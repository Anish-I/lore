# Classify Role Axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated `role` field (`correspondence` / `solicitation` / `bulk`) to lore's auto-classification contract so bulk/solicitation mail is separable from real correspondence, and prove it on the Ellington 494-email eval.

**Architecture:** All contract changes live in `core/lore/classify.py` (prompt, parser, store). The role rides the existing `note_tags` table as `kind='role'` rows — no DDL. The session eval harness is promoted into `eval/scenarios/` and extended to score roles; a full re-run of the 494-email corpus is the acceptance gate.

**Tech Stack:** Python (lore core), pytest (sqlite lane via conftest), codex CLI as the classify LLM provider for the acceptance run.

**Spec:** `docs/superpowers/specs/2026-07-27-classify-role-axis-design.md`

## Global Constraints

- No schema DDL; `note_tags.kind` is free text, unique `(tenant_id, note_id, tag, kind)` already exists.
- Role values: exactly `correspondence`, `solicitation`, `bulk`. Normalized `strip().lower()`, validated; missing/invalid → `None`, never inferred.
- The deterministic fallback path never emits a role.
- A malformed role never blocks storage of the item's tags/topic.
- No changes to `_BATCH_SIZE` (8), `_RUN_CAP` (80), `_BODY_CHARS` (500), or topic registry/vocabulary mechanics.
- No backfill of already-classified notes; no consumer wiring.
- Acceptance run: fresh sqlite DB, provider `codex` CLI at `LORE_CODEX_EFFORT=low`.
- Run tests from `core/` (`python -m pytest`); conftest gives the sqlite + fake-model lane automatically.

---

### Task 1: Role contract in classify.py (TDD)

**Files:**
- Modify: `core/lore/classify.py` (`_classify_prompt`, `parse_classification`, `_store`, `classify_untagged`; new module constant `_ROLES`)
- Test: `core/tests/test_classify_role.py` (new)

**Interfaces:**
- Consumes: existing `classify_untagged(conn, tenant, llm_call=None, scope=None, limit=80)`, `_store(conn, tenant, note_id, tags, topic, source)`.
- Produces: `parse_classification` items gain key `"role": str|None`; `_store` gains keyword param `role=None`; role persisted as `note_tags` row `(kind='role', tag=<role>, source=<source>)`. Task 2's scorer reads `kind='role'` rows.

- [ ] **Step 1: Write the failing tests**

Create `core/tests/test_classify_role.py`:

