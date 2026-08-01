"""Answer synthesis. Uses a local Ollama model if available, else an extractive fallback."""
import os
import json
import re
import urllib.request

OLLAMA_BASE = "http://localhost:11434"
DEFAULT_MODEL = "gemma4:e4b"

def is_ollama_up(timeout=2) -> bool:
    try:
        urllib.request.urlopen(f"{OLLAMA_BASE}/api/tags", timeout=timeout)
        return True
    except Exception:
        return False

def _history_block(history) -> str:
    """Render prior conversation turns ([{role, text}, ...]) into a prompt block.
    Only the last 6 turns are kept — enough for follow-ups ("what about X?")
    without letting an old thread crowd out the retrieved context."""
    turns = [t for t in (history or []) if t and t.get("text")]
    if not turns:
        return ""
    lines = []
    for t in turns[-6:]:
        who = "User" if t.get("role") == "user" else "Assistant"
        lines.append(f"{who}: {str(t['text']).strip()}")
    return "Previous conversation (for follow-up context only):\n" + "\n".join(lines) + "\n\n"


def _grounded_prompt(question, chunks, history=None, style=None) -> str:
    context = "\n\n".join(f"[{c['title']}]\n{c['text']}" for c in chunks)
    if style == "digest":
        # Recency/summary questions: the notes ARE the answer material — synthesize,
        # never refuse. The strict Q&A instruction below made the model say "the
        # context does not contain a summary" instead of just writing one.
        # ANSWER THE QUESTION, don't inventory: "latest changes of lore" wants
        # what changed in lore — not a categorized dump of everything recent.
        instruction = (
            "Below are the user's most recently updated notes, newest first. "
            "Answer the user's question DIRECTLY from them: lead with one sentence that "
            "answers it, then 3-5 concrete bullets with specifics, newest first. Stay on "
            "the question's subject — skip notes about other topics even if recent. "
            "Cite note titles in square brackets. Synthesize from what the notes show — "
            "do NOT say the context lacks a summary."
        )
    else:
        instruction = (
            "You are a company knowledge assistant. Using ONLY the context below, answer "
            "concisely: at most 3 short sentences, or up to 4 tight bullets when listing. "
            "No preamble (never start with 'Based on your notes'). Cite note titles in "
            "square brackets. If the question names a quoted/code artifact and that exact "
            "artifact appears in context, answer from its surrounding sentence. If the exact "
            "artifact does not appear, say so plainly: you do not see an indexed mention of it."
        )
    return (
        f"{instruction}\n\n"
        f"{_history_block(history)}"
        f"Context:\n{context}\n\nQuestion: {question}\n\nAnswer:"
    )


def _env_timeout(name, default):
    try:
        return max(1, int(os.environ.get(name) or os.environ.get("LORE_LLM_TIMEOUT") or default))
    except Exception:
        return default

