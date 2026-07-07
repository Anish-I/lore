"""Lore CLI — query and push content to the Lore API.

Usage:
    lore capture --session <id> --title <title> [--text <text>] \\
                 --scope <scope> --owner <owner> --tenant <tenant> [--url http://localhost:8099]

    lore ask "<question>" --scope <scope> --tenant <tenant> [--url http://localhost:8099]

    lore search "<query>" --scope <scope> --tenant <tenant> [--k 10] [--url http://localhost:8099]

    lore graph --scope <scope> --tenant <tenant> [--url http://localhost:8099]

    If --text is omitted for capture, text is read from stdin.

Examples:
    echo "my notes" | lore capture --session proj-abc --title "Project ABC notes" --scope <scope> --owner <owner> --tenant <tenant>
    lore ask "what is the Kalshi bot?" --scope <scope> --tenant <tenant>
    lore search "RAG pipeline" --scope <scope> --tenant <tenant>
    lore graph --scope <scope> --tenant <tenant>
"""
import argparse, json, os, sys, time
import urllib.request, urllib.error

DEFAULT_URL = "http://localhost:8099"
_HTTP_TIMEOUT = 15   # seconds; applied to every real API call

# Local API token — the desktop-spawned backend rejects tokenless requests
# with 401 (the scraper silently hit this for weeks). Resolution order:
# explicit --token, LORE_LOCAL_TOKEN env, then the desktop app's config file.
_TOKEN: str = ""


def _discover_token() -> str:
    if os.environ.get("LORE_LOCAL_TOKEN"):
        return os.environ["LORE_LOCAL_TOKEN"]
    appdata = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    for app_name in ("lore-desktop", "Lore"):
        cfg_path = os.path.join(appdata, app_name, "lore-config.json")
        try:
            with open(cfg_path, encoding="utf-8") as f:
                tok = (json.load(f) or {}).get("localToken")
                if tok:
                    return tok
        except Exception:
            continue
    return ""


def _headers(extra: dict = None) -> dict:
    h = dict(extra or {})
    if _TOKEN:
        h["X-Lore-Token"] = _TOKEN
    return h


def _post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers=_headers({"Content-Type": "application/json"}),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        return json.loads(resp.read())


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        return json.loads(resp.read())


def ensure_backend(base_url: str = DEFAULT_URL, timeout: int = 2) -> bool:
    """Return True if the Lore backend is reachable on :8099 (GET /presets).

    Does NOT auto-spawn the backend — caller must start Lore first.
    """
    try:
        req = urllib.request.Request(f"{base_url}/presets")
        urllib.request.urlopen(req, timeout=timeout)
        return True
    except Exception:
        return False


def _cmd_capture(args: argparse.Namespace) -> int:
    text = args.text if args.text else sys.stdin.read()
    if not text.strip():
        print("error: no text supplied (use --text or pipe via stdin)", file=sys.stderr)
        return 1
    try:
        result = _post_json(f"{args.url}/capture", {
            "session_id": args.session,
            "title": args.title,
            "text": text,
            "scope": args.scope,
            "owner": args.owner,
            "tenant": args.tenant,
        })
        print(json.dumps(result, indent=2))
        return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        return 1


def _cmd_ask(args: argparse.Namespace) -> int:
    if not ensure_backend(args.url):
        print("Lore is not running. Start it first: uvicorn lore.api:app --port 8099", file=sys.stderr)
        return 1
    try:
        result = _post_json(f"{args.url}/ask", {
            "question": args.question,
            "principal_scopes": [args.scope],
            "tenant_id": args.tenant,
        })
        print(result.get("answer", "(no answer)"))
        engine = result.get("engine", "")
        if engine:
            print(f"\n[engine: {engine}]", file=sys.stderr)
        return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        return 1


def _cmd_search(args: argparse.Namespace) -> int:
    if not ensure_backend(args.url):
        print("Lore is not running. Start it first: uvicorn lore.api:app --port 8099", file=sys.stderr)
        return 1
    try:
        result = _post_json(f"{args.url}/search", {
            "query": args.query,
            "scopes": [args.scope],
            "k": args.k,
            "tenant_id": args.tenant,
        })
        hits = result.get("results", [])
        if not hits:
            print("No results found.")
            return 0
        for i, h in enumerate(hits, 1):
            title = h.get("title") or h.get("note_id", "?")
            heading = h.get("heading_path", "")
            score = h.get("score", 0.0)
            print(f"{i}. {title}  [{heading}]  score={score:.3f}")
        return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        return 1