```python
"""Role axis (2026-07-27 spec): classify emits correspondence|solicitation|bulk."""
from lore import db
from lore.classify import _classify_prompt, classify_untagged, parse_classification


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _insert_note(conn, tenant, nid, title, body):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, title, body, updated_at)
           values(%s,%s,'me','private',%s,%s,now()) on conflict (id) do nothing""",
        (nid, tenant, title, body))


def _role_rows(conn, tenant):
    return conn.execute(
        "select note_id, tag, source from note_tags "
        "where tenant_id=%s and kind='role' order by note_id", (tenant,)).fetchall()


def test_prompt_carries_role_contract():
    p = _classify_prompt([(0, "t", "text")], [])
    for needle in ("correspondence", "solicitation", "bulk", "Omit role"):
        assert needle in p


def test_parse_role_valid_normalized():
    out = parse_classification('[{"id":0,"tags":["a"],"topic":"T","role":" Bulk "}]')
    assert out[0]["role"] == "bulk"


def test_parse_role_invalid_or_missing_is_none_and_keeps_tags():
    out = parse_classification(
        '[{"id":0,"tags":["a"],"topic":"T","role":"advertisement"},'
        '{"id":1,"tags":["b"],"topic":"U"}]')
    assert out[0]["role"] is None and out[0]["tags"] == ["a"]
    assert out[1]["role"] is None and out[1]["tags"] == ["b"]


def test_classify_untagged_stores_role_rows_only_for_roled_items():
    tenant = "role-e2e"
    conn = _conn()
    for i in range(3):
        _insert_note(conn, tenant, f"r-{i}", f"mail {i}", f"body {i}")

    def stub_llm(prompt):
        return ('[{"id":0,"tags":["t"],"topic":"Desk","role":"solicitation"},'
                '{"id":1,"tags":["t"],"topic":"Desk","role":"nonsense"},'
                '{"id":2,"tags":["t"],"topic":"Desk"}]')

    stats = classify_untagged(conn, tenant, llm_call=stub_llm)
    assert stats["llmTagged"] == 3
    assert _role_rows(conn, tenant) == [("r-0", "solicitation", "llm")]


def test_second_run_never_adds_second_role():
    tenant = "role-invariant"
    conn = _conn()
    _insert_note(conn, tenant, "inv-0", "mail", "body")
    calls = []

    def stub_llm(prompt):
        calls.append(prompt)
        role = "bulk" if len(calls) == 1 else "solicitation"
        return f'[{{"id":0,"tags":["t"],"topic":"Desk","role":"{role}"}}]'

    classify_untagged(conn, tenant, llm_call=stub_llm)
    classify_untagged(conn, tenant, llm_call=stub_llm)
    assert _role_rows(conn, tenant) == [("inv-0", "bulk", "llm")]
    assert len(calls) == 1          # second run selected nothing


def test_fallback_stores_no_role():
    tenant = "role-fb"
    conn = _conn()
    _insert_note(conn, tenant, "fb-0", "note", "text with #hashtag inside")
    stats = classify_untagged(conn, tenant, llm_call=lambda p: "garbage not json")
    assert stats["fallbackTagged"] == 1
    assert _role_rows(conn, tenant) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `core/`): `python -m pytest tests/test_classify_role.py -v`
Expected: `test_prompt_carries_role_contract`, `test_parse_role_valid_normalized`, `test_parse_role_invalid_or_missing_is_none_and_keeps_tags` (KeyError `'role'`), and the store tests FAIL; only failures, no errors about imports.

- [ ] **Step 3: Implement the contract in classify.py**

Add near the other module constants (after `_MAX_TAGS = 6`):

```python
_ROLES = ("correspondence", "solicitation", "bulk")
```

Replace the `return (...)` block of `_classify_prompt` with:

```python
    return (
        "You classify notes in a personal knowledge base.\n"
        f"{vocab_block}"
        f"{notes_block}\n\n"
        "For EACH note return 1-5 short lowercase tags and ONE durable topic name "
        "(a project/subject the note belongs to, 1-4 words, title case).\n"
        "When the note is a message (email/DM), also return its role:\n"
        '  "correspondence" - a specific person wrote it to/with the owner about the '
        "owner's matters (the owner's own sent mail counts; a human reply inside an "
        "ongoing thread counts even if the thread began as a pitch);\n"
        '  "solicitation" - unsolicited selling or pitching (vendor demos, cold '
        "outreach, promotional offers);\n"
        '  "bulk" - automated or mass-distributed mail (newsletters, digests, alerts, '
        "receipts, association blasts).\n"
        "Omit role when the note is not a message.\n"
        'Reply with a STRICT JSON array only - no prose, no markdown fences. Each item: '
        '{"id":<note number>,"tags":["tag1","tag2"],"topic":"Topic Name",'
        '"role":"correspondence|solicitation|bulk"}'
    )
```

In `parse_classification`, replace the `out[idx] = {...}` line with:

```python
        role = str(it.get("role") or "").strip().lower()
        out[idx] = {"tags": tags[:_MAX_TAGS], "topic": topic, "is_new": is_new,
                    "role": role if role in _ROLES else None}
```

Change `_store`'s signature and body:

```python
def _store(conn, tenant: str, note_id: str, tags: list, topic, source: str,
           role: str = None) -> None:
```

and append at the end of `_store` (after the topic insert):

```python
    if role:
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'role',%s) on conflict do nothing",
            (note_id, tenant, role, source))
```

In `classify_untagged`, change the LLM-path store call to:

```python
                _store(conn, tenant, nid, res["tags"], res["topic"], "llm",
                       role=res.get("role"))
```

(The fallback-path `_store` call stays exactly as it is — no role argument.)

- [ ] **Step 4: Run the new tests, then the neighbors**

Run: `python -m pytest tests/test_classify_role.py -v`
Expected: 6 PASS.
Run: `python -m pytest tests/test_dump_onboarding.py tests/test_upkeep.py -q`
Expected: all PASS (contract addition is backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add core/lore/classify.py core/tests/test_classify_role.py
git commit -m "feat(classify): role axis - correspondence/solicitation/bulk in the LLM contract"
```

