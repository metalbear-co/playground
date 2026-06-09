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
	PriceCents  int      `json:"price_cents"`
	Stock       int      `json:"stock"`
	IsNew       bool     `json:"is_new"`
	ImageUrls   []string `json:"image_urls"`
}

var products = []Product{
	{1, "Team Work Makes The Dream Work Sticker", "MetalBear teamwork sticker", 499, 1811, true, []string{"team_work_makes_the_Dream_work_ljp4we"}},
	{2, "Team Work Makes The Dream Work T-Shirt", "MetalBear teamwork tee — front and back designs", 2499, 175, true, []string{"", "Metal Mart/samples/mirrord-hoodie-front"}},
	{3, "Mind The Gap Sticker", "MetalBear Mind The Gap sticker", 499, 168, false, []string{"Mind_the_Gap_pkyuc6"}},
	{4, "Mind The Gap T-Shirt", "MetalBear Mind The Gap tee — front and back designs", 2499, 45, false, []string{"Mind_the_gap_-_Front_anazkh", "Mind_the_gap_-_Back_oh9jyf"}},
	{5, "Increase Velocity Sticker", "MetalBear Increase Velocity sticker", 499, 190, false, []string{"Increase_velocity_mfsov2"}},
	{6, "Increase Velocity T-Shirt", "MetalBear Increase Velocity tee — front and back designs", 2499, 13, false, []string{"Increase_Velocity_-_Front_c2dgw6", "Increase_Velocity_-_Back_ywhxi6"}},
	{7, "Cloudboat Willie T-Shirt", "MetalBear Cloudboat Willie tee — front and back designs", 2499, 46, false, []string{"Cloudboat_Willie_-_Front_wpgqi2", "Cloudboat_Willie_-_Back_z05dna"}},
	{8, "A mirrord Is Born T-Shirt", "MetalBear A mirrord Is Born tee — front and back designs", 2499, 48, false, []string{"A_mirrord_is_born_-_Front_xy8l8p", "A_mirrord_is_born_-_Back_bytwh2"}},
	{9, "Debug Mode Hoodie", "Cozy hoodie for late-night debugging sessions", 4999, 31, true, []string{"team_Work_makes_the_Dream_Work_-_front_w5qdnb"}},
	{10, "Kubernetes Ninja Sticker", "Stealthy pod scheduler sticker pack", 399, 240, false, []string{"Mind_the_Gap_pkyuc6"}},
	{11, "Rust Crab Mug", "Fearless-concurrency coffee mug for Rustaceans", 1899, 53, true, []string{"A_mirrord_is_born_-_Front_xy8l8p"}},
	{12, "Latency Killer Cap", "Ball cap for sub-millisecond engineers", 2199, 45, false, []string{"Cloudboat_Willie_-_Front_wpgqi2"}},
	{13, "Production Bug Plush", "Hug the bug — soft plush for incident response", 1499, 80, false, []string{"Increase_velocity_mfsov2"}},
	{14, "Observability Notebook", "Dot-grid notebook for runbooks and architecture doodles", 1299, 107, false, []string{"Mind_the_gap_-_Front_anazkh"}},
	{15, "Container Whale Keychain", "Ship it — tiny whale keychain for your laptop bag", 899, 147, true, []string{"Cloudboat_Willie_-_Back_z05dna"}},
	{16, "Service Mesh Tote Bag", "Carry your sidecars in style", 1699, 65, false, []string{"team_work_makes_the_dream_work_-_back_onanux"}},
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
