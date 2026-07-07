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
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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
type ChainMessage struct {
	TraceID  string `json:"traceId"`
	Sequence int64  `json:"sequence"` // incrementing click number: 1, 2, 3, ...
	Payload  string `json:"payload"`
	Session  string `json:"session"`
}

// clickCounter is the in-memory fallback used only when DATABASE_URL is unset or
// the database is unreachable; otherwise the count is persisted in Postgres so it
// survives gateway restarts.
var clickCounter atomic.Int64

type Config struct {
	Port         string
	KafkaAddress string
	FirstTopic   string
	TraceTopic   string
	TraceGroupID string
	// DatabaseURL, when set, persists the click counter in Postgres (survives
	// restarts). Empty = in-memory counter (resets on restart).
	DatabaseURL string
	// BasePath lets the app be served under a sub-path (e.g. "/kafka-demo") behind
	// an ingress that does NOT rewrite. Empty = served at root. No trailing slash.
	BasePath string
}

func loadConfig() Config {
	viper.AutomaticEnv()
	viper.SetDefault("PORT", "80")
	viper.SetDefault("KAFKA_ADDRESS", "kafka.infra.svc.cluster.local:9092")
	viper.SetDefault("FIRST_TOPIC", "kafka-demo.a")
	viper.SetDefault("TRACE_TOPIC", "kafka-demo.trace")
	viper.SetDefault("TRACE_GROUP_ID", "kafka-demo-gateway")
	viper.SetDefault("DATABASE_URL", "")
	viper.SetDefault("BASE_PATH", "")

	return Config{
		Port:         viper.GetString("PORT"),
		KafkaAddress: viper.GetString("KAFKA_ADDRESS"),
		FirstTopic:   viper.GetString("FIRST_TOPIC"),
		TraceTopic:   viper.GetString("TRACE_TOPIC"),
		TraceGroupID: viper.GetString("TRACE_GROUP_ID"),
		DatabaseURL:  viper.GetString("DATABASE_URL"),
		BasePath:     strings.TrimSuffix(viper.GetString("BASE_PATH"), "/"),
	}
}

// setupCounterDB connects to Postgres and ensures the counter table exists.
// Returns nil (no error) with a nil pool when DATABASE_URL is unset — the gateway
// then falls back to the in-memory counter.
func setupCounterDB(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, nil
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	_, err = pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS kafka_demo_click_counter (
		id int PRIMARY KEY,
		count bigint NOT NULL
	)`)
	if err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// nextSequence returns the next click number. Backed by Postgres when pool is
// non-nil (atomic increment, persisted); otherwise falls back to the in-memory
// counter (also used if the DB call fails, so the demo never blocks on the DB).
func nextSequence(ctx context.Context, pool *pgxpool.Pool) int64 {
	if pool == nil {
		return clickCounter.Add(1)
	}
	var n int64
	err := pool.QueryRow(ctx, `
		INSERT INTO kafka_demo_click_counter (id, count) VALUES (1, 1)
		ON CONFLICT (id) DO UPDATE SET count = kafka_demo_click_counter.count + 1
		RETURNING count`).Scan(&n)
	if err != nil {
		log.Printf("db counter error, falling back to memory: %v", err)
		return clickCounter.Add(1)
	}
	return n
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

	// Persistent click counter in Postgres (falls back to memory if unset/unreachable).
	dbPool, err := setupCounterDB(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Printf("counter DB setup failed, using in-memory counter: %v", err)
	} else if dbPool != nil {
		defer dbPool.Close()
		log.Printf("click counter persisted in Postgres")
	}

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

	router := gin.Default()
	router.Use(cors.Default())

	// Health stays at the root so k8s probes and the GCE load-balancer health
	// check reach it regardless of BasePath.
	router.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })

	// All app routes live under BasePath (e.g. "/kafka-demo"); empty = root. The
	// ingress forwards the full path (no rewrite), so the routes carry the prefix.
	app := router.Group(cfg.BasePath)

	// Serve the embedded single-page UI, injecting <base> so the page's relative
	// fetches ("produce", "trace/..") resolve under BasePath.
	indexPage := indexHTML
	if cfg.BasePath != "" {
		indexPage = bytes.Replace(indexHTML, []byte("<head>"),
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

		seq := nextSequence(c.Request.Context(), dbPool)
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

		msg := ChainMessage{TraceID: traceID, Sequence: seq, Payload: req.Payload, Session: session}
		body, _ := json.Marshal(msg)
		log.Printf("[gateway] button click #%d -> traceId=%s session=%q", seq, traceID, session)

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
			Session: session, Message: fmt.Sprintf("click #%d produced to %s", seq, cfg.FirstTopic),
			TS: time.Now().UnixMilli(),
		})

		c.JSON(http.StatusOK, gin.H{"traceId": traceID})
	})

	// GET /trace/:id -> [TraceEvent] — the UI polls this.
	app.GET("/trace/:id", func(c *gin.Context) {
		c.JSON(http.StatusOK, store.get(c.Param("id")))
	})

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
