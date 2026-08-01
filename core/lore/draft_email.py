"""Email drafting in the owner's own voice (2026-07-29 correspondence-drafts
feature).

Given an ask ("reply to Janet about her dog license renewal"), assemble:
  * STYLE — excerpts of the owner's real correspondence emails, so the model
    matches greeting, sign-off, sentence length, and formality;
  * RECIPIENT HISTORY — the person's interaction timeline from people.py,
    ACL-scoped, so the draft knows what was already discussed;
  * CONTEXT — retrieved chunks (the caller runs the normal recall pipeline,
    tag boost included), the ONLY permitted source of facts.

The output is a DRAFT — {subject, body, sources, style_note_ids}. Lore never
sends anything: per the standing action boundary, side-effectful delivery
belongs to the product backend (`UI → product backend → Lore`). Missing facts
are marked "[CHECK: ...]" in the body rather than invented.

Style-sample selection: recent `source_type='email'` notes roled
'correspondence' within the caller's scopes. When the owner's address is
known (LORE_OWNER_EMAIL or request param), samples whose From-header carries
it are preferred — those are literally the owner's own sent mail.
"""
import json
import os
import re

from . import people
from .llm_providers import provider_available, resolve_llm_call
from .sqlutil import in_clause

_STYLE_LIMIT = 4
_STYLE_EXCERPT_CHARS = 600
_CONTEXT_CHARS = 700
_HISTORY_LIMIT = 6


class DraftError(RuntimeError):
    """Drafting needs an LLM; raised when no provider is usable."""


def _strip_headers(body: str) -> str:
    """Email notes store 'From:/To:/Date:' headers before a blank line; style
    is in the prose after them."""
    text = body or ""
    if re.match(r'^\s*From:', text):
        parts = text.split("\n\n", 1)
        if len(parts) == 2:
            return parts[1]
    return text


def style_samples(conn, tenant: str, scopes, owner_email: str = None,
                  limit: int = _STYLE_LIMIT) -> list:
    """Recent correspondence emails in-scope, owner-sent first when the owner's
    address is known. [{note_id, title, excerpt}], newest first."""
    scope_list = [s for s in (scopes or []) if s]
    if not scope_list:
        return []
    frag, params = in_clause("n.scope_id", scope_list)
    rows = conn.execute(
        f"""select n.id, n.title, n.body from notes n
            where n.tenant_id=%s and n.source_type='email' and {frag}
            and exists (select 1 from note_tags r
                        where r.tenant_id=n.tenant_id and r.note_id=n.id
                        and r.kind='role' and r.tag='correspondence')
            order by n.updated_at desc, n.id limit %s""",
        (tenant, *params, max(limit * 5, 20))).fetchall()

    owner_email = (owner_email or os.environ.get("LORE_OWNER_EMAIL") or "").strip().lower()
    sent, other = [], []
    for nid, title, body in rows:
        first_line = (body or "").split("\n", 1)[0].lower()
        is_sent = bool(owner_email) and first_line.startswith("from:") \
            and owner_email in first_line
        (sent if is_sent else other).append({
            "note_id": nid, "title": title or "(untitled)",
            "excerpt": _strip_headers(body).strip()[:_STYLE_EXCERPT_CHARS]})
    picked = (sent + other) if owner_email else other + sent
    return [s for s in picked if s["excerpt"]][:max(1, limit)]


def recipient_history(conn, tenant: str, scopes, to: str,
                      limit: int = _HISTORY_LIMIT):
    """{person:{...}, interactions:[...]} for the person `to` names (an email
    address or a display name), ACL-scoped via people.py. None when unknown."""
    to_norm = (to or "").strip().lower()
    if not to_norm:
        return None
    scope_str = ",".join(s for s in (scopes or []) if s)
    try:
        roster = people.list_people(conn, tenant, scope_str)
    except Exception:
        return None
    match = None
    for p in roster:
        emails = [e.lower() for e in (p.get("emails") or [])]
        if to_norm in emails or to_norm == (p.get("name") or "").strip().lower():
            match = p
            break
    if not match:
        return None
    detail = people.person_detail(conn, tenant, scope_str, match["id"])
    if not detail:
        return None
    detail["interactions"] = detail.get("interactions", [])[:limit]
    return detail


