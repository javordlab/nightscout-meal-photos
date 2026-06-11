#!/usr/bin/env python3
"""
match_iili_to_local.py — find a local file in /Users/javier/.openclaw/media/inbound
whose perceptual hash matches a given iili.io URL.

Input on stdin (JSON): {"urls": ["https://iili.io/xxx.jpg", ...]}
Output on stdout (JSON): [{"url": ..., "match": "filename.jpg"|null, "distance": N|null, "status": "exact|high|weak|no_iili|miss"}]

- Matches at hamming distance <= 6 are considered good.
- If iili returns non-200 or the image can't be pHashed, status is "no_iili".
- If no local file is close enough, status is "miss".
"""
import sys, os, json, urllib.request, tempfile
import imagehash, PIL.Image as Image

INBOUND = '/Users/javier/.openclaw/media/inbound'

def phash_file(path):
    try:
        return imagehash.phash(Image.open(path))
    except Exception:
        return None

def main():
    req = json.load(sys.stdin)
    urls = req.get('urls', [])
    if not urls:
        print(json.dumps([]))
        return

    # Compute local phashes once
    local = {}
    for fn in os.listdir(INBOUND):
        if not fn.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        h = phash_file(os.path.join(INBOUND, fn))
        if h is not None:
            local[fn] = h

    results = []
    with tempfile.TemporaryDirectory() as td:
        for url in urls:
            tmp = os.path.join(td, 'cur.jpg')
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as r:
                    if r.status != 200:
                        results.append({'url': url, 'match': None, 'distance': None, 'status': 'no_iili'})
                        continue
                    with open(tmp, 'wb') as f:
                        f.write(r.read())
                target = phash_file(tmp)
                if target is None:
                    results.append({'url': url, 'match': None, 'distance': None, 'status': 'no_iili'})
                    continue
            except Exception:
                results.append({'url': url, 'match': None, 'distance': None, 'status': 'no_iili'})
                continue

            best_fn, best_d = None, 999
            for fn, h in local.items():
                d = target - h
                if d < best_d:
                    best_d = d
                    best_fn = fn
            if best_d <= 6:
                status = 'exact' if best_d == 0 else 'high'
            elif best_d <= 12:
                status = 'weak'
            else:
                status = 'miss'
            results.append({
                'url': url,
                'match': best_fn if best_d <= 6 else None,
                'distance': int(best_d),
                'status': status,
            })

    print(json.dumps(results))

if __name__ == '__main__':
    main()
