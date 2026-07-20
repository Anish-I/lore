"""Run isolated semantic recall over explicitly supplied user-owned files."""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "core"))
sys.path.insert(0, str(ROOT / "eval"))


def _parse_sources(values):
    sources = {}
    for value in values:
        source_id, separator, raw_path = value.partition("=")
        if not separator or not source_id.strip() or not raw_path.strip():
            raise ValueError("sources must use id=path")
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"source does not exist: {path}")
        sources[source_id.strip()] = path
    return sources


def _title(text, fallback):
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip() or fallback
    return fallback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--source", action="append", default=[], help="Logical id=local path")
    parser.add_argument(
        "--source-type",
        choices=("note", "claude-session", "codex-session", "claude-history"),
        default="note",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    cases_payload = json.loads(args.cases.read_text(encoding="utf-8"))
    cases = cases_payload.get("cases") or []
    sources = _parse_sources(args.source)
    required = {
        source
        for case in cases
        for source in (case.get("expected_sources") or [case["expected_source"]])
    }
    missing = sorted(required - set(sources))
    if missing:
        parser.error(f"missing sources: {', '.join(missing)}")

    with tempfile.TemporaryDirectory(
        prefix="lore-trusted-recall-", ignore_cleanup_errors=True,
    ) as temp_dir:
        temp = Path(temp_dir)
        os.environ["DATABASE_URL"] = f"sqlite:///{temp / 'recall.db'}"
        os.environ["QDRANT_PATH"] = str(temp / "qdrant")
        os.environ["QDRANT_COLLECTION"] = "trusted_recall_eval"
        os.environ.setdefault(
            "FASTEMBED_CACHE_PATH", str(Path.home() / ".cache" / "lore" / "fastembed"),
        )

        from lore import db
        from lore.embed import LocalEmbedder, LocalSparseEmbedder
        from lore.rerank import LocalReranker

        conn = db.connect()
        db.bootstrap_schema(conn)
        embedder = LocalEmbedder()
        sparse = LocalSparseEmbedder()
        reranker = LocalReranker()
        from lore import qdrant_store
        from lore.index import index_document
        from lore.recall import retrieve
        from trusted_recall_score import score_retrieval

        for source_id, path in sources.items():
            body = path.read_text(encoding="utf-8", errors="replace")
            index_document(
                source_id=source_id,
                title=_title(body, source_id),
                text=body,
                scope_id="trusted-recall",
                owner_id="eval-user",
                tenant_id="trusted-recall",
                embedder=embedder,
                sparse_embedder=sparse,
                conn=conn,
                source_type=args.source_type,
            )

        # Exclude one-time ONNX initialization from query latency.
        embedder.embed(["warm up trusted recall"])
        sparse.embed_sparse(["warm up trusted recall"])
        reranker.rerank("warm up", ["warm up trusted recall"])

        rows = []
        latencies = []
        for case in cases:
            started = time.perf_counter()
            hits = retrieve(
                case["query"],
                embedder,
                reranker,
                ["trusted-recall"],
                "trusted-recall",
                limit=5,
                sparse_embedder=sparse,
                source_types=(args.source_type,),
            )
            latencies.append((time.perf_counter() - started) * 1000)
            unique_hits = []
            seen_sources = set()
            for hit in hits:
                if hit.note_id in seen_sources:
                    continue
                seen_sources.add(hit.note_id)
                unique_hits.append(hit)
            rows.append({
                "case_id": case["id"],
                "expected_sources": case.get("expected_sources") or [case["expected_source"]],
                "ranked_sources": [hit.note_id for hit in unique_hits],
                "provenance": [bool(hit.note_id and hit.why) for hit in unique_hits],
            })

        scored = score_retrieval(rows, latencies)
        result = {
            "schema": "lore-trusted-recall/v1",
            "measurement": "isolated-user-owned-note-retrieval",
            "reranker": reranker.model_name,
            "source_type": args.source_type,
            "sources": sorted(sources),
            "metrics": {
                key: round(value, 4) if isinstance(value, float) else value
                for key, value in scored["metrics"].items()
            },
            "failed_gates": scored["failed_gates"],
            "cases": rows,
            "privacy": {
                "isolated_store": True,
                "source_bodies_persisted": False,
                "retrieved_text_reported": False,
            },
        }
        rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
        conn.close()
        qdrant_store._client.close()
    return 0 if not result["failed_gates"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
