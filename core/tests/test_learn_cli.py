import argparse

from lore import cli


def _args(command, **extra):
    base = {"skills_cmd": command, "tenant": "t", "url": "http://lore", "token": None,
            "json": False, "scope": None, "owner": None, "name": "flow", "version": 1}
    base.update(extra)
    return argparse.Namespace(**base)


def test_cli_pending_and_diff(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_get_json", lambda url: (
        {"skills": [{"name": "flow", "status": "pending", "description": "Do it"}]}
        if url.endswith("pending=true") else {"diff": "--- active\n+++ pending\n"}
    ))
    assert cli._cmd_skills(_args("pending")) == 0
    assert "flow  pending  Do it" in capsys.readouterr().out
    assert cli._cmd_skills(_args("diff")) == 0
    assert "+++ pending" in capsys.readouterr().out


def test_cli_mutations_send_tenant_and_version(monkeypatch, capsys):
    calls = []

    def post(url, payload):
        calls.append((url, payload))
        return {"name": "flow", "status": "active", "version": payload.get("version", 2)}

    monkeypatch.setattr(cli, "_post_json", post)
    assert cli._cmd_skills(_args("approve")) == 0
    assert calls[-1][1] == {"tenant": "t"}
    assert cli._cmd_skills(_args("rollback", version=1)) == 0
    assert calls[-1][1] == {"tenant": "t", "version": 1}
    assert "Rolled back flow to version 1" in capsys.readouterr().out