def ollama_answer(question, chunks, model=DEFAULT_MODEL, timeout=None, history=None, style=None) -> str:
    """chunks: list of dicts with 'title' and 'text'. Returns grounded NL answer."""
    timeout = _env_timeout("LORE_OLLAMA_TIMEOUT", 30) if timeout is None else timeout
    prompt = _grounded_prompt(question, chunks, history, style)
    body = json.dumps({"model": model, "prompt": prompt, "stream": False,
                       "options": {"temperature": 0.2}}).encode()
    req = urllib.request.Request(f"{OLLAMA_BASE}/api/generate", data=body,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["response"].strip()

_QUOTED_ARTIFACT_RE = re.compile(r"[\"'“”‘’`]([^\"'“”‘’`]{3,160})[\"'“”‘’`]")
_CODE_ARTIFACT_RE = re.compile(
    r"(?<![A-Za-z0-9])([A-Za-z0-9_][A-Za-z0-9_.:/-]{3,}[A-Za-z0-9_])(?![A-Za-z0-9])"
)


def _clean_artifact(term: str) -> str:
    return re.sub(r"\s+", " ", (term or "").strip(" \t\r\n.,;:!?()[]{}<>")).strip()


def _is_artifact(term: str) -> bool:
    t = _clean_artifact(term)
    if len(t) < 3:
        return False
    if any(ch in t for ch in "_:"):
        return True
    if "." in t or "-" in t:
        return len(t) >= 5
    if "/" in t:
        return len(t) >= 8 and (any(c.isdigit() for c in t) or any(ch in t for ch in "._-"))
    return any(c.isdigit() for c in t) and any(c.isalpha() for c in t)


def _question_artifacts(question: str):
    out, seen = [], set()
    q = question or ""
    section_scoped = bool(re.search(r"\bwithin\b.*\bsections?\b", q, re.I))
    quoted = [_clean_artifact(m.group(1)) for m in _QUOTED_ARTIFACT_RE.finditer(q)]
    for term in quoted:
        if _is_artifact(term) and term.lower() not in seen:
            seen.add(term.lower())
            out.append(term)
    for m in _CODE_ARTIFACT_RE.finditer(question or ""):
        term = _clean_artifact(m.group(1))
        if _is_artifact(term) and term.lower() not in seen:
            seen.add(term.lower())
            out.append(term)
    if not out and not section_scoped:
        for term in quoted:
            if term and term.lower() not in seen:
                seen.add(term.lower())
                out.append(term)
    return out[:3]


def _contains_artifact(text: str, term: str) -> bool:
    hay = (text or "").lower()
    needle = (term or "").lower()
    if needle in hay:
        return True
    folded = re.sub(r"[^a-z0-9]+", " ", needle).strip()
    return bool(folded and folded in re.sub(r"[^a-z0-9]+", " ", hay))


def _artifact_snippet(text: str, term: str) -> str:
    parts = [p.strip() for p in re.split(r"\n+", text or "") if p.strip()]
    for part in parts:
        if _contains_artifact(part, term):
            return _clean_evidence_text(part, limit=500)
    return _clean_evidence_text(text, limit=500)


def _strip_frontmatter(text: str) -> tuple[dict, str]:
    raw = text or ""
    meta = {}
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n?", raw, re.S)
    if m:
        for line in m.group(1).splitlines():
            km = re.match(r"\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$", line)
            if km:
                meta[km.group(1).lower()] = km.group(2).strip().strip("\"'")
        raw = raw[m.end():]
    return meta, raw


def _current_page_answer(question, chunks) -> str | None:
    if not chunks:
        return None
    first = chunks[0]
    title = first.get("title") or ""
    if not title.startswith("Current page:"):
        return None
    meta, body = _strip_frontmatter(first.get("text") or "")
    lines = []
    for line in body.splitlines():
        t = line.strip()
        if not t or t.startswith("#") or t.startswith("```"):
            continue
        lines.append(re.sub(r"\s+", " ", t).strip())
        if len(" ".join(lines)) > 280:
            break
    label = title.replace("Current page:", "").strip() or "this page"
    desc = meta.get("description") or meta.get("name")
    detail = " ".join(lines).strip()
    if desc and detail:
        return f"This page is about {desc}. {detail[:420]} [{label}]"
    if desc:
        return f"This page is about {desc}. [{label}]"
    if detail:
        return f"This page is about: {detail[:500]} [{label}]"
    return f"I can see the current page `{label}`, but it does not contain descriptive body text. [{label}]"


def _clean_evidence_text(text: str, limit: int = 260) -> str:
    _meta, body = _strip_frontmatter(text or "")
    body = re.sub(r"^From note '.*?', section '.*?'\.\s*", "", body.strip(), flags=re.S)
    body = re.sub(r"\*\*(User|Action|Result):\*\*", r"\1:", body)
    body = re.sub(r"^#{1,6}\s+", "", body, flags=re.M)
    body = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", body)
    body = re.sub(r"\[\[([^\]]+)\]\]", r"\1", body)
    body = re.sub(r"`{3}.*?`{3}", "", body, flags=re.S)
    body = re.sub(r"\s+", " ", body).strip(" -\n\t")
    if len(body) <= limit:
        return body
    cut = body[:limit].rsplit(" ", 1)[0].rstrip(".,;:")
    return cut + "..."


def extractive_answer(question, chunks) -> str:
    if not chunks:
        return "No relevant knowledge found in your scope."
    for term in _question_artifacts(question):
        for c in chunks:
            hay = f"{c.get('title') or ''}\n{c.get('text') or ''}"
            if _contains_artifact(hay, term):
                title = c.get("title") or "Untitled"
                snippet = _artifact_snippet(c.get("text") or "", term)
                return f"`{term}` is covered here: {snippet} [{title}]"
    current = _current_page_answer(question, chunks)
    if current:
        return current
    lines = []
    seen = set()
    for c in chunks[:5]:
        snippet = _clean_evidence_text(c.get("text") or "")
        title = c.get("title") or "Untitled"
        key = (title, snippet[:80])
        if not snippet or key in seen:
            continue
        seen.add(key)
        lines.append(f"- {snippet} [{title}]")
        if len(lines) >= 4:
            break
    if lines:
        return "\n".join(lines)
    return "I found matching notes, but their indexed snippets are empty."



def _fallback_label(e) -> str:
    msg = str(e).lower()
    if "timed out" in msg or "timeout" in msg:
        return "timeout"
    return type(e).__name__


def answer(question, chunks, model=None, history=None, provider=None, style=None):
    """Answer through the user's chosen provider — their Claude/Codex SUBSCRIPTION
    (CLI OAuth, no API key) or their own key (byok) — falling back to local Ollama,
    then extractive. history: optional prior turns (last 6 used) for follow-ups.
    Returns (text, engine)."""
    mdl = model or DEFAULT_MODEL
    if os.environ.get("VAULT_FAKE") == "1":
        return extractive_answer(question, chunks), "extractive(test)"
    if provider in ("codex", "claude", "byok") and chunks:
        try:
            from .llm_providers import resolve_llm_call
            call = resolve_llm_call(provider)
            text = (call(_grounded_prompt(question, chunks, history, style)) or "").strip()
            if text:
                return text, provider
        except Exception as e:
            # If the user explicitly picked a cloud/subscription provider, do not
            # silently wait on a slow local Ollama fallback. Return the fast,
            # grounded extractive answer so Ask stays responsive.
            return extractive_answer(question, chunks), f"extractive (provider fallback: {_fallback_label(e)})"
    if chunks and is_ollama_up():
        try:
            return ollama_answer(question, chunks, model=mdl, history=history, style=style), f"ollama:{mdl}"
        except Exception as e:
            return extractive_answer(question, chunks), f"extractive (llm error: {_fallback_label(e)})"
    return extractive_answer(question, chunks), "extractive"
