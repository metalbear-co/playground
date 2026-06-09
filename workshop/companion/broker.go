package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Seat mirrors the broker's Seat shape.
type Seat struct {
	ID         string `json:"id"`
	Namespace  string `json:"namespace"`
	URL        string `json:"url"`
	Kubeconfig string `json:"kubeconfig"`
}

func claimSeat(broker, name string) (*Seat, error) {
	broker = strings.TrimRight(broker, "/")
	body, _ := json.Marshal(map[string]string{"name": name})
	resp, err := http.Post(broker+"/claim", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("contacting broker %s: %w", broker, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		buf := new(bytes.Buffer)
		buf.ReadFrom(resp.Body)
		return nil, fmt.Errorf("broker returned %d: %s", resp.StatusCode, strings.TrimSpace(buf.String()))
	}
	var s Seat
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, fmt.Errorf("decoding seat: %w", err)
	}
	return &s, nil
}

// reportProgress is best-effort — failures are ignored so the board never blocks the attendee.
func reportProgress(broker, id, stepName string) {
	if broker == "" || id == "" {
		return
	}
	broker = strings.TrimRight(broker, "/")
	body, _ := json.Marshal(map[string]string{"id": id, "step": stepName})
	client := http.Client{Timeout: 2 * time.Second}
	req, _ := http.NewRequest(http.MethodPost, broker+"/progress", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if resp, err := client.Do(req); err == nil {
		resp.Body.Close()
	}
}
