// Service B: consumes kafka-demo.b and forwards to kafka-demo.c.
//
// Pure Kafka -> Kafka relay (no HTTP API beyond /health). For each message it
// (1) emits a trace event to the shared trace topic for the gateway UI, and
// (2) forwards the payload to the next topic. Context propagation (the `baggage`
// header carrying mirrord-session, which mirrord queue splitting filters on) is
// handled by the OpenTelemetry propagator via Extract/Inject — driven by
// OTEL_PROPAGATORS, not hand-copied.
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
	"log"
	"net/http"
	"time"

	"github.com/spf13/viper"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
)

type ChainMessage struct {
	TraceID  string `json:"traceId"`
	Sequence int64  `json:"sequence"` // incrementing click number set by the gateway
	Payload  string `json:"payload"`
	Session  string `json:"session"`
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
}

func loadConfig() Config {
	viper.AutomaticEnv()
	viper.SetDefault("PORT", "80")
	viper.SetDefault("KAFKA_ADDRESS", "kafka.infra.svc.cluster.local:9092")
	viper.SetDefault("KAFKA_TOPIC", "kafka-demo.b")
	viper.SetDefault("NEXT_TOPIC", "kafka-demo.c")
	viper.SetDefault("TRACE_TOPIC", "kafka-demo.trace")
	viper.SetDefault("KAFKA_CONSUMER_GROUP", "service-b")
	viper.SetDefault("STAGE", "b")
	viper.SetDefault("SERVICE_NAME", "service-b")
	viper.SetDefault("WORK_MILLIS", 700)

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
	}
}

func main() {
	cfg := loadConfig()
	initPropagator()

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
		fetches.EachRecord(func(rec *kgo.Record) { handleRecord(cfg, cl, rec) })
	}
}

func handleRecord(cfg Config, cl *kgo.Client, rec *kgo.Record) {
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
	log.Printf("[%s] message: seq=%d traceId=%s session=%q payload=%q", cfg.ServiceName, msg.Sequence, msg.TraceID, msg.Session, msg.Payload)

	// Simulate doing some work.
	time.Sleep(time.Duration(cfg.WorkMillis) * time.Millisecond)

	terminal := cfg.NextTopic == ""
	emitTrace(cl, cfg.TraceTopic, msgCtx, TraceEvent{
		TraceID: msg.TraceID, Stage: cfg.Stage, Service: cfg.ServiceName,
		Session: msg.Session, Done: terminal, TS: time.Now().UnixMilli(),
		Message: forwardMessage(cfg, terminal),
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

func emitTrace(cl *kgo.Client, topic string, ctx context.Context, ev TraceEvent) {
	body, _ := json.Marshal(ev)
	headers := []kgo.RecordHeader{{Key: "traceId", Value: []byte(ev.TraceID)}}
	otel.GetTextMapPropagator().Inject(ctx, kafkaHeaderCarrier{headers: &headers})
	rec := &kgo.Record{Topic: topic, Value: body, Headers: headers}
	if err := cl.ProduceSync(context.Background(), rec).FirstErr(); err != nil {
		log.Printf("trace emit error: %v", err)
	}
}
