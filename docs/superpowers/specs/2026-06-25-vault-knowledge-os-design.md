# Vault — Knowledge-OS Walking Skeleton (Design Spec)

> **Status:** Draft for review · **Date:** 2026-06-25 · **Codename:** "Vault" (placeholder — rename)
> **Authors:** Anish + Claude (Opus 4.8), with adversarial review by Codex (GPT-5.5) and a field survey (Anthropic Contextual Retrieval, Jina Late Chunking, Karpathy KB pattern, RAGFlow, Glean).

## 1. Summary

Vault is an enterprise "knowledge OS" built on Obsidian-style Markdown vaults. A local agent watches each
employee's files, distills them into linked Markdown, and continuously indexes them into a permissioned,
recall-obsessed retrieval engine. Each person's vault becomes queryable knowledge; teams can ask across
multiple people's vaults within their permission scope.

This spec covers **only the walking skeleton** — the thinnest end-to-end vertical slice that proves the full
loop and produces a demoable "wow." It is deliberately narrow in breadth and complete in depth.

### The demo wow we are building toward

> *"Ask Alice's knowledge and Bob's knowledge what we know about the Acme renewal risk."*
> → a **cited** answer drawn from two living vaults, **respecting scopes**.

Permissioned, cross-person, cited recall into living vaults — not agent-to-agent choreography.

## 2. Goals / Non-Goals

### Goals (walking skeleton)
- Prove the loop: **Watch → Distill → Contextualize+Chunk → Index → Recall → /ask (cited) → enhance → repeat.**
- High-recall hybrid retrieval (dense + lexical + graph expansion + rerank) with citations.
- Minimal but real permissioning: `private / team / enterprise` scopes enforced **inside** retrieval.
- Two vaults + a shared team scope, enough to run the cross-person demo query.
- A reusable **recall eval harness** (recall@k) to measure the retrieval engine objectively.

### Non-Goals (explicitly deferred — YAGNI)
CDN publishing · billing/SaaS shell · agent-to-agent negotiation protocol · "acknowledge-dump" automation ·
multi-hop GraphRAG · custom "DAG embeddings" · full person→team→circle→enterprise org lattice ·
enterprise admin console · Obsidian UI clone · workflow automation · fine-tuning / per-person model weights.

## 3. Key Decisions (and why)

