// MetalMart inventory-service — workshop Go variant (canned data, stdlib only).
//
// You STEAL the in-cluster inventory-service (Node) and run THIS Go copy on your laptop.
// Edit the marked line and refresh your browser.
//
// Run:  mirrord exec -f ../mirrord-core.json -- go run main.go
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
)

const port = "8080" // mirrord maps remote :80 -> local :8080

// 👇 EDIT ME — set prefix to "🔥 " (or "SALE! "), save, and refresh your browser.
const prefix = ""

type Product struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PriceCents  int    `json:"price_cents"`
	Stock       int    `json:"stock"`
	IsNew       bool   `json:"is_new"`
}

var products = []Product{
	{1, "MetalBear Hoodie", "Cozy heavyweight hoodie with the MetalBear mascot.", 5900, 42, true},
	{2, "Steal the Show Tee", "Soft cotton tee. Run your laptop as if it were a pod.", 2900, 80, true},
	{3, "mirrord Mug", "Ceramic mug for your morning cluster session.", 1500, 120, false},
	{4, "Cluster Cap", "Embroidered cap. Outgoing traffic, incoming compliments.", 2400, 65, false},
	{5, "Bear Claw Sticker Pack", "Six die-cut vinyl stickers.", 800, 300, false},
	{6, "Plush mirrord Bear", "Huggable plush. Mirrors your affection bidirectionally.", 3200, 33, false},
	{7, "Enamel Pin Set", "Three hard-enamel pins.", 1800, 90, false},
	{8, "DevOps Beanie", "Keep your head warm while the operator does the work.", 2200, 54, false},
}

func main() {
	hostname, _ := os.Hostname()
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Served-By", hostname) // flips the UI banner to your laptop
		switch {
		case r.URL.Path == "/health":
			w.Write([]byte("ok"))
		case strings.HasPrefix(r.URL.Path, "/products"):
			out := make([]Product, len(products))
			for i, p := range products {
				p.Name = prefix + p.Name
				out[i] = p
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(out)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	println("inventory (go) on :" + port)
	http.ListenAndServe("0.0.0.0:"+port, nil)
}
