#!/usr/bin/env python3
"""Report the Elasticsearch version behind ELASTICSEARCH_HOST and ELASTICSEARCH_PORT."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import urlopen

ES_HOST = os.environ.get("ELASTICSEARCH_HOST", "127.0.0.1")
ES_PORT = os.environ.get("ELASTICSEARCH_PORT", "9200")
LISTEN_PORT = int(os.environ.get("PORT", "8080"))


def elasticsearch_version():
    url = f"http://{ES_HOST}:{ES_PORT}/"
    with urlopen(url, timeout=5) as response:
        body = json.load(response)
    return body["version"]["number"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/") == "/livez":
            self._send(200, b"ok", "text/plain")
            return
        try:
            version = elasticsearch_version()
        except (URLError, TimeoutError, KeyError, json.JSONDecodeError):
            self._send(502, b'{"error":"elasticsearch unreachable"}\n', "application/json")
            return
        payload = (json.dumps({"elasticsearch": version}) + "\n").encode()
        self._send(200, payload, "application/json")

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
