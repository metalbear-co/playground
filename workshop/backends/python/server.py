#!/usr/bin/env python3
# MetalMart inventory-service — workshop Python variant (canned data, no dependencies).
#
# You STEAL the in-cluster inventory-service (which runs Node) and run THIS Python copy on your
# laptop — mirrord doesn't care that the languages differ. Edit the marked line and refresh.
#
# Run:  mirrord exec -f ../mirrord-core.json -- python3 server.py
import json, socket
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8080  # mirrord maps remote :80 -> local :8080

PRODUCTS = [
    {"id": 1, "name": "MetalBear Hoodie",       "description": "Cozy heavyweight hoodie with the MetalBear mascot.",        "price_cents": 5900, "stock": 42,  "is_new": True},
    {"id": 2, "name": "Steal the Show Tee",      "description": "Soft cotton tee. Run your laptop as if it were a pod.",     "price_cents": 2900, "stock": 80,  "is_new": True},
    {"id": 3, "name": "mirrord Mug",             "description": "Ceramic mug for your morning cluster session.",            "price_cents": 1500, "stock": 120, "is_new": False},
    {"id": 4, "name": "Cluster Cap",             "description": "Embroidered cap. Outgoing traffic, incoming compliments.", "price_cents": 2400, "stock": 65,  "is_new": False},
    {"id": 5, "name": "Bear Claw Sticker Pack",  "description": "Six die-cut vinyl stickers.",                             "price_cents": 800,  "stock": 300, "is_new": False},
    {"id": 6, "name": "Plush mirrord Bear",      "description": "Huggable plush. Mirrors your affection bidirectionally.",  "price_cents": 3200, "stock": 33,  "is_new": False},
    {"id": 7, "name": "Enamel Pin Set",          "description": "Three hard-enamel pins.",                                 "price_cents": 1800, "stock": 90,  "is_new": False},
    {"id": 8, "name": "DevOps Beanie",           "description": "Keep your head warm while the operator does the work.",    "price_cents": 2200, "stock": 54,  "is_new": False},
]


# 👇 EDIT ME — set PREFIX to "🔥 " (or "SALE! "), save, and refresh your browser.
PREFIX = ""


def render(p):
    return {**p, "name": PREFIX + p["name"]}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code)
        self.send_header("X-Served-By", socket.gethostname())  # flips the UI banner to your laptop
        self.send_header("Content-Type", ctype)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, b"ok")
        if self.path.startswith("/products"):
            body = json.dumps([render(p) for p in PRODUCTS]).encode()
            return self._send(200, body, "application/json")
        self._send(404)

    def log_message(self, *_):
        pass


print(f"inventory (python) on :{PORT}")
HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
