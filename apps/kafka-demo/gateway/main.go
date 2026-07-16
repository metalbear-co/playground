// gateway is the entry point of the kafka-demo chain.
//
// It serves a single-button web UI and, when the button is pressed, produces a
// message to the first Kafka topic (service-a's input). Every service in the
// chain publishes a small "trace" event to a shared topic as it processes the
// message; the gateway consumes that topic and exposes the events per traceId so
// the UI can light up Service A -> B -> C live.
//
// The whole point of the demo is Kafka -> Kafka -> Kafka: the gateway is the only
// HTTP surface, everything downstream is queue-to-queue. The `baggage` header
// carrying `mirrord-session=<session>` is propagated across every hop so mirrord
// queue splitting can steal a single developer's messages out of the shared chain.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/viper"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/propagation"
)

// TraceEvent is the shape every service publishes to the trace topic.
type TraceEvent struct {
	TraceID string `json:"traceId"`
	Stage   string `json:"stage"`   // "gateway" | "a" | "b" | "c"
	Service string `json:"service"` // human-readable service name
	Session string `json:"session"` // mirrord session from baggage, "" for production
	Message string `json:"message"`
	Done    bool   `json:"done"` // true on the terminal service (C)
	TS      int64  `json:"ts"`   // unix millis
}

// ChainMessage is the payload produced onto the first topic and forwarded on.
// The message counter lives in the terminal service (service-c), not here — the
// gateway just produces the message.
type ChainMessage struct {
	TraceID string `json:"traceId"`
	Payload string `json:"payload"`
	Session string `json:"session"`
}

type Config struct {
	Port         string
	KafkaAddress string
	FirstTopic   string
	TraceTopic   string
	TraceGroupID string
	// BasePath lets the app be served under a sub-path (e.g. "/kafka-demo") behind
	// an ingress that does NOT rewrite. Empty = served at root. No trailing slash.
	BasePath string
	// UIVariant selects which embedded page to serve. "" (default) = the base
	// Kafka -> Kafka -> Kafka UI. "event-driven" = the A -> B(DB) -> CronJob Z -> C
	// UI. The rest of the gateway (produce/trace) is variant-agnostic.
	UIVariant string
	// CronEnabled turns on the in-gateway, UI-controllable CronJob Z (start/stop
	// buttons, activity log, DB-state panel) for the interactive event-driven demo.
	// Requires DatabaseURL. Off by default so the real k8s CronJob owns the schedule.
	CronEnabled bool
	// DatabaseURL is the Postgres connection for the cron runner + DB-state panel.
	DatabaseURL string
	// CronOutputTopic is where the cron runner emits (service-c's input).
	CronOutputTopic string
	// CronIntervalSecs is how often the running cron inspects DB state.
	CronIntervalSecs int
}

func loadConfig() Config {
	viper.AutomaticEnv()
	viper.SetDefault("PORT", "80")
	viper.SetDefault("KAFKA_ADDRESS", "kafka.infra.svc.cluster.local:9092")
	viper.SetDefault("FIRST_TOPIC", "kafka-demo.a")
	viper.SetDefault("TRACE_TOPIC", "kafka-demo.trace")
	viper.SetDefault("TRACE_GROUP_ID", "kafka-demo-gateway")
	viper.SetDefault("BASE_PATH", "")
	viper.SetDefault("UI_VARIANT", "")
	viper.SetDefault("CRON_ENABLED", false)
	viper.SetDefault("DATABASE_URL", "")
	viper.SetDefault("CRON_OUTPUT_TOPIC", "kafka-demo.ev.c")
	viper.SetDefault("CRON_INTERVAL_SECS", 15)

	return Config{
		Port:             viper.GetString("PORT"),
		KafkaAddress:     viper.GetString("KAFKA_ADDRESS"),
		FirstTopic:       viper.GetString("FIRST_TOPIC"),
		TraceTopic:       viper.GetString("TRACE_TOPIC"),
		TraceGroupID:     viper.GetString("TRACE_GROUP_ID"),
		BasePath:         strings.TrimSuffix(viper.GetString("BASE_PATH"), "/"),
		UIVariant:        viper.GetString("UI_VARIANT"),
		CronEnabled:      viper.GetBool("CRON_ENABLED"),
		DatabaseURL:      viper.GetString("DATABASE_URL"),
		CronOutputTopic:  viper.GetString("CRON_OUTPUT_TOPIC"),
		CronIntervalSecs: viper.GetInt("CRON_INTERVAL_SECS"),
	}
}

