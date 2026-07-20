# Trusted Recall Evaluation

**Date:** 2026-07-18
**Status:** Test contract
**Builds on:** `2026-07-18-lore-outcomes-design.md`

## Claim under test

Lore should let a person return later, ask naturally, and receive the right
approved context with visible provenance and complete user control. The test
suite must distinguish storage contracts, retrieval quality, and model answer
quality. A green storage test is not evidence of a better answer.

## Evidence lanes

### 1. Deterministic lifecycle

Use isolated SQLite and embedded Qdrant stores. Verify replacement, redaction,
version history, exact export, rollback, tenant/owner/scope isolation, and
deletion from notes, chunks, vectors, versions, and local prompt caches.

Hard gates:

- 100% exact rollback and export fidelity.
- Zero cross-tenant, cross-owner, or cross-scope results.
- 100% provenance coverage for recalled sessions and context-pack items.
- Zero canonical rows, vectors, versions, or hook-cache files after forget.

### 2. Local work and note retrieval

Index copies of explicitly supplied user-owned files into an isolated store.
Do not persist their bodies, prompts, or retrieved excerpts in repository
artifacts. Persist aggregate metrics and source labels only.

Initial gate for the Lore research set:

- hit@1 at least 80%.
- hit@3 at least 95%.
- mean reciprocal rank at least 0.85.
- provenance coverage 100%.
- query P95 at most 500 ms after model warmup on this machine.

These thresholds are release gates for this fixture, not universal retrieval
quality claims. Expand and re-baseline them as the consented corpus grows.

### 3. Cross-model answer replay

Run the same sanitized, non-sensitive asks with and without an approved Lore
context packet through at least two replaceable model families. Run from an
empty workspace and prohibit tool use where the CLI supports it.

Gate:

- Every after-context answer contains all required facts.
- No after-context answer introduces a forbidden personal fact.
- At least one before-context miss becomes correct for every model family.
- The context packet format is identical across model families.

This lane demonstrates handoff portability. It does not send raw personal notes
or hidden reasoning to model providers.

## Reporting

The machine-readable report records fixture IDs, aggregate metrics, latencies,
model family names, and gate failures. It must not include note bodies, secrets,
hidden reasoning, or full model responses. Any failed hard gate blocks a Trusted
Recall completion claim even when the existing contract-regression score is 100.

