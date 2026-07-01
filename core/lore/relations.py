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

from .sqlutil import in_clause

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
# Code spans and shell-style $VARS are not prose — masking them (length-preserving) stops
# co-mentions/cues matching inside `$VAULT`, `code`, etc. (a real false-positive source).
_CODE_SPAN = re.compile(r"`[^`]*`|\$\w+")


def _mask_code(s: str) -> str:
    return _CODE_SPAN.sub(lambda m: " " * len(m.group(0)), s)


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


# Co-mention edges (a known note named in prose, not [[wikilinked]]) are discounted vs
# explicit wikilinks — recall without letting them outrank linked relations.
_COMENTION_DISCOUNT = 0.8


def extract_relations(text: str, resolve, title_index=None):
    """Extract typed relations from `text`.

    Args:
        text: the note's markdown/plaintext.
        resolve: callable(title:str) -> dst_note_id or None. Resolves a [[wikilink]]
                 title to a real note id (caller supplies the tenant-scoped lookup).
        title_index: optional list of (title, dst_id, compiled_pattern) from
                     `build_title_index` — enables the gated CO-MENTION recall layer
                     (known note titles named in prose, no [[ ]] needed). Discounted
                     and gated by binding cue + same clause + negation/hedge checks.

    Returns: list of (dst_id, kind, confidence, evidence), deduped on (dst_id, kind)
    keeping the highest confidence. Only edges meeting the per-kind threshold.
    """
    best = {}  # (dst_id, kind) -> (confidence, evidence)
    for original in _SENT_SPLIT.split(text or ""):
        # Match on a code-masked copy (positions preserved); keep `original` for evidence.
        sentence = _mask_code(original)
        # Candidates = explicit wikilinks (full weight) + co-mentions of known titles (discounted).
        candidates = []  # (position, dst_id, discount)
        for lm in _WIKILINK.finditer(sentence):
            dst = resolve(lm.group(1).strip())
            if dst:
                candidates.append((lm.start(), dst, 1.0))
        if title_index:
            for _title, dst_id, pat in title_index:
                m = pat.search(sentence)
                if m:
                    candidates.append((m.start(), dst_id, _COMENTION_DISCOUNT))
        if not candidates:
            continue
        # Ambiguity is about DISTINCT target notes in the sentence — a wikilink and a bare
        # mention of the SAME note are not ambiguous.
        n_targets = len(set(dst for _pos, dst, _disc in candidates))

        for tgt_pos, dst, discount in candidates:
            for cue_re, kind, direction, specificity in _CUES:
                # v1: forward edges only (subject = the note being indexed). Passive/"by"
                # ('rev') constructions need edge ownership on the linked note — deferred to v2.
                if direction != "fwd":
                    continue
                # The cue must BIND this target: "<subject> CUE <target>", i.e. the cue ends
                # BEFORE the target and in the same clause. Rejects "<target> ... replaces X"
                # (cue's subject is the target) and "extending <target> to support Y".
                cm = None
                for m in cue_re.finditer(sentence):
                    if m.end() <= tgt_pos and _same_clause(sentence, m.end(), tgt_pos):
                        cm = m  # keep the closest preceding in-clause cue
                if cm is None:
                    continue
                if _is_negated(sentence, cm.start()):
                    continue  # negation cancels the candidate (never becomes contradicts)
                gap = tgt_pos - cm.end()
                proximity = 1.0 if gap <= 40 else 0.85
                certainty = _certainty(sentence)
                ambiguity = 1.0 if n_targets == 1 else 0.75
                conf = round(specificity * proximity * certainty * ambiguity * discount, 3)
                if conf < _MIN_CONFIDENCE.get(kind, 1.1):
                    continue
                key = (dst, kind)
                prev = best.get(key)
                evidence = original.strip()[:240]
                if prev is None or conf > prev[0]:
                    best[key] = (conf, evidence)

    return [(dst, kind, conf, evidence) for (dst, kind), (conf, evidence) in best.items()]


