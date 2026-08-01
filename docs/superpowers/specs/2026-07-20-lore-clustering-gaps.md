# Lore Clustering (Sections/Topics) — Gap Analysis (Claude ⇄ Sol, 2026-07-20)

**Status:** Analysis — no code changes. Companion to
`2026-07-20-lore-recall-ceiling-gaps.md`; same discipline (bottleneck evidence →
smallest model-agnostic fill → executable gate → reversible).
**Authors:** Claude (Fable 5) code audit + literature sweep; Sol (Codex) independent
analysis with verified anchors (task `codex-1784572998-b0f5`); merged by Claude;
Sol round-2 review incorporated (task `codex-1784573349-c931`) — TaxoAdapt wording,
re-open support floor, C6 priority rationale, no-rewrite invariant, C7 phrasing.

## What "clustering" actually is today

**It is not clustering — it is open-vocabulary single-label classification followed
by exact string equality** (Sol's phrasing; code-verified):

1. `classify.py` — per-note LLM batch call (8 notes/call, 500 chars each, cap 80/run)
   returns `{tags, topic}`; fallback = frontmatter → #hashtags → **first wikilink** as
   topic. One topic per note. No confidence. No abstention. Malformed JSON silently
   drops to heuristics. **The prompt never sees the existing topic vocabulary** —
   every batch invents names independently.
2. `sections.py` — groups by **exact slug equality** of topic strings; ≥5 notes
   (`DEFAULT_THRESHOLD`, magic) → proposal → user applies (desktop moves files,
   undo recorded) → optional Personal Wizard promotion. Dismissals are sticky forever.
3. `upkeep.py` — a **third independent topic namer**: folds date/session notes into
   topic notes via a wikilink/title vocab + regex matching (≤5 topics/note).
4. `autofile.py` (opt-in) — tag-slug overlap score files "unambiguous" notes into
   applied sections.

Three writers of topic names (classify-LLM, upkeep-vocab, wikilink-fallback), **no
shared canonical registry**, grouping by string equality. Meanwhile the two strongest
signals in the store — **Qdrant embeddings for every chunk and the Postgres
entity/person edge graph — are never consulted** for grouping.

What's genuinely good and must be preserved: backend never touches files; everything
is proposals-only with undo; user-owned state; sticky dismissal as a UX default.

## Verdict

Sol: *"For discovery, that is the wrong order. The literature pattern is
overwhelmingly cluster-first, label-second (BERTopic, Top2Vec, HDBSCAN-lineage,
LLM-assisted clustering). Can the current design be saved? Yes — as an incremental
assignment/autofile layer, not as the main discovery engine."* Claude concurs, with
one caveat in favor of the current shape: raw HDBSCAN on short multi-domain text
classifies a majority of documents as outliers (arxiv:2212.08459), so the cluster-first
lane must be introduced as a **shadow path judged by org metrics**, not a rewrite.

Root failure mode: **topic fragmentation**. "Kalshi Bot" / "Kalshi Trading Bot" /
"KalshiBot" → three slugs, none reaching threshold 5, though one subject has 9+ notes.
Nobody can currently measure how often this happens (backend was down today; no org
eval exists) — which is itself hole #1.

## Tier C0 — Measurement (blocks everything; mirrors recall-doc G1)

### C1. No organization-quality eval; online signals already exist, unused
- **Evidence:** `eval/` covers recall/outcomes/state/LoCoMo — nothing for
  tags/topics/sections. `section_proposals.status` (proposed/applied/dismissed) +
  undo transitions are a free online metric nobody computes.
- **Literature:** cluster eval needs external metrics — purity biased toward many
  clusters; use NMI/ARI/pairwise F1 (IR-Book ch.16 canon); human interpretability
  is its own axis (Chang et al., NeurIPS 2009 "Reading Tea Leaves"); V-measure
  separates homogeneity vs completeness (Rosenberg & Hirschberg 2007).
- **Fill:** `lore org-eval`: (a) online — acceptance rate, dismissal rate, undo rate,
  parse-failure rate, source breakdown (llm/heuristic), fragmentation index
  (near-duplicate topic slugs by embedding similarity of topic centroids);
  (b) offline — small hand-labeled pairwise gold set (same-section? yes/no) →
  pairwise P/R/F1 + ARI/NMI.
- **Gate:** no clustering change ships unless online acceptance holds-or-improves,
  undo ≤ baseline, and pairwise F1/NMI improves on gold. (Sol's rank-1, verbatim.)

## Tier C1 — Stop the bleeding (fragmentation)

### C2. Canonical topic vocabulary + aliases; classifier chooses, not invents
- **Evidence:** batch isolation + exact-slug grouping (above). Root cause of
  fragmentation.
- **Literature:** TnT-LLM two-phase taxonomy-then-assignment (arxiv:2403.12173);
  EvoTaxo — each item becomes a **draft action over the CURRENT taxonomy** rather
  than a free-text label (arxiv:2603.19711); taxonomy induction lineage
  (Hearst-pattern → neural, ACL D17-1123).
- **Fill:** canonical `topics` registry + alias table (user-visible, ADD-only).
  `classify.py` prompt gains the existing canonical topic list (or its nearest-K by
  embedding for long vocabularies); model must pick an existing topic ID or emit
  `new_topic` — new names enter as **proposals**, not facts. Upkeep's vocab matcher
  reads the same registry.
- **Gate:** duplicate-topic proposal rate −70%; fragmentation index −50%; acceptance
  not worse. (Sol's numbers.)

### C3. Confidence + abstention on classification
- **Evidence:** malformed LLM JSON silently falls back; first-wikilink-as-topic is
  arbitrary; no `confidence` column anywhere; low-confidence notes count toward
  section thresholds same as high.
- **Literature:** short-text clustering fragility (Murshed et al. survey; UMB
  dissertation on short-text semantic representation); selective prediction canon.
- **Fill:** store `confidence`, `source`, `parse_error`, `abstain` on note_tags;
  abstained/low-confidence notes don't count toward thresholds; one strict-schema
  retry for malformed batches.
- **Gate:** parse failures visible and <1%; acceptance of low-confidence proposals
  measurably lower (proves the filter earns its keep).

## Tier C2 — Use the signals the store already has

### C4. Embedding + entity merge proposals (the fragmentation repair loop)
- **Evidence:** embeddings + entity graph unused; semantically identical topics
  invisible to slug equality.
- **Literature:** BERTopic/Top2Vec cluster semantic vectors then label
  (arxiv:2203.05794, arxiv:2008.09470); StreamETM merges topic models across batches
  via optimal transport (arxiv:2504.07711); heterogeneous-network clustering — entity
  structure improves topical grouping and blocks false merges (Wang et al., topical
  hierarchies in HINs).
- **Fill:** offline upkeep pass: topic centroid = mean of member-note embeddings;
  propose alias-merge when cosine + entity-overlap + token overlap clear a threshold;
  entity DISAGREEMENT blocks risky merges (two projects can be semantically near).
  Proposals-only; user accepts; ADD-only alias table.
- **Gate:** merge-proposal acceptance ≥80%, false-merge (undo/dismiss) ≤5%,
  fragmentation index drops.

### C5. Threshold 5 → proposal score; sticky dismissal → signature-based re-open
- **Evidence:** one global magic threshold ignores density/age/confidence/history;
  dismissed topics never return even if membership doubles.
- **Literature:** internal validity (silhouette, Rousseeuw 1987) paired with
  external/user metrics; stream clustering treats evolving structure as first-class —
  CluStream (Aggarwal 2003), DenStream (Cao 2006); **verified PhD:** Zubaroğlu 2023
  (METU) online clustering of evolving streams; TaxoAdapt adaptive expansion/
  restructuring for evolving corpora (arxiv:2506.10737 — supports width/depth
  adaptation; do not cite it for a literal merge/split operation).
- **Fill:** proposal score = size + embedding density + source confidence +
  folder/topic evidence (UI knob stays as override). Dismissed proposals re-open only
  on material membership change: **Jaccard <0.6 vs the dismissed set AND a support
  floor (Δ≥3 new notes or union ≥8)** — below the floor, mark "watch", don't
  re-propose (Sol round-2: size-doubling alone is redundant with the Jaccard test).
  Versioned assignments, ADD-only.
- **Gate:** acceptance monotonic by score decile; resurrected-proposal acceptance
  ≥ normal −10pts; no dismiss-spam increase.

### C6. Wizard membership drift
- **Evidence:** `sections.wizard_members` = folder-prefix ∪ recorded note_ids —
  a note tagged with the topic AFTER promotion never joins its wizard unless
  physically filed. This is a **user-visible recall failure** (wizard answers miss
  the user's newest notes on exactly its topic) and it contaminates any later
  RAG-quality evaluation — do it before the Tier-C3 discovery work (Sol round-2).
- **Fill:** union in current topic-tag membership (slug match via canonical registry)
  for RAG membership only (file moves stay autofile/user-driven).
- **Gate:** wizard coverage (member count vs topic-tagged count) ↑; autofile undo flat.

## Tier C3 — The discovery engine (shadow first)

### C7. Cluster-first, name-second shadow lane
- **Evidence:** a 1–4-word generated name is a lossy cluster key from 500 chars and
  isolated batches (Sol's structural critique — the core inversion).
- **Literature:** BERTopic (arxiv:2203.05794); HDBSCAN lineage (Campello/Moulavi/
  Sander 2013); LLM-assisted clustering with constraints (Viswanathan et al.,
  TACL 2024); topic labeling as its own task (Mei/Shen/Zhai KDD 2007; **verified
  PhD:** Alokaili 2021, Sheffield, topic representation/labeling); CobwebTM lifelong
  hierarchical concept formation (arxiv:2604.14489). Caveat: HDBSCAN outlier-floods
  short multi-domain text (arxiv:2212.08459) → prefer kNN-graph communities over
  existing Qdrant vectors at vault scale.
- **Fill:** shadow proposal generator: Qdrant kNN graph → connected components /
  thresholded communities → name AFTER membership from representative notes + top
  entities (LLM labels with evidence attached). Runs alongside label-first; both feed
  the same proposal UI; org metrics decide which engine wins. Promotion is itself a
  **candidate replacement proposal** the user accepts (with undo) — never a silent
  swap of the discovery engine (Sol round-2).
- **Gate:** accepted proposals per 100 notes ≥ label-first +20%, undo ≤ baseline.
  UNMEASURABLE until C1 ships.

### C8. Multi-label membership (primary + secondaries)
- **Evidence:** one topic per note forces project/person/tool notes into one bucket;
  homogeneity-vs-completeness tradeoff invisible without C1.
- **Literature:** V-measure's homogeneity/completeness split; multi-label text
  clustering need is standard.
- **Fill:** primary topic (may trigger file move) + ≤2 secondary topics (feed wizard
  membership + retrieval signals only).
- **Gate:** wizard/search coverage ↑ without autofile-undo ↑.

### C9. Evidence-backed labels
- **Evidence:** user sees a name, not why notes belong together; rename/edit behavior
  untracked.
- **Fill:** store per-proposal evidence: representative notes, top entities, top terms,
  nearest existing topics. Label generated only after membership is known.
- **Gate:** rename/edit rate <25%; acceptance ↑.

## Unmeasurable today (Sol, verbatim)
Purity, NMI/ARI, fragmentation, split/merge quality, threshold optimality,
multi-label value, drift handling — all blocked on C1. Acceptance/dismiss/undo can
start immediately from existing rows, but they're product metrics, not a clustering
benchmark. Live fragmentation counts couldn't be sized today (backend down).

## Recommended sequence
1. **C1** org metrics + small pairwise gold set (everything else is opinion until then).
2. **C2** canonical vocabulary + aliases → **C3** confidence/abstain (both cheap,
   both attack fragmentation at the source).
3. **C4** embedding/entity merge proposals → **C5** score-based proposals +
   dismissal re-open → **C6** wizard membership union.
4. **C7** shadow cluster-first lane; replace label-first discovery only if metrics
   say so → **C8/C9**.

Invariants throughout: proposals-only, user applies, undo recorded, ADD-only tables,
no heavy new runtime, backend never moves files.
**Amended 2026-07-20 (Anish's product decision):** sections now AUTO-APPLY by default
(`cfg.autoApplySections`, default on; toggle in Settings → Tidy up & auto-organize).
"User applies" is the OFF position of that toggle, not a standing invariant. Two
guards keep auto mode sane: all moves still run in the desktop under pathGuard
(backend still never touches files), and **undo in auto mode lands the section in
'dismissed'** (sticky) — otherwise the next upkeep run would re-apply the undone
section. Note: auto-apply raises the stakes on C2/C4 (fragmentation now creates
real duplicate folders, not just duplicate proposals) — the canonical-vocabulary
work moves up in practical urgency. **Plus (Sol round-2): the canonical
registry and upkeep's vocab folding must never rewrite existing wikilinks/tags in
user files or stored bodies — they add alias/canonical mappings that influence
future proposals and RAG membership only.**
