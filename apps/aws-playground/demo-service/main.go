// Command demo-service answers a single question over HTTP: which machine is
// handling this request, and what does the ECS task metadata service say about
// it.
//
// It is deployed publicly, so it exposes nothing beyond that: no environment
// dump, no caller-controlled outbound requests, no filesystem access. The only
// outbound call it ever makes is to the link-local ECS metadata endpoint.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

const metadataTimeout = 2 * time.Second

// Response is the whole public surface of this service.
type Response struct {
	Hostname string    `json:"hostname"`
	PID      int       `json:"pid"`
	Source   string    `json:"source"`
	ECS      *ECSFacts `json:"ecs,omitempty"`
	Error    string    `json:"error,omitempty"`
}

// ECSFacts is a deliberately narrow projection of the task metadata document.
// The full document carries ARNs and network detail that this service has no
// reason to publish.
type ECSFacts struct {
	Cluster          string `json:"cluster"`
	AvailabilityZone string `json:"availability_zone"`
	Family           string `json:"family"`
	Revision         string `json:"revision"`
	LaunchType       string `json:"launch_type"`
}

type taskMetadata struct {
	Cluster          string `json:"Cluster"`
	Family           string `json:"Family"`
	Revision         string `json:"Revision"`
	AvailabilityZone string `json:"AvailabilityZone"`
	LaunchType       string `json:"LaunchType"`
}

func main() {
	addr := ":" + envOr("PORT", "8080")

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("/api/metadata", handleMetadata)
	mux.HandleFunc("/", handleIndex)

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("demo-service listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server stopped: %v", err)
	}
}

func handleMetadata(w http.ResponseWriter, r *http.Request) {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	response := Response{
		Hostname: hostname,
		PID:      os.Getpid(),
		Source:   "ecs-task-metadata-v4",
	}

	facts, err := fetchECSFacts(r.Context())
	switch {
	case err != nil:
		// Running outside ECS is the normal case for a local process under
		// mirrord, so it is reported rather than treated as a failure.
		response.Source = "unavailable"
		response.Error = err.Error()
	default:
		response.ECS = facts
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("failed to write response: %v", err)
	}
}

func fetchECSFacts(ctx context.Context) (*ECSFacts, error) {
	endpoint, err := metadataEndpoint()
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/task", nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: metadataTimeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("metadata request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("metadata service returned %d", response.StatusCode)
	}

	var decoded taskMetadata
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("metadata response was not valid JSON: %w", err)
	}

	return &ECSFacts{
		Cluster:          decoded.Cluster,
		AvailabilityZone: decoded.AvailabilityZone,
		Family:           decoded.Family,
		Revision:         decoded.Revision,
		LaunchType:       decoded.LaunchType,
	}, nil
}

// metadataEndpoint reads the endpoint ECS injects, and refuses anything that is
// not link-local. The variable is normally set by the agent, but this service
// is public and a mistake elsewhere should not turn it into a fetcher for
// arbitrary hosts.
func metadataEndpoint() (string, error) {
	raw := os.Getenv("ECS_CONTAINER_METADATA_URI_V4")
	if raw == "" {
		return "", errors.New("ECS_CONTAINER_METADATA_URI_V4 is not set")
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("metadata endpoint is not a valid URL: %w", err)
	}

	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLinkLocalUnicast() {
		return "", fmt.Errorf("metadata endpoint %q is not link-local", host)
	}

	return parsed.String(), nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

const indexPage = `<!doctype html>
<meta charset="utf-8">
<title>aws-playground demo service</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  pre { padding: 1rem; border-radius: .5rem; background: rgba(127,127,127,.15); overflow-x: auto; }
</style>
<h1>aws-playground demo service</h1>
<p>Whoever answers <code>/api/metadata</code> reports its own hostname and what
the ECS task metadata service tells it. Run this service locally under mirrord
and the answer changes.</p>
<pre id="out">loading…</pre>
<script>
  fetch("/api/metadata")
    .then((response) => response.json())
    .then((body) => { document.getElementById("out").textContent = JSON.stringify(body, null, 2); })
    .catch((error) => { document.getElementById("out").textContent = String(error); });
</script>
`

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, indexPage)
}
