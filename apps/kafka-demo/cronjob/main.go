// CronJob Z — the DB-state-driven hop of the event-driven kafka-demo mode.
//
// Many real-world architectures aren't a pure Kafka relay: a service writes state
// to a DB, and a CronJob periodically inspects that state and emits a Kafka event.
// This
// binary is that CronJob. It runs to completion on a schedule (a k8s CronJob, e.g.
// every minute):
//
//  1. read the "pending" rows service-b wrote to kafka_demo_events,
//  2. for each, emit a Kafka event to the output topic (service-c's input),
//  3. mark the row "emitted".
//
// Each pending row carries the originating `session` (the mirrord-session baggage
// value). The CronJob reconstructs the W3C Baggage member from it and injects it
// into the outgoing Kafka headers via the same OpenTelemetry carrier the services
// use — so the emitted event stays session-tagged and mirrord queue splitting /
// idle preview environments still route it to the right developer. When the
// CronJob is run under a mirrord preview with DB branching, its reads/writes hit an
// isolated branch, so it only ever sees that developer's own pending rows.
//
// Uses github.com/twmb/franz-go (kgo) as a plain producer (no consumer group) and
// pgx for Postgres, matching the rest of the demo.
package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/viper"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/baggage"
)

// ChainMessage is the payload produced onto the output topic — the same shape the
// gateway/services use, so service-c consumes it unchanged.
type ChainMessage struct {
	TraceID string `json:"traceId"`
	Payload string `json:"payload"`
	Session string `json:"session"`
}

// TraceEvent is the shape every service publishes to the trace topic for the UI.
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
	KafkaAddress string
	OutputTopic  string
	TraceTopic   string
	DatabaseURL  string
	Stage        string
	ServiceName  string
}

func loadConfig() Config {
	viper.AutomaticEnv()
	viper.SetDefault("KAFKA_ADDRESS", "kafka.infra.svc.cluster.local:9092")
	viper.SetDefault("OUTPUT_TOPIC", "kafka-demo.ev.c")
	viper.SetDefault("TRACE_TOPIC", "kafka-demo.ev.trace")
	viper.SetDefault("DATABASE_URL", "")
	viper.SetDefault("STAGE", "z")
	viper.SetDefault("SERVICE_NAME", "cronjob-z")

	return Config{
		KafkaAddress: viper.GetString("KAFKA_ADDRESS"),
		OutputTopic:  viper.GetString("OUTPUT_TOPIC"),
		TraceTopic:   viper.GetString("TRACE_TOPIC"),
		DatabaseURL:  viper.GetString("DATABASE_URL"),
		Stage:        viper.GetString("STAGE"),
		ServiceName:  viper.GetString("SERVICE_NAME"),
	}
}

type pendingEvent struct {
	ID      int64
	TraceID string
	Session string
	Payload string
}

func main() {
	cfg := loadConfig()
	initPropagator()

	if cfg.DatabaseURL == "" {
		log.Fatalf("%s: DATABASE_URL is required (the CronJob reads state written by service-b)", cfg.ServiceName)
	}

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("%s: connect Postgres: %v", cfg.ServiceName, err)
	}
	defer pool.Close()
	// The table is normally created by service-b; ensure it exists so a lone
	// CronJob run (e.g. under a fresh DB branch) doesn't fail on a missing table.
	if err := ensureTable(ctx, pool); err != nil {
		log.Fatalf("%s: ensure table: %v", cfg.ServiceName, err)
	}

	// Plain producer — no consumer group; the CronJob only emits.
	cl, err := kgo.NewClient(kgo.SeedBrokers(cfg.KafkaAddress))
	if err != nil {
		log.Fatalf("%s: kafka client: %v", cfg.ServiceName, err)
	}
	defer cl.Close()

	pending, err := fetchPending(ctx, pool)
	if err != nil {
		log.Fatalf("%s: read pending state: %v", cfg.ServiceName, err)
	}
	if len(pending) == 0 {
		log.Printf("%s: no changed DB state to act on — nothing to emit", cfg.ServiceName)
		return
	}
	log.Printf("%s: found %d pending event(s) in DB state", cfg.ServiceName, len(pending))

	for _, ev := range pending {
		if err := emitAndMark(ctx, cfg, cl, pool, ev); err != nil {
			log.Printf("[%s] failed to emit event id=%d: %v", cfg.ServiceName, ev.ID, err)
			continue
		}
		log.Printf("[%s] DB state changed -> emitted event to %s (trace=%s session=%q)", cfg.ServiceName, cfg.OutputTopic, ev.TraceID, ev.Session)
	}
}

// emitAndMark reconstructs the session baggage, produces the Kafka event to the
// output topic, emits a trace event for the UI, and marks the row emitted.
func emitAndMark(ctx context.Context, cfg Config, cl *kgo.Client, pool *pgxpool.Pool, ev pendingEvent) error {
	// Rebuild the propagated context (W3C baggage: mirrord-session=<session>) from
	// the stored session, so the emitted event is session-tagged exactly as if it
	// had ridden the chain — mirrord queue splitting / idle previews filter on it.
	msgCtx := context.Background()
	if ev.Session != "" {
		if member, err := baggage.NewMember("mirrord-session", ev.Session); err == nil {
			if bag, err := baggage.New(member); err == nil {
				msgCtx = baggage.ContextWithBaggage(msgCtx, bag)
			}
		}
	}

	body, _ := json.Marshal(ChainMessage{TraceID: ev.TraceID, Payload: ev.Payload, Session: ev.Session})
	headers := []kgo.RecordHeader{{Key: "traceId", Value: []byte(ev.TraceID)}}
	otel.GetTextMapPropagator().Inject(msgCtx, kafkaHeaderCarrier{headers: &headers})

	rec := &kgo.Record{Topic: cfg.OutputTopic, Value: body, Headers: headers}
	if err := cl.ProduceSync(ctx, rec).FirstErr(); err != nil {
		return err
	}

	emitTrace(cl, cfg.TraceTopic, msgCtx, TraceEvent{
		TraceID: ev.TraceID, Stage: cfg.Stage, Service: cfg.ServiceName,
		Session: ev.Session, Done: false, TS: time.Now().UnixMilli(),
		Message: "saw changed DB state — emitted event to " + cfg.OutputTopic,
	})

	return markEmitted(ctx, pool, ev.ID)
}

func ensureTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS kafka_demo_events (
		id bigserial PRIMARY KEY,
		trace_id text NOT NULL,
		session text NOT NULL DEFAULT '',
		payload text NOT NULL DEFAULT '',
		status text NOT NULL DEFAULT 'pending',
		created_at timestamptz NOT NULL DEFAULT now()
	)`)
	return err
}

func fetchPending(ctx context.Context, pool *pgxpool.Pool) ([]pendingEvent, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, trace_id, session, payload
		FROM kafka_demo_events
		WHERE status = 'pending'
		ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []pendingEvent
	for rows.Next() {
		var e pendingEvent
		if err := rows.Scan(&e.ID, &e.TraceID, &e.Session, &e.Payload); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func markEmitted(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	_, err := pool.Exec(ctx, `UPDATE kafka_demo_events SET status = 'emitted' WHERE id = $1`, id)
	return err
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
