"""Topic merge proposals (C4, 2026-07-20 clustering-gaps doc).

Repairs topic-name fragmentation — "Subrogation" / "Subro Recovery" /
"subrogation-cases" as three slug-distinct topics — using signals the store
already has: the notes' own text (embedding centroids) plus topic-name token
overlap. Slug-level near-duplicates are caught without any model at all.

PROPOSALS ONLY: this module returns proposal dicts and writes nothing. The
caller (upkeep job / API / desktop) decides how to surface them, and per the
standing invariant an accepted merge only ADDS alias mappings that steer
future classification and RAG membership — it never rewrites wikilinks/tags
in user files or stored bodies.

Guards (Sol's review of the gap doc):
  * entity/token disagreement blocks risky merges — two semantically close but
    distinct projects share no name tokens AND no cross-note title mentions,
    so they must clear the HIGHER cosine bar (`cosine_floor_distinct`).
  * direction is deterministic: keep the topic with more notes (ties: the
    lexicographically smaller name), so repeated runs propose stably.
"""
import math
import re

from .sqlutil import in_clause

# A merge is proposed when EITHER:
#   cosine >= COSINE_FLOOR            and the names share tokens/slug evidence
#   cosine >= COSINE_FLOOR_DISTINCT   with no name evidence at all
COSINE_FLOOR = 0.80
COSINE_FLOOR_DISTINCT = 0.90
# Max member notes embedded per topic centroid (cost bound; sampling is fine —
# a centroid over 40 digests is stable enough for merge detection).
MAX_NOTES_PER_TOPIC = 40
# Chars of body appended to the title for each note digest.
_DIGEST_BODY_CHARS = 300


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")


def _slug_key(name: str) -> str:
    """Aggressive normal form for slug-level duplicate detection:
    strip separators entirely and a trailing plural 's'."""
    s = _slug(name).replace("-", "")
    return s[:-1] if s.endswith("s") and len(s) > 3 else s


def _tokens(name: str) -> set:
    return {t for t in _slug(name).split("-") if t}


