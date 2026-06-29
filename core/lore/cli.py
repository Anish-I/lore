"""Lore CLI — query and push content to the Lore API.

Usage:
    lore capture --session <id> --title <title> [--text <text>] \\
                 [--scope private] [--owner me] [--tenant solo] [--url http://localhost:8099]

    lore ask "<question>" [--scope private] [--tenant solo] [--url http://localhost:8099]

    lore search "<query>" [--scope private] [--tenant solo] [--k 10] [--url http://localhost:8099]

    lore graph [--scope private] [--tenant solo] [--url http://localhost:8099]

    If --text is omitted for capture, text is read from stdin.

Examples:
    echo "my notes" | lore capture --session proj-abc --title "Project ABC notes"
    lore ask "what is the Kalshi bot?" --scope private
    lore search "RAG pipeline" --scope private
    lore graph --scope private
"""
import argparse, json, socket, sys
import urllib.request, urllib.error

DEFAULT_URL = "http://localhost:8099"
_HTTP_TIMEOUT = 15   # seconds; applied to every real API call


def _post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
        return json.loads(resp.read())


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=_HTTP_TIMEOUT) as resp:
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
    cap.add_argument("--scope", default="private",
                     help="ACL scope visible to (default: private)")
    cap.add_argument("--owner", default="me",
                     help="Owner identifier (default: me)")
    cap.add_argument("--tenant", default="solo",
                     help="Tenant namespace (default: solo)")
    cap.add_argument("--url", default=DEFAULT_URL,
                     help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- ask ---
    ask = sub.add_parser("ask", help="Ask a question against the Lore knowledge base")
    ask.add_argument("question", help="Natural language question")
    ask.add_argument("--scope", default="private",
                     help="ACL scope to query (default: private)")
    ask.add_argument("--tenant", default="solo",
                     help="Tenant namespace (default: solo)")
    ask.add_argument("--url", default=DEFAULT_URL,
                     help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- search ---
    srch = sub.add_parser("search", help="Search the Lore knowledge base")
    srch.add_argument("query", help="Search query")
    srch.add_argument("--scope", default="private",
                      help="ACL scope to search (default: private)")
    srch.add_argument("--tenant", default="solo",
                      help="Tenant namespace (default: solo)")
    srch.add_argument("--k", type=int, default=10,
                      help="Number of results to return (default: 10)")
    srch.add_argument("--url", default=DEFAULT_URL,
                      help=f"Lore API base URL (default: {DEFAULT_URL})")

    # --- graph ---
    grph = sub.add_parser("graph", help="Print knowledge graph node/edge counts")
    grph.add_argument("--scope", default="private",
                      help="ACL scope to query (default: private)")
    grph.add_argument("--tenant", default="solo",
                      help="Tenant namespace (default: solo)")
    grph.add_argument("--url", default=DEFAULT_URL,
                      help=f"Lore API base URL (default: {DEFAULT_URL})")

    args = parser.parse_args()
    dispatch = {
        "capture": _cmd_capture,
        "ask": _cmd_ask,
        "search": _cmd_search,
        "graph": _cmd_graph,
    }
    handler = dispatch.get(args.cmd)
    sys.exit(handler(args) if handler else 1)


if __name__ == "__main__":
    main()
