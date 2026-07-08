"""Large-data + open-data smoke (M1-M5), isolated tenant, self-cleaning.

  --load     ingest N synthetic notes, measure ingest + search + context-pack latency
  --opendata download & ingest real public docs (Gutenberg txt, arXiv PDF, a wiki URL)
  --cleanup  /forget everything under the smoke tenant

Run:  python eval/smoke_load.py --load --opendata ; python eval/smoke_load.py --cleanup
"""
import argparse
import functools
print = functools.partial(print, flush=True)
import json
import os
import statistics
import sys
import tempfile
import time
import urllib.request
import urllib.error

BASE = f"http://localhost:{os.environ.get('LORE_PORT', '8099')}"
TENANT = os.environ.get("LORE_TENANT", "smoke")
SCOPE = os.environ.get("LORE_SCOPE", "research")


def _token():
    tok = os.environ.get("LORE_LOCAL_TOKEN")
    if tok:
        return tok
    ad = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    for a in ("lore-desktop", "Lore"):
        try:
            with open(os.path.join(ad, a, "lore-config.json"), encoding="utf-8") as f:
                t = (json.load(f) or {}).get("localToken")
                if t:
                    return t
        except Exception:
            pass
    return ""


TOKEN = _token()
H = {"content-type": "application/json", **({"X-Lore-Token": TOKEN} if TOKEN else {})}


def call(method, path, payload=None, timeout=120):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=H)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or "null"), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200], (time.perf_counter() - t0) * 1000
    except Exception as e:
        return 0, str(e)[:200], (time.perf_counter() - t0) * 1000


_TOPICS = ["retrieval", "underwriting", "kalshi", "chunking", "embeddings", "graph",
           "upkeep", "hooks", "wizards", "scopes", "recall", "sync", "provenance"]


