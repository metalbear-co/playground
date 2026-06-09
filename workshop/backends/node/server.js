// MetalMart inventory-service — workshop Node/Postgres variant.
//
// You STEAL the in-cluster inventory-service and run THIS on your laptop. mirrord injects the
// pod's DATABASE_URL and routes the DB connection through the cluster — so this talks to the
// real cluster Postgres with zero local setup. Edit the marked line, save, refresh your browser.
//
// Run:  npm install   (once)
//       mirrord exec -f ../mirrord-core.json -- node server.js
import http from "node:http";
import os from "node:os";
import pg from "pg";

const PORT = 8080; // mirrord maps remote :80 -> local :8080 (mirrord-core.json port_mapping)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Served-By", os.hostname()); // makes the UI banner flip to your laptop
  if (req.url === "/health") return res.writeHead(200).end("ok");
  if (req.url.startsWith("/products")) {
    try {
      // 👇 EDIT ME — set PREFIX to "🔥 " (or "SALE! "), save, and refresh your browser.
      const PREFIX = "";
      const { rows } = await pool.query(
        "SELECT id, name, description, price_cents, stock, image_urls, is_new FROM products ORDER BY id"
      );
      const out = rows.map((r) => ({ ...r, name: PREFIX + r.name }));
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      return res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  }
  res.writeHead(404).end();
});

server.listen(PORT, () =>
  console.log(`inventory (node) on :${PORT} — DB ${process.env.DATABASE_URL ? "from cluster ✓" : "MISSING ✗"}`)
);
