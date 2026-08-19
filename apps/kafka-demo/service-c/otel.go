package main

import (
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/contrib/propagators/autoprop"
	"go.opentelemetry.io/otel"
)

// initPropagator installs the global OpenTelemetry text-map propagator. It honors
// the OTEL_PROPAGATORS environment variable (default "tracecontext,baggage"), so
// the `baggage` header carrying mirrord-session=<user> is injected and extracted
// automatically at every Kafka hop — no hand-copying of headers.
func initPropagator() {
	otel.SetTextMapPropagator(autoprop.NewTextMapPropagator())
}

// kafkaHeaderCarrier adapts a slice of Kafka record headers to a
// propagation.TextMapCarrier, so otel.GetTextMapPropagator().Inject/Extract can
// read and write propagated context (W3C baggage, traceparent, ...) directly on
// Kafka records.
type kafkaHeaderCarrier struct {
	headers *[]kgo.RecordHeader
}

func (c kafkaHeaderCarrier) Get(key string) string {
	for _, h := range *c.headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

func (c kafkaHeaderCarrier) Set(key, value string) {
	for i := range *c.headers {
		if (*c.headers)[i].Key == key {
			(*c.headers)[i].Value = []byte(value)
			return
		}
	}
	*c.headers = append(*c.headers, kgo.RecordHeader{Key: key, Value: []byte(value)})
}

func (c kafkaHeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(*c.headers))
	for _, h := range *c.headers {
		keys = append(keys, h.Key)
	}
	return keys
}
