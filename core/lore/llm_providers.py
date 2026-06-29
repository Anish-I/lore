"""Pluggable LLM auth/providers for Lore's optional LLM features (e.g. relation enrichment).

The user shouldn't need a separate paid API account just to use Lore's LLM features. Three
auth modes, selected by config/env `LORE_LLM_PROVIDER`:

  * "codex"  — shell out to the local **Codex CLI** (uses the user's Codex/OpenAI SUBSCRIPTION
               OAuth; no API key). Slow per call (CLI subprocess) → on-demand / small batches.
  * "claude" — shell out to the local **Claude Code CLI** `claude -p` (uses the user's Claude
               SUBSCRIPTION OAuth; no API key). Also CLI-speed. Unsets CLAUDECODE so a nested
               session is allowed.
  * "byok"   — direct API with the user's OWN key (`LORE_LLM_API_KEY` + optional base_url/model;
               OpenAI-compatible, defaults to Together AI). FAST → bulk enrichment.

Each provider exposes the same contract: a `call(prompt:str) -> str` returning the model's text.
`resolve_llm_call(cfg)` returns the configured callable (or raises ProviderError with guidance).
"""
import os
import re
import glob
import shutil
import subprocess


class ProviderError(RuntimeError):
    pass


# --- Codex CLI (subscription OAuth) ----------------------------------------

def _find_codex_bin() -> str:
    if os.environ.get("CODEX_BIN") and os.path.exists(os.environ["CODEX_BIN"]):
        return os.environ["CODEX_BIN"]
    # Prefer the real Codex binary (Windows install: %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe)
    # over a `codex` shim on PATH — PATH may hold an older Node wrapper that rejects newer config.
    local = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/AppData/Local")
    hits = glob.glob(os.path.join(local, "OpenAI", "Codex", "bin", "*", "codex.exe"))
    if hits:
        return sorted(hits)[-1]
    onpath = shutil.which("codex")
    if onpath:
        return onpath
    raise ProviderError("Codex CLI not found (set CODEX_BIN or install Codex)")


def codex_call(prompt: str, timeout: int = 180) -> str:
    """Run `codex exec` (read-only) and return just the assistant's final text.

    Relation extraction is a simple structured task — no deep reasoning needed — so we run
    at a LOW reasoning effort for speed (override with LORE_CODEX_EFFORT, e.g. minimal/low/
    medium). Optional fast model via LORE_CODEX_MODEL."""
    binp = _find_codex_bin()
    effort = os.environ.get("LORE_CODEX_EFFORT", "low")
    args = [binp, "exec", "--sandbox", "read-only", "--skip-git-repo-check",
            "-c", f"model_reasoning_effort={effort}"]
    model = os.environ.get("LORE_CODEX_MODEL")
    if model:
        args += ["-m", model]
    args.append(prompt)
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    out = proc.stdout or ""
    if proc.returncode != 0 and not out.strip():
        raise ProviderError(f"codex exec failed (exit {proc.returncode}): {(proc.stderr or '').strip()[:200]}")
    # codex exec prints a header, then a line "codex", the answer, then "tokens used".
    m = re.search(r"(?:^|\n)codex\n(.*?)(?:\ntokens used|\Z)", out, re.DOTALL)
    return (m.group(1).strip() if m else out.strip())


# --- Claude Code CLI (subscription OAuth) ----------------------------------

def claude_call(prompt: str, timeout: int = 180) -> str:
    """Run `claude -p` headless and return its stdout. Unsets CLAUDECODE so that running
    inside a Claude Code session can still spawn a nested one."""
    binp = shutil.which("claude") or os.environ.get("CLAUDE_BIN")
    if not binp:
        raise ProviderError("Claude CLI not found (install Claude Code or set CLAUDE_BIN)")
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    out = subprocess.run(
        [binp, "-p", prompt], capture_output=True, text=True, timeout=timeout, env=env,
    ).stdout or ""
    return out.strip()


# --- Bring-your-own-key (direct API; OpenAI-compatible) --------------------

def byok_call(prompt: str, timeout: int = 60) -> str:
    """Direct API call with the user's own key. OpenAI-compatible; defaults to Together AI.
    Config via env: LORE_LLM_API_KEY (required), LORE_LLM_BASE_URL, LORE_LLM_MODEL."""
    key = os.environ.get("LORE_LLM_API_KEY") or os.environ.get("TOGETHER_API_KEY")
    if not key:
        raise ProviderError("BYOK selected but no key set (LORE_LLM_API_KEY)")
    base_url = os.environ.get("LORE_LLM_BASE_URL", "https://api.together.xyz/v1")
    model = os.environ.get("LORE_LLM_MODEL", "meta-llama/Llama-4-Maverick-17B-128E-Instruct")
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url=base_url)
    resp = client.chat.completions.create(
        model=model, messages=[{"role": "user", "content": prompt}],
        temperature=0.0, timeout=timeout,
    )
    return resp.choices[0].message.content or ""


_PROVIDERS = {"codex": codex_call, "claude": claude_call, "byok": byok_call}


def resolve_llm_call(provider: str = None):
    """Return the configured provider's call(prompt)->str. Defaults to env LORE_LLM_PROVIDER,
    else 'byok'. Raises ProviderError for an unknown provider."""
    p = (provider or os.environ.get("LORE_LLM_PROVIDER") or "byok").strip().lower()
    if p not in _PROVIDERS:
        raise ProviderError(f"Unknown LLM provider '{p}' (use codex | claude | byok)")
    return _PROVIDERS[p]


def provider_available(provider: str) -> bool:
    """Whether a provider can run right now (binary present / key set) — for Settings UI."""
    p = (provider or "").lower()
    try:
        if p == "codex":
            return bool(_find_codex_bin())
        if p == "claude":
            return bool(shutil.which("claude") or os.environ.get("CLAUDE_BIN"))
        if p == "byok":
            return bool(os.environ.get("LORE_LLM_API_KEY") or os.environ.get("TOGETHER_API_KEY"))
    except ProviderError:
        return False
    return False