def _cmd_graph(args: argparse.Namespace) -> int:
    if not ensure_backend(args.url):
        print("Lore is not running. Start it first: uvicorn lore.api:app --port 8099", file=sys.stderr)
        return 1
    try:
        url = f"{args.url}/graph?tenant={args.tenant}&scopes={args.scope}"
        result = _get_json(url)
        nodes = len(result.get("nodes", []))
        edges = len(result.get("edges", []))
        print(f"nodes={nodes}  edges={edges}")
        return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        return 1


# ---------------------------------------------------------------------------
# doctor / next
# ---------------------------------------------------------------------------

def _count_md(root: str) -> int:
    """Recursive *.md count, skipping dot-dirs — mirrors the desktop scanner."""
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        total += sum(1 for f in filenames if f.lower().endswith(".md"))
    return total


def _status_get(url: str, with_token: bool):
    """GET returning (status_code, parsed_json_or_None) without raising."""
    headers = _headers() if with_token else {}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


def _collect_doctor(args) -> list:
    """All doctor rows: client-side checks + the backend's /doctor checks."""
    rows = []

    up = ensure_backend(args.url)
    rows.append({
        "name": "backend", "ok": up,
        "detail": f"reachable at {args.url}" if up else f"NOT reachable at {args.url}",
        "fix": None if up else "start the Lore app (or uvicorn lore.api:app --port 8099)",
    })
    if not up:
        return rows

    # Token round-trip: tokenless must 401 when enforcement is on; with the
    # discovered token it must 200. This is the silent-401 failure mode that
    # once left the index empty while every scan reported success.
    stats_url = f"{args.url}/stats?tenant={args.tenant}"
    code_no, _ = _status_get(stats_url, with_token=False)
    code_yes, stats = _status_get(stats_url, with_token=True)
    if code_no == 401 and code_yes == 200:
        rows.append({"name": "token", "ok": True,
                     "detail": "enforcement ON and the local token works", "fix": None})
    elif code_no == 200:
        rows.append({"name": "token", "ok": True,
                     "detail": "enforcement OFF (raw backend — fine for dev/CI)", "fix": None})
    elif code_yes != 200:
        rows.append({"name": "token", "ok": False,
                     "detail": f"requests with the discovered token get HTTP {code_yes or 'no response'}",
                     "fix": "pass --token, or check %APPDATA%/lore-desktop/lore-config.json localToken"})
    else:
        rows.append({"name": "token", "ok": True,
                     "detail": f"tokenless={code_no}, with-token={code_yes}", "fix": None})

    # Disk vs index gap (the reconcile's own math, exposed for humans).
    if args.root and stats:
        disk = sum(_count_md(r) for r in args.root)
        indexed = int(stats.get("notes") or 0)
        folded = int(stats.get("foldedPaths") or 0)
        gap = disk - folded - indexed
        ok = disk == 0 or gap <= max(10, disk * 0.10)
        rows.append({
            "name": "coverage", "ok": ok,
            "detail": f"{disk} .md on disk · {indexed} indexed · {folded} folded · gap {gap}",
            "fix": None if ok else "run a reindex/scan (desktop reconcile does this on boot)",
        })

    code, body = _status_get(f"{args.url}/doctor?tenant={args.tenant}", with_token=True)
    if code == 200 and body:
        rows.extend(body.get("checks", []))
    else:
        rows.append({"name": "doctor-endpoint", "ok": False,
                     "detail": f"GET /doctor returned HTTP {code or 'no response'}",
                     "fix": "backend predates /doctor — update Lore" if code == 404 else None})
    return rows


def _cmd_doctor(args: argparse.Namespace) -> int:
    rows = _collect_doctor(args)
    if args.json:
        print(json.dumps({"ok": all(r["ok"] for r in rows), "checks": rows}, indent=2))
    else:
        width = max(len(r["name"]) for r in rows)
        for r in rows:
            mark = "OK  " if r["ok"] else "FAIL"
            print(f"  {mark}  {r['name']:<{width}}  {r['detail']}")
            if r.get("fix") and not r["ok"]:
                print(f"        {'':<{width}}  fix: {r['fix']}")
        hints = [r for r in rows if r["ok"] and r.get("fix")]
        for r in hints:
            print(f"  hint  {r['name']:<{width}}  {r['fix']}")
    return 0 if all(r["ok"] for r in rows) else 1


