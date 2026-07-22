"""Connectors — pull work threads from a source and run them through the to-dos
wizard, idempotently.

The enterprise "email → to-dos" flow, minus the paste step: point a connector at
a mailbox and every *new* message becomes pending to-dos, scope-governed exactly
like the wizard (`todos.extract_todos` + `todos.create_todos`). A `connector_seen`
watermark makes re-sync idempotent — a message is processed once, ever, keyed by
(tenant, source, external id).

The first connector reads a **mailbox folder** of RFC-822 `.eml` files — a Gmail/
Outlook export, a Maildir, or the synthetic corpus under `synth/`. It needs no
OAuth, so it's testable today and useful now (drop an export in a folder, sync).
A Gmail/Slack **API** connector later is the same pipeline behind a different
`fetch`: only the "get the next messages" step changes — extraction, persistence,
scoping, and the watermark are shared here.
"""
import email
import email.policy
import glob
import hashlib
import json
import os
import re

from . import todos as todos_mod

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(html: str) -> str:
    """Cheap HTML → text: drop script/style, unwrap tags, collapse whitespace.
    Good enough to feed the extractor; not a full renderer."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html or "")
    text = _TAG_RE.sub(" ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _body_text(msg) -> str:
    """Preferred plaintext body (falls back to stripped HTML), via the modern
    email API so transfer-encoding/charset are decoded for us."""
    try:
        body = msg.get_body(preferencelist=("plain", "html"))
    except Exception:
        body = None
    if body is None:
        return ""
    try:
        content = body.get_content()
    except Exception:
        return ""
    if body.get_content_type() == "text/html":
        return _strip_html(content)
    return content


def parse_eml(raw) -> dict:
    """Parse an RFC-822 message (bytes or str) into
    {external_id, subject, sender, date, text}.

    `text` is the body with a rebuilt From/To/Cc/Subject header block so both
    extraction paths get the context they expect — the heuristic resolves first
    names to full names from the recipient headers, and the LLM sees who/what.
    `external_id` is the Message-ID; absent one, a content hash so dedup still holds.
    """
    if isinstance(raw, bytes):
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    else:
        msg = email.message_from_string(raw, policy=email.policy.default)
    subject = str(msg.get("subject", "") or "")
    sender = str(msg.get("from", "") or "")
    to = str(msg.get("to", "") or "")
    cc = str(msg.get("cc", "") or "")
    date = str(msg.get("date", "") or "")
    body = _body_text(msg)

    mid = str(msg.get("message-id", "") or "").strip().lstrip("<").rstrip(">")
    external_id = mid or ("sha256:" + hashlib.sha256(
        ("\n".join((subject, sender, body))).encode("utf-8", "replace")).hexdigest()[:32])

    header = f"From: {sender}\nTo: {to}\n"
    if cc:
        header += f"Cc: {cc}\n"
    header += f"Date: {date}\nSubject: {subject}\n\n"
    return {"external_id": external_id, "subject": subject, "sender": sender,
            "date": date, "text": header + body}


def _provenance(parsed: dict) -> str:
    """Short 'who · subject' tag stamped on to-dos whose extractor left source blank,
    so a synced item still points back at the message it came from."""
    who = re.sub(r"\s*<[^>]+>", "", parsed.get("sender", "")).strip()
    subj = parsed.get("subject", "").strip()
    return (" · ".join(p for p in (who, subj) if p))[:160] or None


# --- watermark (idempotent re-sync) -----------------------------------------


def _already_seen(conn, tenant: str, source: str, external_id: str, scope: str) -> bool:
    # scope is part of the dedup key: the SAME message synced into two different
    # scopes must be processed once per scope (it yields to-dos in each), so two
    # scopes in one tenant never collide on a shared source name.
    r = conn.execute(
        "select 1 from connector_seen where tenant_id=%s and source=%s "
        "and scope_id=%s and external_id=%s",
        (tenant, source, scope or "", external_id)).fetchone()
    return r is not None


def _mark_seen(conn, tenant: str, source: str, external_id: str,
               scope: str, todo_count: int) -> None:
    conn.execute(
        "insert into connector_seen(tenant_id,source,external_id,scope_id,todo_count) "
        "values(%s,%s,%s,%s,%s) "
        "on conflict (tenant_id,source,scope_id,external_id) do nothing",
        (tenant, source, external_id, scope or "", todo_count))


# --- mailbox connector -------------------------------------------------------


def sync_mailbox(conn, tenant: str, scope: str, folder: str, owner: str = None,
                 provider: str = None, source: str = None, llm_call=None,
                 limit: int = None) -> dict:
    """Process every *new* `.eml` under `folder`: extract to-dos, persist them
    `pending` under `scope`, and watermark the message so a re-sync skips it.

    Idempotent by construction — already-seen messages are counted as `skipped`
    and never re-extracted. Returns
    {source, processed, skipped, todos_created, todos}.
    """
    source = source or f"mailbox:{os.path.basename(os.path.normpath(folder))}"
    paths = sorted(glob.glob(os.path.join(folder, "**", "*.eml"), recursive=True))
    processed = skipped = created_count = 0
    created = []
    for p in paths:
        if limit is not None and processed >= limit:
            break
        try:
            with open(p, "rb") as f:
                parsed = parse_eml(f.read())
        except Exception:
            continue
        ext = parsed["external_id"]
        if _already_seen(conn, tenant, source, ext, scope):
            skipped += 1
            continue
        items = todos_mod.extract_todos(parsed["text"], me=owner,
                                        provider=provider, llm_call=llm_call)
        prov = _provenance(parsed)
        for it in items:
            if not it.get("source"):
                it["source"] = prov
        new = todos_mod.create_todos(conn, tenant, items, scope=scope, owner=owner)
        _mark_seen(conn, tenant, source, ext, scope, len(new))
        created.extend(new)
        created_count += len(new)
        processed += 1
    return {"source": source, "processed": processed, "skipped": skipped,
            "todos_created": created_count, "todos": created}


# --- Slack workspace-export connector ----------------------------------------
# A Slack export is a directory: users.json (id → name) + one subfolder per
# channel, each holding <YYYY-MM-DD>.json files of message objects. It needs no
# OAuth (the admin downloads it), so — like the mailbox connector — it's testable
# and useful today, and a live Slack **API** connector later is this same pipeline
# behind a different fetch. Slack's conversational style leans on the LLM path;
# the heuristic still catches explicit "Name, do X" asks.

_MENTION_RE = re.compile(r"<@([A-Z0-9]+)>")


def _slack_users(folder: str) -> dict:
    """Map Slack user id → display name from users.json (best-effort)."""
    names = {}
    try:
        with open(os.path.join(folder, "users.json"), encoding="utf-8") as f:
            for u in json.load(f):
                uid = u.get("id")
                prof = u.get("profile") or {}
                name = (u.get("real_name") or prof.get("real_name")
                        or prof.get("display_name") or u.get("name") or uid)
                if uid:
                    names[uid] = name
    except Exception:
        pass
    return names


def _slack_channels(folder: str) -> list:
    """Channel names = immediate subdirectories that contain day .json files."""
    out = []
    try:
        for name in os.listdir(folder):
            d = os.path.join(folder, name)
            if os.path.isdir(d) and glob.glob(os.path.join(d, "*.json")):
                out.append(name)
    except Exception:
        pass
    return out


def parse_slack_export(folder: str):
    """Yield one {external_id, channel, participants, text} per thread across the
    export. Messages are grouped by `thread_ts` (root replies) or standalone `ts`,
    ordered in time; `<@U…>` mentions are resolved to names. The rendered `text`
    leads with a Channel/Participants header (context for the LLM) then one message
    per line (so the heuristic still sees line-leading "Name, do X" asks)."""
    users = _slack_users(folder)
    for channel in sorted(_slack_channels(folder)):
        threads = {}   # thread key → list of (ts, author, text)
        for day in sorted(glob.glob(os.path.join(folder, channel, "*.json"))):
            try:
                with open(day, encoding="utf-8") as f:
                    msgs = json.load(f)
            except Exception:
                continue
            for m in msgs if isinstance(msgs, list) else []:
                if not isinstance(m, dict) or m.get("type") != "message" or m.get("subtype"):
                    continue
                text = _MENTION_RE.sub(lambda mt: users.get(mt.group(1), mt.group(1)),
                                       str(m.get("text", "") or ""))
                if not text.strip():
                    continue
                author = users.get(m.get("user"), m.get("user") or "someone")
                key = str(m.get("thread_ts") or m.get("ts") or "")
                threads.setdefault(key, []).append((str(m.get("ts") or ""), author, text))
        for key, items in threads.items():
            items.sort(key=lambda x: x[0])
            participants = list(dict.fromkeys(a for _, a, _ in items))
            body = "\n".join(t for _, _, t in items)
            header = f"Channel: #{channel}\nParticipants: {', '.join(participants)}\n\n"
            yield {"external_id": f"{channel}:{key}", "channel": channel,
                   "participants": participants, "text": header + body}


def sync_slack_export(conn, tenant: str, scope: str, folder: str, owner: str = None,
                      provider: str = None, source: str = None, llm_call=None,
                      limit: int = None) -> dict:
    """Process every *new* thread in a Slack export → pending to-dos under `scope`,
    watermarked so re-sync is idempotent. Same contract/return as `sync_mailbox`."""
    source = source or f"slack:{os.path.basename(os.path.normpath(folder))}"
    processed = skipped = created_count = 0
    created = []
    for thread in parse_slack_export(folder):
        if limit is not None and processed >= limit:
            break
        ext = thread["external_id"]
        if _already_seen(conn, tenant, source, ext, scope):
            skipped += 1
            continue
        items = todos_mod.extract_todos(thread["text"], me=owner,
                                        provider=provider, llm_call=llm_call)
        prov = ("#" + thread["channel"])[:160]
        for it in items:
            if not it.get("source"):
                it["source"] = prov
        new = todos_mod.create_todos(conn, tenant, items, scope=scope, owner=owner)
        _mark_seen(conn, tenant, source, ext, scope, len(new))
        created.extend(new)
        created_count += len(new)
        processed += 1
    return {"source": source, "processed": processed, "skipped": skipped,
            "todos_created": created_count, "todos": created}
