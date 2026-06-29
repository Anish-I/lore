"""Heuristic reasoned-graph layer: typed semantic relations + node importance.

Turns Lore's structural links into REASONED edges. For each `[[wikilink]]` that
resolves to a real note, we inspect the enclosing sentence/clause, match a
direction- and negation-aware cue lexicon, and emit a typed edge whose:
  * kind     = the relation (supports/contradicts/causes/depends_on/supersedes/implements)
  * weight   = a deterministic confidence in [0,1]
  * evidence = the justifying sentence, so every edge is auditable.

Precision-first (per the design debate with Codex): v1 anchors ONLY on explicit
wikilinks (never folder/tag co-occurrence), gates each kind by a minimum
confidence, and keeps the graph sparse and explainable. No LLM dependence.
"""
import re
import math
import datetime

# Relation kinds we emit (relates_to is intentionally NOT emitted in v1 — the
# structural 'link' edge already captures generic association).
RELATION_KINDS = ("supports", "contradicts", "causes", "depends_on", "supersedes", "implements")

# Minimum confidence to persist an edge, per kind (Codex bands).
_MIN_CONFIDENCE = {
    "depends_on": 0.70, "implements": 0.70, "supersedes": 0.70, "causes": 0.70,
    "supports": 0.65, "contradicts": 0.65,
}

# Cue patterns: (compiled regex, kind, direction, specificity).
# direction 'fwd' = this-note -> linked-note; 'rev' = linked-note -> this-note (passive/“by”).
def _c(p):
    return re.compile(p, re.IGNORECASE)

_CUES = [
    # depends_on
    (_c(r"\bdepends?\s+on\b"), "depends_on", "fwd", 0.95),
    (_c(r"\brequires?\b"), "depends_on", "fwd", 0.90),
    (_c(r"\bbuilt\s+on\b"), "depends_on", "fwd", 0.90),
    (_c(r"\bbuilds?\s+on\b"), "depends_on", "fwd", 0.85),
    (_c(r"\bneeds?\b"), "depends_on", "fwd", 0.75),
    (_c(r"\b(?:is|are|was|were)\s+required\s+by\b"), "depends_on", "rev", 0.90),
    (_c(r"\bblocked\s+by\b"), "depends_on", "fwd", 0.85),
    (_c(r"\bprerequisite\b"), "depends_on", "fwd", 0.80),
    # supersedes
    (_c(r"\bsupersedes?\b"), "supersedes", "fwd", 1.00),
    (_c(r"\breplaces?\b"), "supersedes", "fwd", 0.95),
    (_c(r"\bdeprecates?\b"), "supersedes", "fwd", 0.95),
    (_c(r"\bobsoletes?\b"), "supersedes", "fwd", 0.90),
    (_c(r"\b(?:is|are|was|were)\s+replaced\s+by\b"), "supersedes", "rev", 0.95),
    (_c(r"\b(?:is|are|was|were)\s+superseded\s+by\b"), "supersedes", "rev", 0.95),
    # causes
    (_c(r"\bcauses?\b"), "causes", "fwd", 0.95),
    (_c(r"\bleads?\s+to\b"), "causes", "fwd", 0.90),
    (_c(r"\bresults?\s+in\b"), "causes", "fwd", 0.90),
    (_c(r"\btriggers?\b"), "causes", "fwd", 0.85),
    (_c(r"\bbecause\s+of\b"), "causes", "rev", 0.85),   # A because of B => B causes A
    (_c(r"\bcaused\s+by\b"), "causes", "rev", 0.90),
    # implements
    (_c(r"\bimplements?\b"), "implements", "fwd", 0.95),
    (_c(r"\bimplementation\s+of\b"), "implements", "fwd", 0.90),
    (_c(r"\brealizes?\b"), "implements", "fwd", 0.80),
    (_c(r"\bfulfills?\b"), "implements", "fwd", 0.80),
    (_c(r"\b(?:is|are|was|were)\s+implemented\s+by\b"), "implements", "rev", 0.90),
    # supports
    (_c(r"\bsupports?\b"), "supports", "fwd", 0.85),
    (_c(r"\bconfirms?\b"), "supports", "fwd", 0.85),
    (_c(r"\bvalidates?\b"), "supports", "fwd", 0.85),
    (_c(r"\bcorroborates?\b"), "supports", "fwd", 0.85),
    (_c(r"\bevidence\s+for\b"), "supports", "fwd", 0.80),
    # contradicts
    (_c(r"\bcontradicts?\b"), "contradicts", "fwd", 0.90),
    (_c(r"\bconflicts?\s+with\b"), "contradicts", "fwd", 0.85),
    (_c(r"\bdisagrees?\s+with\b"), "contradicts", "fwd", 0.85),
    (_c(r"\brefutes?\b"), "contradicts", "fwd", 0.90),
]

