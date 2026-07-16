// Service B: consumes kafka-demo.b and forwards to kafka-demo.c.
//
// Pure Kafka -> Kafka relay (no HTTP API beyond /health). For each message it
// (1) emits a trace event to the shared trace topic for the gateway UI, and
// (2) forwards the payload to the next topic. Context propagation (the `baggage`
// header carrying mirrord-session, which mirrord queue splitting filters on) is
// handled by the OpenTelemetry propagator via Extract/Inject — driven by
// OTEL_PROPAGATORS, not hand-copied.
//
// The terminal service (service-c) additionally persists a running counter in
// Postgres — it writes (+1) and reads back the total number of messages that
// completed the chain, so the count survives restarts. Only the service given
// DATABASE_URL opens a DB connection; the others skip it. This is also what makes
// mirrord DB branching meaningful on that service.
//
// Uses github.com/twmb/franz-go (kgo). franz-go's consumer-group implementation
// correctly assigns partitions when group members subscribe to different topics —
// which is exactly what mirrord Kafka queue splitting does (the operator's
// forwarder and the client share a group but consume different topics). It is
// configured with the Range balancer to match the operator's
// `partition.assignment.strategy: range` (MirrordPropertyList).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/viper"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
)

type ChainMessage struct {
	TraceID string `json:"traceId"`
	Payload string `json:"payload"`
	Session string `json:"session"`
}

type TraceEvent struct {
	TraceID string `json:"traceId"`
	Stage   string `json:"stage"`
	Service string `json:"service"`
	Session string `json:"session"`
	Message string `json:"message"`
	Done    bool   `json:"done"`
	TS      int64  `json:"ts"`
}

type Config struct {
	Port          string
	KafkaAddress  string
	InTopic       string
	NextTopic     string // empty = terminal service (no forward)
	TraceTopic    string
	ConsumerGroup string
	Stage         string
	ServiceName   string
	WorkMillis    int
	// DatabaseURL, when set, connects to Postgres. In the default (relay/terminal)
	// mode it persists the processed counter; in event-sink mode it records pending
	// event state for CronJob Z. Empty = no DB.
	DatabaseURL string
	// DBMode selects the DB behavior. "" (default) = terminal processed-counter
	// (base demo). "event-sink" = service-b in the event-driven mode: write a
	// pending row to kafka_demo_events instead of forwarding to Kafka.
	DBMode string
}

func loadConfig() Config {
	viper.AutomaticEnv()
	// Treat an explicitly-empty env var as set, not unset. This matters for
	// NEXT_TOPIC="" — the documented "terminal service" convention — which viper
	// would otherwise ignore, falling back to the default and making the service
	// try to forward (and never signal end-of-chain).
	viper.AllowEmptyEnv(true)
	viper.SetDefault("PORT", "80")
	viper.SetDefault("KAFKA_ADDRESS", "kafka.infra.svc.cluster.local:9092")
	viper.SetDefault("KAFKA_TOPIC", "kafka-demo.b")
	viper.SetDefault("NEXT_TOPIC", "kafka-demo.c")
	viper.SetDefault("TRACE_TOPIC", "kafka-demo.trace")
	viper.SetDefault("KAFKA_CONSUMER_GROUP", "service-b")
	viper.SetDefault("STAGE", "b")
	viper.SetDefault("SERVICE_NAME", "service-b")
	viper.SetDefault("WORK_MILLIS", 700)
	viper.SetDefault("DATABASE_URL", "")
	viper.SetDefault("DB_MODE", "")

	return Config{
		Port:          viper.GetString("PORT"),
		KafkaAddress:  viper.GetString("KAFKA_ADDRESS"),
		InTopic:       viper.GetString("KAFKA_TOPIC"),
		NextTopic:     viper.GetString("NEXT_TOPIC"),
		TraceTopic:    viper.GetString("TRACE_TOPIC"),
		ConsumerGroup: viper.GetString("KAFKA_CONSUMER_GROUP"),
		Stage:         viper.GetString("STAGE"),
		ServiceName:   viper.GetString("SERVICE_NAME"),
		WorkMillis:    viper.GetInt("WORK_MILLIS"),
		DatabaseURL:   viper.GetString("DATABASE_URL"),
		DBMode:        viper.GetString("DB_MODE"),
	}
}

