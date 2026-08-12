# Long-run benchmarks: process survival, Windows shims, and why loss accounting earns its keep

**Date:** 2026-08-10
**Context:** Building `eval/bench_locomo_qa.py` (LoCoMo end-to-end QA with an
LLM judge) and running it against a second Lore backend. Four runs were lost
before one completed.

## 1. A .CMD shim makes a benchmark silently report zero

On Windows `codex` resolves to `codex.CMD`. `subprocess.run(["codex", ...])`
dies with `WinError 2: The system cannot find the file specified`, because
CreateProcess does not apply PATHEXT to a bare name — while the identical
command works from every shell you would test it in.

The first smoke run reported **J = 0.00%**. The number was not wrong in any way
a reader could detect; it was a real score computed over 6 questions where all 6
answerer calls had failed.

```python
CODEX_BIN = shutil.which("codex") or "codex"   # resolves the .CMD
```

**The transferable part:** any harness that shells out to a CLI must count call
failures and print them next to the score. `answer_errors: 6, codex.failures: 6`
is what turned "our system scores 0%" into "our subprocess call is broken" in
about ten seconds.

## 2. Anything over ~10 minutes must be launched detached

Three separate runs died with the backend logging:

    [bench] uvicorn exited rc=1073807364

`1073807364` = `0x40010004` = `DBG_TERMINATE_PROCESS` — external termination,
not a crash. Background children of the agent's tool shell (`&`, `nohup`, the
harness's own background mode) are all in that shell's process tree and are
killed on session teardown. A 100-minute ingest cannot survive there.

What works — a genuinely detached process:

```powershell
Start-Process -FilePath python -ArgumentList "$s\run_ingest.py" `
  -WindowStyle Hidden -RedirectStandardOutput "$s\ingest.log"
```

Env vars can't be passed through `Start-Process`, so wrap the entrypoint in a
tiny launcher `.py` that sets `os.environ` and `runpy.run_path`s the real script.

**Diagnostic tell:** if the client logs thousands of *connection* failures rather
than 500s, the server died — don't go looking for a concurrency bug in your code.
That misdiagnosis cost a cycle here: 5,846 ingest failures looked like the
4-worker change had broken embedded Qdrant, and it hadn't.

## 3. Embedded Qdrant does not scale with ingest threads

`--ingest-workers 4` moved throughput from ~1.0 to ~1.2 notes/sec. Embedded
(local-mode) Qdrant holds an exclusive file lock and SQLite has its own write
lock, so parallel `/ingest` serialises behind them. Related symptom: importing
`lore.recall` in a second process while the backend is up raises a
`portalocker` error — the lock is cross-process.

**Product consequence:** a town onboarding thousands of documents cannot be sped
up by threading the embedded lane. That is the server-Qdrant/Postgres lane's job,
and the board should say so.

## 4. Loss accounting proved its worth on a catastrophic run

When the backend died 36 notes into a 5,882-note ingest, the harness reported:

    ingested 36 (failed 5846) · gold refs 1434, missing 1418
    unwinnable questions 1954 · store probe: 16 sampled, 16 absent
    recall@1/5/10 = 0.000, n=0

It refused to score the 36 surviving notes and call that a recall number. A
harness that skipped failed questions instead of counting them would have
reported a *high* recall over a handful of documents. **Losses in the same
output as the metric is the property that makes a number trustworthy** — more
than provenance, which only tells you what produced a number, not whether the
denominator is intact.

## 5. Ranking multipliers launder the penalty they're supposed to apply

`recall.py::_apply_note_signals` multiplies seven signals. Supersession was
`×0.80` — the second-weakest lever — against boosts of up to `×1.60` (tags),
`×1.20` (recency), `×1.15` (entity), `×1.10` (importance). Two matched tags
alone repay the supersession penalty; the full stack put a **repealed** ordinance
at 0.70 against 0.50 for the current one that replaced it.

Fix: apply supersession **last**, and **clamp instead of scale** —
`f = min(f, base) * superseded_weight`, where `base` is the pre-signal score.
Boosts can then never lift a superseded note past an equally-relevant current
one. Lowering the weight alone does not work: any two boosts defeat any weight.

**The generalisable question:** in a multiplicative scoring stack, for every
penalty ask *what is the largest product of boosts that can cancel it?* If that
product exceeds the penalty, the penalty is decorative.

**How it hid:** the existing test compared superseded vs current with every
other signal equal — the one configuration where ×0.80 always wins. A penalty
test that doesn't pit the penalty against the boosts tests nothing.

## 6. A metric can hide a whole class of defect

`recall@k` scores a question a HIT when the gold *turn id* is retrieved,
regardless of whether the stored text under that id contains the answer. LoCoMo
turns carry a `blip_caption` for shared photos that the ingest dropped; 86 of 250
sampled questions had all their gold evidence in such turns, and every one still
counted as a retrieval hit.

Running end-to-end QA against the same corpus is what exposed it. Measured cost
of the dropped captions: ~8 points on the affected third, ~3 points overall —
smaller than first projected, but invisible to recall by construction.