_NEGATORS = ("not", "never", "no", "n't", "without", "cannot", "isn't", "doesn't", "don't")
_HEDGE_STRONG = re.compile(r"\b(may|might|could|should|proposed|consider|perhaps|maybe|planned|tentativ)\w*\b", re.IGNORECASE)
_HEDGE_WEAK = re.compile(r"\b(likely|probably|generally|usually)\b", re.IGNORECASE)
_WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_CLAUSE_SPLIT = re.compile(r"[;,:]")


def _certainty(sentence: str) -> float:
    if _HEDGE_STRONG.search(sentence):
        return 0.45
    if _HEDGE_WEAK.search(sentence):
        return 0.75
    return 1.0


def _is_negated(sentence: str, cue_start: int) -> bool:
    """True if a negator appears within 3 tokens before the cue."""
    before = sentence[:cue_start].split()[-3:]
    return any(any(neg in tok.lower() for neg in _NEGATORS) for tok in before)


def _same_clause(sentence: str, a: int, b: int) -> bool:
    """True if positions a and b sit in the same comma/semicolon-delimited clause."""
    lo, hi = sorted((a, b))
    return _CLAUSE_SPLIT.search(sentence, lo, hi) is None


def extract_relations(text: str, resolve):
    """Extract typed relations from `text`.

    Args:
        text: the note's markdown/plaintext.
        resolve: callable(title:str) -> dst_note_id or None. Resolves a [[wikilink]]
                 title to a real note id (caller supplies the tenant-scoped lookup).

    Returns: list of (dst_id, kind, confidence, evidence), deduped on (dst_id, kind)
    keeping the highest confidence. Only edges meeting the per-kind threshold.
    """
    best = {}  # (dst_id, kind) -> (confidence, evidence)
    for sentence in _SENT_SPLIT.split(text or ""):
        links = list(_WIKILINK.finditer(sentence))
        if not links:
            continue
        n_links = len(links)
        for lm in links:
            dst = resolve(lm.group(1).strip())
            if not dst:
                continue
            link_pos = lm.start()
            for cue_re, kind, direction, specificity in _CUES:
                # v1: forward edges only (subject = the note being indexed). Passive/"by"
                # ('rev') constructions need edge ownership on the linked note — deferred to v2.
                if direction != "fwd":
                    continue
                # The cue must BIND this link: it has to read "<subject> CUE [[link]]", i.e.
                # the cue ends BEFORE the link and in the same clause. This rejects
                # "[[Composio]] ... replaces Zapier" (cue's subject is the link) and
                # "extending [[X]] to support Y" (cue after the link) — the v1 false positives.
                cm = None
                for m in cue_re.finditer(sentence):
                    if m.end() <= link_pos and _same_clause(sentence, m.end(), link_pos):
                        cm = m  # keep the closest preceding in-clause cue
                if cm is None:
                    continue
                if _is_negated(sentence, cm.start()):
                    continue  # negation cancels the candidate (never becomes contradicts)
                gap = link_pos - cm.end()
                proximity = 1.0 if gap <= 40 else 0.85
                certainty = _certainty(sentence)
                ambiguity = 1.0 if n_links == 1 else 0.75
                conf = round(specificity * proximity * certainty * ambiguity, 3)
                if conf < _MIN_CONFIDENCE.get(kind, 1.1):
                    continue
                key = (dst, kind)
                prev = best.get(key)
                evidence = sentence.strip()[:240]
                if prev is None or conf > prev[0]:
                    best[key] = (conf, evidence)

    return [(dst, kind, conf, evidence) for (dst, kind), (conf, evidence) in best.items()]