func main() {
	cfg := loadConfig()
	initPropagator()

	// Services given DATABASE_URL open a pool. In the default mode only the terminal
	// service (service-c) does, for the processed counter; in event-sink mode the
	// event-driven service-b holds the pending event-state table instead.
	var (
		dbPool *pgxpool.Pool
		err    error
	)
	if cfg.DBMode == "event-sink" {
		dbPool, err = setupEventsDB(context.Background(), cfg.DatabaseURL)
	} else {
		dbPool, err = setupCounterDB(context.Background(), cfg.DatabaseURL)
	}
	if err != nil {
		log.Printf("%s: DB setup failed (continuing without it): %v", cfg.ServiceName, err)
	} else if dbPool != nil {
		defer dbPool.Close()
		if cfg.DBMode == "event-sink" {
			log.Printf("%s: pending event state persisted in Postgres (event-sink mode)", cfg.ServiceName)
		} else {
			log.Printf("%s: processed counter persisted in Postgres", cfg.ServiceName)
		}
	}

	cl, err := kgo.NewClient(
		kgo.SeedBrokers(cfg.KafkaAddress),
		kgo.ConsumerGroup(cfg.ConsumerGroup),
		kgo.ConsumeTopics(cfg.InTopic),
		// Match the operator's `partition.assignment.strategy: range` so the split
		// group negotiates a common protocol.
		kgo.Balancers(kgo.RangeBalancer()),
		// New group with no committed offset starts at the end (only new messages).
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
	)
	if err != nil {
		log.Fatalf("kafka client: %v", err)
	}
	defer cl.Close()

	// Minimal health endpoint so k8s probes and mirrord targeting have a port.
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
		log.Printf("%s health server on :%s", cfg.ServiceName, cfg.Port)
		_ = http.ListenAndServe("0.0.0.0:"+cfg.Port, mux)
	}()

	log.Printf("%s consuming %s (group=%s) -> %s", cfg.ServiceName, cfg.InTopic, cfg.ConsumerGroup, cfg.NextTopic)

	ctx := context.Background()
	for {
		fetches := cl.PollFetches(ctx)
		if errs := fetches.Errors(); len(errs) > 0 {
			for _, e := range errs {
				log.Printf("fetch error: topic=%s partition=%d err=%v", e.Topic, e.Partition, e.Err)
			}
			time.Sleep(time.Second)
			continue
		}
		fetches.EachRecord(func(rec *kgo.Record) { handleRecord(cfg, cl, dbPool, rec) })
	}
}

func handleRecord(cfg Config, cl *kgo.Client, db *pgxpool.Pool, rec *kgo.Record) {
	// Log every consumed message up front, naming the consuming service.
	log.Printf("[%s] CONSUMED kafka message: topic=%s partition=%d offset=%d", cfg.ServiceName, rec.Topic, rec.Partition, rec.Offset)

	// Extract propagated context (incl. W3C baggage / mirrord-session) from the
	// incoming record headers. Which formats are read is driven by OTEL_PROPAGATORS.
	msgCtx := otel.GetTextMapPropagator().Extract(context.Background(), kafkaHeaderCarrier{headers: &rec.Headers})

	var msg ChainMessage
	if err := json.Unmarshal(rec.Value, &msg); err != nil {
		log.Printf("bad message: %v", err)
		return
	}
	log.Printf("[%s] message: traceId=%s session=%q payload=%q", cfg.ServiceName, msg.TraceID, msg.Session, msg.Payload)

	// Simulate doing some work.
	time.Sleep(time.Duration(cfg.WorkMillis) * time.Millisecond)

	// Event-driven mode (service-b): instead of forwarding to Kafka, record the
	// message as pending state in the DB. CronJob Z later sees the changed state
	// and emits the next Kafka event. The session is stored so the CronJob can
	// re-tag the event it emits (keeping queue splitting / idle previews working).
	if cfg.DBMode == "event-sink" {
		msgText := "wrote pending state to DB"
		if db != nil {
			if id, err := insertEventRow(context.Background(), db, msg); err != nil {
				log.Printf("[%s] events DB error: %v", cfg.ServiceName, err)
			} else {
				msgText = fmt.Sprintf("wrote pending state to DB (id #%d)", id)
				log.Printf("[%s] wrote pending state to DB id #%d (trace=%s session=%q) for CronJob Z", cfg.ServiceName, id, msg.TraceID, msg.Session)
			}
		}
		emitTrace(cl, cfg.TraceTopic, msgCtx, TraceEvent{
			TraceID: msg.TraceID, Stage: cfg.Stage, Service: cfg.ServiceName,
			Session: msg.Session, Done: false, TS: time.Now().UnixMilli(),
			Message: msgText,
		})
		return
	}

	terminal := cfg.NextTopic == ""
	msgText := forwardMessage(cfg, terminal)

	// Terminal service persists the counter: write (+1) and read back the total.
	// This is the end of the chain, so the increment shows up last in the logs.
	if terminal && db != nil {
		if n, err := incrementCounter(context.Background(), db); err != nil {
			log.Printf("[%s] counter DB error: %v", cfg.ServiceName, err)
		} else {
			msgText = fmt.Sprintf("%s (message #%d)", msgText, n)
			log.Printf("[%s] DB counter incremented -> %d messages have completed the chain", cfg.ServiceName, n)
		}
	}

	emitTrace(cl, cfg.TraceTopic, msgCtx, TraceEvent{
		TraceID: msg.TraceID, Stage: cfg.Stage, Service: cfg.ServiceName,
		Session: msg.Session, Done: terminal, TS: time.Now().UnixMilli(),
		Message: msgText,
	})

	if !terminal {
		headers := []kgo.RecordHeader{{Key: "traceId", Value: []byte(msg.TraceID)}}
		// Inject the propagated context (baggage, traceparent, ...) into the
		// outgoing headers — no explicit knowledge of the baggage header here.
		otel.GetTextMapPropagator().Inject(msgCtx, kafkaHeaderCarrier{headers: &headers})
		out := &kgo.Record{Topic: cfg.NextTopic, Value: rec.Value, Headers: headers}
		if err := cl.ProduceSync(context.Background(), out).FirstErr(); err != nil {
			log.Printf("forward error: %v", err)
		}
	}
}