def load(n):
    print(f"== load: {n} notes into tenant={TENANT} ==")
    ingest_ms = []
    ok = 0
    for i in range(n):
        topic = _TOPICS[i % len(_TOPICS)]
        body = (f"# Load Note {i} about {topic}\n\n"
                f"This synthetic note {i} discusses {topic} in depth. "
                f"Identifier LOAD-{i:04d} references decision {i}. "
                + (f"The {topic} pipeline processes stage {i % 7}. " * 12))
        st, _, dt = call("POST", "/ingest", {
            "source_id": f"load-{i}", "title": f"Load Note {i} about {topic}",
            "text": body, "scope": SCOPE, "owner": "loadtest", "tenant": TENANT})
        if st == 200:
            ok += 1
            ingest_ms.append(dt)
        if (i + 1) % 100 == 0:
            print(f"  ingested {i + 1}/{n} (last p50 {statistics.median(ingest_ms[-100:]):.0f}ms)")
    print(f"  ingest: {ok}/{n} ok, p50={statistics.median(ingest_ms):.0f}ms p95={sorted(ingest_ms)[int(len(ingest_ms)*0.95)-1]:.0f}ms")

    st, b, _ = call("GET", f"/stats?tenant={TENANT}")
    print(f"  stats: {b}")

    # Query latency at scale.
    q_ms, hits_ok = [], 0
    for i in range(0, n, max(1, n // 20)):
        topic = _TOPICS[i % len(_TOPICS)]
        st, b, dt = call("POST", "/search", {"query": f"what does note {i} say about {topic}",
                                             "scopes": [SCOPE], "tenant_id": TENANT, "k": 5})
        q_ms.append(dt)
        if st == 200 and b.get("results"):
            hits_ok += 1
    print(f"  search@scale: {hits_ok} non-empty, p50={statistics.median(q_ms):.0f}ms p95={sorted(q_ms)[int(len(q_ms)*0.95)-1]:.0f}ms")

    # Exact-ID recall at scale (the exact lane must still nail LOAD-0137).
    st, b, dt = call("POST", "/search", {"query": "find LOAD-0137", "scopes": [SCOPE], "tenant_id": TENANT, "k": 5})
    hit = st == 200 and any("LOAD-0137" in str(h.get("text", "")) for h in b.get("results", []))
    print(f"  exact-ID @ scale: {'HIT' if hit else 'MISS'} ({dt:.0f}ms)")

    # Context-pack at scale respects budget.
    st, b, dt = call("POST", "/context-pack", {"task": "retrieval and embeddings pipeline",
                                              "scopes": [SCOPE], "tenant_id": TENANT, "budget": 2000})
    print(f"  context-pack @ scale: {b.get('tokens_total') if isinstance(b, dict) else b}/{2000} tokens, {len(b.get('items', [])) if isinstance(b, dict) else 0} items ({dt:.0f}ms)")
    return hit


_OPEN = [
    ("url", "https://en.wikipedia.org/wiki/Retrieval-augmented_generation"),
    ("txt", "https://www.gutenberg.org/cache/epub/1342/pg1342.txt"),   # Pride & Prejudice
    ("pdf", "https://arxiv.org/pdf/1706.03762"),                        # Attention Is All You Need
]


def opendata():
    print(f"== open-data ingest into tenant={TENANT} ==")
    tmp = tempfile.mkdtemp(prefix="lore-opendata-")
    results = []
    for kind, url in _OPEN:
        if kind == "url":
            st, b, dt = call("POST", "/ingest-url", {"url": url, "scope": SCOPE, "owner": "opendata", "tenant": TENANT})
            ok = st == 200 and isinstance(b, dict) and b.get("chunks", 0) > 0
            print(f"  {'OK' if ok else 'FAIL'} URL   {url[:48]} -> {b.get('chunks') if isinstance(b, dict) else b} chunks ({dt:.0f}ms)")
            results.append(ok)
        else:
            # Download to temp, then /reindex through the file path (needs VAULT_ROOTS
            # to include the temp dir — the backend guards reindex paths). We instead
            # POST the extracted/raw text via /ingest to avoid the path guard.
            try:
                data = urllib.request.urlopen(url, timeout=60).read()
            except Exception as e:
                print(f"  SKIP {kind.upper()} download failed: {e}")
                results.append(None)
                continue
            path = os.path.join(tmp, f"open.{kind}")
            with open(path, "wb") as f:
                f.write(data)
            if kind == "pdf":
                from lore.extract import extract_text
                got = extract_text(path)
                if not got:
                    print("  FAIL PDF extraction returned nothing")
                    results.append(False)
                    continue
                title, text = got
            else:
                text = data.decode("utf-8", "replace")[:400_000]
                title = "Pride and Prejudice (Gutenberg)"
            st, b, dt = call("POST", "/ingest", {
                "source_id": f"open-{kind}", "title": title, "text": text[:400_000],
                "scope": SCOPE, "owner": "opendata", "tenant": TENANT}, timeout=180)
            ok = st == 200 and isinstance(b, dict) and b.get("chunks", 0) > 0
            print(f"  {'OK' if ok else 'FAIL'} {kind.upper():5} {title[:40]} -> {b.get('chunks') if isinstance(b, dict) else b} chunks ({len(text)} chars, {dt:.0f}ms)")
            results.append(ok)

    # Recall over the open data.
    for q in ["what is attention in transformers", "who is Elizabeth Bennet", "what is retrieval augmented generation"]:
        st, b, dt = call("POST", "/search", {"query": q, "scopes": [SCOPE], "tenant_id": TENANT, "k": 3})
        top = b.get("results", [{}])[0].get("title") if isinstance(b, dict) and b.get("results") else "(none)"
        print(f"  recall '{q[:36]}' -> {top} ({dt:.0f}ms)")
    return all(r for r in results if r is not None)


def cleanup():
    print(f"== cleanup: forget tenant={TENANT} ==")
    # /forget by path prefix won't catch DB-only notes; delete via the notes we know.
    for pref in ["load-", "open-", "agent:", "url:", "smoke"]:
        pass
    st, b, _ = call("POST", "/forget", {"tenant": TENANT, "path_prefix": ""})
    print(f"  forget(all paths): {st} {b}")
    st, b, _ = call("GET", f"/stats?tenant={TENANT}")
    print(f"  stats after: {b}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--load", type=int, nargs="?", const=500, default=0)
    ap.add_argument("--opendata", action="store_true")
    ap.add_argument("--cleanup", action="store_true")
    args = ap.parse_args()
    fails = 0
    if args.load:
        if not load(args.load):
            fails += 1
    if args.opendata:
        if not opendata():
            fails += 1
    if args.cleanup:
        cleanup()
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
