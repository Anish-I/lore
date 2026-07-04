"""Answer synthesis. Uses a local Ollama model if available, else an extractive fallback."""
import os
import json
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


def ollama_answer(question, chunks, model=DEFAULT_MODEL, timeout=90, history=None) -> str:
    """chunks: list of dicts with 'title' and 'text'. Returns grounded NL answer."""
    context = "\n\n".join(f"[{c['title']}]\n{c['text']}" for c in chunks)
    prompt = (
        "You are a company knowledge assistant. Using ONLY the context below, answer the "
        "question in 2-4 sentences. Cite the note titles you used in square brackets. "
        "If the context does not contain the answer, say so plainly.\n\n"
        f"{_history_block(history)}"
        f"Context:\n{context}\n\nQuestion: {question}\n\nAnswer:"
    )
    body = json.dumps({"model": model, "prompt": prompt, "stream": False,
                       "options": {"temperature": 0.2}}).encode()
    req = urllib.request.Request(f"{OLLAMA_BASE}/api/generate", data=body,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["response"].strip()

def extractive_answer(question, chunks) -> str:
    if not chunks:
        return "No relevant knowledge found in your scope."
    lines = [f"- {c['text'].strip()[:200]}  [{c['title']}]" for c in chunks[:4]]
    return "Based on your library:\n" + "\n".join(lines)

def answer(question, chunks, model=None, history=None):
    """Try the local LLM (optionally a caller-chosen model); fall back to extractive.
    history: optional [{role:'user'|'assistant', text}, ...] prior turns (last 6 used)
    so follow-up questions resolve against the running conversation.
    Returns (text, engine)."""
    mdl = model or DEFAULT_MODEL
    if os.environ.get("VAULT_FAKE") == "1":
        return extractive_answer(question, chunks), "extractive(test)"
    if chunks and is_ollama_up():
        try:
            return ollama_answer(question, chunks, model=mdl, history=history), f"ollama:{mdl}"
        except Exception as e:
            return extractive_answer(question, chunks), f"extractive (llm error: {e})"
    return extractive_answer(question, chunks), "extractive"
