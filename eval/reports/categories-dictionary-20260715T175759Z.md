# Lore category recall campaign

- Timestamp: `20260715T175759Z`
- Arm: `dictionary`

| Kind | n | Recall@1 | Recall@5 | MRR@10 | p50 ms | p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| dictionary | 12 | 0.917 | 1.0 | 0.933 | 389.4 | 584.7 |
| vague | 12 | 0.5 | 0.75 | 0.646 | 458.3 | 583.8 |
| complex | 12 | 1.0 | 1.0 | 1.0 | 416.2 | 881.8 |
| mixed | 12 | 0.917 | 1.0 | 0.944 | 398.9 | 493.9 |
| overall | 48 | 0.833 | 0.938 | 0.881 | 406.1 | 584.7 |

## Ask samples

### dictionary: unset CLAUDECODE nested claude session

Engine: `claude`

Prefix nested launches with `unset CLAUDECODE && claude -p "..." --dangerously-skip-permissions`, otherwise Claude Code errors with "Claude Code cannot be launched inside another Claude Code session" [Unset CLAUDECODE for nested sessions]. The CLAUDECODE env var is how Claude Code detects nesting to prevent crashes from shared runtime resources, so it must be unset for every worker instance spawned from Bash [Unset CLAUDECODE for nested sessions] [feedback_nested_claude.md].

### dictionary: VSR video-subtitle-remover Apple Silicon

Engine: `claude`

Three undocumented fixes are needed before VSR runs on an M-series Mac [VSR (video-subtitle-remover) on macOS Apple Silicon — setup gotchas]:

- `paddlepaddle` isn't in `requirements.txt` — without it, imports succeed but predictor creation throws a misleading dependency error.
- Bundled ffmpeg is x86_64 (`OSError: Errno 86` without Rosetta) — symlink the system arm64 ffmpeg so the audio mux step works.
- Relative paths break because VSR's cwd is its own repo root — the wrapper's `buildVsrArgs` now absolutises `--input`/`--output`.

After the fixes, `sttn-auto` runs on CPU at ~5 fps for 720×720; `--inpaint lama` still fails and isn't investigated [VSR (video-subtitle-remover) on macOS Apple Silicon — setup gotchas]. It's invoked via `tiktok-caps clean`, which wraps VSR from pure Node [TikTokCaptions].

### dictionary: gemma4:e4b throughput ceiling

Engine: `claude`

- Gemma4:e4b on local hardware cannot consistently plan multi-step workflows of ≥6 nodes within the 120s HTTP timeout; timeouts accounted for 17/39 E2E failures [Gemma4:e4b local throughput ceiling for workflow planning].
- Short 2–3 node plans consistently succeed under 20s; overall the E2E capped at 9/39 PASS even after synonym-field and rate-limit fixes [Session state snapshot — 2026-04-16 end-of-day].
- Suggested mitigations: raise the client timeout to 180–240s, route complex requests to a cloud fallback (reserving gemma4 for ≤5-node plans), or rely on the pre-validated scenario/template library [Gemma4:e4b local throughput ceiling for workflow planning].

### vague: what did the security check of the codebase find

Engine: `claude`

- The DELETE /auth/account endpoint lacked PIN brute-force protection (unlike POST /auth/verify-pin); it was fixed with an IP-based rate limiter (3 req/hr) and per-user PIN attempt tracking, committed as `4440cd7` [2026-04-06 > 15:30].
- A full codebase read found the server at grade C+ (3 hard bugs, architectural debt, dead Zapier code, no migration runner) and mobile at B- (fontScale bug, Apple Sign-In stub, no streaming); the earlier security audit was "mostly resolved" [Thread: 2026-04-02 > 04:30].
- The formal audit note only records scope (full Wingman codebase) and status "Complete" — no specific findings are included in the context [Security Audit Report — 2026-03-15].

### vague: why was the betting bot losing money

Engine: `claude`

The context records that the [[KalshiBot]] paper win rate was only 38.55%, losing about $102/week, but it does not state the root cause of the losses [Kalshi 15m crypto: win-rate diagnosis, value strategy, pair verdict (2026-06-05)]. That note only says an investigation was done into the low win rate and whether "buy the cheapest on both sides" could profit, with the full diagnosis in `kalshi-trading-bot/docs/value_and_pair_findings.md`.

### vague: that tool that removes burned-in captions from videos

Engine: `claude`

