"""Tag-scoped retrieval: match a query against the tenant's tag vocabulary so
ask-time context collects around the tags the user actually named
(2026-07-28 subsections/tag-scoping design).

"algebraic terms in the mathematics of dogs" → tags {algebra, dogs} → notes
carrying those tags get a bounded ranking BOOST in recall. Deliberately a
boost, never a hard filter: Lore is recall-obsessed, and a relevant note the
classifier didn't tag must still be reachable through the hybrid lanes.

Matching is deterministic and cheap — tags are already normalized slugs
(classify._norm_tag). A tag matches when, against the slug-normalized query:
  * it appears as an exact token ("dogs" → dogs),
  * a plural fold matches either way ("dog"/"dogs"),
  * a query token merely EXTENDS a tag of >= 5 chars ("algebra" → algebraic),
  * a multi-word tag appears as a dash-joined phrase ("crypto-bots").
Tags shorter than 3 chars never match (stop-slug noise).
"""
from .sqlutil import in_clause

import re

_MIN_TAG_LEN = 3        # 1-2 char tags are noise ("ai" would hit everything)
_PREFIX_MIN_LEN = 5     # prefix lane needs length to be safe (algebra->algebraic)
_MAX_HITS_COUNTED = 3   # boost saturates — dozens of matched tags must not run away


def _norm(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', str(text or '').lower()).strip('-')


def match_tags(tags, query: str) -> set:
    """The subset of `tags` the query names. Pure function — no DB, no model."""
    qnorm = _norm(query)
    if not qnorm:
        return set()
    tokens = qnorm.split('-')
    token_set = set(tokens)
    folded = {t[:-1] if t.endswith('s') and len(t) > 3 else t for t in token_set}
    phrase = f"-{qnorm}-"

    out = set()
    for tag in tags:
        t = _norm(tag)
        if len(t) < _MIN_TAG_LEN:
            continue
        if '-' in t:                                   # multi-word: phrase match,
            # last word plural-folded both ways ("dog-licenses" ~ "dog license")
            head, _, last = t.rpartition('-')
            variants = {t}
            if last.endswith('s') and len(last) > 3:
                variants.add(f"{head}-{last[:-1]}")
            else:
                variants.add(f"{head}-{last}s")
            if any(f"-{v}-" in phrase for v in variants):
                out.add(tag)
            continue
        t_fold = t[:-1] if t.endswith('s') and len(t) > 3 else t
        if t in token_set or t_fold in folded:
            out.add(tag)
            continue
        if len(t) >= _PREFIX_MIN_LEN and any(
                tok.startswith(t) for tok in token_set):
            out.add(tag)
    return out


def load_tag_vocabulary(conn, tenant: str) -> list:
    """Distinct tag + topic names for a tenant (both are query-nameable)."""
    return [r[0] for r in conn.execute(
        "select distinct tag from note_tags "
        "where tenant_id=%s and kind in ('tag','topic')", (tenant,)).fetchall()]


def tag_note_ids(conn, tenant: str, matched: set, scopes, cap: int = 8) -> list:
    """Note ids carrying the query-named tags, best-covered first — the seed
    list for candidate injection (recall's seed_note_ids). ACL-filtered by
    scope; deterministic order (hits desc, id)."""
    scope_list = [s for s in (scopes or []) if s]
    if not matched or not scope_list:
        return []
    frag_t, params_t = in_clause("t.tag", sorted(matched))
    frag_s, params_s = in_clause("n.scope_id", scope_list)
    rows = conn.execute(
        f"""select t.note_id, count(distinct t.tag) as hits from note_tags t
            join notes n on n.id = t.note_id and n.tenant_id = t.tenant_id
            where t.tenant_id=%s and t.kind in ('tag','topic') and {frag_t} and {frag_s}
            group by t.note_id order by hits desc, t.note_id limit %s""",
        (tenant, *params_t, *params_s, max(1, cap))).fetchall()
    return [r[0] for r in rows]


def tag_hits_by_note(conn, tenant: str, matched: set, note_ids) -> dict:
    """{note_id: distinct matched tags on it}, capped at _MAX_HITS_COUNTED.
    One query over the candidate set — same cost shape as the other signals."""
    ids = [n for n in set(note_ids) if n]
    if not ids or not matched:
        return {}
    frag_n, params_n = in_clause("note_id", ids)
    frag_t, params_t = in_clause("tag", sorted(matched))
    rows = conn.execute(
        f"select note_id, count(distinct tag) from note_tags "
        f"where tenant_id=%s and kind in ('tag','topic') and {frag_t} and {frag_n} "
        f"group by note_id",
        (tenant, *params_t, *params_n)).fetchall()
    return {nid: min(int(c), _MAX_HITS_COUNTED) for nid, c in rows}
