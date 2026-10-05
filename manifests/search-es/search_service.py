#!/usr/bin/env python3
"""Show the Elasticsearch version and a title search against the catalog."""

import html
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ES_HOST = os.environ.get("ELASTICSEARCH_HOST", "127.0.0.1")
ES_PORT = os.environ.get("ELASTICSEARCH_PORT", "9200")
LISTEN_PORT = int(os.environ.get("PORT", "8080"))
SEARCH_TERM = "linen"


class SearchRejected(Exception):
    def __init__(self, detail):
        self.detail = detail


def es_request(path, body=None):
    url = f"http://{ES_HOST}:{ES_PORT}{path}"
    data = None if body is None else json.dumps(body).encode()
    headers = {} if body is None else {"Content-Type": "application/json"}
    request = Request(url, data=data, headers=headers)
    with urlopen(request, timeout=5) as response:
        return json.load(response)


def elasticsearch_version():
    return es_request("/")["version"]["number"]


def search_hits(term):
    try:
        result = es_request(
            "/catalog/_search",
            {"query": {"match": {"title": term}}},
        )
    except HTTPError as error:
        if error.code == 404:
            return []
        detail = error.read().decode(errors="replace")[:500]
        raise SearchRejected(detail) from error
    hits = []
    for hit in result["hits"]["hits"]:
        source = hit["_source"]
        hits.append((source["title"], source["sku"]))
    return hits


def page(version, hits, error=None):
    major = version.split(".", 1)[0]
    if major == "9":
        background, ink, accent = "#f3e8ff", "#3b0764", "#6d28d9"
    else:
        background, ink, accent = "#e7f6ec", "#14532d", "#15803d"
    if error is not None:
        card = f'<p class="empty">{html.escape(error)}</p>'
    elif not hits:
        card = '<p class="empty">No documents</p>'
    else:
        rows = "".join(
            f"<article><h2>{html.escape(title)}</h2><p class=\"sku\">{html.escape(sku)}</p></article>"
            for title, sku in hits
        )
        card = rows
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elasticsearch {html.escape(version)}</title>
<style>
  body {{
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: {background};
    color: {ink};
    font-family: system-ui, sans-serif;
  }}
  p {{ margin: 0; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.85rem; }}
  h1 {{ margin: 0.2rem 0 1.5rem; font-size: 4.5rem; line-height: 1; }}
  article, .empty {{
    width: min(28rem, 90vw);
    padding: 1.25rem 1.5rem;
    border-radius: 1rem;
    background: white;
  }}
  article {{ border-left: 0.4rem solid {accent}; }}
  h2 {{ margin: 0; font-size: 1.6rem; }}
  .sku {{ margin-top: 0.35rem; text-transform: none; letter-spacing: 0; color: #64748b; }}
  .query {{ margin-bottom: 1rem; text-transform: none; letter-spacing: 0; }}
  .empty {{ text-align: center; color: #64748b; text-transform: none; letter-spacing: 0; }}
</style>
</head>
<body>
  <p>Elasticsearch</p>
  <h1>{html.escape(version)}</h1>
  <p class="query">match title: {html.escape(SEARCH_TERM)}</p>
  {card}
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/livez":
            self._send(200, b"ok", "text/plain")
            return
        try:
            version = elasticsearch_version()
            if path == "/healthz":
                self._send(200, b"ok", "text/plain")
                return
            hits = search_hits(SEARCH_TERM)
        except SearchRejected as rejected:
            self._send(200, page(version, [], rejected.detail).encode(), "text/html; charset=utf-8")
            return
        except (URLError, TimeoutError, KeyError, json.JSONDecodeError, HTTPError):
            self._send(502, b'{"error":"elasticsearch unreachable"}\n', "application/json")
            return
        self._send(200, page(version, hits).encode(), "text/html; charset=utf-8")

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()
