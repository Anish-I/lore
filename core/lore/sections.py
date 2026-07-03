"""Section proposals: when a topic accumulates enough notes, PROPOSE a folder.

A Section is ultimately a physical folder the notes move into — but:

  ***CRITICAL SAFEGUARD: the backend NEVER moves, renames, or deletes a user's
  files.  This module only tracks proposal state and computes/records move
  plans.  The desktop main process performs the actual filesystem moves,
  through its path-guard, and ONLY when the user explicitly clicks
  Enable (apply) or Undo.  Nothing is ever moved automatically.***

Lifecycle (section_proposals.status):
    proposed  --apply-->  applied   (original paths recorded for undo)
    proposed  --dismiss-> dismissed (sticky: the topic is never re-proposed)
    applied   --undo--->  proposed  (move plan back to the recorded originals)
"""
import datetime
import json
import re
import time
import uuid

from .sqlutil import in_clause

DEFAULT_THRESHOLD = 5   # notes on one topic before a Section is proposed


class SectionError(RuntimeError):
    """Invalid section transition (unknown id, wrong tenant, or wrong status)."""


def _slug(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', str(name or '').lower()).strip('-')


def _basename(p: str) -> str:
    return re.split(r'[\\/]', str(p or ''))[-1]


def _path_has_segment_slug(path: str, slug: str) -> bool:
    """True when any DIRECTORY segment of `path` slugifies to `slug` — the note
    already lives inside a folder named after the topic (already sectioned)."""
    segs = [s for s in re.split(r'[\\/]', str(path or '')) if s]
    return any(_slug(s) == slug for s in segs[:-1])   # exclude the filename itself


def propose_sections(conn, tenant: str, threshold: int = DEFAULT_THRESHOLD) -> dict:
    """Group topic-tagged notes and upsert 'proposed' section rows.

    A proposal is created for a topic when >= `threshold` of its notes:
      * have a real file on disk (source_path is set), and
      * are not already inside a folder named after the topic, and
      * are not already claimed by an applied section.
    Dismissed/applied topics are sticky — never re-proposed.  Existing 'proposed'
    rows are refreshed with the current note set.  NO files are touched here.
    """
    threshold = max(2, int(threshold or DEFAULT_THRESHOLD))

    rows = conn.execute(
        "select t.tag, t.note_id, n.source_path from note_tags t "
        "join notes n on n.id = t.note_id and n.tenant_id = t.tenant_id "
        "where t.tenant_id=%s and t.kind='topic' and n.source_path is not null",
        (tenant,)).fetchall()

    existing = {}          # slug -> (id, status)
    claimed: set = set()   # note_ids already inside an APPLIED section
    for sid, topic, status, note_ids in conn.execute(
            "select id, topic, status, note_ids from section_proposals where tenant_id=%s",
            (tenant,)).fetchall():
        existing[_slug(topic)] = (sid, status)
        if status == 'applied' and note_ids:
            try:
                claimed.update(json.loads(note_ids))
            except Exception:
                pass

    groups: dict = {}   # slug -> {"name": display, "notes": [note_id, ...]}
    for topic, note_id, source_path in rows:
        slug = _slug(topic)
        if not slug or note_id in claimed:
            continue
        if _path_has_segment_slug(source_path, slug):
            continue   # file already lives in a folder named after this topic
        g = groups.setdefault(slug, {"name": topic, "notes": []})
        if note_id not in g["notes"]:
            g["notes"].append(note_id)

    created = updated = 0
    for slug, g in groups.items():
        if len(g["notes"]) < threshold:
            continue
        note_ids_json = json.dumps(sorted(g["notes"]))
        prior = existing.get(slug)
        if prior:
            sid, status = prior
            if status == 'proposed':
                conn.execute(
                    "update section_proposals set note_ids=%s, updated_at=now() "
                    "where id=%s and tenant_id=%s",
                    (note_ids_json, sid, tenant))
                updated += 1
            # applied/dismissed: sticky — never re-propose
            continue
        conn.execute(
            "insert into section_proposals(id, tenant_id, name, topic, note_ids, status) "
            "values(%s,%s,%s,%s,%s,'proposed') on conflict do nothing",
            (f"sec:{tenant}:{slug}", tenant, g["name"], g["name"], note_ids_json))
        created += 1
    return {"proposed": created, "updated": updated}


def list_sections(conn, tenant: str) -> list:
    """All section proposals for a tenant (proposed + applied + dismissed),
    with per-note title/path so the UI can show what would move."""
    rows = conn.execute(
        "select id, name, topic, note_ids, original_paths, status, created_at, updated_at "
        "from section_proposals where tenant_id=%s order by created_at desc, id",
        (tenant,)).fetchall()

    all_ids = []
    parsed = []
    for sid, name, topic, note_ids, original_paths, status, created, updated in rows:
        try:
            ids = json.loads(note_ids) if note_ids else []
        except Exception:
            ids = []
        all_ids.extend(ids)
        parsed.append((sid, name, topic, ids, original_paths, status, created, updated))

    meta = {}
    if all_ids:
        frag, params = in_clause("id", list(dict.fromkeys(all_ids)))
        for nid, title, spath in conn.execute(
                f"select id, title, source_path from notes where tenant_id=%s and {frag}",
                [tenant, *params]).fetchall():
            meta[nid] = {"id": nid, "title": title, "path": spath}

    out = []
    for sid, name, topic, ids, original_paths, status, created, updated in parsed:
        try:
            originals = json.loads(original_paths) if original_paths else None
        except Exception:
            originals = None
        out.append({
            "id": sid,
            "name": name,
            "topic": topic,
            "status": status,
            "notes": [meta.get(i, {"id": i, "title": None, "path": None}) for i in ids],
            "original_paths": originals,
            "created_at": created.isoformat() if isinstance(created, datetime.datetime) else created,
            "updated_at": updated.isoformat() if isinstance(updated, datetime.datetime) else updated,
        })
    return out


def _get(conn, tenant: str, section_id: str):
    row = conn.execute(
        "select id, name, topic, note_ids, original_paths, status "
        "from section_proposals where id=%s and tenant_id=%s",
        (section_id, tenant)).fetchone()
    if not row:
        raise SectionError("section not found")
    return row


def apply_section(conn, tenant: str, section_id: str, dest_dir: str = None) -> dict:
    """Transition proposed -> applied and return the MOVE PLAN.

    Records each note's ORIGINAL path (for undo) and, when the desktop supplies
    `dest_dir`, the destination path per note.  The backend does NOT move files —
    the desktop executes the returned plan under its path-guard, on user action.
    """
    sid, name, _topic, note_ids, _orig, status = _get(conn, tenant, section_id)
    if status != 'proposed':
        raise SectionError(f"cannot apply a section in status '{status}'")
    try:
        ids = json.loads(note_ids) if note_ids else []
    except Exception:
        ids = []

    moves = []
    if ids:
        frag, params = in_clause("id", ids)
        for nid, spath in conn.execute(
                f"select id, source_path from notes where tenant_id=%s and {frag}",
                [tenant, *params]).fetchall():
            if not spath:
                continue   # DB-only note (no file) — nothing to move
            to = f"{dest_dir.rstrip('/')}/{_basename(spath)}" if dest_dir else None
            moves.append({"note_id": nid, "from": spath, "to": to})

    conn.execute(
        "update section_proposals set status='applied', original_paths=%s, updated_at=now() "
        "where id=%s and tenant_id=%s",
        (json.dumps(moves), sid, tenant))
    return {"ok": True, "id": sid, "name": name, "folder": name, "moves": moves}


def dismiss_section(conn, tenant: str, section_id: str) -> dict:
    """Transition proposed -> dismissed (sticky; the topic is never re-proposed)."""
    sid, _name, _topic, _ids, _orig, status = _get(conn, tenant, section_id)
    if status != 'proposed':
        raise SectionError(f"cannot dismiss a section in status '{status}'")
    conn.execute(
        "update section_proposals set status='dismissed', updated_at=now() "
        "where id=%s and tenant_id=%s", (sid, tenant))
    return {"ok": True, "id": sid, "status": "dismissed"}


def undo_section(conn, tenant: str, section_id: str) -> dict:
    """Transition applied -> proposed and return the recorded original paths.

    The desktop moves each file from its section location back to `from` (the
    recorded original path).  The backend itself never touches the filesystem.
    """
    sid, name, _topic, _ids, original_paths, status = _get(conn, tenant, section_id)
    if status != 'applied':
        raise SectionError(f"cannot undo a section in status '{status}'")
    try:
        moves = json.loads(original_paths) if original_paths else []
    except Exception:
        moves = []
    conn.execute(
        "update section_proposals set status='proposed', original_paths=null, updated_at=now() "
        "where id=%s and tenant_id=%s", (sid, tenant))
    return {"ok": True, "id": sid, "name": name, "moves": moves}


# --- Personal Wizards: an APPLIED section promoted to a per-topic RAG assistant ---
# A wizard is a VIEW over its section's notes; promoting moves nothing — the
# section is already a real folder, the files stay exactly where they are.

def _fwd(p: str) -> str:
    return str(p or '').replace('\\', '/')


def _section_folder(original_paths):
    """Folder an applied section's notes live in — the dirname of the recorded
    move destinations.  None when the section was applied without a dest_dir."""
    try:
        moves = json.loads(original_paths) if original_paths else []
    except Exception:
        moves = []
    for mv in moves:
        to = mv.get("to") if isinstance(mv, dict) else None
        if to:
            return _fwd(to).rsplit('/', 1)[0]
    return None


def promote_section(conn, tenant: str, section_id: str) -> dict:
    """Promote an APPLIED section to a Personal Wizard (idempotent).

    Only valid once the section is a real folder (status 'applied') — the notes
    must actually live together before they can back a wizard.  Creates a
    personal_wizards row; nothing on disk changes and the section itself keeps
    working (undo stays possible)."""
    sid, name, topic, note_ids, _orig, status = _get(conn, tenant, section_id)
    if status != 'applied':
        raise SectionError(f"cannot promote a section in status '{status}' (enable it first)")
    try:
        ids = json.loads(note_ids) if note_ids else []
    except Exception:
        ids = []
    wid = f"wiz:{tenant}:{_slug(name)}"
    conn.execute(
        "insert into personal_wizards(id, tenant_id, section_id, name, topic, note_count) "
        "values(%s,%s,%s,%s,%s,%s) on conflict do nothing",
        (wid, tenant, sid, name, topic, len(ids)))
    return {"ok": True, "id": wid, "section_id": sid, "name": name,
            "topic": topic, "note_count": len(ids)}


def list_personal_wizards(conn, tenant: str) -> list:
    """All personal wizards for a tenant, each with the folder its notes live in
    (derived from the promoted section's recorded move plan)."""
    rows = conn.execute(
        "select w.id, w.section_id, w.name, w.topic, w.note_count, w.created_at, s.original_paths "
        "from personal_wizards w "
        "left join section_proposals s on s.id = w.section_id and s.tenant_id = w.tenant_id "
        "where w.tenant_id=%s order by w.created_at desc, w.id",
        (tenant,)).fetchall()
    return [{
        "id": wid, "section_id": sid, "name": name, "topic": topic,
        "note_count": note_count or 0,
        "folder": _section_folder(original_paths),
        "created_at": created.isoformat() if isinstance(created, datetime.datetime) else created,
    } for wid, sid, name, topic, note_count, created, original_paths in rows]


def _get_wizard(conn, tenant: str, wizard_id: str):
    row = conn.execute(
        "select w.id, w.section_id, w.name, s.note_ids, s.original_paths "
        "from personal_wizards w "
        "left join section_proposals s on s.id = w.section_id and s.tenant_id = w.tenant_id "
        "where w.id=%s and w.tenant_id=%s",
        (wizard_id, tenant)).fetchone()
    if not row:
        raise SectionError("wizard not found")
    return row


def wizard_members(conn, tenant: str, wizard_id: str):
    """(note_ids, scope_ids) belonging to a wizard.

    Membership is the union of notes currently INSIDE the section's folder
    (source_path prefix — note ids are path-derived, so they change when the
    desktop moves a file) and the section's recorded note_ids that still exist
    (covers notes the desktop skipped or that never had a file move)."""
    _wid, _sid, _name, note_ids, original_paths = _get_wizard(conn, tenant, wizard_id)
    member: set = set()
    folder = _section_folder(original_paths)
    if folder:
        # Same LIKE-escape as /forget: \, %, _ must not act as wildcards.
        esc = folder.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        member.update(r[0] for r in conn.execute(
            "select id from notes where tenant_id=%s and source_path is not null "
            "and replace(source_path, '\\', '/') like %s escape '\\'",
            (tenant, esc + '/%')).fetchall())
    try:
        ids = json.loads(note_ids) if note_ids else []
    except Exception:
        ids = []
    if ids:
        frag, params = in_clause("id", ids)
        member.update(r[0] for r in conn.execute(
            f"select id from notes where tenant_id=%s and {frag}",
            [tenant, *params]).fetchall())
    scopes = []
    if member:
        frag, params = in_clause("id", sorted(member))
        scopes = [r[0] for r in conn.execute(
            f"select distinct scope_id from notes where tenant_id=%s and {frag}",
            [tenant, *params]).fetchall() if r[0]]
    return member, scopes


def wizard_chat(conn, tenant: str, wizard_id: str) -> list:
    """Persisted chat history for a wizard, oldest first."""
    _get_wizard(conn, tenant, wizard_id)   # unknown wizard -> SectionError
    out = []
    for cid, role, text, sources, created in conn.execute(
            "select id, role, text, sources, created_at from personal_wizard_chats "
            "where wizard_id=%s and tenant_id=%s order by created_at, id",
            (wizard_id, tenant)).fetchall():
        try:
            srcs = json.loads(sources) if sources else None
        except Exception:
            srcs = None
        out.append({"id": cid, "role": role, "text": text, "sources": srcs,
                    "created_at": created.isoformat() if isinstance(created, datetime.datetime) else created})
    return out


def append_wizard_chat(conn, tenant: str, wizard_id: str, role: str, text: str, sources=None) -> str:
    """Append one chat turn.  The id embeds a nanosecond timestamp so the
    (created_at, id) ordering stays stable even when the user turn and the
    assistant turn land inside the same clock second."""
    cid = f"{time.time_ns():020d}-{uuid.uuid4().hex[:8]}"
    conn.execute(
        "insert into personal_wizard_chats(id, wizard_id, tenant_id, role, text, sources) "
        "values(%s,%s,%s,%s,%s,%s)",
        (cid, wizard_id, tenant, role, text, json.dumps(sources) if sources else None))
    return cid