def _token_jaccard(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _has_name_evidence(a: str, b: str) -> bool:
    """Shared token, or an abbreviation-style prefix pair ('subro'/'subrogation').
    Prefix rule needs >=4 chars so 'tax'/'taxi'-class accidents don't count."""
    if _token_jaccard(a, b) > 0.0:
        return True
    for x in _tokens(a):
        for y in _tokens(b):
            lo, hi = (x, y) if len(x) <= len(y) else (y, x)
            if len(lo) >= 4 and hi.startswith(lo):
                return True
    return False


def _cosine(u, v) -> float:
    dot = sum(x * y for x, y in zip(u, v))
    nu = math.sqrt(sum(x * x for x in u))
    nv = math.sqrt(sum(x * x for x in v))
    if nu < 1e-12 or nv < 1e-12:
        return 0.0
    return dot / (nu * nv)


def _centroid(vectors) -> list:
    dim = len(vectors[0])
    out = [0.0] * dim
    for v in vectors:
        for i in range(dim):
            out[i] += v[i]
    n = float(len(vectors))
    return [x / n for x in out]


def _topic_members(conn, tenant: str) -> dict:
    """{topic display name: [note_id, ...]} from note_tags kind='topic'."""
    rows = conn.execute(
        "select tag, note_id from note_tags where tenant_id=%s and kind='topic'",
        (tenant,)).fetchall()
    out: dict = {}
    for tag, note_id in rows:
        out.setdefault(tag, []).append(note_id)
    return out


def _note_digests(conn, tenant: str, note_ids: list) -> list:
    """One short embeddable digest per note: title + head of body."""
    if not note_ids:
        return []
    frag, params = in_clause("id", note_ids)
    rows = conn.execute(
        f"select title, body from notes where tenant_id=%s and {frag}",
        (tenant, *params)).fetchall()
    digests = []
    for title, body in rows:
        head = " ".join((body or "")[:_DIGEST_BODY_CHARS].split())
        digests.append(f"{title or ''} — {head}".strip(" —"))
    return [d for d in digests if d]


def propose_topic_merges(conn, tenant: str, embedder=None, *,
                         cosine_floor: float = COSINE_FLOOR,
                         cosine_floor_distinct: float = COSINE_FLOOR_DISTINCT,
                         max_notes_per_topic: int = MAX_NOTES_PER_TOPIC) -> list:
    """Return merge proposals [{keep, merge, reason, score, keep_count,
    merge_count}] sorted by descending score. Writes nothing.

    Two lanes:
      slug      — _slug_key collision ("kalshi-bot" vs "KalshiBot"); model-free,
                  always proposed (score 1.0).
      embedding — topic centroids over member-note digests; requires `embedder`
                  (skipped when None). Name-token overlap lowers the bar
                  (COSINE_FLOOR); no shared tokens demands COSINE_FLOOR_DISTINCT.
    """
    members = _topic_members(conn, tenant)
    names = sorted(members)
    if len(names) < 2:
        return []

    def keep_merge(a: str, b: str):
        ca, cb = len(members[a]), len(members[b])
        if ca != cb:
            return (a, b) if ca > cb else (b, a)
        return (a, b) if a <= b else (b, a)

    proposals = {}

    def add(a: str, b: str, reason: str, score: float):
        keep, merge = keep_merge(a, b)
        key = (keep, merge)
        prior = proposals.get(key)
        if prior is None or score > prior["score"]:
            proposals[key] = {
                "keep": keep, "merge": merge, "reason": reason,
                "score": round(score, 4),
                "keep_count": len(members[keep]),
                "merge_count": len(members[merge]),
            }

    # --- Lane 1: slug-key collisions (model-free) ---
    by_key: dict = {}
    for name in names:
        by_key.setdefault(_slug_key(name), []).append(name)
    for group in by_key.values():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                add(group[i], group[j], "slug", 1.0)

    # --- Lane 2: embedding centroids ---
    if embedder is not None:
        digests_by_topic = {}
        for name in names:
            ids = members[name][:max_notes_per_topic]
            digests_by_topic[name] = _note_digests(conn, tenant, ids)
        # One batched embed call across all topics (order-preserving flatten).
        flat, spans = [], {}
        for name in names:
            ds = digests_by_topic[name]
            spans[name] = (len(flat), len(flat) + len(ds))
            flat.extend(ds)
        if flat:
            vecs = embedder.embed(flat)
            centroids = {}
            for name in names:
                lo, hi = spans[name]
                if hi > lo:
                    centroids[name] = _centroid(vecs[lo:hi])
            # Mean-center before cosine: corpora with shared boilerplate (note
            # templates, captured-session scaffolding) push EVERY centroid into
            # one dominant direction and raw cosines saturate toward 1.0 —
            # measured on the 2026-07-20 office scenario smoke: 934 proposals,
            # 6.5% precision. Subtracting the corpus mean cancels the shared
            # direction so only topic-specific content drives similarity.
            if len(centroids) >= 2:
                gmean = _centroid(list(centroids.values()))
                centroids = {
                    name: [x - m for x, m in zip(vec, gmean)]
                    for name, vec in centroids.items()
                }
            cnames = sorted(centroids)
            for i in range(len(cnames)):
                for j in range(i + 1, len(cnames)):
                    a, b = cnames[i], cnames[j]
                    cos = _cosine(centroids[a], centroids[b])
                    if _has_name_evidence(a, b) and cos >= cosine_floor:
                        add(a, b, "embedding", cos)
                    elif cos >= cosine_floor_distinct:
                        # No name evidence — the distinct-projects guard:
                        # only near-identical content clears this bar.
                        add(a, b, "embedding-distinct", cos)

    return sorted(proposals.values(), key=lambda p: (-p["score"], p["keep"], p["merge"]))
