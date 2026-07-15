package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/baggage"
)

// cronLogEntry is one line in the CronJob Z activity log the UI shows.
type cronLogEntry struct {
	TS      int64  `json:"ts"`
	Message string `json:"message"`
}

// dbRow mirrors a kafka_demo_events row for the UI's DB-state panel.
type dbRow struct {
	ID        int64  `json:"id"`
	TraceID   string `json:"traceId"`
	Session   string `json:"session"`
	Payload   string `json:"payload"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

// cronRunner is an in-gateway, UI-controllable stand-in for CronJob Z, for the
// interactive event-driven demo. Start/stop it from the browser; each run reads the
// "pending" rows service-b wrote to kafka_demo_events, emits a (session-tagged) event
// to the output topic, and marks them "emitted" — logging when it starts and ends so
// the DB state change is easy to narrate. In a real cluster the standalone CronJob Z
// image / k8s CronJob does this on a schedule; this only exists when CRON_ENABLED=true.
type cronRunner struct {
	db          *pgxpool.Pool
	cl          *kgo.Client
	store       *traceStore
	outputTopic string
	interval    time.Duration

	mu      sync.Mutex
	running bool
	cancel  context.CancelFunc
	logs    []cronLogEntry
}

const maxCronLogs = 100

func newCronRunner(db *pgxpool.Pool, cl *kgo.Client, store *traceStore, outputTopic string, interval time.Duration) *cronRunner {
	return &cronRunner{db: db, cl: cl, store: store, outputTopic: outputTopic, interval: interval}
}

func (r *cronRunner) addLog(format string, args ...any) {
	entry := cronLogEntry{TS: time.Now().UnixMilli(), Message: fmt.Sprintf(format, args...)}
	r.mu.Lock()
	r.logs = append(r.logs, entry)
	if len(r.logs) > maxCronLogs {
		r.logs = r.logs[len(r.logs)-maxCronLogs:]
	}
	r.mu.Unlock()
	log.Printf("[cronjob-z] %s", entry.Message)
}

// start begins the periodic loop. Returns false if it was already running.
func (r *cronRunner) start() bool {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.running = true
	r.cancel = cancel
	r.mu.Unlock()
	r.addLog("CronJob Z STARTED — will inspect DB state every %s", r.interval)
	go r.loop(ctx)
	return true
}

// stop halts the periodic loop. Returns false if it wasn't running.
func (r *cronRunner) stop() bool {
	r.mu.Lock()
	if !r.running {
		r.mu.Unlock()
		return false
	}
	r.running = false
	if r.cancel != nil {
		r.cancel()
	}
	r.mu.Unlock()
	r.addLog("CronJob Z STOPPED")
	return true
}

func (r *cronRunner) isRunning() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.running
}

func (r *cronRunner) snapshotLogs() []cronLogEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]cronLogEntry, len(r.logs))
	copy(out, r.logs)
	return out
}

// clearLog empties the activity log.
func (r *cronRunner) clearLog() {
	r.mu.Lock()
	r.logs = nil
	r.mu.Unlock()
}

func (r *cronRunner) intervalSecs() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return int(r.interval.Seconds())
}

// setInterval changes the delay between runs. Takes effect on the next wait — the
// loop re-reads the interval each cycle — so it can be changed live, mid-run.
func (r *cronRunner) setInterval(d time.Duration) {
	r.mu.Lock()
	r.interval = d
	r.mu.Unlock()
	r.addLog("interval changed — CronJob Z now inspects DB state every %s", d)
}

func (r *cronRunner) loop(ctx context.Context) {
	r.runOnce(ctx) // run immediately on start
	for {
		r.mu.Lock()
		d := r.interval
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(d):
			r.runOnce(ctx)
		}
	}
}

// runOnce is a single CronJob Z tick: read changed DB state, emit events, mark emitted.
func (r *cronRunner) runOnce(ctx context.Context) {
	rows, err := r.fetchPending(ctx)
	if err != nil {
		r.addLog("run FAILED reading DB state: %v", err)
		return
	}
	if len(rows) == 0 {
		r.addLog("run at %s — no changed DB state (0 pending), nothing to emit", time.Now().Format("15:04:05"))
		return
	}
	r.addLog("run STARTED — saw %d changed row(s) in DB state (status=pending)", len(rows))
	emitted := 0
	for _, row := range rows {
		if err := r.emitAndMark(ctx, row); err != nil {
			r.addLog("  emit FAILED for id=%d: %v", row.ID, err)
			continue
		}
		emitted++
		r.addLog("  emitted event to %s (id=%d trace=%s session=%q) → marked 'emitted'", r.outputTopic, row.ID, row.TraceID, row.Session)
	}
	r.addLog("run ENDED — emitted %d event(s)", emitted)
}

// emitAndMark reconstructs the session baggage, produces the event to the output
// topic (so service-c consumes it), records the CronJob Z trace stage for the UI,
// and flips the row to 'emitted'.
func (r *cronRunner) emitAndMark(ctx context.Context, row dbRow) error {
	msgCtx := context.Background()
	if row.Session != "" {
		if member, err := baggage.NewMember("mirrord-session", row.Session); err == nil {
			if bag, err := baggage.New(member); err == nil {
				msgCtx = baggage.ContextWithBaggage(msgCtx, bag)
			}
		}
	}

	body, _ := json.Marshal(ChainMessage{TraceID: row.TraceID, Payload: row.Payload, Session: row.Session})
	headers := []kgo.RecordHeader{{Key: "traceId", Value: []byte(row.TraceID)}}
	otel.GetTextMapPropagator().Inject(msgCtx, kafkaHeaderCarrier{headers: &headers})
	if err := r.cl.ProduceSync(ctx, &kgo.Record{Topic: r.outputTopic, Value: body, Headers: headers}).FirstErr(); err != nil {
		return err
	}

	// Light up the CronJob Z stage in the UI directly (the gateway owns the store).
	r.store.add(TraceEvent{
		TraceID: row.TraceID, Stage: "z", Service: "cronjob-z", Session: row.Session,
		Message: "saw changed DB state — emitted event to " + r.outputTopic,
		TS:      time.Now().UnixMilli(),
	})

	return r.markEmitted(ctx, row.ID)
}

func (r *cronRunner) fetchPending(ctx context.Context) ([]dbRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, trace_id, session, payload
		FROM kafka_demo_events WHERE status = 'pending' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dbRow
	for rows.Next() {
		var e dbRow
		if err := rows.Scan(&e.ID, &e.TraceID, &e.Session, &e.Payload); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *cronRunner) markEmitted(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, `UPDATE kafka_demo_events SET status = 'emitted' WHERE id = $1`, id)
	return err
}

// fetchAll returns the most recent rows for the UI's DB-state panel.
func (r *cronRunner) fetchAll(ctx context.Context) ([]dbRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, trace_id, session, payload, status, to_char(created_at, 'HH24:MI:SS')
		FROM kafka_demo_events ORDER BY id DESC LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dbRow
	for rows.Next() {
		var e dbRow
		if err := rows.Scan(&e.ID, &e.TraceID, &e.Session, &e.Payload, &e.Status, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// completedCount returns the running total from service-c's terminal counter
// (kafka_demo_click_counter) — the number of messages that have completed the chain.
// Returns 0 when no message has completed yet (no row).
func (r *cronRunner) completedCount(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.QueryRow(ctx, `SELECT count FROM kafka_demo_click_counter WHERE id = 1`).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return n, err
}

// ensureEventsTable creates the tables the gateway reads if they don't exist yet, so
// the DB-state panel, cron runner, and completed-count tile work even before service-b
// or service-c has written its first row.
func ensureEventsTable(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS kafka_demo_events (
		id bigserial PRIMARY KEY,
		trace_id text NOT NULL,
		session text NOT NULL DEFAULT '',
		payload text NOT NULL DEFAULT '',
		status text NOT NULL DEFAULT 'pending',
		created_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		return err
	}
	// service-c's terminal counter table (read by GET /count). service-c also creates
	// it; IF NOT EXISTS keeps both idempotent.
	_, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS kafka_demo_click_counter (
		id int PRIMARY KEY,
		count bigint NOT NULL
	)`)
	return err
}
