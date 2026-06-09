// Seat broker for the mirrord workshop.
//
// Hands out pre-provisioned seats (namespace + kubeconfig + URL) to attendees by name —
// idempotently. Also serves an admin dashboard (token-gated) showing seats claimed + live mirrord
// sessions (read from the Operator's mirrordclustersessions via the in-cluster API), with a reset.
// Stdlib only.
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type Seat struct {
	ID         string `json:"id"`
	Namespace  string `json:"namespace"`
	URL        string `json:"url"`
	Kubeconfig string `json:"kubeconfig"`
}

type state struct {
	mu       sync.Mutex
	seats    []Seat
	claims   map[string]string // name -> seat id
	progress map[string]string // seat id -> last reported step
	claimsBy map[string]string // seat id -> name
}

var (
	st         = &state{claims: map[string]string{}, progress: map[string]string{}, claimsBy: map[string]string{}}
	claimsFile = env("CLAIMS_FILE", "claims.json")
	adminToken = os.Getenv("ADMIN_TOKEN")
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	b, err := os.ReadFile(env("SEATS_FILE", "seats.json"))
	if err != nil {
		log.Fatalf("read seats: %v", err)
	}
	if err := json.Unmarshal(b, &st.seats); err != nil {
		log.Fatalf("parse seats: %v", err)
	}
	loadClaims()
	log.Printf("loaded %d seats, %d already claimed", len(st.seats), len(st.claims))

	http.HandleFunc("/claim", handleClaim)
	http.HandleFunc("/progress", handleProgress)
	http.HandleFunc("/status", handleStatus)
	http.HandleFunc("/admin/data", handleAdminData)
	http.HandleFunc("/admin/reset", handleAdminReset)
	http.HandleFunc("/admin", handleAdmin)
	http.HandleFunc("/", handleBoard)

	addr := env("ADDR", ":8088")
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("seat broker listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

// ── seat claiming ─────────────────────────────────────────────────────────────

func handleClaim(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		http.Error(w, "body must be {\"name\": \"...\"}", http.StatusBadRequest)
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if id, ok := st.claims[req.Name]; ok {
		writeJSON(w, seatByID(id))
		return
	}
	for i := range st.seats {
		if _, taken := st.claimsBy[st.seats[i].ID]; !taken {
			st.claims[req.Name] = st.seats[i].ID
			st.claimsBy[st.seats[i].ID] = req.Name
			saveClaims()
			log.Printf("claimed %s -> %s", req.Name, st.seats[i].ID)
			writeJSON(w, &st.seats[i])
			return
		}
	}
	http.Error(w, "no seats left — tell the facilitator", http.StatusConflict)
}

func handleProgress(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	var req struct{ ID, Step string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	st.mu.Lock()
	st.progress[req.ID] = req.Step
	st.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	cors(w)
	type row struct{ ID, ClaimedBy, Step string }
	st.mu.Lock()
	rows := make([]row, 0, len(st.seats))
	claimed := 0
	for _, s := range st.seats {
		by := st.claimsBy[s.ID]
		if by != "" {
			claimed++
		}
		rows = append(rows, row{s.ID, by, st.progress[s.ID]})
	}
	total := len(st.seats)
	st.mu.Unlock()
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	writeJSON(w, map[string]any{"total": total, "claimed": claimed, "seats": rows})
}

// ── admin dashboard ───────────────────────────────────────────────────────────

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	tok := r.URL.Query().Get("token")
	if tok == "" {
		tok = r.Header.Get("X-Admin-Token")
	}
	if adminToken == "" || tok != adminToken {
		http.Error(w, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func handleAdmin(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, adminPage)
}

func handleAdminData(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	sessions, sErr := listSessions()
	bySeat := map[string]Session{}
	finale := 0
	for _, s := range sessions {
		if s.Seat == "finale" {
			finale++
		} else {
			bySeat[s.Seat] = s
		}
	}
	st.mu.Lock()
	type row struct {
		Seat, ClaimedBy, User string
		Session               bool
	}
	rows := []row{}
	claimed := 0
	for _, seat := range st.seats {
		by := st.claimsBy[seat.ID]
		if by == "" {
			continue
		}
		claimed++
		sess, ok := bySeat[seat.ID]
		rows = append(rows, row{seat.ID, by, sess.User, ok})
	}
	total := len(st.seats)
	st.mu.Unlock()
	sort.Slice(rows, func(i, j int) bool { return rows[i].Seat < rows[j].Seat })
	out := map[string]any{
		"total":          total,
		"claimed":        claimed,
		"sessions":       len(sessions),
		"finaleSessions": finale,
		"rows":           rows,
	}
	if sErr != nil {
		out["sessionsError"] = sErr.Error()
	}
	writeJSON(w, out)
}

func handleAdminReset(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	killed, err := killAllSessions()
	st.mu.Lock()
	st.claims = map[string]string{}
	st.claimsBy = map[string]string{}
	st.progress = map[string]string{}
	st.mu.Unlock()
	saveClaims()
	log.Printf("admin reset: cleared claims, killed %d sessions", killed)
	msg := fmt.Sprintf("reset: freed all seats, killed %d session(s)", killed)
	if err != nil {
		msg += " (session kill error: " + err.Error() + ")"
	}
	writeJSON(w, map[string]any{"ok": true, "message": msg})
}

// ── Operator sessions via the in-cluster API ──────────────────────────────────

type Session struct {
	Name, Seat, User, Target string
}

const sessionsPath = "/apis/mirrord.metalbear.co/v1alpha/mirrordclustersessions"

func k8sReq(method, path string) ([]byte, int, error) {
	const sa = "/var/run/secrets/kubernetes.io/serviceaccount"
	token, err := os.ReadFile(sa + "/token")
	if err != nil {
		return nil, 0, err
	}
	caPEM, err := os.ReadFile(sa + "/ca.crt")
	if err != nil {
		return nil, 0, err
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caPEM)
	client := &http.Client{
		Timeout:   8 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}},
	}
	host := "https://" + os.Getenv("KUBERNETES_SERVICE_HOST") + ":" + env("KUBERNETES_SERVICE_PORT", "443")
	req, _ := http.NewRequest(method, host+path, nil)
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

func listSessions() ([]Session, error) {
	body, code, err := k8sReq(http.MethodGet, sessionsPath)
	if err != nil {
		return nil, err
	}
	if code != 200 {
		return nil, fmt.Errorf("k8s %d: %s", code, strings.TrimSpace(string(body)))
	}
	var parsed struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Spec struct {
				Namespace string `json:"namespace"`
				Owner     struct {
					Username string `json:"username"`
				} `json:"owner"`
				Target struct {
					Name string `json:"name"`
				} `json:"target"`
			} `json:"spec"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	out := make([]Session, 0, len(parsed.Items))
	for _, it := range parsed.Items {
		seat := strings.TrimPrefix(it.Spec.Namespace, "ws-")
		if it.Spec.Namespace == "workshop-finale" {
			seat = "finale"
		}
		out = append(out, Session{Name: it.Metadata.Name, Seat: seat, User: it.Spec.Owner.Username, Target: it.Spec.Target.Name})
	}
	return out, nil
}

func killAllSessions() (int, error) {
	sessions, err := listSessions()
	if err != nil {
		return 0, err
	}
	killed := 0
	for _, s := range sessions {
		if _, code, e := k8sReq(http.MethodDelete, sessionsPath+"/"+s.Name); e == nil && (code == 200 || code == 202) {
			killed++
		}
	}
	return killed, nil
}

// ── board (public) + helpers ──────────────────────────────────────────────────

func handleBoard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, board)
}

func seatByID(id string) *Seat {
	for i := range st.seats {
		if st.seats[i].ID == id {
			return &st.seats[i]
		}
	}
	return nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func saveClaims() {
	b, _ := json.MarshalIndent(st.claims, "", "  ")
	_ = os.WriteFile(claimsFile, b, 0o644)
}

func loadClaims() {
	b, err := os.ReadFile(claimsFile)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, &st.claims)
	for name, id := range st.claims {
		st.claimsBy[id] = name
	}
}

const board = `<!doctype html><meta charset=utf-8><title>Workshop board</title>
<style>body{font-family:system-ui;background:#1a1730;color:#fff;margin:0;padding:24px}
h1{color:#f59e0b}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.s{background:#2b2750;border-radius:8px;padding:8px;font-size:13px}.s b{color:#a99cff}.t{opacity:.6;font-size:11px}</style>
<h1>MetalMart workshop 🐻</h1><div id=n class=t></div><div class=g id=g></div>
<script>async function tick(){const r=await fetch('status');const d=await r.json();
document.getElementById('n').textContent=d.claimed+' / '+d.total+' seats claimed';
document.getElementById('g').innerHTML=d.seats.map(s=>'<div class=s><b>'+s.ID+'</b><br>'+
(s.ClaimedBy||'—')+'<br><span class=t>'+(s.Step||'')+'</span></div>').join('')}
tick();setInterval(tick,3000)</script>`

const adminPage = `<!doctype html><meta charset=utf-8><title>Workshop admin</title>
<style>body{font-family:system-ui;background:#13111f;color:#eee;margin:0;padding:24px}
h1{color:#a99cff;margin:0 0 16px}.nums{display:flex;gap:16px;margin-bottom:18px;flex-wrap:wrap}
.n{background:#221d3a;border-radius:12px;padding:14px 22px;min-width:120px}.n .big{font-size:34px;font-weight:700}
.n.live .big{color:#34d399}.n .lbl{opacity:.6;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
table{border-collapse:collapse;width:100%;max-width:640px}td,th{text-align:left;padding:7px 12px;border-bottom:1px solid #2b2750;font-size:14px}
th{opacity:.6;font-weight:600;font-size:12px;text-transform:uppercase}.dot{color:#34d399;font-weight:700}.off{opacity:.3}
button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:10px 18px;background:#e0533d;color:#fff;cursor:pointer;margin-top:18px}
.err{color:#f87171;font-size:13px}.ok{color:#34d399;font-size:13px}</style>
<h1>Workshop admin 🐻</h1>
<div class=nums>
 <div class=n><div class=big id=claimed>–</div><div class=lbl>seats claimed</div></div>
 <div class="n live"><div class=big id=sessions>–</div><div class=lbl>sessions running</div></div>
 <div class=n><div class=big id=finale>–</div><div class=lbl>finale sessions</div></div>
</div>
<table><thead><tr><th>seat</th><th>claimed by</th><th>stealing?</th></tr></thead><tbody id=rows></tbody></table>
<button id=reset>Reset everything</button> <span id=msg></span>
<script>
const tok=new URLSearchParams(location.search).get('token');
async function tick(){
 const r=await fetch('admin/data?token='+encodeURIComponent(tok));
 if(!r.ok){document.getElementById('msg').innerHTML='<span class=err>auth failed</span>';return;}
 const d=await r.json();
 claimed.textContent=d.claimed+' / '+d.total; sessions.textContent=d.sessions; finale.textContent=d.finaleSessions;
 rows.innerHTML=d.rows.map(x=>'<tr><td><b>'+x.Seat+'</b></td><td>'+x.ClaimedBy+'</td><td>'+
   (x.Session?'<span class=dot>● live</span>':'<span class=off>○ idle</span>')+'</td></tr>').join('')
   || '<tr><td colspan=3 class=off>no seats claimed yet</td></tr>';
 document.getElementById('msg').innerHTML=d.sessionsError?'<span class=err>sessions: '+d.sessionsError+'</span>':'';
}
document.getElementById('reset').onclick=async()=>{
 if(!confirm('Free ALL seats and kill ALL mirrord sessions?'))return;
 const r=await fetch('admin/reset?token='+encodeURIComponent(tok),{method:'POST'});
 const d=await r.json().catch(()=>({message:'error'}));
 document.getElementById('msg').innerHTML='<span class=ok>'+(d.message||'done')+'</span>'; tick();
};
tick();setInterval(tick,3000);
</script>`
