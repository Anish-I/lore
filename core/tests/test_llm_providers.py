"""Tests for the pluggable LLM providers (codex / claude / byok)."""
import types
import pytest
from lore import llm_providers as P


def test_resolve_returns_right_callable_and_rejects_unknown():
    assert P.resolve_llm_call("codex") is P.codex_call
    assert P.resolve_llm_call("claude") is P.claude_call
    assert P.resolve_llm_call("byok") is P.byok_call
    with pytest.raises(P.ProviderError):
        P.resolve_llm_call("nope")


def test_codex_call_extracts_final_answer(monkeypatch):
    # Simulate codex exec stdout: header noise, the 'codex' marker, the answer, then 'tokens used'.
    fake_stdout = (
        "provider: openai\napproval: never\nsandbox: read-only\n--------\n"
        "user\nextract relations\n"
        "codex\n[{\"target\":\"X\",\"relation\":\"depends_on\"}]\n"
        "tokens used\n123\n"
    )
    monkeypatch.setattr(P, "_find_codex_bin", lambda: "codex.exe")
    monkeypatch.setattr(P.subprocess, "run",
                        lambda *a, **k: types.SimpleNamespace(stdout=fake_stdout, stderr="", returncode=0))
    out = P.codex_call("extract relations")
    assert out == '[{"target":"X","relation":"depends_on"}]'


def test_claude_call_unsets_claudecode_and_returns_stdout(monkeypatch):
    monkeypatch.setenv("CLAUDECODE", "1")
    monkeypatch.setattr(P.shutil, "which", lambda name: "claude" if name == "claude" else None)
    seen = {}
    def fake_run(cmd, **kw):
        seen["env_has_claudecode"] = "CLAUDECODE" in (kw.get("env") or {})
        seen["cmd"] = cmd
        seen["input"] = kw.get("input")
        seen["cwd"] = kw.get("cwd")
        return types.SimpleNamespace(stdout="[]\n", stderr="", returncode=0)
    monkeypatch.setattr(P.subprocess, "run", fake_run)
    prompt = "line one\nline two\nline three"
    out = P.claude_call(prompt)
    assert out == "[]"
    assert seen["env_has_claudecode"] is False, "CLAUDECODE must be stripped for the nested call"
    # Regression guard: the prompt must ride on STDIN, never argv. Passing a multi-line prompt as an
    # argv element gets truncated at the first newline by the Windows claude.CMD shim.
    assert seen["input"] == prompt, "prompt must be delivered via stdin (input=)"
    assert prompt not in seen["cmd"], "prompt must NOT be in the argv list"
    # Must run from a neutral cwd so the agentic CLI can't load the repo's CLAUDE.md/memory as
    # ambient context and leak it into the answer.
    assert seen["cwd"] == P._isolated_cwd(), "claude CLI must run in the isolated cwd"


def test_codex_call_rejects_cmd_shim(monkeypatch):
    # A .cmd/.bat shim truncates multi-line argv prompts on Windows — codex_call must refuse it
    # loudly instead of shelling out and getting a corrupted (first-line-only) prompt.
    monkeypatch.setattr(P, "_find_codex_bin", lambda: r"C:\path\to\codex.cmd")
    with pytest.raises(P.ProviderError) as exc:
        P.codex_call("some\nmulti-line\nprompt")
    assert "CODEX_BIN" in str(exc.value)


def test_byok_requires_key(monkeypatch):
    monkeypatch.delenv("LORE_LLM_API_KEY", raising=False)
    monkeypatch.delenv("TOGETHER_API_KEY", raising=False)
    with pytest.raises(P.ProviderError):
        P.byok_call("hi")
