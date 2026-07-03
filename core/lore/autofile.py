"""Auto-file (opt-in, cfg.autoFileObvious): unambiguous notes skip the proposal.

During upkeep, a note whose classification points CLEARLY at one existing APPLIED
section is recorded into that section (note_ids + original_paths, so undo covers it)
and its move lands in the returned plan.  Same safeguard as sections.apply: the
backend only records state — the DESKTOP executes the moves under its path-guard,
and only when the user has switched the setting on.  classify.py emits no numeric
confidence, so the margin is computed here from a deterministic per-section
affinity score (see _score_note).
"""
import json

from .sqlutil import in_clause
from .sections import _basename, _fwd, _section_folder, _slug

AUTO_FILE_MIN_SCORE = 2.0   # bar: requires at least an exact topic match
AUTO_FILE_MARGIN = 1.0      # top section must beat the runner-up by this much
_AUTO_FILE_CAP = 200        # candidates scored per run (cost/latency bound)


def _note_tag_slugs(conn, tenant: str, note_ids: list) -> dict:
    """{note_id: {"topics": set(slug), "tags": set(slug)}} for the given notes."""
    out = {nid: {"topics": set(), "tags": set()} for nid in note_ids}
    if not note_ids:
        return out
    frag, params = in_clause("note_id", note_ids)
    for nid, tag, kind in conn.execute(
            f"select note_id, tag, kind from note_tags where tenant_id=%s and {frag}",
            [tenant, *params]).fetchall():
        slug = _slug(tag)
        if slug:
            out[nid]["topics" if kind == 'topic' else "tags"].add(slug)
    return out


def _score_note(note_slugs: dict, section: dict) -> float:
    """Affinity of one note to one applied section.  Deterministic:
      +2.0 the note's topic IS the section's topic (the strong signal)
      +1.0 a plain tag names the section
      +0.25 per tag shared with the section's member notes, capped at +1.0"""
    score = 0.0
    if section["slug"] in note_slugs["topics"]:
        score += 2.0
    if section["slug"] in note_slugs["tags"]:
        score += 1.0
    shared = len(note_slugs["tags"] & section["member_tags"])
    score += min(shared * 0.25, 1.0)
    return score


def auto_file_notes(conn, tenant: str, scope: str = None) -> dict:
    """Record unambiguous notes into existing APPLIED sections; return the move plan.

    A note is filed only when its top section score clears AUTO_FILE_MIN_SCORE AND
    beats the second-best section by AUTO_FILE_MARGIN — everything else keeps
    flowing into normal proposals.  NO files are touched here (desktop executes).
    Runs before propose_sections so filed (now claimed) notes never re-propose."""
    # Applied sections that materialised as a real folder (somewhere to file INTO).
    sections = []
    claimed: set = set()   # notes already inside ANY applied section (incl. folderless)
    for sid, name, topic, note_ids, original_paths in conn.execute(
            "select id, name, topic, note_ids, original_paths from section_proposals "
            "where tenant_id=%s and status='applied' order by id",
            (tenant,)).fetchall():
        try:
            ids = json.loads(note_ids) if note_ids else []
        except Exception:
            ids = []
        claimed.update(ids)
        folder = _section_folder(original_paths)
        if folder:
            sections.append({"id": sid, "name": name, "slug": _slug(topic or name),
                             "folder": folder, "member_ids": ids})
    if not sections:
        return {"checked": 0, "filed": 0, "moves": []}

    # Each section's member tag profile (for the weak shared-tag signal).
    for sec in sections:
        sec["member_tags"] = set()
        for slugs in _note_tag_slugs(conn, tenant, sec["member_ids"]).values():
            sec["member_tags"] |= slugs["tags"]

    # Candidates: file-backed, topic-classified, unclaimed notes (newest first, capped).
    q = ("select n.id, n.source_path from notes n "
         "where n.tenant_id=%s and n.source_path is not null "
         "and exists (select 1 from note_tags t where t.note_id=n.id "
         "            and t.tenant_id=%s and t.kind='topic')")
    params: list = [tenant, tenant]
    if scope:
        q += " and n.scope_id=%s"
        params.append(scope)
    q += " order by n.updated_at desc, n.id limit %s"
    params.append(_AUTO_FILE_CAP)
    candidates = [(nid, spath) for nid, spath in conn.execute(q, params).fetchall()
                  if nid not in claimed]

    note_slugs = _note_tag_slugs(conn, tenant, [nid for nid, _ in candidates])
    filed: dict = {}   # section id -> [(note_id, from, to)]
    moves = []
    for nid, spath in candidates:
        scored = sorted(((_score_note(note_slugs[nid], sec), sec) for sec in sections),
                        key=lambda p: (-p[0], p[1]["id"]))
        top_score, top = scored[0]
        second = scored[1][0] if len(scored) > 1 else 0.0
        if top_score < AUTO_FILE_MIN_SCORE or (top_score - second) < AUTO_FILE_MARGIN:
            continue   # ambiguous / below the bar → stays in the normal proposal flow
        if _fwd(spath).startswith(top["folder"] + '/'):
            continue   # already lives in the section folder
        to = f"{top['folder']}/{_basename(spath)}"
        filed.setdefault(top["id"], []).append((nid, spath, to))
        moves.append({"note_id": nid, "from": spath, "to": to,
                      "section_id": top["id"], "section": top["name"]})

    # Record membership + original paths per touched section (one write each).
    for sec_id, entries in filed.items():
        row = conn.execute(
            "select note_ids, original_paths from section_proposals where id=%s and tenant_id=%s",
            (sec_id, tenant)).fetchone()
        try:
            ids = json.loads(row[0]) if row and row[0] else []
        except Exception:
            ids = []
        try:
            originals = json.loads(row[1]) if row and row[1] else []
        except Exception:
            originals = []
        for nid, spath, to in entries:
            if nid not in ids:
                ids.append(nid)
            originals.append({"note_id": nid, "from": spath, "to": to})
        conn.execute(
            "update section_proposals set note_ids=%s, original_paths=%s, updated_at=now() "
            "where id=%s and tenant_id=%s",
            (json.dumps(sorted(ids)), json.dumps(originals), sec_id, tenant))
        # Keep the promoted wizard's count honest (no-op when not promoted).
        conn.execute(
            "update personal_wizards set note_count=%s where section_id=%s and tenant_id=%s",
            (len(ids), sec_id, tenant))

    return {"checked": len(candidates), "filed": len(moves), "moves": moves}
