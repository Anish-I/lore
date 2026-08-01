# Design: correspondence drafts — style-matched email drafting over the store

**Date:** 2026-07-29
**Status:** v1 implemented (`draft_email.py`, `POST /emails/draft` + v1 mirror)
**Motivation:** Owner feature ask: the API should write emails for the owner,
backed by (a) a databank of what was discussed with each recipient, (b) the
owner's own writing style, and (c) context pulled by what the email is about —
"if the email is about a pet license, pull from the notes and keep the
handwriting." Emails live as their own source with tags, connected through
the knowledge graph like everything else.

## Decision summary

1. **Draft, never send.** The standing action boundary holds: Lore is memory +
   retrieval and never grows `send_x()`. `POST /emails/draft` returns
   {subject, body, citations, style_note_ids, recipient}; delivery is the
   product backend's job (`UI → product backend → Lore`). When the sent copy
   is ingested back as an email note, the loop closes by itself — the
   databank grows with every exchange.
2. **Three evidence lanes, all already in the engine:**
   - **Style** — recent in-scope `source_type='email'` notes roled
     `correspondence`; when the owner's address is known (`LORE_OWNER_EMAIL`
     or request param), notes whose From-header carries it rank first (those
     are literally the owner's sent mail). Bulk/solicitation mail is never a
     style source. Headers are stripped; the prose is the voice.
   - **Recipient history** — `people.person_detail` (ACL-scoped): identity by
     email binding, dated interaction timeline with evidence lines.
   - **Facts** — the normal recall pipeline on the ask (hybrid + rerank +
     note signals **including the tag boost**, so "pet license" concentrates
     on `dog-licenses`-tagged notes). Chunks are the ONLY permitted source of
     facts; the prompt requires "[CHECK: ...]" markers instead of invention.
3. **Emails as a first-class source, not a new subsystem.** Emails already
   ingest as `source_type='email'` notes: classify gives them tags/topic/role,
   people extraction binds senders, graph edges connect them — "separate
   folder with tags, connected by the KG" falls out of the existing axes
   (source_type = the folder, note_tags = the tags, edges/people = the graph).
   No schema change was needed for v1.
4. **Provider required, cheap-model friendly.** Drafting has no extractive
   fallback (a template cannot match a voice) — no usable provider → 503 with
   a clear message. The task is style transfer over supplied evidence, which
   cheap models do well; provider stays per-request selectable.

## Surface

`POST /emails/draft` (root + `/api/v1` mirror via the allowlist):

```json
{"ask": "reply to Janet about renewing her dog license",
 "to": "j@aol.com",                  // optional: email or display name
 "provider": "claude",               // optional
 "owner_email": "clerk@town.gov",    // optional; else LORE_OWNER_EMAIL
 "style_limit": 4}
```

Personal mode: key-authed callers omit scopes/tenant (same contract as /ask).
Response: `{subject, body, engine, style_note_ids, recipient, citations,
scopes_used}`. Query text is audited as a hash like every retrieval endpoint.

## Prompt contract

STYLE SAMPLES (match greeting/sign-off/sentence length/formality, never reuse
content) → RECIPIENT + RECENT HISTORY → CONTEXT (numbered, the only fact
source, "[CHECK: ...]" for gaps) → TASK → strict-JSON `{"subject","body"}`
with a fence-tolerant parser and a plain-text fallback.

## Later (not in v1)

- **Style profile distillation** — a periodic upkeep pass that summarizes the
  owner's voice (greeting, sign-off, register, typical length) into a durable
  profile note instead of raw excerpts; cheaper prompts, more stable voice.
  Natural SLM seat later, per the 2026-07-28 SLM spec.
- **Thread awareness** — accept the incoming email being replied to and
  weight its thread's notes (edges kind='link' via people/thread ids).
- **Draft storage** — persisting drafts as `source_type='draft'` notes so
  revisions are retrievable; deferred until the product layer needs it.
- **Per-recipient tone** — the databank knows formality varies by recipient;
  style samples could filter to mail previously sent TO this person first.

## Testing

`test_draft_email.py`: owner-sent style preference + bulk exclusion + scope
discipline; prompt carries style/context/JSON contract/[CHECK escape];
strict + fallback parsing; compose grounding with an injected LLM; DraftError
without a provider; endpoint end-to-end through TestClient with a real ingest
(collection + citations) and a stubbed resolver.
