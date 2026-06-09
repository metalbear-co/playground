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
    {"id": 1, "name": "Team Work Makes The Dream Work Sticker", "description": "MetalBear teamwork sticker", "price_cents": 499, "stock": 1811, "is_new": True, "image_urls": ["team_work_makes_the_Dream_work_ljp4we"]},
    {"id": 2, "name": "Team Work Makes The Dream Work T-Shirt", "description": "MetalBear teamwork tee — front and back designs", "price_cents": 2499, "stock": 175, "is_new": True, "image_urls": ["", "Metal Mart/samples/mirrord-hoodie-front"]},
    {"id": 3, "name": "Mind The Gap Sticker", "description": "MetalBear Mind The Gap sticker", "price_cents": 499, "stock": 168, "is_new": False, "image_urls": ["Mind_the_Gap_pkyuc6"]},
    {"id": 4, "name": "Mind The Gap T-Shirt", "description": "MetalBear Mind The Gap tee — front and back designs", "price_cents": 2499, "stock": 45, "is_new": False, "image_urls": ["Mind_the_gap_-_Front_anazkh", "Mind_the_gap_-_Back_oh9jyf"]},
    {"id": 5, "name": "Increase Velocity Sticker", "description": "MetalBear Increase Velocity sticker", "price_cents": 499, "stock": 190, "is_new": False, "image_urls": ["Increase_velocity_mfsov2"]},
    {"id": 6, "name": "Increase Velocity T-Shirt", "description": "MetalBear Increase Velocity tee — front and back designs", "price_cents": 2499, "stock": 13, "is_new": False, "image_urls": ["Increase_Velocity_-_Front_c2dgw6", "Increase_Velocity_-_Back_ywhxi6"]},
    {"id": 7, "name": "Cloudboat Willie T-Shirt", "description": "MetalBear Cloudboat Willie tee — front and back designs", "price_cents": 2499, "stock": 46, "is_new": False, "image_urls": ["Cloudboat_Willie_-_Front_wpgqi2", "Cloudboat_Willie_-_Back_z05dna"]},
    {"id": 8, "name": "A mirrord Is Born T-Shirt", "description": "MetalBear A mirrord Is Born tee — front and back designs", "price_cents": 2499, "stock": 48, "is_new": False, "image_urls": ["A_mirrord_is_born_-_Front_xy8l8p", "A_mirrord_is_born_-_Back_bytwh2"]},
    {"id": 9, "name": "Debug Mode Hoodie", "description": "Cozy hoodie for late-night debugging sessions", "price_cents": 4999, "stock": 31, "is_new": True, "image_urls": ["team_Work_makes_the_Dream_Work_-_front_w5qdnb"]},
    {"id": 10, "name": "Kubernetes Ninja Sticker", "description": "Stealthy pod scheduler sticker pack", "price_cents": 399, "stock": 240, "is_new": False, "image_urls": ["Mind_the_Gap_pkyuc6"]},
    {"id": 11, "name": "Rust Crab Mug", "description": "Fearless-concurrency coffee mug for Rustaceans", "price_cents": 1899, "stock": 53, "is_new": True, "image_urls": ["A_mirrord_is_born_-_Front_xy8l8p"]},
    {"id": 12, "name": "Latency Killer Cap", "description": "Ball cap for sub-millisecond engineers", "price_cents": 2199, "stock": 45, "is_new": False, "image_urls": ["Cloudboat_Willie_-_Front_wpgqi2"]},
    {"id": 13, "name": "Production Bug Plush", "description": "Hug the bug — soft plush for incident response", "price_cents": 1499, "stock": 80, "is_new": False, "image_urls": ["Increase_velocity_mfsov2"]},
    {"id": 14, "name": "Observability Notebook", "description": "Dot-grid notebook for runbooks and architecture doodles", "price_cents": 1299, "stock": 107, "is_new": False, "image_urls": ["Mind_the_gap_-_Front_anazkh"]},
    {"id": 15, "name": "Container Whale Keychain", "description": "Ship it — tiny whale keychain for your laptop bag", "price_cents": 899, "stock": 147, "is_new": True, "image_urls": ["Cloudboat_Willie_-_Back_z05dna"]},
    {"id": 16, "name": "Service Mesh Tote Bag", "description": "Carry your sidecars in style", "price_cents": 1699, "stock": 65, "is_new": False, "image_urls": ["team_work_makes_the_dream_work_-_back_onanux"]},
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
