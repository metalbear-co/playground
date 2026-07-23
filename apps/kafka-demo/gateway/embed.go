package main

import _ "embed"

//go:embed index.html
var indexHTML []byte

// index_event.html is the event-driven mode UI, served when UI_VARIANT=event-driven.
// It lights up A -> B(writes DB) -> CronJob Z -> C instead of the pure Kafka chain.
//
//go:embed index_event.html
var indexEventHTML []byte
