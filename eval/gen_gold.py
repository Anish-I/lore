"""Generate a recall gold set from the LIVE vault (M1-D).

Samples stable notes via /graph, then emits two query kinds per note:
  exact      — a question containing an identifier token the note body holds
               (exercises the exact-ID lane; recall.py's _ID_EXTRACT pattern)
  paraphrase — one question the note answers, phrased WITHOUT its title words
               (via local Ollama; skipped when Ollama is down)

Output: eval/gold/gold-<tenant>.json — REVIEW THE FIRST GENERATED FILE by hand
before trusting nightly numbers built on it. Paraphrases are frozen here so
run_nightly.py never needs Ollama.

Env: LORE_PORT (8099) · LORE_TENANT (local) · LORE_SCOPES (engineering)
     LORE_TOKEN / LORE_LOCAL_TOKEN (X-Lore-Token; auto-discovered from the
     desktop config when unset) · GOLD_N (40)

Run:  python eval/gen_gold.py
"""
import json
import os
import random
import re
import sys
import urllib.parse
import urllib.request

PORT = os.environ.get("LORE_PORT", "8099")
BASE = f"http://localhost:{PORT}"
TENANT = os.environ.get("LORE_TENANT", "local")
SCOPES = [s for s in os.environ.get("LORE_SCOPES", "engineering").split(",") if s]
GOLD_N = int(os.environ.get("GOLD_N", "40"))
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:e4b")

# Mirrors upkeep._DATE_TITLE_RE — ephemeral notes fold away; never gold targets.
_DATE_TITLE_RE = re.compile(r"^(session:\s*)?\d{4}[-/]\d{2}[-/]\d{2}", re.IGNORECASE)
# Mirrors recall._ID_EXTRACT — identifier tokens the exact lane matches.
_ID_EXTRACT = re.compile(r"\b([A-Za-z]{2,}-(?:[A-Za-z]{2}-)?\d{2,})\b")


def _token() -> str:
    tok = os.environ.get("LORE_TOKEN") or os.environ.get("LORE_LOCAL_TOKEN")
    if tok:
        return tok
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    for app_name in ("lore-desktop", "Lore"):
        try:
            with open(os.path.join(appdata, app_name, "lore-config.json"), encoding="utf-8") as f:
                t = (json.load(f) or {}).get("localToken")
                if t:
                    return t
        except Exception:
            continue
    return ""


TOKEN = _token()


def _get(path):
    req = urllib.request.Request(BASE + path, headers={"X-Lore-Token": TOKEN} if TOKEN else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _ollama_paraphrase(title, body):
    prompt = (
        "You write retrieval-eval questions. Given this note, ask ONE short question "
        "the note clearly answers, WITHOUT reusing distinctive words from its title. "
        f"Title: {title}\n\nNote:\n{body[:1500]}\n\nQuestion:"
    )
    # NOTE: no num_predict cap — gemma4:e4b burns hundreds of hidden reasoning
    # tokens before its visible answer; a small cap yields an empty response.
    payload = json.dumps({"model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
                          "options": {"temperature": 0.4}}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/generate", data=payload,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read()).get("response", "").strip()
    lines = [ln.strip().strip('"') for ln in out.splitlines() if ln.strip()]
    # First line that reads like a question (reasoning models sometimes prefix chatter).
    for q in lines:
        if 10 <= len(q) <= 200 and "?" in q:
            return q
    return None


def main():
    random.seed(int(os.environ.get("GOLD_SEED", "7")))
    graph = _get(f"/graph?tenant={TENANT}&scopes={','.join(SCOPES)}")
    nodes = graph.get("nodes", [])
    if not nodes:
        print("no nodes visible — is the backend indexed and the token right?", file=sys.stderr)
        sys.exit(1)

    def stable(n):
        if _DATE_TITLE_RE.match(n.get("label") or ""):
            return False
        return True

    cands = [n for n in nodes if stable(n)]
    # Prefer connected/important notes — they're what retrieval must not lose.
    cands.sort(key=lambda n: (n.get("links") or 0) + 10 * (n.get("importance") or 0), reverse=True)
    pool = cands[: GOLD_N * 3]
    random.shuffle(pool)
    sample = pool[:GOLD_N]

    ollama_ok = True
    queries = []
    for n in sample:
        try:
            note = _get(f"/notes/{urllib.parse.quote(n['id'], safe='')}?tenant={TENANT}&scopes={','.join(SCOPES)}")
        except Exception:
            continue
        body = note.get("body") or ""
        title = note.get("title") or n.get("label") or n["id"]

        m = _ID_EXTRACT.search(body)
        if m:
            queries.append({
                "q": f"What do my notes say about {m.group(1)}?",
                "expect_note_id": n["id"], "expect_title_sub": title[:40], "kind": "exact",
            })

        if ollama_ok:
            try:
                pq = _ollama_paraphrase(title, body)
                if pq:
                    queries.append({
                        "q": pq, "expect_note_id": n["id"],
                        "expect_title_sub": title[:40], "kind": "paraphrase",
                    })
            except urllib.error.URLError as e:
                # Connection-level failure → Ollama is down; stop trying.
                print(f"ollama unreachable ({e}) — exact-only gold", file=sys.stderr)
                ollama_ok = False
            except Exception:
                continue  # one bad generation skips the note, not the lane

    if len(queries) < 25:
        print(f"only {len(queries)} queries generated (<25) — refusing to write a weak gold set. "
              "Is Ollama up? Is the index populated?", file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gold")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"gold-{TENANT}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"generated_at": __import__("datetime").datetime.now().isoformat(),
                   "tenant": TENANT, "scopes": SCOPES, "queries": queries}, f, indent=2)
    kinds = {}
    for q in queries:
        kinds[q["kind"]] = kinds.get(q["kind"], 0) + 1
    print(f"wrote {out_path}: {len(queries)} queries {kinds}")
    print("REVIEW this file once by hand before trusting nightly numbers.")


if __name__ == "__main__":
    main()
