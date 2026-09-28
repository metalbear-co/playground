import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8080);
const authUrl = process.env.AUTH_URL || "http://auth-srvc.ci-lab.svc.cluster.local:8080";
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function proxy(req, res, target) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const headers = { "content-type": req.headers["content-type"] || "application/json" };
  if (req.headers["x-mirrord-session"]) {
    headers["x-mirrord-session"] = req.headers["x-mirrord-session"];
  }
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const payload = Buffer.from(await upstream.arrayBuffer());
  send(res, upstream.status, payload, upstream.headers.get("content-type") || "application/json");
}

function serveStatic(res, urlPath) {
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(dist, relative));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 200, fs.readFileSync(path.join(dist, "index.html")), types[".html"]);
    return;
  }
  send(res, 200, fs.readFileSync(file), types[path.extname(file)] || "application/octet-stream");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/health") {
      send(res, 200, "{\"status\":\"ok\"}");
      return;
    }
    if (url.pathname === "/api/login") {
      await proxy(req, res, `${authUrl}/login`);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    send(res, 502, JSON.stringify({ error: String(error) }));
  }
});

server.listen(port);