def draft_prompt(ask: str, style: list, chunks: list, recipient=None) -> str:
    parts = ["You draft ONE email in the OWNER'S OWN VOICE.\n"]
    if style:
        parts.append(
            "STYLE SAMPLES — the owner's real emails. Match their greeting, "
            "sign-off, sentence length, and formality. Do NOT reuse their content:")
        for i, s in enumerate(style, 1):
            parts.append(f'--- style {i}: "{s["title"]}"\n{s["excerpt"]}')
        parts.append("")
    if recipient:
        p = recipient["person"]
        emails = ", ".join(p.get("emails") or [])
        parts.append(f"RECIPIENT: {p.get('name')} <{emails}>")
        if recipient.get("interactions"):
            parts.append("RECENT HISTORY WITH RECIPIENT:")
            for it in recipient["interactions"]:
                parts.append(f"- [{it.get('date')}] {it.get('title')}: "
                             f"{(it.get('evidence') or '')[:120]}")
        parts.append("")
    parts.append(
        "CONTEXT — the ONLY source of facts. Never invent a fact; where one is "
        "missing, write [CHECK: what to verify] in the body instead:")
    for i, c in enumerate(chunks, 1):
        parts.append(f"[{i}] {c.get('title') or ''}: {(c.get('text') or '')[:_CONTEXT_CHARS]}")
    parts.append(f"\nTASK: {ask}\n")
    parts.append('Reply with STRICT JSON only — no prose, no markdown fences: '
                 '{"subject": "...", "body": "..."}')
    return "\n".join(parts)


def parse_draft(raw: str) -> dict | None:
    """{'subject','body'} from a strict-JSON reply; tolerant of fences/prose.
    None when nothing usable came back."""
    m = re.search(r'\{.*\}', raw or '', re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            body = str(obj.get("body") or "").strip()
            if body:
                return {"subject": str(obj.get("subject") or "").strip() or None,
                        "body": body}
        except Exception:
            pass
    text = re.sub(r'^```\w*|```$', '', (raw or '').strip(), flags=re.MULTILINE).strip()
    return {"subject": None, "body": text} if text else None


def _resolve_llm(provider: str = None):
    prov = (provider or os.environ.get("LORE_LLM_PROVIDER") or "byok").strip().lower()
    if not provider_available(prov):
        raise DraftError(f"no usable LLM provider ('{prov}') — drafting requires one")
    try:
        return resolve_llm_call(prov), prov
    except Exception as e:
        raise DraftError(str(e)) from e


def compose(conn, tenant: str, scopes, ask: str, chunks: list, to: str = None,
            provider: str = None, llm_call=None, owner_email: str = None,
            style_limit: int = _STYLE_LIMIT) -> dict:
    """Assemble style + recipient history + context, call the LLM, return the
    draft. `chunks` come from the caller's normal recall run (already ACL'd,
    tag-boosted, cited). Raises DraftError when no provider is usable."""
    engine = provider or "injected"
    if llm_call is None:
        llm_call, engine = _resolve_llm(provider)
    style = style_samples(conn, tenant, scopes, owner_email=owner_email,
                          limit=style_limit)
    recipient = recipient_history(conn, tenant, scopes, to) if to else None
    raw = llm_call(draft_prompt(ask, style, chunks, recipient))
    draft = parse_draft(raw)
    if not draft:
        raise DraftError("the model returned no usable draft")
    return {
        "subject": draft["subject"],
        "body": draft["body"],
        "engine": engine,
        "style_note_ids": [s["note_id"] for s in style],
        "recipient": (recipient or {}).get("person"),
    }
