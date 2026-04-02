#!/usr/bin/env python3
"""Local server for Meal Photos page — proxies Nightscout API to avoid CORS."""

import http.server
import urllib.request
import urllib.parse
import json
import os

NS_URL = "https://p01--sefi--s66fclg7g2lm.code.run"
API_SECRET = "b3170e23f45df7738434cd8be9cd79d86a6d0f01"
PORT = 8765
DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.proxy_nightscout()
        else:
            super().do_GET()

    def proxy_nightscout(self):
        url = NS_URL + self.path
        req = urllib.request.Request(url)
        req.add_header("api-secret", API_SECRET)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())


if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Meal Photos server on http://localhost:{PORT}")
    server.serve_forever()
