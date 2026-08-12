# Architecture diagrams drift from code, and docstrings assert what code doesn't do

**Date:** 2026-08-07
**Context:** Blue-team audit of the Lore Municipal Cloud board against the lore-arch engine source.

## What happened

I drew a six-band architecture board, tagged components LIVE vs PLANNED, and
used it to reason about security. An adversarial re-audit against the actual
source found that **six drawn components have no implementation at all** (Box +
VKG, Firecrawl, collector tray, ASR, Mistral OCR, NLI fact-check), and that the
container card I tagged **LIVE** describes a topology present in no file — the
repo's compose has only qdrant + postgres, both with published ports and
`vault/vault` credentials, no Caddy, no app service, no network block.

Worse: I published a green "HOLDS UP UNDER AUDIT" claim — *"learned skills
cannot self-activate, approve_skill is the sole writer of active/"* — that was
**false**. `learn.py:577` has a second writer that auto-applies patches to
already-active skills, behind a gate that defaulted OFF.

## The two transferable lessons

### 1. A diagram is a claim, and claims need a verification pass
A security review that trusts the diagram reviews controls for a system that
doesn't exist, and misses the ones that do. Before treating any architecture
doc as a review artifact, diff every box against the code. Tag honestly:
LIVE / PLANNED / NOT BUILT. An aspirational box drawn in the same style as a
shipped one is worse than no box.

### 2. Docstrings assert security properties the code doesn't implement
Two independent criticals shared this shape:
- `sandbox.py` docstring: child "inherits no connection, socket or token."
  Reality: `mp.get_context("spawn")` inherits `os.environ` wholesale — every
  secret. And the return path was a `multiprocessing.Queue`, i.e. **pickle**, so
  a compromised child could execute code in the parent via `__reduce__`. The
  isolation had a hole in its own return path.
- `learn.py` docstring: the model "cannot override filesystem guards."
  Reality: ungated auto-apply straight to the live skills directory.

**When auditing, treat a docstring's security claim as the hypothesis to
disprove, never as evidence.** Grep for the mechanism it names and confirm it
exists.

### 3. Object checks are not caller checks
Recurring bug class in this codebase, found three times:
`/feedback`, `/feedback/event`, `/query-log/purge` all validated that the
*object* existed in the named tenant, and read the tenant from the request
body. That reads like authorization but authenticates nobody. Ask of every
handler: **what proves the CALLER is who they say?**

## Mechanical gotchas hit along the way

- **Heredoc `\n` corruption (hit twice, again).** Writing Python via
  `python - <<'PYEOF'` turns `\\n` inside a string into a literal newline and
  produces `SyntaxError: unterminated string literal`. Use the Edit tool for
  any string containing newlines, or `chr(10)`.
- **`spawn` + stdin heredoc fails**: `OSError: Invalid argument: '<stdin>'`.
  Multiprocessing spawn re-imports `__main__`; test it from a real file.
- **Adding a band to the board touches three files** — `gen_v5.py`,
  `check_layout.py` (`BAND_IDS`), `render_png.py` (`BANDS`).
- **Constant ordering**: `SEC_HI` is defined in the governance band, below the
  security band that wanted it. Use a literal or hoist the constant.
