"""Outbound email for team invites.

SMTP-configured via environment (works with Gmail app passwords, Resend,
Postmark, or any SMTP relay):
    LORE_SMTP_HOST, LORE_SMTP_PORT (default 587, STARTTLS),
    LORE_SMTP_USER, LORE_SMTP_PASS, LORE_SMTP_FROM (default LORE_SMTP_USER)

Delivery is best-effort and HONEST: send_invite_email always returns
{"delivered": bool, "reason": str} — the API surfaces that so the UI can tell
the inviter to share the invite manually when no relay is configured. It never
raises into the invite endpoint: an email outage must not lose the invite row.
"""
import os
import smtplib
from email.message import EmailMessage


def smtp_settings() -> dict | None:
    """The SMTP relay config from env, or None when not configured."""
    host = os.environ.get("LORE_SMTP_HOST")
    if not host:
        return None
    user = os.environ.get("LORE_SMTP_USER", "")
    return {
        "host": host,
        "port": int(os.environ.get("LORE_SMTP_PORT", "587")),
        "user": user,
        "password": os.environ.get("LORE_SMTP_PASS", ""),
        "sender": os.environ.get("LORE_SMTP_FROM") or user,
    }


def _compose_invite(to_email: str, team_name: str, inviter: str, invite_id: str, sender: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = f"{inviter} invited you to “{team_name}” on Lore"
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(
        f"{inviter} invited you to the shared base “{team_name}” on Lore.\n\n"
        f"To join: open Lore, sign in with this email address ({to_email}), and\n"
        f"accept the pending invite — it will be waiting on your invites list.\n\n"
        f"Invite id: {invite_id}\n\n"
        f"If you weren't expecting this, you can ignore this email; the invite\n"
        f"only works for someone signed in as {to_email}.\n"
    )
    return msg


def send_invite_email(to_email: str, team_name: str, inviter: str, invite_id: str,
                      transport=None) -> dict:
    """Deliver an invite email. Returns {"delivered": bool, "reason": str}.

    `transport` (tests) is a callable(msg, cfg) that performs the send; the
    default opens an SMTP STARTTLS session per message — fine at invite volume.
    """
    cfg = smtp_settings()
    if cfg is None:
        return {"delivered": False,
                "reason": "email not configured (set LORE_SMTP_HOST) — share the invite manually"}
    msg = _compose_invite(to_email, team_name, inviter, invite_id, cfg["sender"])
    try:
        if transport is not None:
            transport(msg, cfg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as s:
                s.starttls()
                if cfg["user"]:
                    s.login(cfg["user"], cfg["password"])
                s.send_message(msg)
        return {"delivered": True, "reason": ""}
    except Exception as e:  # invite must survive a mail outage
        return {"delivered": False, "reason": f"send failed: {e}"}
