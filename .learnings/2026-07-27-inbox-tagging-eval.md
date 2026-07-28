# Learnings: Ellington inbox tagging eval (2026-07-27)

1. **classify.py has no role axis, and that's the measured gap.** On a 494-email
   synthetic clerk inbox, topic clustering is decision-grade (30 topics,
   purity 0.775, thread-pair recall 0.866) but 50% of ground-truth SPAM files
   into real work topics because the prompt only asks for topic+tags. The
   misses are *gray bulk mail* (association digests, certification/conference
   blasts, vendor pilots) whose vocabulary IS the tenant's domain vocabulary —
   token-level spam detection over freeform tags caps at R≈0.54. If junk
   handling matters, it needs an explicit `role` field in the JSON contract or
   a steering line in `_classify_prompt`, not post-hoc tag matching.
   Artifact: eval/history/inbox-tagging-ellington-494-2026-07-27.json.
   **Outcome (2026-07-28):** role field shipped (spec 2026-07-27); acceptance
   rerun closed the gap completely — SPAM recall 1.000 via solicitation∪bulk,
   0 false solicitations, correspondence 0.965 — at a small in-gate topic
   cost (30→40 topics, purity 0.775→0.753). The longer contract diffuses
   topic naming slightly; G4/G5 sit exactly at their limits.

2. **The C2 registry holds at ~500 notes but splits synonyms.** Zero slug-level
   duplicates across 62 batches (vocab reload every batch works), yet the same
   matter still lands in two semantically-distinct names ("Somers Road Solar"
   / "Solar Development" — 71+20 emails). Slug canonicalization can't see
   synonymy; that's topic_merge.py's job downstream, and evals scoring
   "1 matter = 1 topic" must run it or count the split as expected.

3. **Email eval harness pattern that works:** parse corpus → notes with
   `updated_at = email date` (+minute tiebreak). classify_untagged orders by
   updated_at DESC, so synthetic corpora with class-prefixed ids (spm-, ctx-)
   would otherwise classify in id order = grouped by ground-truth class,
   quietly making batches homogeneous and flattering the numbers.

4. **Double-encoded UTF-8 in browser-saved HTML corpora:** the Ellington file
   had "â€""-style mojibake baked in; round-tripping each string through
   `s.encode('cp1252').decode('utf-8')` (per-string try/except, deep-walk the
   JSON) repaired all 494 emails with zero residue.

5. **`node tool | head` masks the tool's exit code** — the background task
   reported exit 0 while kimi.mjs had died with exit 2 ("fetch failed" was the
   only output). Same class of bug as the `pytest | tail` entry from 07-24:
   never let a pipe stage own the exit code of the thing you're monitoring.
