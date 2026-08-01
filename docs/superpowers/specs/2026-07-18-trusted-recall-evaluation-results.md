# Trusted Recall Evaluation Results

**Date:** 2026-07-18
**Status:** Bounded milestone gate passed
**Contract:** `2026-07-18-trusted-recall-evaluation.md`

## What changed

- Added exact personal-memory export with full version history.
- Added readable recall reasons and retained technical retrieval traces.
- Deduplicated session discovery at the session level.
- Invalidated frozen hook context after explicit edit, rollback, or forget.
- Added visible history, restore, export, and provenance controls to
  **What Lore knows**.
- Made the L6 cross-encoder the local default after it passed the latency gate
  without reducing hit@1/3/5 on the two completed comparison fixtures.
- Added deterministic lifecycle, real-note/session retrieval, and live
  cross-model replay suites.

## Evidence

| Lane | Result | Artifact |
| --- | --- | --- |
| Full backend regression | 303 passed, 2 skipped | bare `python -m pytest -q` |
| Full desktop regression | 54 passed | `npm test -- --run` |
| Contract outcome benchmark | 100/100, no failed gates | `eval/history/lore-outcomes-trusted-recall-2026-07-18.json` |
| Eight Lore notes/research artifacts | hit@1/3/5 100%, MRR 1.0, provenance 100%, P95 393 ms | `eval/history/trusted-recall-notes-l6-2026-07-18.json` |
| Five captured Lore sessions | hit@1/3/5 100%, MRR 1.0, provenance 100%, P95 159 ms | `eval/history/trusted-recall-sessions-2026-07-18.json` |
| Claude and Codex replay | before 0%, after 100%, 3 gains per family, 0 forbidden facts | `eval/history/trusted-recall-model-handoff-2026-07-18.json` |
| L12 latency ablation | quality passed; P95 701 ms failed the 500 ms gate | `eval/history/trusted-recall-notes-2026-07-18.json` |
| UI integration | all controls present, heading visible, zero page errors | `node desktop/e2e-trusted-recall.js` |

The note and session evaluators index copies into temporary SQLite and embedded
Qdrant stores. Reports contain source IDs, ranks, provenance booleans, and
latency only. They do not persist note bodies or retrieved excerpts.

## Success gate assessment

- **Less repetition:** bounded pass. Both live families moved from 0/3 correct
  without context to 3/3 with the same Lore packet.
- **Better task completion:** bounded pass on three deterministic fact-use asks;
  natural workflow completion still needs human-rated tasks.
- **High recall precision:** pass on 13 labeled user-owned artifacts.
- **No invented personal facts:** no configured forbidden fact appeared; this is
  a narrow safety probe, not a general hallucination guarantee.
- **Cross-model handoff:** pass for Claude and Codex with one identical context
  format. Kimi did not run because no model is configured locally.
- **Edit/export/rollback/deletion:** pass across API, SQL rows, Qdrant vectors,
  version history, and desktop prompt-cache invalidation.
- **Latency:** pass with the L6 default on both completed real-data fixtures.

## Remaining risks

1. Kimi is installed but has no configured model, so the third family is pending.
2. The live desktop backend was not running on port 8099 during this evaluation;
   production data was not mutated and installed-app behavior was not claimed.
3. A bounded LoCoMo HTTP run was stopped after six minutes before its first note
   completed ingestion. Bulk replay startup/throughput remains unresolved.
4. The real-data gold set has 13 cases. It needs more consented sessions,
   temporal updates, conflicts, deletions, and unrelated distractors.
5. Model replay uses evidence IDs for deterministic scoring. Add human-rated
   natural answers before making broad task-quality or Hermes comparisons.

## Decision

Trusted Recall has moved beyond contract-only evidence: the current vertical
slice retrieves the tested user-owned work, explains provenance, survives two
replaceable model families, and honors explicit rollback/deletion controls.
Keep the milestone open for installed-app and larger-corpus validation; do not
start Skills Hub or gateway expansion based on this bounded pass alone.