---

### Task 2: Promote the inbox eval harness into eval/scenarios/ with role scoring

**Files:**
- Create: `eval/scenarios/inbox_ellington_494.json` (copy of the extracted corpus, `scratchpad/emails.json` from the 2026-07-27 session — 494 emails with `tags`+`thread` ground truth; if the scratchpad is gone, re-extract from the Downloads HTML per the scorer's docstring)
- Create: `eval/scenarios/run_inbox_tagging.py`
- Create: `eval/scenarios/score_inbox_tagging.py`

**Interfaces:**
- Consumes: Task 1's `note_tags` rows `kind='role'`; `classify_untagged`, `resolve_llm_call`.
- Produces: `run_inbox_tagging.py --db <path> [--corpus <json>] [--smoke]` populates a fresh sqlite lore DB; `score_inbox_tagging.py --db <path> [--corpus <json>]` prints metrics and per-gate PASS/FAIL lines, exit code 1 if any gate fails, and handles role-less baseline DBs (role coverage 0, role gates reported SKIP).

- [ ] **Step 1: Write run_inbox_tagging.py**

```python
"""Ingest the Ellington inbox corpus into a fresh lore DB and classify it.

Usage (from repo root):
    python eval/scenarios/run_inbox_tagging.py --db /tmp/inbox-eval.db [--smoke]

Sets DATABASE_URL to the --db sqlite path BEFORE importing lore, so it can
never touch a live store. Provider: LORE_LLM_PROVIDER (default codex, low
effort). The corpus JSON ships beside this script.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="sqlite db file (created fresh)")
    ap.add_argument("--corpus", default=os.path.join(HERE, "inbox_ellington_494.json"))
    ap.add_argument("--smoke", action="store_true", help="classify one batch of 8 only")
    args = ap.parse_args()

    if os.path.exists(args.db):
        sys.exit(f"refusing to reuse existing db {args.db} - delete it first")
    os.environ["DATABASE_URL"] = "sqlite:///" + args.db.replace("\\", "/")
    os.environ.setdefault("LORE_LLM_PROVIDER", "codex")
    os.environ.setdefault("LORE_CODEX_EFFORT", "low")
    sys.path.insert(0, os.path.join(HERE, "..", "..", "core"))

    from lore import db
    from lore.classify import classify_untagged
    from lore.llm_providers import resolve_llm_call

    tenant = "ellington-eval"
    emails = json.load(open(args.corpus, encoding="utf-8"))
    conn = db.connect()
    db.bootstrap_schema(conn)

    for i, e in enumerate(emails):
        to = ", ".join(f"{p.get('name','')} <{p.get('addr','')}>" for p in e.get("to", []))
        cc = ", ".join(f"{p.get('name','')} <{p.get('addr','')}>" for p in e.get("cc", []))
        frm = f"{e['from'].get('name','')} <{e['from'].get('addr','')}>"
        head = [f"From: {frm}", f"To: {to}"]
        if cc:
            head.append(f"Cc: {cc}")
        head.append(f"Date: {e.get('date','')}")
        if e.get("attachment"):
            head.append(f"Attachment: {e['attachment']}")
        body = "\n".join(head) + "\n\n" + (e.get("body") or "")
        # updated_at from the email date (+minute tiebreak): classify orders
        # newest-first like a real dump onboard, not by id prefix (which would
        # group ground-truth classes into homogeneous batches).
        ts = f"{e['date']} 12:{i % 60:02d}:{i // 60:02d}"
        conn.execute(
            """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                                 source_type, updated_at)
               values(%s,%s,'me','private',%s,%s,'email',%s)
               on conflict (id) do nothing""",
            (e["id"], tenant, e.get("subject") or "(no subject)", body, ts))
    print(f"ingested {len(emails)} emails", flush=True)

    llm = resolve_llm_call(os.environ["LORE_LLM_PROVIDER"])
    if args.smoke:
        print(classify_untagged(conn, tenant, llm_call=llm, limit=8), flush=True)
        conn.close()
        return

    for run in range(1, 12):
        remaining = conn.execute(
            "select count(*) from notes n where n.tenant_id=%s and not exists "
            "(select 1 from note_tags t where t.note_id=n.id and t.tenant_id=%s)",
            (tenant, tenant)).fetchone()[0]
        if remaining == 0:
            break
        t0 = time.time()
        stats = classify_untagged(conn, tenant, llm_call=llm)
        print(f"run {run}: {remaining} remained, {stats} in {time.time()-t0:.0f}s",
              flush=True)
    conn.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write score_inbox_tagging.py**

```python
"""Score lore's inbox tagging vs the Ellington ground truth (topics + roles).

Usage: python eval/scenarios/score_inbox_tagging.py --db /tmp/inbox-eval.db

Gates (spec 2026-07-27-classify-role-axis-design.md):
  G1 SPAM recall by solicitation|bulk        >= 0.85
  G2 non-SPAM emails roled solicitation      <= 5%
  G3 human mail (Context/Search/Exhibit*) roled correspondence >= 90%
  G4 distinct topics                         <= 40
  G5 topic->class purity                     >= 0.75
Role gates report SKIP when the DB predates the role axis (coverage 0).
Exit 1 if any evaluated gate fails.

Corpus provenance: extracted from "[2026.07.27]-lore-test-inbox-500-v1.html"
(const EMAILS array; double-encoded UTF-8 repaired via cp1252->utf-8 round-trip).
"""
import argparse
import json
import math
import os
import sqlite3
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TENANT = "ellington-eval"
HUMAN = ("Context", "Search", "Exhibit 1", "Exhibit 2", "Exhibit 3")


def nmi(a, b):
    ids = sorted(set(a) & set(b))
    n = len(ids)
    if not n:
        return 0.0
    ca, cb, cab = Counter(), Counter(), Counter()
    for i in ids:
        ca[a[i]] += 1
        cb[b[i]] += 1
        cab[(a[i], b[i])] += 1
    mi = sum((c / n) * math.log((c * n) / (ca[x] * cb[y]))
             for (x, y), c in cab.items())
    ha = -sum((c / n) * math.log(c / n) for c in ca.values())
    hb = -sum((c / n) * math.log(c / n) for c in cb.values())
    d = math.sqrt(ha * hb)
    return mi / d if d else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--corpus", default=os.path.join(HERE, "inbox_ellington_494.json"))
    args = ap.parse_args()

    emails = {e["id"]: e for e in json.load(open(args.corpus, encoding="utf-8"))}
    dbc = sqlite3.connect(args.db)
    topic, role = {}, {}
    for nid, kind, tag in dbc.execute(
            "select note_id, kind, tag from note_tags where tenant_id=?", (TENANT,)):
        if kind == "topic":
            topic[nid] = tag
        elif kind == "role":
            role[nid] = tag

    ids = [i for i in emails if i in topic]
    print(f"emails {len(emails)}  topics assigned {len(ids)}  roles assigned "
          f"{sum(1 for i in ids if i in role)}")

    klass = {i: "+".join(sorted(emails[i]["tags"])) for i in ids}
    thread = {i: emails[i]["thread"] for i in ids}
    tcount = Counter(topic[i] for i in ids)
    groups = defaultdict(list)
    for i in ids:
        groups[topic[i]].append(i)
    purity = sum(Counter(klass[i] for i in m).most_common(1)[0][1]
                 for m in groups.values()) / len(ids)
    print(f"distinct topics {len(tcount)}  purity {purity:.3f}  "
          f"nmi/class {nmi(topic, klass):.3f}  nmi/thread {nmi(topic, thread):.3f}")

    results = []
    have_roles = any(i in role for i in ids)
    if have_roles:
        spam = [i for i in ids if "SPAM" in emails[i]["tags"]]
        nonspam = [i for i in ids if "SPAM" not in emails[i]["tags"]]
        human = [i for i in ids
                 if any(t in HUMAN for t in emails[i]["tags"])
                 and "SPAM" not in emails[i]["tags"]]
        g1 = sum(1 for i in spam if role.get(i) in ("solicitation", "bulk")) / len(spam)
        g2 = sum(1 for i in nonspam if role.get(i) == "solicitation") / len(nonspam)
        g3 = sum(1 for i in human if role.get(i) == "correspondence") / len(human)
        rd = Counter(role.get(i, "(none)") for i in ids)
        print(f"role distribution: {dict(rd)}")
        results += [("G1 spam recall by solicitation|bulk >= 0.85", g1, g1 >= 0.85),
                    ("G2 non-spam roled solicitation <= 0.05", g2, g2 <= 0.05),
                    ("G3 human mail roled correspondence >= 0.90", g3, g3 >= 0.90)]
    else:
        print("no role rows - role gates SKIP (baseline DB)")
    results += [("G4 distinct topics <= 40", len(tcount), len(tcount) <= 40),
                ("G5 purity >= 0.75", purity, purity >= 0.75)]

    ok = True
    for name, val, passed in results:
        ok &= passed
        print(f"{'PASS' if passed else 'FAIL'}  {name}  (got {val if isinstance(val, int) else f'{val:.3f}'})")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Copy the corpus JSON beside the scripts**

```bash
cp "$SCRATCHPAD/emails.json" eval/scenarios/inbox_ellington_494.json
```

- [ ] **Step 4: Verify the scorer against the 2026-07-27 baseline DB (role-less)**

Run: `python eval/scenarios/score_inbox_tagging.py --db "$SCRATCHPAD/lore-inbox-eval.db"`
Expected: prints `no role rows - role gates SKIP`, `PASS G4` (30 topics), `PASS G5` (0.775), exit 0. This proves back-compat and pins the baseline numbers.

- [ ] **Step 5: Commit**

```bash
git add eval/scenarios/run_inbox_tagging.py eval/scenarios/score_inbox_tagging.py eval/scenarios/inbox_ellington_494.json
git commit -m "eval(inbox): promote Ellington tagging harness with role gates"
```

---

### Task 3: Acceptance run + artifact

**Files:**
- Create: `eval/history/inbox-tagging-ellington-494-roles-2026-07-27.json` (results artifact)
- Modify: `.learnings/2026-07-27-inbox-tagging-eval.md` (append outcome line)

**Interfaces:**
- Consumes: Task 1 contract + Task 2 scripts.
- Produces: pass/fail verdict against the five gates; committed artifact.

- [ ] **Step 1: Smoke one batch with the new prompt**

Run: `python eval/scenarios/run_inbox_tagging.py --db <scratch>/inbox-roles.db --smoke` then delete the DB.
Expected: `llmTagged: 8`; inspect stdout of a follow-up scorer run or the DB for `kind='role'` rows on most of the 8 (emails are messages, so roles should be present).

- [ ] **Step 2: Full run (background, ~25 min, ~62 codex calls)**

Run: `python eval/scenarios/run_inbox_tagging.py --db <scratch>/inbox-roles.db`
Expected: 7 runs, `fallbackTagged` 0 throughout.

- [ ] **Step 3: Score and check gates**

Run: `python eval/scenarios/score_inbox_tagging.py --db <scratch>/inbox-roles.db`
Expected: G1-G5 all PASS, exit 0.
If a role gate fails: one prompt-wording iteration is in scope (tighten the failing boundary's definition line in `_classify_prompt`, rerun). More than one failed iteration → stop and report findings; do not chase thresholds by weakening gates.

- [ ] **Step 4: Write the results artifact**

Create `eval/history/inbox-tagging-ellington-494-roles-2026-07-27.json` mirroring the baseline artifact's shape (`inbox-tagging-ellington-494-2026-07-27.json`) with: harness pointer to `eval/scenarios/`, the five gate values, role distribution, spam-recall delta vs the 0.543 tag-token baseline, and topic metrics vs the baseline run. Append one outcome line to `.learnings/2026-07-27-inbox-tagging-eval.md` (§1) noting the role-axis result.

- [ ] **Step 5: Commit**

```bash
git add eval/history/inbox-tagging-ellington-494-roles-2026-07-27.json .learnings/2026-07-27-inbox-tagging-eval.md
git commit -m "eval(inbox): role-axis acceptance run - gates + artifact"
```
