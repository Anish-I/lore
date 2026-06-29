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
        return types.SimpleNamespace(stdout="[]\n", stderr="", returncode=0)
    monkeypatch.setattr(P.subprocess, "run", fake_run)
    out = P.claude_call("hi")
    assert out == "[]"
    assert seen["env_has_claudecode"] is False, "CLAUDECODE must be stripped for the nested call"


def test_byok_requires_key(monkeypatch):
    monkeypatch.delenv("LORE_LLM_API_KEY", raising=False)
    monkeypatch.delenv("TOGETHER_API_KEY", raising=False)
    with pytest.raises(P.ProviderError):
        P.byok_call("hi")