def backfill_relations(conn, tenant: str) -> int:
    """Recompute typed relations for ALL notes in a tenant from their stored text
    (notes.body, or concatenated chunk text for notes indexed before the body column).
    Use to populate the reasoned graph on a vault indexed before relations existed.
    Returns the total number of typed edges written."""
    from .index import _upsert_edges  # local import avoids a load-time cycle

    notes = conn.execute("select id, body from notes where tenant_id=%s", (tenant,)).fetchall()

    def _text(nid, body):
        if body:
            return body
        rows = conn.execute(
            "select text from chunks where note_id=%s order by chunk_index", (nid,)
        ).fetchall()
        return "\n".join(r[0] for r in rows if r[0]) if rows else ""

    def _resolver(src_id):
        def r(title):
            row = conn.execute(
                "select id from notes where lower(title)=%s and tenant_id=%s limit 1",
                (title.lower(), tenant),
            ).fetchone()
            return row[0] if row and row[0] != src_id else None
        return r

    total = 0
    for nid, body in notes:
        rels = extract_relations(_text(nid, body), _resolver(nid))
        by_kind = {}
        for dst, kind, conf, evidence in rels:
            by_kind.setdefault(kind, []).append((dst, conf, evidence))
        for kind in RELATION_KINDS:
            _upsert_edges(conn, tenant, nid, kind, by_kind.get(kind, []))
        total += len(rels)
    return total


# ---------------------------------------------------------------------------
# Node importance: weighted typed in-degree (Codex formula), normalized per tenant.
# ---------------------------------------------------------------------------

_IMPORTANCE_WEIGHTS = {
    "depends_on": 0.45, "implements": 0.20, "supports": 0.15, "contradicts": 0.10,
}
_RECENCY_WEIGHT = 0.10
_RECENCY_HALFLIFE_DAYS = 45.0
_CONTESTED_CAP = 0.15  # cap the contradicts contribution to avoid drama bias


def recompute_importance(conn, tenant: str, now=None) -> int:
    """Recompute notes.importance for a tenant from typed incoming-edge weights + recency.
    Returns the number of notes updated."""
    now = now or datetime.datetime.now(datetime.timezone.utc)

    # Incoming typed-edge weight sums per destination note.
    rows = conn.execute(
        """select dst_note_id, kind, sum(weight)
           from edges where tenant_id=%s and kind = any(%s)
           group by dst_note_id, kind""",
        (tenant, list(_IMPORTANCE_WEIGHTS.keys())),
    ).fetchall()
    raw = {}  # note_id -> {kind: sum}
    for dst, kind, total in rows:
        raw.setdefault(dst, {})[kind] = float(total or 0)

    notes = conn.execute(
        "select id, updated_at from notes where tenant_id=%s", (tenant,)
    ).fetchall()
    if not notes:
        return 0

    # Normalize each component by its per-tenant max so importance is comparable in [0,1].
    maxes = {k: max((raw.get(n[0], {}).get(k, 0.0) for n in notes), default=0.0) for k in _IMPORTANCE_WEIGHTS}

    updated = 0
    for note_id, updated_at in notes:
        comp = raw.get(note_id, {})
        score = 0.0
        for kind, w in _IMPORTANCE_WEIGHTS.items():
            mx = maxes[kind]
            val = (comp.get(kind, 0.0) / mx) if mx > 0 else 0.0
            if kind == "contradicts":
                val = min(val, _CONTESTED_CAP / _RECENCY_WEIGHT) if _RECENCY_WEIGHT else val
                val = min(val, 1.0)
            score += w * val
        # Recency: exponential decay, half-life 45 days.
        if updated_at is not None:
            age_days = max(0.0, (now - updated_at).total_seconds() / 86400.0)
            recency = math.pow(0.5, age_days / _RECENCY_HALFLIFE_DAYS)
        else:
            recency = 0.0
        score += _RECENCY_WEIGHT * recency
        conn.execute("update notes set importance=%s where id=%s", (round(score, 4), note_id))
        updated += 1
    return updated
