# Lore category recall campaign

- Timestamp: `20260715T175055Z`
- Arm: `baseline`

| Kind | n | Recall@1 | Recall@5 | MRR@10 | p50 ms | p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| dictionary | 12 | 0.917 | 1.0 | 0.933 | 473.0 | 665.7 |
| vague | 12 | 0.25 | 0.833 | 0.539 | 377.2 | 499.9 |
| complex | 12 | 1.0 | 1.0 | 1.0 | 546.4 | 1250.4 |
| mixed | 12 | 0.917 | 1.0 | 0.944 | 424.7 | 856.1 |
| overall | 48 | 0.771 | 0.958 | 0.854 | 423.2 | 856.1 |

## Ask samples

### dictionary: unset CLAUDECODE nested claude session

Engine: `claude`

Prefix nested Claude Code launches with `unset CLAUDECODE`, e.g. `unset CLAUDECODE && claude -p "..." --dangerously-skip-permissions`, or it errors with "Claude Code cannot be launched inside another Claude Code session" [Unset CLAUDECODE for nested sessions]. The env var exists so Claude Code can detect nesting and prevent crashes from shared runtime resources [Unset CLAUDECODE for nested sessions]; this rule is also indexed as a required practice in [Wingman Project Memory].

### dictionary: VSR video-subtitle-remover Apple Silicon

Engine: `claude`

Three setup fixes are needed before VSR runs on an M-series Mac [VSR (video-subtitle-remover) on macOS Apple Silicon — setup gotchas]:

- Install `paddlepaddle` manually — it's missing from `requirements.txt`, and its absence throws a misleading "predictor creation" error.
- The bundled `ffmpeg` is x86_64; symlink to a system arm64 ffmpeg or the audio mux step fails with `Bad CPU type`.
- Pass absolute paths through the wrapper — VSR resolves relative paths against its own repo root, so `buildVsrArgs` absolutises `--input`/`--output` [TikTokCaptions].
- After the fixes, `sttn-auto` runs ~5 fps on CPU for 720×720; `--inpaint lama` still fails and isn't worth using.

### dictionary: gemma4:e4b throughput ceiling

Engine: `claude`

Gemma4:e4b running locally via Ollama cannot consistently plan multi-step workflows of 6+ nodes within a 120s HTTP timeout — this capped the 39-scenario E2E at 9/39 PASS, with 17 timeout failures all on ≥6-node graphs [Gemma4:e4b local throughput ceiling for workflow planning].

- Short 2–3 node plans consistently succeed in under 20s; the remaining 12 failures were HTTP 500s from JSON shapes outside the widened synonym whitelist.
- Proposed mitigations: raise the client timeout to 180–240s, route complex requests to a cloud fallback (reserving gemma4 for ≤5-node plans), or pre-generate templates via the scenario library — which the Workflows tab already exposes as the primary entry point.

### vague: what did the security check of the codebase find

Engine: `claude`

- A follow-up review found DELETE /auth/account lacked PIN brute-force protection; an IP rate limiter (3 req/hr) and per-user PIN attempt tracking were added in commit `4440cd7` [2026-04-06].
- The full audit [Security Audit Report — 2026-03-15] is marked complete covering server, mobile, config, and dependencies, but its specific findings aren't included in the context.
- A later codebase read noted the security audit was "mostly resolved," with the server graded C+ (3 hard bugs, architectural debt) and mobile B- [Thread: 2026-04-02].

### vague: why was the betting bot losing money

Engine: `claude`

- Two tail BTC trades caused most of the loss (-$110.60 of it); the other 273 trades were roughly flat — a risk-control failure, not a broken model [Crypto 15m Markets — Win-Rate Diagnosis].
- The live trader had no EV gate (calibration silently bypassed) and assumed a 48.5% win rate the data (38.55%) refuted; the ML leg also never compared spot to the strike price [Crypto 15m Markets — Win-Rate Diagnosis].
- Risk counters were in-memory and entry-only, so daily-loss limits reset on restart with no per-ticker exposure cap [Crypto 15m Markets — Win-Rate Diagnosis].
- The weather bot compounded losses with an 18% win rate (-$20.98), and the crypto pair maker strategy had only a 3% fill rate [Thread: 2026-04-02], [Thread: 2026-04-03].

### vague: that tool that removes burned-in captions from videos

Engine: `claude`