def _cmd_next(args: argparse.Namespace) -> int:
    rows = _collect_doctor(args)
    actions = []
    by = {r["name"]: r for r in rows}
    if not by.get("backend", {}).get("ok"):
        actions.append("Start the Lore app — nothing else can run until the backend is up.")
    else:
        if not by.get("index", {}).get("ok", True):
            actions.append("Reindex your library — the index is empty.")
        if not by.get("coverage", {}).get("ok", True):
            actions.append("Reindex — files on disk aren't in the index yet.")
        if not by.get("model-cache", {}).get("ok", True):
            actions.append(f"Repair the model cache: {by['model-cache'].get('fix')}")
        if not by.get("upkeep", {}).get("ok", True):
            actions.append("Run upkeep — captured session notes are piling up.")
        llm_row = by.get("llm", {})
        if llm_row.get("fix"):
            actions.append(llm_row["fix"])
        hist = os.environ.get("LORE_EVAL_HISTORY") or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "eval", "history", "nightly.jsonl")
        hist = os.path.normpath(hist)
        if os.path.exists(os.path.dirname(hist)):
            if not os.path.exists(hist) or (time.time() - os.path.getmtime(hist)) > 48 * 3600:
                actions.append("Run the nightly recall eval (eval/run_nightly.py) — no fresh history.")
    if not actions:
        print("All clear — nothing needs attention.")
    else:
        for i, a in enumerate(actions, 1):
            print(f"{i}. {a}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="lore",
        description="Lore CLI — push content to the Lore knowledge OS",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # --- capture ---
    cap = sub.add_parser("capture", help="Index a session transcript into Lore")
    cap.add_argument("--session", required=True,
                     help="Stable unique session identifier (e.g. a UUID or slug)")
    cap.add_argument("--title", required=True,
                     help="Human-readable title for the captured note")
    cap.add_argument("--text", default=None,
                     help="Text to index; reads stdin if omitted")
    cap.add_argument("--scope", required=True,
                     help="ACL scope visible to the caller")
    cap.add_argument("--owner", required=True,
                     help="Owner identifier")
    cap.add_argument("--tenant", required=True,
                     help="Tenant namespace")
    cap.add_argument("--url", default=DEFAULT_URL,
                     help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- ask ---
    ask = sub.add_parser("ask", help="Ask a question against the Lore knowledge base")
    ask.add_argument("question", help="Natural language question")
    ask.add_argument("--scope", required=True,
                     help="ACL scope to query")
    ask.add_argument("--tenant", required=True,
                     help="Tenant namespace")
    ask.add_argument("--url", default=DEFAULT_URL,
                     help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- search ---
    srch = sub.add_parser("search", help="Search the Lore knowledge base")
    srch.add_argument("query", help="Search query")
    srch.add_argument("--scope", required=True,
                      help="ACL scope to search")
    srch.add_argument("--tenant", required=True,
                      help="Tenant namespace")
    srch.add_argument("--k", type=int, default=10,
                      help="Number of results to return (default: 10)")
    srch.add_argument("--url", default=DEFAULT_URL,
                      help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- graph ---
    grph = sub.add_parser("graph", help="Print knowledge graph node/edge counts")
    grph.add_argument("--scope", required=True,
                      help="ACL scope to query")
    grph.add_argument("--tenant", required=True,
                      help="Tenant namespace")
    grph.add_argument("--url", default=DEFAULT_URL,
                      help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- doctor ---
    doc = sub.add_parser("doctor", help="Health-check the local Lore install")
    doc.add_argument("--tenant", default="local", help="Tenant namespace (default: local)")
    doc.add_argument("--root", action="append", default=[],
                     help="Library root for the disk-vs-index coverage check (repeatable)")
    doc.add_argument("--url", default=DEFAULT_URL,
                     help=f"Lore API base URL (default: {DEFAULT_URL})")
    doc.add_argument("--token", default=None, help="Local API token (else env/desktop config)")
    doc.add_argument("--json", action="store_true", help="Machine-readable output")

    # --- next ---
    nxt = sub.add_parser("next", help="What should I do next? (read-only status)")
    nxt.add_argument("--tenant", default="local", help="Tenant namespace (default: local)")
    nxt.add_argument("--root", action="append", default=[],
                     help="Library root for the coverage check (repeatable)")
    nxt.add_argument("--url", default=DEFAULT_URL,
                     help=f"Lore API base URL (default: {DEFAULT_URL})")
    nxt.add_argument("--token", default=None, help="Local API token (else env/desktop config)")

    args = parser.parse_args()

    # Resolve the local API token once for every command.
    global _TOKEN
    _TOKEN = getattr(args, "token", None) or _discover_token()

    dispatch = {
        "capture": _cmd_capture,
        "ask": _cmd_ask,
        "search": _cmd_search,
        "graph": _cmd_graph,
        "doctor": _cmd_doctor,
        "next": _cmd_next,
    }
    handler = dispatch.get(args.cmd)
    sys.exit(handler(args) if handler else 1)


if __name__ == "__main__":
    main()
