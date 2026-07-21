# Cold-Start Onboarding Findings — Raw Dump into Fresh Lore (2026-07-21)

**Setup:** beck-s's raw Enron mailbox — 3,000 messages (capped from 11,830),
ALL folders including inbox/sent/all_documents, duplicates KEPT, folder names
hidden — dumped flat into a brand-new Lore store. Real product path throughout:
local gemma4:e4b classification honoring the 80-notes-per-tidy-up cap,
auto-apply sections at its default-ON setting, v2 merges, live retrieval.
Artifact: `eval/history/coldstart-enron-2026-07-21.json` ·
runner: `eval/scenarios/run_coldstart_enron.py`.

## What day one actually looks like

| Stage | Result | Verdict |
| --- | --- | --- |
| Ingest | 3,000 notes / 194s, 0 rejected, 2.29 chunks/note | solid |
| Search | r@1 0.889 / r@5 1.0 (dup-tolerant), p50 518ms | **search works on a mess** |
| Duplicate echo | 8.9% of top-5 slots are duplicate copies | visible tax, single-digit |
| Day-one organization | 400 classified → **338 distinct topics**, F1 vs owner's real folders **0.002** | **effectively no organization** |
| Auto-apply exposure | **0 sections would auto-create** | safe — by accident |
| v2 healing | 6 merges proposed, **6/6 agree** with hidden folders | fires correctly, ~2% coverage |
| G10 midpoint threshold | catches 93% of impossible, **falsely abstains on 61% of answerable** | **not viable on raw dumps** |
| #2 telemetry | inject-style 1,904 tok vs IDs-first **476 tok** (4.0×), +hydrate-1 935 (2.0×) | **#2 now justified by our own numbers** |

## Findings

1. **Search-first onboarding is real**: a user who dumps 3,000 uncurated emails
   gets genuinely good retrieval immediately (r@5 1.0 dup-tolerant). The
   product's day-one promise should be "ask it anything", not "watch it
   organize".
2. **C2 (canonical topic vocabulary) is now measured as THE cold-start blocker**:
   batch-blind LLM naming invented ~1 topic per email (338 topics / 400 notes,
   F1 0.002). Nothing downstream (sections, wizards, merges) can function on
   that topic space. This is no longer a priority argument — it's a number.
3. **Auto-apply survived by accident, not design**: fragmentation kept every
   topic under the 5-note threshold, so zero sections auto-created. Once C2
   fixes naming, threshold-5 will start firing on dumps — auto-apply needs a
   purity gate BEFORE C2 lands, not after.
4. **v2 healing does act on classifier fragmentation** (6/6 correct on real
   data — first observed healing outside synthetics) but at ~2% coverage it is
   a repair loop, not a substitute for C2.
5. **G10 cannot ship as a fixed midpoint threshold**: on the raw dump the
   answerable/no-answer score distributions overlap enough that catching 93%
   of impossible queries costs 61% false abstention. Curated stores separate
   cleanly; raw dumps don't. G10 needs either a false-abstain budget (choose
   threshold at ≤5% false abstain, accept lower impossible-catch) or a richer
   signal than raw fused score (margin + lane agreement, per the gap doc).
6. **#2 (IDs-first SessionStart digest) graduates from claude-mem theory to
   our own telemetry**: 4.0× cheaper than today's resolved-content injection
   on real data (real chunks are big; synthetic understated this). Green light.
7. **Hygiene gaps confirmed at ingest**: no cross-note dedup (the 8.9% echo
   tax; ~19% of dumped notes were duplicate copies), and `redact.py` runs on
   /capture only — directly indexed dump files skip redaction entirely.
   Dump-onboarding needs an ingest-side dedup + redact pass.
8. **Coverage pacing**: at the 80-notes-per-run cap, full classification of a
   3k dump takes 38 tidy-up runs. Fine as a cost guard for trickle capture;
   wrong for bulk onboarding — a one-time "onboarding burst" mode is needed.

## Self-healing / hygiene scorecard (as of tonight)

- Ephemeral folding: works for session scratch; inert on dumps (date-title keyed).
- Supersession: works when cued; inert on silent near-duplicates.
- Low-content gate: works everywhere (0 junk notes indexed here).
- v2 merges: safe everywhere; heals only classifier fragmentation, slowly.
- Missing: ingest dedup, ingest redaction, auto-apply purity gate,
  onboarding burst mode. These four ARE the dump-onboarding backlog.

## Priority impact

C2 moves from "next up" to **blocking any dump-onboarding story**; add the
four hygiene items above as its cluster. G10 gets re-specced with a
false-abstain budget. #2 is approved for build on measured economics.
