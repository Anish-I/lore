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


def _already_seen(conn, tenant: str, source: str, external_id: str) -> bool:
    r = conn.execute(
        "select 1 from connector_seen where tenant_id=%s and source=%s and external_id=%s",
        (tenant, source, external_id)).fetchone()
    return r is not None


def _mark_seen(conn, tenant: str, source: str, external_id: str,
               scope: str, todo_count: int) -> None:
    conn.execute(
        "insert into connector_seen(tenant_id,source,external_id,scope_id,todo_count) "
        "values(%s,%s,%s,%s,%s) "
        "on conflict (tenant_id,source,external_id) do nothing",
        (tenant, source, external_id, scope, todo_count))


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
        if _already_seen(conn, tenant, source, ext):
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