// traceStore keeps the last events per traceId in memory so the UI can poll them.
type traceStore struct {
	mu     sync.Mutex
	events map[string][]TraceEvent
	order  []string // traceIds, oldest first, for capped eviction
}

const maxTraces = 200

func newTraceStore() *traceStore {
	return &traceStore{events: make(map[string][]TraceEvent)}
}

func (s *traceStore) add(ev TraceEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.events[ev.TraceID]; !ok {
		s.order = append(s.order, ev.TraceID)
		for len(s.order) > maxTraces {
			oldest := s.order[0]
			s.order = s.order[1:]
			delete(s.events, oldest)
		}
	}
	s.events[ev.TraceID] = append(s.events[ev.TraceID], ev)
}

func (s *traceStore) get(traceID string) []TraceEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]TraceEvent, len(s.events[traceID]))
	copy(out, s.events[traceID])
	sort.SliceStable(out, func(i, j int) bool { return out[i].TS < out[j].TS })
	return out
}

func newTraceID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func main() {
	cfg := loadConfig()
	initPropagator()
	store := newTraceStore()

	// One franz-go client: produces to the first topic AND consumes the trace topic.
	cl, err := kgo.NewClient(
		kgo.SeedBrokers(cfg.KafkaAddress),
		kgo.ConsumerGroup(cfg.TraceGroupID),
		kgo.ConsumeTopics(cfg.TraceTopic),
		kgo.Balancers(kgo.RangeBalancer()),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
	)
	if err != nil {
		log.Fatalf("kafka client: %v", err)
	}
	defer cl.Close()

	// Background consumer of the trace topic. Everything services emit lands here.
	go consumeTrace(cl, store)

	// Optional: in-gateway, UI-controllable CronJob Z for the interactive demo.
	var cron *cronRunner
	if cfg.CronEnabled && cfg.DatabaseURL != "" {
		pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("cron: connect Postgres: %v", err)
		}
		defer pool.Close()
		if err := ensureEventsTable(context.Background(), pool); err != nil {
			log.Fatalf("cron: ensure events table: %v", err)
		}
		cron = newCronRunner(pool, cl, store, cfg.CronOutputTopic,
			time.Duration(cfg.CronIntervalSecs)*time.Second)
		log.Printf("cron control enabled (output=%s interval=%ds)", cfg.CronOutputTopic, cfg.CronIntervalSecs)
	}

	router := gin.Default()
	router.Use(cors.Default())

	// Health stays at the root so k8s probes and the GCE load-balancer health
	// check reach it regardless of BasePath.
	router.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	// All app routes live under BasePath (e.g. "/kafka-demo"); empty = root. The
	// ingress forwards the full path (no rewrite), so the routes carry the prefix.
	app := router.Group(cfg.BasePath)

	// Serve the embedded single-page UI, injecting <base> so the page's relative
	// fetches ("produce", "trace/..") resolve under BasePath. UI_VARIANT picks which
	// page: the base Kafka chain, or the event-driven (DB + CronJob) flow.
	indexPage := indexHTML
	if cfg.UIVariant == "event-driven" {
		indexPage = indexEventHTML
	}
	if cfg.BasePath != "" {
		indexPage = bytes.Replace(indexPage, []byte("<head>"),
			[]byte("<head>\n  <base href=\""+cfg.BasePath+"/\">"), 1)
	}
	app.GET("/", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexPage)
	})

	// POST /produce { "payload": "...", "session": "optional" } -> { "traceId": "..." }
	app.POST("/produce", func(c *gin.Context) {
		var req struct {
			Payload string `json:"payload"`
			Session string `json:"session"`
		}
		_ = c.ShouldBindJSON(&req)
		if req.Payload == "" {
			req.Payload = "hello from the button"
		}

		traceID := newTraceID()

		// Extract any propagated context (W3C baggage / traceparent) from the incoming
		// HTTP request, so a caller can pass `baggage: mirrord-session=<you>` directly
		// (the realistic OTel entry-point behavior). The `session` body field, when
		// set, sets/overrides the mirrord-session baggage. mirrord queue splitting
		// filters on the resulting `baggage` Kafka header.
		reqCtx := otel.GetTextMapPropagator().Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))
		if req.Session != "" {
			if member, err := baggage.NewMember("mirrord-session", req.Session); err == nil {
				if bag, err := baggage.New(member); err == nil {
					reqCtx = baggage.ContextWithBaggage(reqCtx, bag)
				}
			}
		}
		// Effective session = whatever ended up in baggage (from header or body).
		session := baggage.FromContext(reqCtx).Member("mirrord-session").Value()

		msg := ChainMessage{TraceID: traceID, Payload: req.Payload, Session: session}
		body, _ := json.Marshal(msg)
		log.Printf("[gateway] produced traceId=%s session=%q", traceID, session)

		headers := []kgo.RecordHeader{{Key: "traceId", Value: []byte(traceID)}}
		otel.GetTextMapPropagator().Inject(reqCtx, kafkaHeaderCarrier{headers: &headers})

		ctx, cancel := context.WithTimeout(reqCtx, 10*time.Second)
		defer cancel()
		rec := &kgo.Record{Topic: cfg.FirstTopic, Value: body, Headers: headers}
		if err := cl.ProduceSync(ctx, rec).FirstErr(); err != nil {
			log.Printf("produce failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Record the kickoff so the UI has something immediately.
		store.add(TraceEvent{
			TraceID: traceID, Stage: "gateway", Service: "gateway",
			Session: session, Message: "produced to " + cfg.FirstTopic,
			TS: time.Now().UnixMilli(),
		})

		c.JSON(http.StatusOK, gin.H{"traceId": traceID})
	})

	// GET /trace/:id -> [TraceEvent] — the UI polls this.
	app.GET("/trace/:id", func(c *gin.Context) {
		c.JSON(http.StatusOK, store.get(c.Param("id")))
	})

	// CronJob Z control + DB-state, for the interactive event-driven demo. Only wired
	// up when CRON_ENABLED=true; otherwise the UI hides these controls.
	if cron != nil {
		app.POST("/cron/start", func(c *gin.Context) {
			cron.start()
			c.JSON(http.StatusOK, gin.H{"running": cron.isRunning()})
		})
		app.POST("/cron/stop", func(c *gin.Context) {
			cron.stop()
			c.JSON(http.StatusOK, gin.H{"running": cron.isRunning()})
		})
		app.POST("/cron/run", func(c *gin.Context) {
			go cron.runOnce(context.Background()) // one-off run, don't block the request
			c.JSON(http.StatusOK, gin.H{"running": cron.isRunning()})
		})
		app.POST("/cron/clear-log", func(c *gin.Context) {
			cron.clearLog()
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})
		app.POST("/cron/interval", func(c *gin.Context) {
			var req struct {
				Secs int `json:"secs"`
			}
			_ = c.ShouldBindJSON(&req)
			if req.Secs < 1 {
				req.Secs = 1
			}
			cron.setInterval(time.Duration(req.Secs) * time.Second)
			c.JSON(http.StatusOK, gin.H{"intervalSecs": req.Secs})
		})
		app.GET("/cron/status", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"enabled":      true,
				"running":      cron.isRunning(),
				"intervalSecs": cron.intervalSecs(),
				"log":          cron.snapshotLogs(),
			})
		})
		app.GET("/db-state", func(c *gin.Context) {
			rows, err := cron.fetchAll(c.Request.Context())
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, rows)
		})
		// POST /db/clear -> empty kafka_demo_events (the DB-state panel).
		app.POST("/db/clear", func(c *gin.Context) {
			if err := cron.clearEvents(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})
		// GET /count -> service-c's terminal DB counter (messages that completed the chain).
		app.GET("/count", func(c *gin.Context) {
			n, err := cron.completedCount(c.Request.Context())
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"completed": n})
		})
	} else {
		// Report disabled so the UI can hide the cron/DB panels.
		app.GET("/cron/status", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"enabled": false})
		})
	}

	log.Printf("gateway listening on :%s (kafka=%s first_topic=%s trace_topic=%s)",
		cfg.Port, cfg.KafkaAddress, cfg.FirstTopic, cfg.TraceTopic)
	if err := router.Run("0.0.0.0:" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}

func consumeTrace(cl *kgo.Client, store *traceStore) {
	for {
		fetches := cl.PollFetches(context.Background())
		if errs := fetches.Errors(); len(errs) > 0 {
			for _, e := range errs {
				log.Printf("trace fetch error: topic=%s err=%v", e.Topic, e.Err)
			}
			time.Sleep(time.Second)
			continue
		}
		fetches.EachRecord(func(rec *kgo.Record) {
			var ev TraceEvent
			if err := json.Unmarshal(rec.Value, &ev); err != nil {
				log.Printf("bad trace event: %v", err)
				return
			}
			store.add(ev)
		})
	}
}
