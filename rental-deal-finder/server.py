#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote_plus
from urllib.request import Request, urlopen
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent

# Supports: €123, EUR 123, 123€, 123 EUR, $123, USD 123
PRICE_RE = re.compile(
    r"(?:€\s?(\d{2,4}(?:[\.,]\d{1,2})?)|(\d{2,4}(?:[\.,]\d{1,2})?)\s?€|EUR\s?(\d{2,4}(?:[\.,]\d{1,2})?)|(\d{2,4}(?:[\.,]\d{1,2})?)\s?EUR|\$\s?(\d{2,4}(?:[\.,]\d{1,2})?)|USD\s?(\d{2,4}(?:[\.,]\d{1,2})?))",
    re.I,
)

RESULT_LINK_RE = re.compile(r'<item>(.*?)</item>', re.I | re.S)

PROVIDERS = [
    ("Hertz", "hertz.com"),
    ("Rentalcars", "rentalcars.com"),
    ("DiscoverCars", "discovercars.com"),
    ("Auto Europe", "autoeurope.com"),
    ("Kayak", "kayak.com"),
    ("Skyscanner", "skyscanner.com"),
    ("Expedia", "expedia.com"),
    ("Booking", "booking.com"),
]


def fetch_text(url: str, timeout: int = 12) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urlopen(req, timeout=timeout).read()
    return data.decode("utf-8", errors="ignore")


def extract_prices(text: str):
    out = []
    for m in PRICE_RE.finditer(text):
        groups = m.groups()
        eur_val = groups[0] or groups[1] or groups[2] or groups[3]
        usd_val = groups[4] or groups[5]
        if eur_val:
            try:
                v = float(eur_val.replace(",", "."))
                if 80 <= v <= 2000:
                    out.append(("EUR", v))
            except Exception:
                pass
        elif usd_val:
            try:
                v = float(usd_val.replace(",", "."))
                if 80 <= v <= 2000:
                    out.append(("USD", v))
            except Exception:
                pass
    return out


def extract_result_urls(rss_xml: str, domain: str, max_urls: int = 4):
    urls = []
    snippets = []
    seen = set()
    try:
        root = ET.fromstring(rss_xml)
    except Exception:
        return urls, snippets

    for item in root.findall('.//item'):
        link = (item.findtext('link') or '').strip()
        desc = (item.findtext('description') or '').strip()
        if not link.startswith('http'):
            continue
        if domain.lower() not in (urlparse(link).netloc or '').lower() and domain.lower() not in link.lower():
            continue
        if link in seen:
            continue
        seen.add(link)
        urls.append(link)
        snippets.append(desc)
        if len(urls) >= max_urls:
            break

    return urls, snippets


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/hunt":
            return super().do_GET()

        qs = parse_qs(parsed.query)
        trip = qs.get("q", [""])[0].strip()
        fx = float(qs.get("fx", ["1.09"])[0] or 1.09)
        if not trip:
            return self._json({"error": "missing query"}, 400)

        results = []
        debug = []

        for provider, domain in PROVIDERS:
            query = f"site:{domain} {trip} car rental one way"
            search_url = f"https://www.bing.com/search?format=rss&q={quote_plus(query)}"

            try:
                search_rss = fetch_text(search_url, timeout=14)
            except Exception as e:
                debug.append({"provider": provider, "error": f"search fail: {e}"})
                continue

            provider_hits = 0
            seen_prices = set()

            # pass 1: RSS snippets
            urls, snippets = extract_result_urls(search_rss, domain=domain, max_urls=5)
            for snippet in snippets:
                for cur, val in extract_prices(snippet):
                    key = (cur, round(val))
                    if key in seen_prices:
                        continue
                    seen_prices.add(key)
                    price_eur = val if cur == "EUR" else (val / fx)
                    results.append({
                        "provider": provider,
                        "price": round(price_eur, 2),
                        "url": f"https://www.bing.com/search?q={quote_plus(query)}",
                        "source": "auto-hunter-rss-snippet",
                    })
                    provider_hits += 1
                    if provider_hits >= 4:
                        break
                if provider_hits >= 4:
                    break

            # pass 2: top result pages + r.jina.ai mirror
            for u in urls:
                if provider_hits >= 6:
                    break
                texts = []
                try:
                    texts.append(fetch_text(u, timeout=10))
                except Exception:
                    pass
                try:
                    mirror = "https://r.jina.ai/http://" + u.replace("https://", "").replace("http://", "")
                    texts.append(fetch_text(mirror, timeout=10))
                except Exception:
                    pass

                for t in texts:
                    for cur, val in extract_prices(t):
                        key = (cur, round(val))
                        if key in seen_prices:
                            continue
                        seen_prices.add(key)
                        price_eur = val if cur == "EUR" else (val / fx)
                        results.append({
                            "provider": provider,
                            "price": round(price_eur, 2),
                            "url": u,
                            "source": "auto-hunter-result-page",
                        })
                        provider_hits += 1
                        if provider_hits >= 6:
                            break
                    if provider_hits >= 6:
                        break

            debug.append({"provider": provider, "hits": provider_hits, "resultUrls": len(urls)})

        self._json({"results": results, "debug": debug})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
    print("Serving on http://127.0.0.1:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()