The tool is **VSR (video-subtitle-remover)** — a Python tool (PaddleOCR + STTN/LAMA/ProPainter inpainting) that strips hard-burned subtitles from video, wrapped by the `tiktok-caps clean` command via `src/clean/vsr-wrapper.ts` [TikTokCaptions]. On Apple Silicon it runs CPU-only with the default `sttn-auto` inpainter (~5 fps at 720×720); `--inpaint lama` fails with a paddlex dependency error, and the bundled x86_64 ffmpeg needs a symlink to system arm64 ffmpeg [VSR (video-subtitle-remover) on macOS Apple Silicon — setup gotchas].

### complex: Why did BGE-base at 768 dimensions fail to beat BGE-small on the semantic gold set?

Engine: `claude`

BGE-base failed because the ceiling was domain vocabulary, not model capacity — neither embedder encodes insurance jargon like IBNR, excess-of-loss, or loss costs, so the same actuarial/finance/legal miss cluster persisted and BGE-base even added a new miss [Lore — embedder A/B: BGE-base did NOT beat BGE-small (2026-06-28)]. It scored slightly worse (recall@1 84% vs 86%, MRR 0.847 vs 0.860) while indexing 2.4× slower. The gap was later closed by a ~20-entry domain glossary for query expansion, lifting recall@1 to 98% [Lore — semantic gold-set baseline (2026-06-28)].

### complex: What discrepancy fixes and adaptive edge changes went into the BTC15M value model?

Engine: `claude`

- **T off-by-one**: deciding at bar `elapsed`'s close puts the price at minute `elapsed+1`, so T = 14−elapsed, not 15−elapsed [Crypto 15m Markets — Win-Rate Diagnosis, Value Strategy, and the Both-Sides Idea]
- **Strike off-by-one**: the strike is the window OPEN (first bar's `open`), not its close
- **Vol estimator**: trailing 15-sample std replaced with EWMA (λ=0.94) × `BTC15M_VOL_SCALE = 0.90`, improving Brier 0.1641 → 0.1564 and directional accuracy 0.752 → 0.763
- **Adaptive edge threshold**: per-T Brier ranges 0.08 (T=2m) to 0.22 (T=13m), so the flat min-edge that over-traded the fuzzy early window was replaced with a per-T threshold [BTC15M value model — discrepancy fixes + adaptive edge (2026-06-11)]

### complex: What positioning and Home tab changes shipped in the Lore memory-first v3 redesign?

Engine: `claude`

Positioning shifted to a **memory company** — "Lore remembers" [Lore memory-first v3 shipped (2026-07-04)]. Home tab changes:

- Home became the default tab with a greeting and "Lore remembers N things · X new since yesterday · backed up ✓" line
- Ask input plus learned prompt chips (suggestPrompts: repeats ≥2 from ask_history, an activity chip, and cold-start)
- This-week digest via `GET /digest` — day × section group-by, no LLM

### mixed: the Apex 46k simulation — what did the identifier-lane benchmark fix?

Engine: `claude`

The identifier-lane work fixed weak exact-ID retrieval on the 46k-note Apex simulation: a dedicated exact-match lane for identifiers raised exact-ID recall from 66% to 100% [Vault — exact-match identifier lane (66%→100% exact-ID) — 2026-06-25]. The same testing pass also surfaced remaining semantic-recall gaps (~75%) as the next optimization target [Security].

### mixed: PairStrategy — how does it profit from the spread when both legs fill?

Engine: `claude`

It posts resting maker limit orders at `best_bid + 1` on both the YES and NO legs; if both legs fill, the pair costs less than the guaranteed 100¢ settlement payout, so profit = `100 − maker_pair_cost − fees` [Crypto 15m Markets — Win-Rate Diagnosis, Value Strategy, and the Both-Sides Idea]. Economically this reduces to capturing the spread (`maker_gross = spread − 2c` in fees, ~1¢/leg near mid), so it needs a spread of roughly ≥5¢ to be net positive [PairStrategy]. The profit only exists if both legs fill — orphaned single legs leave directional exposure, which is why pairs are currently disabled [PairStrategy].

### mixed: claude -p spawning — why does it error inside another session?

Engine: `claude`

Claude Code sets a `CLAUDECODE` env var to detect nesting and prevent crashes from shared runtime resources, so a nested launch errors with "Claude Code cannot be launched inside another Claude Code session" [Unset CLAUDECODE for nested sessions]. The fix is to prefix with `unset CLAUDECODE && claude -p "..." --dangerously-skip-permissions` when spawning worker instances.