The tool is VSR (video-subtitle-remover), wrapped by the `tiktok-caps clean` command — it uses PaddleOCR plus STTN/LAMA/ProPainter inpainting to strip hard-burned subtitles from video [TikTokCaptions]. It lives as a sibling clone at `/Users/aivat/video-subtitle-remover` (or `$VSR_PATH`), spawned via `src/clean/vsr-wrapper.ts`, and runs on M-series CPU at ~5 fps for a 720×720 clip [VSR (video-subtitle-remover) on macOS Apple Silicon — setup gotchas].

### complex: Why did BGE-base at 768 dimensions fail to beat BGE-small on the semantic gold set?

Engine: `claude`

Because the misses were domain-vocabulary gaps, not model-capacity gaps: neither BGE-small nor BGE-base encodes insurance jargon like IBNR, excess-of-loss, or loss costs, so the same actuarial/finance/legal miss cluster persisted — and BGE-base even added a new miss [Lore — embedder A/B: BGE-base did NOT beat BGE-small (2026-06-28)]. It scored slightly worse (recall@1 84% vs 86%, MRR 0.847 vs 0.860) while indexing 2.4× slower. The actual fix was a ~20-entry domain glossary for query expansion, which lifted recall@1 from 86% to 98% [Lore — semantic gold-set baseline (2026-06-28)].

### complex: What discrepancy fixes and adaptive edge changes went into the BTC15M value model?

Engine: `claude`

- **T off-by-one**: deciding at the close of bar `elapsed` puts price at minute `elapsed+1`, so T = 14−elapsed, not 15−elapsed [Crypto 15m Markets — Win-Rate Diagnosis, Value Strategy, and the Both-Sides Idea].
- **Strike off-by-one**: the market strike is the window open (minute 0, first bar's `open`), not that bar's close [Crypto 15m Markets — Win-Rate Diagnosis, Value Strategy, and the Both-Sides Idea].
- **Vol estimator**: replaced noisy trailing 15-sample std with EWMA (λ=0.94) × `BTC15M_VOL_SCALE = 0.90`, improving Brier 0.1641→0.1564 and directional accuracy 0.752→0.763 [Crypto 15m Markets — Win-Rate Diagnosis, Value Strategy, and the Both-Sides Idea].
- **Adaptive edge threshold**: per-T Brier ranges 0.08 (T=2m) to 0.22 (T=13m), so a flat min-edge over-trades the fuzzy early window — the threshold now adapts per T (observed decaying 8.5c→3.2c in dry-run) [BTC15M value model — discrepancy fixes + adaptive edge (2026-06-11)].

### complex: What positioning and Home tab changes shipped in the Lore memory-first v3 redesign?

Engine: `claude`

Positioning shifted to a **memory company** with the tagline "Lore remembers" [Lore memory-first v3 shipped (2026-07-04)]. Home tab changes:

- Home became the default tab with a greeting and status line: "Lore remembers N things · X new since yesterday · backed up ✓"
- Ask input plus learned prompt chips (suggestPrompts: repeats ≥2 from ask_history, an activity chip, and cold-start)
- This-week digest via `GET /digest` — day × section group-by, no LLM

### mixed: the Apex 46k simulation — what did the identifier-lane benchmark fix?

Engine: `claude`

It fixed weak exact-match ID retrieval on the 46k-note Apex simulation: a dedicated exact-match lane for identifiers raised exact-ID recall from 66% to 100% [Vault — exact-match identifier lane (66%→100% exact-ID) — 2026-06-25] [Security]. Semantic recall remained a separate gap (~75%), with further optimization proposed [Security].

### mixed: PairStrategy — how does it profit from the spread when both legs fill?

Engine: `claude`

It posts resting limit orders at `best_bid + 1` on both the YES and NO legs; if both fill, the combined cost is under 100¢, and profit = 100 − maker_pair_cost − fees [PairStrategy], [Crypto 15m Markets — Win-Rate Diagnosis, Value Strategy, and the Both-Sides Idea]. Economics reduce to the spread: `maker_gross = spread − 2c`, so a spread ≳ 5¢ is needed after real maker fees (~1¢/leg near mid) [PairStrategy > 2026-06-05 verdict (verified in code)]. This only works if both legs fill — otherwise an orphan leaves directional exposure, which is why pairs are currently disabled [PairStrategy > Notes].

### mixed: claude -p spawning — why does it error inside another session?

Engine: `claude`

Claude Code sets a `CLAUDECODE` env var to detect nesting and prevent crashes from shared runtime resources; when it's present, a nested launch errors with "Claude Code cannot be launched inside another Claude Code session" [Unset CLAUDECODE for nested sessions]. Fix: prefix with `unset CLAUDECODE && claude -p "..." --dangerously-skip-permissions`.