| Decision | Choice | Rationale / source |
|---|---|---|
| Vector store | **Qdrant** (retrieval) + **Postgres** (truth/ACL/graph) | Qdrant has native dense+sparse hybrid + RRF/DBSF fusion; avoids a later migration. Codex over Claude's pgvector. |
| Retrieval shape | Hybrid **dense + lexical(BM25)**, **RRF** fusion, **cross-encoder rerank** | Unanimous production consensus; 15–30% recall lift reported. |
| Graph role | **1–2 hop expansion + rerank signal**, NOT the primary index | Claude + Codex + Godsey/Glean field experience. "DAG embeddings" judged a red herring as a primary mechanism. |
| Chunking | **Contextual Retrieval (selective)** + parent summaries; **defer Late Chunking** | −49% failed retrievals (−67% w/ rerank); chunks stay independently addressable → localized re-index on edits; works with chosen Voyage embedder (Late Chunking would force an embedder swap). |
| Embeddings | **Voyage `voyage-4-large`** hosted · **BGE-M3** local fallback | Quality + data-residency path for enterprise. |
| Reranker | **Voyage `rerank-2.5`** · Cohere `rerank-v4` alt | Long-context, multilingual, instruction-following. |
| Ingestion parsers | **Docling / Marker / Zerox** (don't build) | Battle-tested PDF/DOCX/OCR→Markdown; faster to wow. |
| ACL enforcement | **Inside candidate generation**, never post-filter | Post-filtering silently destroys recall + leaks side channels. |

## 4. Architecture

Five components, each independently testable, communicating over well-defined interfaces.

```
┌─────────────┐   file change   ┌──────────────┐   clean .md    ┌──────────────────┐
│  Watcher    │ ───────────────>│  Distiller   │ ─────────────> │  Indexer         │
│ (local)     │                 │ (LLM + OCR)  │                │ (chunk+context+  │
└─────────────┘                 └──────────────┘                │  embed+upsert)   │
                                                                 └────────┬─────────┘
                                          ┌──────────────────────────────┘
                                          v                  writes
                              ┌────────────────────┐   ┌──────────────────────────┐
                              │ Qdrant (vectors,    │   │ Postgres (docs, chunks    │
                              │ dense+sparse, ACL   │   │ meta, ACL rows, graph     │
                              │ payload)            │   │ edges, tenants)           │
                              └─────────┬───────────┘   └────────────┬──────────────┘
                                        └──────────┬─────────────────┘
                                                   v
                                       ┌────────────────────────┐   question+principal
                                       │  Recall Engine          │ <────────────────────┐
                                       │ multi-lane → RRF →       │                      │
                                       │ graph-expand → rerank    │                ┌─────┴──────┐
                                       └───────────┬─────────────┘                 │  /ask API   │
                                                   └────────────────────────────── │ (cited,     │
                                                          8–15 cited chunks         │ scoped)     │
                                                                                    └─────────────┘
```

### 4.1 Watcher (local agent)
- **Does:** watch a folder tree; on create/modify/delete, enqueue an ingestion job for the changed file.
- **Input:** filesystem events (Windows-first; cross-platform later). **Output:** job `{path, event, owner, tenant}`.
- **Depends on:** a file-watch lib (e.g. `chokidar`/`watchdog`), the job queue.
- **Debounce:** coalesce rapid edits (e.g. 2s) so a burst of saves = one re-index.

### 4.2 Distiller
- **Does:** convert raw file → clean, linked Markdown with frontmatter.
  - Routing: `.md` passthrough; PDF/DOCX/PPTX → **Docling/MarkItDown**; images/scans → **Marker/Zerox** OCR;
    code → fenced blocks + summary.
  - LLM pass: extract entities, tags, `[[links]]`, and write/update frontmatter
    (`owner`, `scope`, `tags`, `aliases`, `links`, `source_path`, `updated_at`).
- **Output:** normalized `.md` note (the canonical artifact, viewable in Obsidian).
- **Depends on:** parser libs, distillation LLM, Postgres (note record).

### 4.3 Indexer
- **Does:** turn a note into retrievable, contextualized chunks.
  1. **AST parse** the Markdown (not regex). Chunk by heading tree + semantic blocks, **150–350 tokens** atomic.
  2. Build **parent summaries** (section-level + note-level).
  3. **Selective Contextual Retrieval:** for chunks that aren't self-contained, generate a 50–100 token
     situating blurb from note title/path + heading stack + parent summary + links; prepend to chunk text
     before embedding **and** before the sparse (Contextual BM25) index.
  4. Embed dense (Voyage) + sparse; **upsert to Qdrant** with payload
     `{tenant_id, owner, scope_ids, note_id, chunk_id, heading_path, links, updated_at}`.
  5. Write chunk/edge/graph rows to **Postgres** (source of truth).
- **Stable chunk IDs** so edits re-index locally and don't churn unrelated embeddings.
- **Homogenization guard:** constrain the context prompt to *situate, not summarize*; regenerate context only
  when the parent summary changes; keep the sparse lane so exact terms survive.

### 4.4 Recall Engine
- **Does:** answer `retrieve(query, principal)` → ranked, cited chunks.
  - **Multi-lane retrieve (~300 candidates):** dense vector; sparse/BM25; exact title/alias/entity; owner/recency.
  - **ACL filter inside each lane:** every lane filters by `tenant_id` + principal's allowed `scope_ids`.
  - **RRF fuse** → top ~150.
  - **Graph expand:** from top ~30 seeds, pull 1-hop neighbors (outbound links, backlinks, same-section, same-project);
    2-hop only for explicit "map/related/explain" queries; decay graph candidates unless dense/sparse agree.
  - **Rerank** (cross-encoder) → return **8–15** evidence chunks with provenance.
- **Output:** `[{chunk, note_id, score, why_retrieved}]`.

### 4.5 /ask API
- **Does:** `POST /ask {question, principal}` → scope-filtered, **cited** natural-language answer +
  the "why this was retrieved" evidence list.
- **Cross-person:** principal's scope set may span multiple owners (e.g. a team scope) → enables the demo query.

## 5. Data Model (Postgres, source of truth)

```
tenants(id, name)
principals(id, tenant_id, kind['user'|'team'], name)
scopes(id, tenant_id, kind['private'|'team'|'enterprise'], owner_principal_id NULL)
principal_scopes(principal_id, scope_id)         -- who can read what
notes(id, tenant_id, owner_principal_id, source_path, title, scope_id, updated_at)
chunks(id, note_id, heading_path, text, parent_summary_id NULL, has_context bool, updated_at)
edges(src_note_id, dst_note_id, kind['link'|'backlink'|'tag'|'same_section'])
ingest_jobs(id, tenant_id, path, event, status, error, created_at)
```

Qdrant payload mirrors the ACL-relevant subset (`tenant_id`, `owner`, `scope_ids`) so filtering happens in-engine.

## 6. Scopes / ACL (v1)

- Three scope kinds: `private` (owner only), `team` (members of a team principal), `enterprise` (all in tenant).
- Each note is assigned exactly one `scope_id` at distill time (default `private`; overridable via frontmatter).
- Retrieval resolves the principal's `principal_scopes` → allowed `scope_ids` → filters candidates **before** rerank.
- **No** full org lattice yet; three kinds are enough to prove permissioned cross-person recall.

## 7. Acceptance Criteria (definition of "wow")

1. Drop a PDF + a Markdown note into Alice's watched folder → within seconds they appear as linked `.md` notes
   in her Obsidian-viewable vault, indexed.
2. `POST /ask` as Alice (private scope) returns a cited answer from her own notes; the citation opens the note.
3. Seed Bob's vault + a shared `team` scope. `POST /ask` as a **team** principal:
   *"What do we know about the Acme renewal risk?"* → answer cites chunks from **both** Alice's and Bob's notes.
4. The same query as Alice (no team scope on Bob's private notes) **omits** Bob's private chunks — ACL holds.
5. Each answer includes a **"why retrieved"** evidence list (which lane + score surfaced each chunk).

## 8. Eval Plan (recall is the product)

- Reuse the existing Obsidian retrieval-eval methodology (recall@k harness from prior CLI-vs-hook work).
- Build a small gold set: ~30 questions with known answer-notes across the two seed vaults.
- Metric: **recall@20** (1 − failed-retrieval rate), plus end-to-end answer-citation correctness.
- A/B the contextualization step: naive chunks vs Contextual Retrieval, to confirm the expected lift before locking.
- Gate: contextualization must measurably beat naive on the gold set, else fall back to naive + revisit.

## 9. Tech Stack

- **Language/runtime (DECIDED 2026-06-25):** **Python core** (FastAPI) for ingestion + indexing + recall engine
  (Docling/Marker/Zerox + best RAG/embedding tooling + first-class Qdrant client); **thin Node API** layer for the
  `/ask` surface to match the existing Wingman/Composio stack. Clean service boundary; may collapse to one service later.
- **Vector:** Qdrant (Docker locally). **DB:** Postgres (existing local instance).
- **Queue:** lightweight (Postgres-backed or Redis, both already available).
- **Embeddings:** Voyage `voyage-4-large` (hosted) / BGE-M3 (local). **Rerank:** Voyage `rerank-2.5`.
- **Distillation LLM:** hosted first (OpenAI/Together) with a local path for data-residency. → **Open question #2.**
- **Viewer:** Obsidian (vault folder is the canonical store).

## 10. Build Order (milestones within the skeleton)

1. **M1 – Single-vault loop:** watcher → distill (.md only first) → chunk+embed → Qdrant/Postgres → `/ask` cited. (Proves the spine.)
2. **M2 – Ingestion breadth:** add PDF + image OCR + code via Docling/Marker/Zerox.
3. **M3 – Recall quality:** multi-lane + RRF + rerank + graph expansion; stand up the eval harness; A/B contextualization.
4. **M4 – Scopes + cross-person:** add `private/team/enterprise`, seed Bob's vault, ACL-in-retrieval, run the demo query.

Each milestone is independently demoable and testable.

## 11. Risks & Mitigations

- **Context homogenization** (Codex): distinct chunks look alike → precision drop. → constrain prompt, apply selectively, keep sparse lane, regenerate-on-parent-change.
- **Ingestion garbage-in:** weak distillation = weak recall regardless of algorithm. → eval harness catches it; iterate distillation prompt.
- **GraphRAG over-investment** (field warning: "easy to start, hard to finish"). → cap at 1–2 hops, graph complements not replaces; measurable-or-cut.
- **Scope leak:** any post-filtering. → enforce ACL inside candidate generation; test case #4 is a hard gate.

## 12. Open Questions (resolve at plan time)

1. ~~**Runtime:**~~ **RESOLVED 2026-06-25** → Python core + thin Node API.
2. **Distillation LLM:** which model, and hosted-first vs local-first for the enterprise data-residency story?
   (Default for M1: existing hosted OpenAI/Together; local path deferred.)
3. **Seed data:** real personal vault subset vs synthetic "Acme renewal" corpus for the demo?
   (Default: synthetic Acme corpus for a clean, shareable demo.)

## 13. Appendix — Field Survey (what others ship)

- **Karpathy KB pattern (Apr 2026, 1.7M views):** "raw data → LLM compiles to .md wiki → CLI Q&A + incremental
  enhancement → viewable in Obsidian." This loop = our loop. Canonical pipeline: Ingest → Compile → Lint → View → Query → Enhance.
- **Production RAG consensus:** hybrid BM25+dense+rerank is the proven default; BM25 lifts recall, rerank fixes precision.
- **GraphRAG reality:** most teams never beat plain hybrid in production; internal company knowledge is the *ideal*
  GraphRAG use case (entities bounded by org size). Glean ($260M) is the incumbent doing exactly this.
- **Contextual Retrieval (Anthropic):** −49%/−67% failed retrievals; ~$1/M doc tokens w/ prompt caching.
- **Late Chunking (Jina):** cheaper, but couples chunk to whole-doc encoding and bounded by 8k embed window — deferred.
- **RAGFlow:** OSS reference for deep document understanding + chunk-level grounded citations — study for the "why retrieved" UX.
```
