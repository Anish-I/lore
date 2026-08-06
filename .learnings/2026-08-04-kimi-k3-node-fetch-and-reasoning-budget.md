# Kimi K3 delegation: node fetch dead on this machine + reasoning eats max_tokens

**Date:** 2026-08-04
**Context:** ~/.claude/tools/kimi.mjs (Moonshot API wrapper), debate-panel workflow

## Problem

Four consecutive failures calling Kimi K3 for a debate task, three distinct causes:

1. `kimi.mjs` fails instantly with `Request failed: fetch failed` (exit 2) while
   `curl` to the same `https://api.moonshot.ai/v1` endpoint with the same env key
   returns 200. Node/undici networking issue on this machine;
   `NODE_OPTIONS=--dns-result-order=ipv4first` did NOT fix it.
2. Non-streaming curl with `--max-time 580` hit exit 28 (timeout) — K3 takes
   >9.5 min to answer a ~6k-char analytical brief because it reasons first.
3. Streaming with `max_tokens: 3500` produced **0 answer chars**: all 3,497
   deltas were `reasoning_content`, `finish_reason: "length"`. K3 spends its
   entire token budget on chain-of-thought before the first `content` token.

## Working recipe

- Build the OpenAI-style JSON payload to a file (system + user, `"stream": true`,
  `max_tokens ≥ 12000` for essay-length answers; observed throughput ~33 tok/s).
- `curl -sN https://api.moonshot.ai/v1/chat/completions -H "Authorization: Bearer $KIMI_API_KEY" -d @payload.json -o stream.txt`
- Parse SSE lines: answer text is in `choices[].delta.content`; ignore
  `reasoning_content` (or capture separately). `finish_reason: "length"` with
  0 content chars means the budget died inside reasoning — raise max_tokens,
  don't shrink the prompt.

## Addendum 2026-08-06

- `kimi-k3` rejects any `temperature` except **1**: `{"error":{"message":"invalid
  temperature: only 1 is allowed for this model"}}`. Omit the field or set 1.
  The error comes back as a plain JSON body in place of the SSE stream, so a
  parser that only reads `data:` lines sees 0 chars — check the raw file when
  a "successful" stream parses empty.

## Rules of thumb

- Kimi K3 delegation on this machine: curl, never the node wrapper, until
  kimi.mjs is fixed (its fetch is broken regardless of prompt size).
- For any reasoning model behind an OpenAI-compatible API, `max_tokens` caps
  reasoning + answer COMBINED — budget 3-4× the expected visible answer.
- Streaming is the reliability fix as much as a UX one: it survives idle-timeout
  middleboxes and yields partial text on a cut connection.
