"""Server-side secret redaction backstop for /capture.

Applied before any text is embedded or stored so that secrets inadvertently
included in Claude session transcripts never reach the knowledge base.
This is a defence-in-depth layer; the primary secret-filtering should happen
at the capture point (client / browser extension).

Patterns covered:
  - PEM private key blocks (-----BEGIN … PRIVATE KEY-----)
  - AWS access key IDs  (AKIA[0-9A-Z]{16})
  - Slack tokens        (xox[baprs]-…)
  - GitHub tokens       (ghp_… / ghs_…)
  - JWTs                (three base64url segments)
  - Generic key=value   (api_key / secret / token / password = <value>)
"""
import re

# PEM private key block — single-line and multiline.
_PEM_RE = re.compile(
    r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----',
    re.MULTILINE,
)
# AWS access key ID.
_AWS_RE = re.compile(r'\bAKIA[0-9A-Z]{16}\b')
# Slack tokens (bot, app, user, refresh, service).
_SLACK_RE = re.compile(r'\bxox[baprs]-[A-Za-z0-9\-]+')
# GitHub personal-access / server-to-server tokens.
_GH_RE = re.compile(r'\bgh[ps]_[A-Za-z0-9]{20,}\b')
# Google API keys (Maps, Cloud, etc.): AIza + 35 chars.
_GOOGLE_API_RE = re.compile(r'\bAIza[0-9A-Za-z_\-]{35}\b')
# Google OAuth client secrets.
_GOOGLE_OAUTH_RE = re.compile(r'\bGOCSPX-[0-9A-Za-z_\-]{20,}\b')
# Stripe live secret / restricted keys.
_STRIPE_RE = re.compile(r'\b(?:sk|rk)_live_[0-9A-Za-z]{10,}\b')
# OpenAI / Anthropic-style secret keys (sk-… , sk-ant-…).
_OPENAI_RE = re.compile(r'\bsk-(?:ant-)?[A-Za-z0-9_\-]{20,}\b')
# JWTs: three base64url segments of at least 10 chars each.
_JWT_RE = re.compile(
    r'\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'
)
# Generic "api_key = supersecret" / "password: hunter2" patterns (case-insensitive).
_KV_RE = re.compile(
    r'(?i)(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+'
)

_PATTERNS = [_PEM_RE, _AWS_RE, _SLACK_RE, _GH_RE, _GOOGLE_API_RE,
             _GOOGLE_OAUTH_RE, _STRIPE_RE, _OPENAI_RE, _JWT_RE, _KV_RE]


def redact(text: str) -> str:
    """Replace known secret patterns in *text* with ``[REDACTED]``.

    Patterns are applied left-to-right; the more specific patterns (PEM, AWS,
    Slack, GitHub, JWT) run before the broader key=value catch-all so the
    replacement token itself is not re-matched by a later pattern.

    Returns the sanitised string; raises nothing (if a pattern errors it is
    silently skipped so the pipeline never blocks on a redaction failure).
    """
    for pat in _PATTERNS:
        try:
            text = pat.sub("[REDACTED]", text)
        except Exception:
            pass
    return text
