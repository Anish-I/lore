"""Invite email delivery: honest status, never raises into the invite flow."""

from lore import mailer


def test_unconfigured_smtp_reports_undelivered(monkeypatch):
    monkeypatch.delenv("LORE_SMTP_HOST", raising=False)
    r = mailer.send_invite_email("a@b.com", "Saga", "Anish", "inv-1")
    assert r["delivered"] is False and "not configured" in r["reason"]


def test_configured_smtp_sends_composed_invite(monkeypatch):
    monkeypatch.setenv("LORE_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("LORE_SMTP_USER", "lore@example.com")
    monkeypatch.setenv("LORE_SMTP_PASS", "pw")
    sent = []
    r = mailer.send_invite_email("friend@example.com", "Saga", "Anish", "inv-42",
                                 transport=lambda msg, cfg: sent.append((msg, cfg)))
    assert r == {"delivered": True, "reason": ""}
    msg, cfg = sent[0]
    assert msg["To"] == "friend@example.com"
    assert "Saga" in msg["Subject"] and "Anish" in msg["Subject"]
    assert "inv-42" in msg.get_content()
    assert cfg["host"] == "smtp.example.com" and cfg["sender"] == "lore@example.com"


def test_transport_failure_is_contained(monkeypatch):
    monkeypatch.setenv("LORE_SMTP_HOST", "smtp.example.com")
    def boom(msg, cfg):
        raise ConnectionError("relay down")
    r = mailer.send_invite_email("a@b.com", "Saga", "Anish", "inv-1", transport=boom)
    assert r["delivered"] is False and "relay down" in r["reason"]
