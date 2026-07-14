"""Automatic supersession detection (propose → accept/dismiss).

When a newly ingested/captured note covers the same topic as an existing,
older note, we PROPOSE a `supersedes` edge (new -> old) instead of asserting
one.  Proposals are cheap and deterministic — token overlap plus a recency
gate, no LLM and no embedding dependency — and a human (or a future policy)
accepts or dismisses them.  Only accepted/cue-asserted edges affect ranking.

Edge provenance (edges.origin):
  * 'auto-proposed'   — detected here, awaiting confirmation. Never ranks.
  * 'auto'            — an accepted auto proposal. Ranks.
  * 'auto-dismissed'  — rejected; kept so the pair is never re-proposed. Never ranks.
  * 'index'/'capture' — cue-lexicon supersedes edges from explicit prose
                        ("X supersedes Y", relations.py). Rank as accepted.

The ranking surface is api._note_signals_provider: it resolves each candidate
note's `superseded` signal from the edges table per query (filtered by
NON_RANKING_ORIGINS below) and recall._apply_note_signals downweights by
SUPERSEDED_WEIGHT.  No Qdrant payload state — the DB is the single source of
truth for supersession.

Deliberately NOT here: the legal supersession lane (`amends`/`repeals`, the
municipal track).  Those must stay near-deterministic, effective-dated, and
citation-anchored — auto proposals never bleed into them.
"""
import os
import re

from .sqlutil import in_clause

# Origins that never influence ranking.
NON_RANKING_ORIGINS = ("auto-proposed", "auto-dismissed")

# Detection gates (env-tunable; the state eval picks the real numbers).
TITLE_JACCARD_MIN = float(os.environ.get("LORE_SUPERSEDE_TITLE_MIN", "0.5"))
CONFIDENCE_MIN = float(os.environ.get("LORE_SUPERSEDE_MIN", "0.55"))
MAX_PROPOSALS_PER_NOTE = 3

_STOPWORDS = frozenset((
    "the", "and", "for", "with", "from", "that", "this", "into", "over",
    "about", "notes", "note", "update", "updated", "new", "session",
))

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_-]{2,}")


def _tokens(s: str) -> set:
    return {t for t in _TOKEN_RE.findall((s or "").lower()) if t not in _STOPWORDS}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def propose_supersessions(conn, tenant_id: str, note_id: str) -> list:
    """Detect older notes the given note likely supersedes; write proposals.

    Candidate = same tenant + same scope, strictly older (created_at), high
    title-token overlap, confirmed by body-token overlap.  Emits at most
    MAX_PROPOSALS_PER_NOTE edges (kind='supersedes', origin='auto-proposed').
    A pair that already has ANY supersedes edge (including a dismissed one) is
    left untouched.  Returns the list of proposed dst note_ids.
    """
    row = conn.execute(
        "select title, scope_id, body, coalesce(created_at, updated_at) from notes"
        " where id=%s and tenant_id=%s",
        (note_id, tenant_id),
    ).fetchone()
    if not row:
        return []
    title, scope_id, body, created = row
    new_title_toks = _tokens(title)
    if not new_title_toks:
        return []

    candidates = conn.execute(
        "select id, title from notes"
        " where tenant_id=%s and scope_id=%s and id<>%s"
        "   and coalesce(created_at, updated_at) < %s",
        (tenant_id, scope_id, note_id, created),
    ).fetchall()

    scored = []
    for cid, ctitle in candidates:
        tj = _jaccard(new_title_toks, _tokens(ctitle))
        if tj >= TITLE_JACCARD_MIN:
            scored.append((tj, cid))
    scored.sort(reverse=True)

    new_body_toks = _tokens((body or "")[:2000])
    proposed = []
    for tj, cid in scored[:MAX_PROPOSALS_PER_NOTE * 2]:
        if len(proposed) >= MAX_PROPOSALS_PER_NOTE:
            break
        cbody = conn.execute(
            "select body from notes where id=%s and tenant_id=%s", (cid, tenant_id)
        ).fetchone()
        bj = _jaccard(new_body_toks, _tokens(((cbody[0] if cbody else "") or "")[:2000]))
        confidence = round(0.6 * tj + 0.4 * bj, 3)
        if confidence < CONFIDENCE_MIN:
            continue
        # on conflict DO NOTHING: an existing edge of any origin (cue-asserted,
        # accepted, or dismissed) must not be downgraded back to a proposal.
        cur = conn.execute(
            """insert into edges(tenant_id, src_note_id, dst_note_id, kind,
                                 weight, evidence, origin)
               values(%s,%s,%s,'supersedes',%s,%s,'auto-proposed')
               on conflict (tenant_id, src_note_id, dst_note_id, kind) do nothing""",
            (tenant_id, note_id, cid,
             confidence,
             f"auto: title overlap {tj:.2f}, body overlap {bj:.2f}, newer note covers same topic"),
        )
        if getattr(cur, "rowcount", 1):
            proposed.append(cid)
    return proposed


def list_proposals(conn, tenant_id: str) -> list:
    """Pending auto proposals with human-readable titles, newest first."""
    rows = conn.execute(
        """select e.src_note_id, e.dst_note_id, e.weight, e.evidence, e.updated_at,
                  ns.title, nd.title
           from edges e
           join notes ns on ns.id = e.src_note_id and ns.tenant_id = e.tenant_id
           join notes nd on nd.id = e.dst_note_id and nd.tenant_id = e.tenant_id
           where e.tenant_id=%s and e.kind='supersedes' and e.origin='auto-proposed'
           order by e.updated_at desc""",
        (tenant_id,),
    ).fetchall()
    return [
        {"src": r[0], "dst": r[1], "confidence": r[2], "evidence": r[3],
         "proposed_at": str(r[4]), "src_title": r[5], "dst_title": r[6]}
        for r in rows
    ]


def resolve_proposal(conn, tenant_id: str, src: str, dst: str, action: str) -> bool:
    """Accept ('auto') or dismiss ('auto-dismissed') a pending proposal.
    Returns False when no pending proposal matches. Ranking picks the change
    up on the next query — the signals provider reads edges live."""
    origin = "auto" if action == "accept" else "auto-dismissed"
    cur = conn.execute(
        """update edges set origin=%s, updated_at=now()
           where tenant_id=%s and src_note_id=%s and dst_note_id=%s
             and kind='supersedes' and origin='auto-proposed'""",
        (origin, tenant_id, src, dst),
    )
    return bool(getattr(cur, "rowcount", 0))


def superseded_note_ids(conn, tenant_id: str) -> set:
    """Note ids with an incoming ACCEPTED supersedes edge (any ranking origin)."""
    pred, params = in_clause("origin", NON_RANKING_ORIGINS)
    rows = conn.execute(
        f"select distinct dst_note_id from edges"
        f" where tenant_id=%s and kind='supersedes' and not ({pred})",
        (tenant_id, *params),
    ).fetchall()
    return {r[0] for r in rows}


def is_superseded(conn, tenant_id: str, note_id: str) -> bool:
    pred, params = in_clause("origin", NON_RANKING_ORIGINS)
    row = conn.execute(
        f"select 1 from edges where tenant_id=%s and dst_note_id=%s"
        f" and kind='supersedes' and not ({pred}) limit 1",
        (tenant_id, note_id, *params),
    ).fetchone()
    return row is not None
