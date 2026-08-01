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

# Embedding-lane gates (v2, insurance-hardened). The 5000-note insurance run
# proved absolute cosine alone cannot separate true fragments from ADJACENT
# DESKS: "Claims - Property" vs "Subrogation" sits at 0.90-0.94 centered
# cosine — the same band as genuine name-variants (91 proposals, 38.5%
# precision). What separates them is TOPOLOGY: a true variant's nearest
# neighbor is its own sibling by a clear margin (~0.97 vs ~0.92), while an
# adjacent desk is near-equidistant to several topics. So every embedding
# merge now requires MUTUAL nearest-neighborhood plus a margin over the
# runner-up, iterated in rounds so 3-way fragment families still chain.
COSINE_FLOOR = 0.80            # with distinctive name evidence
# Sweep on the insurance store (135 variant topics / 34 gold):
#   0.90/margin.02 → 22 props, 1 false (0.955) · 0.94/.02 → 21 props, 0 false
#   (1.000) · margin .03 → drops 2 TRUE merges. 0.94 + 0.02 wins.
COSINE_FLOOR_DISTINCT = 0.94   # without any name evidence
MUTUAL_MARGIN = 0.02           # best must beat each side's runner-up by this
MERGE_ROUNDS = 3               # union-find rounds (chains A<-B<-C fragment sets)
# A shared name token only counts as evidence if it is rare across topic
# names — "claims"/"auto" style domain words appear everywhere and endorsed
# 21 of the 56 false insurance merges.
TOKEN_DF_CEILING_FRAC = 0.10
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


def _token_df(names: list) -> dict:
    """Document frequency of each name token across all topic names."""
    df: dict = {}
    for n in names:
        for t in _tokens(n):
            df[t] = df.get(t, 0) + 1
    return df


def _has_name_evidence(a: str, b: str, df: dict = None, n_names: int = 0) -> bool:
    """Distinctive shared token, or an abbreviation-style prefix pair
    ('subro'/'subrogation'). Prefix rule needs >=4 chars so 'tax'/'taxi'-class
    accidents don't count. When a df map is given, a token endorses a merge
    only if it is RARE across topic names — common domain words ("claims",
    "auto") name many distinct desks and are not evidence of sameness."""
    ceiling = max(2, int(n_names * TOKEN_DF_CEILING_FRAC)) if df else None

    def distinctive(tok: str) -> bool:
        return df is None or df.get(tok, 0) <= ceiling

    shared = _tokens(a) & _tokens(b)
    if any(distinctive(t) for t in shared):
        return True
    for x in _tokens(a):
        for y in _tokens(b):
            lo, hi = (x, y) if len(x) <= len(y) else (y, x)
            if len(lo) >= 4 and hi.startswith(lo) and distinctive(hi):
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
                  always proposed (score 1.0). Perfect precision on every
                  scenario measured.
      embedding — group centroids over member-note digests; requires `embedder`
                  (skipped when None). v2 gates (insurance-hardened): a merge
                  must be a MUTUAL nearest-neighbor pair with a MUTUAL_MARGIN
                  lead over each side's runner-up, clear the cosine floor
                  (lowered only by DISTINCTIVE shared name tokens — rare across
                  topic names), and rounds iterate so fragment families chain.
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
            df = _token_df(names)

            # Union-find over topics; each round merges MUTUAL nearest
            # neighbors only, then recomputes group centroids, so a 3-4 way
            # fragment family chains together while adjacent desks (whose
            # nearest neighbor is never reciprocal-with-margin) stay apart.
            parent = {n: n for n in centroids}

            def find(x):
                while parent[x] != x:
                    parent[x] = parent[parent[x]]
                    x = parent[x]
                return x

            for _round in range(MERGE_ROUNDS):
                groups: dict = {}
                for n in centroids:
                    groups.setdefault(find(n), []).append(n)
                reps = sorted(groups)
                if len(reps) < 2:
                    break
                gcent = {r: _centroid([centroids[n] for n in groups[r]]) for r in reps}
                # Re-center over CURRENT groups: shared boilerplate saturates
                # raw cosines toward 1.0 (office smoke: 934 proposals, 6.5%
                # precision before centering).
                gmean = _centroid(list(gcent.values()))
                gcent = {r: [x - m for x, m in zip(v, gmean)] for r, v in gcent.items()}

                best: dict = {}
                for i in range(len(reps)):
                    for j in range(i + 1, len(reps)):
                        a, b = reps[i], reps[j]
                        cos = _cosine(gcent[a], gcent[b])
                        for s, o in ((a, b), (b, a)):
                            top = best.setdefault(s, [])
                            top.append((cos, o))

                merged_any = False
                for a in reps:
                    ranked = sorted(best.get(a, []), reverse=True)
                    if not ranked:
                        continue
                    cos, b = ranked[0]
                    runner = ranked[1][0] if len(ranked) > 1 else -1.0
                    b_ranked = sorted(best.get(b, []), reverse=True)
                    if not b_ranked or b_ranked[0][1] != a:
                        continue                      # not mutual
                    b_runner = b_ranked[1][0] if len(b_ranked) > 1 else -1.0
                    if cos - max(runner, b_runner) < MUTUAL_MARGIN and len(reps) > 2:
                        continue                      # equidistant neighborhood — adjacent desks
                    evidence = any(
                        _has_name_evidence(x, y, df, len(names))
                        for x in groups[a] for y in groups[b])
                    floor = cosine_floor if evidence else cosine_floor_distinct
                    if cos < floor:
                        continue
                    ra, rb = find(a), find(b)
                    if ra == rb:
                        continue
                    # Report the merge as the largest topic on each side.
                    ka = max(groups[a], key=lambda n: len(members[n]))
                    kb = max(groups[b], key=lambda n: len(members[n]))
                    add(ka, kb, "embedding" if evidence else "embedding-distinct", cos)
                    parent[rb] = ra
                    merged_any = True
                if not merged_any:
                    break

    return sorted(proposals.values(), key=lambda p: (-p["score"], p["keep"], p["merge"]))