func forwardMessage(cfg Config, terminal bool) string {
	if terminal {
		return "processed — end of chain"
	}
	return "processed, forwarded to " + cfg.NextTopic
}

// setupCounterDB connects to Postgres and ensures the counter table exists.
// Returns (nil, nil) when url is empty — the service then runs without a counter.
func setupCounterDB(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, nil
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS kafka_demo_click_counter (
		id int PRIMARY KEY,
		count bigint NOT NULL
	)`); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// incrementCounter writes (+1) and reads back the running total of messages that
// completed the chain. Atomic upsert; RETURNING gives the new value.
func incrementCounter(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
		INSERT INTO kafka_demo_click_counter (id, count) VALUES (1, 1)
		ON CONFLICT (id) DO UPDATE SET count = kafka_demo_click_counter.count + 1
		RETURNING count`).Scan(&n)
	return n, err
}

// setupEventsDB connects to Postgres and ensures the event-state table exists.
// Used by service-b in the event-driven mode (DB_MODE=event-sink): each consumed
// message is recorded as a "pending" row that CronJob Z later picks up, emits, and
// marks "emitted". Returns (nil, nil) when url is empty — the service then runs
// without a DB. This table is also what makes DB branching meaningful for the
// CronJob (it reads an isolated schema-only branch under a preview).
func setupEventsDB(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		return nil, nil
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS kafka_demo_events (
		id bigserial PRIMARY KEY,
		trace_id text NOT NULL,
		session text NOT NULL DEFAULT '',
		payload text NOT NULL DEFAULT '',
		status text NOT NULL DEFAULT 'pending',
		created_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// insertEventRow records a consumed message as pending state for CronJob Z to see.
// The session and traceId are stored so the CronJob can re-tag (baggage) and trace
// the event it later emits.
func insertEventRow(ctx context.Context, pool *pgxpool.Pool, msg ChainMessage) (int64, error) {
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO kafka_demo_events (trace_id, session, payload, status)
		VALUES ($1, $2, $3, 'pending')
		RETURNING id`, msg.TraceID, msg.Session, msg.Payload).Scan(&id)
	return id, err
}

func emitTrace(cl *kgo.Client, topic string, ctx context.Context, ev TraceEvent) {
	body, _ := json.Marshal(ev)
	headers := []kgo.RecordHeader{{Key: "traceId", Value: []byte(ev.TraceID)}}
	otel.GetTextMapPropagator().Inject(ctx, kafkaHeaderCarrier{headers: &headers})
	rec := &kgo.Record{Topic: topic, Value: body, Headers: headers}
	if err := cl.ProduceSync(context.Background(), rec).FirstErr(); err != nil {
		log.Printf("trace emit error: %v", err)
	}
}