def extract_entity_pairs(text: str, title_index, resolve=None):
    """Extract `A <cue> B` relations where BOTH endpoints are known notes named in the text
    (the subject is a named ENTITY, not the note being processed). For session captures /
    rich prose like "Codex replaces n8n" → Codex --supersedes--> n8n.

    Entities = [[wikilinks]] (full weight, via `resolve`) + distinctive title co-mentions
    (0.8 discount). A directional edge A→B is emitted when a forward cue sits BETWEEN A and B
    in the same clause, not negated. Returns (src_id, dst_id, kind, confidence, evidence).
    """
    best = {}  # (src_id, dst_id, kind) -> (conf, evidence)
    for original in _SENT_SPLIT.split(text or ""):
        sentence = _mask_code(original)
        ents = []  # (start, end, note_id, discount)
        for lm in _WIKILINK.finditer(sentence):
            did = resolve(lm.group(1).strip()) if resolve else None
            if did:
                ents.append((lm.start(), lm.end(), did, 1.0))
        if title_index:
            for _t, did, pat in title_index:
                m = pat.search(sentence)
                if m:
                    ents.append((m.start(), m.end(), did, _COMENTION_DISCOUNT))
        if len(ents) < 2:
            continue
        ents.sort()
        for a_start, a_end, a_id, a_disc in ents:
            for b_start, b_end, b_id, b_disc in ents:
                if a_id == b_id or a_end > b_start:
                    continue  # need A strictly before B, distinct notes
                for cue_re, kind, direction, specificity in _CUES:
                    if direction != "fwd":
                        continue
                    # cue must sit BETWEEN A and B, in the same clause: "A <cue> B".
                    cm = None
                    for m in cue_re.finditer(sentence):
                        if m.start() >= a_end and m.end() <= b_start and _same_clause(sentence, a_end, b_start):
                            cm = m
                    if cm is None or _is_negated(sentence, cm.start()):
                        continue
                    disc = min(a_disc, b_disc)  # discounted if either endpoint is a bare mention
                    conf = round(specificity * _certainty(sentence) * disc, 3)
                    if conf < _MIN_CONFIDENCE.get(kind, 1.1):
                        continue
                    key = (a_id, b_id, kind)
                    if key not in best or conf > best[key][0]:
                        best[key] = (conf, original.strip()[:240])
    return [(a, b, k, c, e) for (a, b, k), (c, e) in best.items()]


# Generic titles that would cause noisy co-mention matches if treated as entities.
_TITLE_STOPLIST = frozenset((
    "index", "readme", "notes", "todo", "ideas", "log", "inbox", "untitled",
    "home", "overview", "misc", "scratch", "draft", "new note",
))


def _is_distinctive(title: str) -> bool:
    """A title is safe to match in free prose only if it's DISTINCTIVE — multi-word,
    CamelCase, or long. Bare common words ('Vault', 'Server') match prose noisily and
    are excluded from co-mention (they still work as explicit [[wikilinks]])."""
    return (" " in title) or bool(re.search(r"[a-z][A-Z]", title)) or len(title) >= 8


def build_title_index(conn, tenant: str, exclude_id: str = None):
    """Build a co-mention vocabulary: DISTINCTIVE note titles in the tenant, as whole-word
    case-insensitive patterns, for recognizing entities named in prose. Skips titles shorter
    than 4 chars, generic stoplist titles, and non-distinctive bare words (noise control)."""
    rows = conn.execute(
        "select id, title from notes where tenant_id=%s and title is not null", (tenant,)
    ).fetchall()
    index = []
    for nid, title in rows:
        if nid == exclude_id:
            continue
        t = (title or "").strip()
        if len(t) < 4 or t.lower() in _TITLE_STOPLIST or not _is_distinctive(t):
            continue
        pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])", re.IGNORECASE)
        index.append((t, nid, pat))
    return index


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

    # Build the co-mention title index ONCE (filter self-edges per note in the loop).
    title_index = build_title_index(conn, tenant)

    total = 0
    for nid, body in notes:
        rels = extract_relations(_text(nid, body), _resolver(nid), title_index)
        by_kind = {}
        for dst, kind, conf, evidence in rels:
            if dst == nid:
                continue  # skip a note co-mentioning its own title
            by_kind.setdefault(kind, []).append((dst, conf, evidence))
        for kind in RELATION_KINDS:
            _upsert_edges(conn, tenant, nid, kind, by_kind.get(kind, []))
        total += sum(len(v) for v in by_kind.values())
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
    frag, kparams = in_clause("kind", list(_IMPORTANCE_WEIGHTS.keys()))
    rows = conn.execute(
        f"""select dst_note_id, kind, sum(weight)
           from edges where tenant_id=%s and {frag}
           group by dst_note_id, kind""",
        [tenant, *kparams],
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
