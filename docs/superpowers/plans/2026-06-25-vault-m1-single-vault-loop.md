# Vault M1 — Single-Vault Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the spine of Vault — drop a Markdown file into a watched folder and have it chunked, contextualized, embedded into Qdrant, and answerable via `POST /ask` with citations.

**Architecture:** Python core (FastAPI) owns ingestion + indexing + recall over Qdrant (vectors) and Postgres (source of truth + ACL). A thin Node API proxies `/ask` to match the existing Wingman stack. M1 handles `.md` only, a single owner/scope, hybrid dense+sparse retrieval with RRF, and citations. No OCR/PDF (M2), no multi-person scopes (M4) yet.

**Tech Stack:** Python 3.11, FastAPI, Qdrant (Docker), Postgres (existing local), `qdrant-client`, `voyageai`, `psycopg[binary]`, `watchdog`, `markdown-it-py`, `tiktoken`, `pytest`. Node 20 + Express for the API proxy.

## Global Constraints

- **Vector store:** Qdrant for retrieval; **Postgres is the source of truth** for docs/chunks/ACL/graph. Never store ground truth only in Qdrant.
- **ACL is enforced inside candidate generation** (Qdrant payload filter), never as a post-filter. (M1 has one scope, but the filter path must exist.)
- **Stable chunk IDs:** `chunk_id = sha1(note_id + heading_path + chunk_index)` so edits re-index locally.
- **Embeddings:** Voyage `voyage-4-large`; **reranker** Voyage `rerank-2.5`. A `FakeEmbedder`/`FakeReranker` MUST exist for tests (no network in unit tests).
- **Chunking:** atomic 150–350 tokens by heading tree; selective Contextual Retrieval blurb (50–100 tokens) prepended before embedding AND before the sparse index.
- **Retrieve wide → rerank narrow:** dense + sparse → RRF → rerank → return 8–15 chunks. M1 may use smaller k (retrieve 40, return 8) for the single-vault case.
- **TDD:** every task starts with a failing test. Frequent commits. DRY. YAGNI.
- All paths below are relative to repo root `C:\Users\ivatu\vault-kos`.

---

## File Structure

```
vault-kos/
  core/                         # Python core (FastAPI)
    pyproject.toml
    vault/
      __init__.py
      config.py                 # env + settings
      db.py                     # Postgres connection + schema bootstrap
      models.py                 # dataclasses: Note, Chunk, RetrievedChunk
      chunker.py                # Markdown AST → atomic chunks + heading_path
      contextualize.py          # selective Contextual Retrieval blurb
      embed.py                  # Embedder protocol + VoyageEmbedder + FakeEmbedder
      rerank.py                 # Reranker protocol + VoyageReranker + FakeReranker
      index.py                  # Indexer: note → chunks → embed → upsert Qdrant+PG
      recall.py                 # Recall engine: hybrid retrieve → RRF → rerank
      distill.py                # M1: .md passthrough + frontmatter normalize
      watcher.py                # folder watch → enqueue → index
      api.py                    # FastAPI app: POST /ask, POST /reindex
      qdrant_store.py           # Qdrant collection setup + hybrid query
    tests/
      test_chunker.py
      test_contextualize.py
      test_rrf.py
      test_index_recall_e2e.py  # uses FakeEmbedder + real Qdrant/PG (docker)
  api/                          # Node thin proxy
    package.json
    server.js
    test/server.test.js
  docker-compose.yml            # qdrant + postgres
  .env.example
```

---

### Task 1: Scaffold core + infra (Docker, Postgres schema, config)

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `core/pyproject.toml`, `core/vault/__init__.py`, `core/vault/config.py`, `core/vault/db.py`
- Test: `core/tests/test_db.py`

**Interfaces:**
- Produces: `config.settings` (object with `.database_url`, `.qdrant_url`, `.voyage_api_key`, `.vault_root`, `.tenant_id`, `.owner_id`, `.scope_id`); `db.connect() -> psycopg.Connection`; `db.bootstrap_schema(conn) -> None`.

- [ ] **Step 1: docker-compose for Qdrant + Postgres**

```yaml
# docker-compose.yml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports: ["6333:6333"]
    volumes: ["./.qdrant:/qdrant/storage"]
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: vault
      POSTGRES_PASSWORD: vault
      POSTGRES_DB: vault
    ports: ["5433:5432"]
    volumes: ["./.pgdata:/var/lib/postgresql/data"]
```

- [ ] **Step 2: .env.example + pyproject**

```
# .env.example
DATABASE_URL=postgresql://vault:vault@localhost:5433/vault
QDRANT_URL=http://localhost:6333
VOYAGE_API_KEY=replace_me
VAULT_ROOT=./sample-vault
TENANT_ID=t1
OWNER_ID=alice
SCOPE_ID=alice-private
```

```toml
# core/pyproject.toml
[project]
name = "vault-core"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi","uvicorn","qdrant-client","voyageai","psycopg[binary]",
  "watchdog","markdown-it-py","tiktoken","python-dotenv","pydantic"
]
[project.optional-dependencies]
dev = ["pytest","httpx"]
```

- [ ] **Step 3: config.py**

```python
# core/vault/config.py
import os
from dataclasses import dataclass
from dotenv import load_dotenv
load_dotenv()

@dataclass(frozen=True)
class Settings:
    database_url: str = os.environ.get("DATABASE_URL", "postgresql://vault:vault@localhost:5433/vault")
    qdrant_url: str = os.environ.get("QDRANT_URL", "http://localhost:6333")
    voyage_api_key: str = os.environ.get("VOYAGE_API_KEY", "")
    vault_root: str = os.environ.get("VAULT_ROOT", "./sample-vault")
    tenant_id: str = os.environ.get("TENANT_ID", "t1")
    owner_id: str = os.environ.get("OWNER_ID", "alice")
    scope_id: str = os.environ.get("SCOPE_ID", "alice-private")

settings = Settings()
```

- [ ] **Step 4: Write failing test for schema bootstrap**

```python
# core/tests/test_db.py
from vault import db
def test_bootstrap_creates_tables():
    conn = db.connect()
    db.bootstrap_schema(conn)
    cur = conn.execute("select count(*) from information_schema.tables where table_name in ('notes','chunks','edges')")
    assert cur.fetchone()[0] == 3
```

- [ ] **Step 5: Run test, expect FAIL**

Run: `cd core && pytest tests/test_db.py -v`
Expected: FAIL (`vault.db` has no `connect`/`bootstrap_schema`).

- [ ] **Step 6: db.py with schema**

```python
# core/vault/db.py
import psycopg
from .config import settings

SCHEMA = """
create table if not exists notes(
  id text primary key, tenant_id text, owner_id text, scope_id text,
  source_path text, title text, updated_at timestamptz default now());
create table if not exists chunks(
  id text primary key, note_id text references notes(id) on delete cascade,
  heading_path text, text text, has_context boolean default false,
  chunk_index int, updated_at timestamptz default now());
create table if not exists edges(
  src_note_id text, dst_note_id text, kind text);
"""

def connect():
    conn = psycopg.connect(settings.database_url, autocommit=True)
    return conn

def bootstrap_schema(conn):
    conn.execute(SCHEMA)
```

- [ ] **Step 7: Run test, expect PASS** (requires `docker compose up -d postgres`)

Run: `docker compose up -d postgres && cd core && pip install -e ".[dev]" && pytest tests/test_db.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example core/pyproject.toml core/vault/__init__.py core/vault/config.py core/vault/db.py core/tests/test_db.py
git commit -m "feat(core): scaffold infra, config, postgres schema"
```

---

### Task 2: Markdown chunker (AST → atomic chunks)

**Files:**
- Create: `core/vault/chunker.py`, `core/vault/models.py`
- Test: `core/tests/test_chunker.py`

**Interfaces:**
- Produces: `models.Chunk(note_id, chunk_index, heading_path, text)`; `chunker.chunk_markdown(note_id: str, md: str, target_min=150, target_max=350) -> list[Chunk]`. `heading_path` is `"H1 > H2 > H3"`. Token counting via `tiktoken` `cl100k_base`.

- [ ] **Step 1: models.py**

```python
# core/vault/models.py
from dataclasses import dataclass, field
@dataclass
class Chunk:
    note_id: str
    chunk_index: int
    heading_path: str
    text: str
    context: str = ""           # filled by contextualize step
@dataclass
class RetrievedChunk:
    chunk_id: str
    note_id: str
    text: str
    heading_path: str
    score: float
    why: str
```

- [ ] **Step 2: Failing test**

```python
# core/tests/test_chunker.py
from vault.chunker import chunk_markdown
MD = """# Acme Account

## Renewal
Acme's contract renews in Q3. Risk: champion left the company.

## Pricing
List price is $120k; discount approved to $96k.
"""
def test_chunks_carry_heading_path():
    chunks = chunk_markdown("n1", MD)
    assert any(c.heading_path == "Acme Account > Renewal" for c in chunks)
    assert any("champion left" in c.text for c in chunks)

def test_no_chunk_exceeds_token_max():
    chunks = chunk_markdown("n1", MD, target_max=350)
    from vault.chunker import _ntokens
    assert all(_ntokens(c.text) <= 350 for c in chunks)
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd core && pytest tests/test_chunker.py -v`
Expected: FAIL (no `chunk_markdown`).

- [ ] **Step 4: chunker.py**

```python
# core/vault/chunker.py
from markdown_it import MarkdownIt
import tiktoken
from .models import Chunk

_enc = tiktoken.get_encoding("cl100k_base")
def _ntokens(s: str) -> int:
    return len(_enc.encode(s))

def chunk_markdown(note_id, md, target_min=150, target_max=350):
    mdit = MarkdownIt()
    tokens = mdit.parse(md)
    sections = []                # (heading_path, body_text)
    heading_stack = []           # (level, text)
    buf = []
    def flush():
        if buf:
            path = " > ".join(t for _, t in heading_stack)
            sections.append((path, "\n".join(buf).strip()))
            buf.clear()
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.type == "heading_open":
            flush()
            level = int(t.tag[1])
            text = tokens[i+1].content
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, text))
            i += 3; continue
        if t.type == "inline" and t.content:
            buf.append(t.content)
        i += 1
    flush()

    chunks, idx = [], 0
    for path, body in sections:
        if not body:
            continue
        # split body into atomic chunks respecting token budget on paragraph boundaries
        paras, cur = body.split("\n"), []
        cur_tok = 0
        for p in paras:
            pt = _ntokens(p)
            if cur and cur_tok + pt > target_max:
                chunks.append(Chunk(note_id, idx, path, "\n".join(cur).strip())); idx += 1
                cur, cur_tok = [], 0
            cur.append(p); cur_tok += pt
        if cur:
            chunks.append(Chunk(note_id, idx, path, "\n".join(cur).strip())); idx += 1
    return chunks
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd core && pytest tests/test_chunker.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/vault/models.py core/vault/chunker.py core/tests/test_chunker.py
git commit -m "feat(core): markdown AST chunker with heading paths + token budget"
```

---

### Task 3: Selective Contextual Retrieval blurb

**Files:**
- Create: `core/vault/contextualize.py`
- Test: `core/tests/test_contextualize.py`

**Interfaces:**
- Consumes: `models.Chunk`.
- Produces: `contextualize.needs_context(chunk: Chunk) -> bool`; `contextualize.build_context(note_title: str, chunk: Chunk, llm=None) -> str`. With `llm=None`, returns a deterministic metadata-only blurb (no network) — used in tests and as the M1 default to avoid per-chunk LLM cost. `apply_context(chunks, note_title, llm=None) -> list[Chunk]` sets `chunk.context` and `has_context`.

- [ ] **Step 1: Failing test**

```python
# core/tests/test_contextualize.py
from vault.models import Chunk
from vault.contextualize import needs_context, apply_context

def test_short_chunk_needs_context():
    c = Chunk("n1", 0, "Acme Account > Renewal", "Risk: champion left.")
    assert needs_context(c) is True

def test_selfcontained_chunk_skips_context():
    big = "Acme Corporation renewal for fiscal Q3 2026. " * 12
    c = Chunk("n1", 0, "Acme Account > Renewal", big)
    assert needs_context(c) is False

def test_apply_context_prepends_metadata_blurb_without_llm():
    c = Chunk("n1", 0, "Acme Account > Renewal", "Risk: champion left.")
    out = apply_context([c], "Acme Account", llm=None)[0]
    assert out.context != "" and "Acme Account" in out.context
    assert out.has_context_text().startswith(out.context)
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd core && pytest tests/test_contextualize.py -v`
Expected: FAIL.

- [ ] **Step 3: contextualize.py + Chunk helper**

Add to `models.py` `Chunk`:
```python
    has_context: bool = False
    def has_context_text(self) -> str:
        return f"{self.context}\n\n{self.text}".strip() if self.context else self.text
```

```python
# core/vault/contextualize.py
import tiktoken
from .models import Chunk
_enc = tiktoken.get_encoding("cl100k_base")

def needs_context(chunk: Chunk) -> bool:
    # heuristic: short chunks or chunks with dangling pronouns need situating
    n = len(_enc.encode(chunk.text))
    has_pronoun_start = chunk.text.strip().lower().startswith(("it ", "they ", "this ", "the city", "risk:"))
    return n < 120 or has_pronoun_start

CONTEXT_PROMPT = (
    "<document title>{title}</document title>\n<section>{path}</section>\n"
    "<chunk>{chunk}</chunk>\nGive a 1-sentence context that situates this chunk "
    "(name the entity/section/time it refers to). Answer with only the sentence."
)

def build_context(note_title: str, chunk: Chunk, llm=None) -> str:
    if llm is None:
        # deterministic, no-network default: situate via metadata
        return f"From note '{note_title}', section '{chunk.heading_path}'."
    return llm(CONTEXT_PROMPT.format(title=note_title, path=chunk.heading_path, chunk=chunk.text)).strip()

def apply_context(chunks, note_title, llm=None):
    for c in chunks:
        if needs_context(c):
            c.context = build_context(note_title, c, llm=llm)
            c.has_context = True
    return chunks
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd core && pytest tests/test_contextualize.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/vault/contextualize.py core/vault/models.py core/tests/test_contextualize.py
git commit -m "feat(core): selective contextual-retrieval blurb (metadata default + llm hook)"
```

---

### Task 4: Embedder + Reranker (with Fakes) and RRF

**Files:**
- Create: `core/vault/embed.py`, `core/vault/rerank.py`, `core/vault/fusion.py`
- Test: `core/tests/test_rrf.py`

**Interfaces:**
- Produces: `embed.Embedder` protocol with `embed(texts: list[str]) -> list[list[float]]`; `embed.VoyageEmbedder`, `embed.FakeEmbedder(dim=8)` (hash-based deterministic vectors). `rerank.Reranker` protocol `rerank(query, docs) -> list[float]`; `rerank.VoyageReranker`, `rerank.FakeReranker` (lexical-overlap score). `fusion.rrf(rankings: list[list[str]], k=60) -> dict[str,float]`.

- [ ] **Step 1: Failing test for RRF**

```python
# core/tests/test_rrf.py
from vault.fusion import rrf
def test_rrf_rewards_agreement():
    dense = ["a","b","c"]; sparse = ["b","a","d"]
    scored = rrf([dense, sparse])
    assert scored["a"] > scored["c"]     # a ranks high in both
    assert scored["b"] > scored["d"]
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd core && pytest tests/test_rrf.py -v`
Expected: FAIL.

- [ ] **Step 3: fusion.py, embed.py, rerank.py**

```python
# core/vault/fusion.py
def rrf(rankings, k=60):
    scores = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank + 1)
    return scores
```

```python
# core/vault/embed.py
import hashlib
from typing import Protocol
class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...

class FakeEmbedder:
    def __init__(self, dim=8): self.dim = dim
    def embed(self, texts):
        out = []
        for t in texts:
            h = hashlib.sha256(t.lower().encode()).digest()
            out.append([h[i % len(h)] / 255.0 for i in range(self.dim)])
        return out

class VoyageEmbedder:
    def __init__(self, api_key, model="voyage-4-large"):
        import voyageai
        self.client = voyageai.Client(api_key=api_key); self.model = model
    def embed(self, texts):
        return self.client.embed(texts, model=self.model, input_type="document").embeddings
```

```python
# core/vault/rerank.py
from typing import Protocol
class Reranker(Protocol):
    def rerank(self, query: str, docs: list[str]) -> list[float]: ...

class FakeReranker:
    def rerank(self, query, docs):
        q = set(query.lower().split())
        return [len(q & set(d.lower().split())) / (len(q) + 1) for d in docs]

class VoyageReranker:
    def __init__(self, api_key, model="rerank-2.5"):
        import voyageai
        self.client = voyageai.Client(api_key=api_key); self.model = model
    def rerank(self, query, docs):
        r = self.client.rerank(query, docs, model=self.model, top_k=len(docs))
        scores = [0.0]*len(docs)
        for res in r.results: scores[res.index] = res.relevance_score
        return scores
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd core && pytest tests/test_rrf.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/vault/fusion.py core/vault/embed.py core/vault/rerank.py core/tests/test_rrf.py
git commit -m "feat(core): embedder/reranker protocols with fakes + RRF fusion"
```

---

### Task 5: Qdrant store (hybrid collection + ACL-filtered query)

**Files:**
- Create: `core/vault/qdrant_store.py`
- Test: covered by Task 7 e2e (needs Qdrant running).

**Interfaces:**
- Produces: `qdrant_store.ensure_collection(dim: int) -> None`; `qdrant_store.upsert(points: list[dict]) -> None` where each point is `{id, vector, payload}` and payload has `tenant_id, owner_id, scope_ids:list[str], note_id, heading_path, text, chunk_id`; `qdrant_store.search(vector, allowed_scope_ids, tenant_id, limit) -> list[dict]` returning payloads + score, filtered by `tenant_id` AND `scope_ids` overlap (ACL inside the query).

- [ ] **Step 1: qdrant_store.py**

```python
# core/vault/qdrant_store.py
from qdrant_client import QdrantClient
from qdrant_client.http import models as qm
from .config import settings

COLLECTION = "vault_chunks"
_client = QdrantClient(url=settings.qdrant_url)

def ensure_collection(dim):
    existing = [c.name for c in _client.get_collections().collections]
    if COLLECTION not in existing:
        _client.create_collection(
            COLLECTION,
            vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
        )
        _client.create_payload_index(COLLECTION, "tenant_id", qm.PayloadSchemaType.KEYWORD)
        _client.create_payload_index(COLLECTION, "scope_ids", qm.PayloadSchemaType.KEYWORD)

def upsert(points):
    _client.upsert(COLLECTION, points=[
        qm.PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"]) for p in points
    ])

def search(vector, allowed_scope_ids, tenant_id, limit=40):
    flt = qm.Filter(must=[
        qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
        qm.FieldCondition(key="scope_ids", match=qm.MatchAny(any=list(allowed_scope_ids))),
    ])
    res = _client.search(COLLECTION, query_vector=vector, query_filter=flt, limit=limit, with_payload=True)
    return [{"score": r.score, **r.payload} for r in res]
```

- [ ] **Step 2: Commit**

```bash
git add core/vault/qdrant_store.py
git commit -m "feat(core): qdrant collection + ACL-filtered vector search"
```

> Note: ACL filter (`tenant_id` + `scope_ids` overlap) lives **inside** the Qdrant query — satisfies the global constraint even though M1 uses one scope.

---

### Task 6: Indexer (note → chunks → context → embed → upsert PG+Qdrant)

**Files:**
- Create: `core/vault/index.py`, `core/vault/distill.py`
- Test: `core/tests/test_index_recall_e2e.py` (part 1)

**Interfaces:**
- Consumes: chunker, contextualize, embed, qdrant_store, db.
- Produces: `distill.distill_md(path: str) -> tuple[str, str, str]` returning `(note_id, title, markdown)` (M1: read file, derive title from first H1 or filename, note_id = sha1(path)). `index.index_note(path: str, embedder, conn, owner_id, scope_id, tenant_id) -> int` returns number of chunks indexed; writes notes+chunks rows and upserts Qdrant points with stable `chunk_id = sha1(note_id + heading_path + chunk_index)`.

- [ ] **Step 1: distill.py**

```python
# core/vault/distill.py
import hashlib, os, re
def distill_md(path):
    with open(path, encoding="utf-8") as f:
        md = f.read()
    note_id = hashlib.sha1(path.encode()).hexdigest()[:16]
    m = re.search(r"^#\s+(.+)$", md, re.M)
    title = m.group(1).strip() if m else os.path.splitext(os.path.basename(path))[0]
    return note_id, title, md
```

- [ ] **Step 2: index.py**

```python
# core/vault/index.py
import hashlib
from . import qdrant_store
from .chunker import chunk_markdown
from .contextualize import apply_context
from .distill import distill_md

def _chunk_id(note_id, heading_path, idx):
    return hashlib.sha1(f"{note_id}|{heading_path}|{idx}".encode()).hexdigest()[:24]

def index_note(path, embedder, conn, owner_id, scope_id, tenant_id):
    note_id, title, md = distill_md(path)
    chunks = apply_context(chunk_markdown(note_id, md), title, llm=None)
    if not chunks:
        return 0
    texts = [c.has_context_text() for c in chunks]
    vectors = embedder.embed(texts)
    qdrant_store.ensure_collection(len(vectors[0]))

    conn.execute("insert into notes(id,tenant_id,owner_id,scope_id,source_path,title) values(%s,%s,%s,%s,%s,%s) on conflict (id) do update set title=excluded.title",
                 (note_id, tenant_id, owner_id, scope_id, path, title))
    conn.execute("delete from chunks where note_id=%s", (note_id,))
    points = []
    for c, vec, text in zip(chunks, vectors, texts):
        cid = _chunk_id(note_id, c.heading_path, c.chunk_index)
        conn.execute("insert into chunks(id,note_id,heading_path,text,has_context,chunk_index) values(%s,%s,%s,%s,%s,%s)",
                     (cid, note_id, c.heading_path, c.text, c.has_context, c.chunk_index))
        points.append({"id": cid, "vector": vec, "payload": {
            "tenant_id": tenant_id, "owner_id": owner_id, "scope_ids": [scope_id],
            "note_id": note_id, "heading_path": c.heading_path, "text": c.text, "chunk_id": cid}})
    qdrant_store.upsert(points)
    return len(points)
```

- [ ] **Step 3: Commit**

```bash
git add core/vault/index.py core/vault/distill.py
git commit -m "feat(core): indexer pipeline note->chunks->embed->PG+Qdrant"
```

---

### Task 7: Recall engine + end-to-end test

**Files:**
- Create: `core/vault/recall.py`
- Test: `core/tests/test_index_recall_e2e.py` (full)

**Interfaces:**
- Consumes: qdrant_store, embed, rerank, fusion.
- Produces: `recall.retrieve(query, embedder, reranker, allowed_scope_ids, tenant_id, limit=8) -> list[RetrievedChunk]`. M1 fuses the dense lane with a lexical lane derived from Qdrant payload text (sparse BM25 lane is stubbed via simple term-overlap ranking over the dense candidate set in M1; real sparse vectors land in M3). RRF over the two rankings, then rerank, return top `limit` with `why`.

- [ ] **Step 1: recall.py**

```python
# core/vault/recall.py
from .models import RetrievedChunk
from . import qdrant_store
from .fusion import rrf

def _lexical_rank(query, candidates):
    q = set(query.lower().split())
    scored = sorted(candidates, key=lambda c: len(q & set(c["text"].lower().split())), reverse=True)
    return [c["chunk_id"] for c in scored]

def retrieve(query, embedder, reranker, allowed_scope_ids, tenant_id, limit=8):
    qvec = embedder.embed([query])[0]
    candidates = qdrant_store.search(qvec, allowed_scope_ids, tenant_id, limit=40)
    if not candidates:
        return []
    by_id = {c["chunk_id"]: c for c in candidates}
    dense_rank = [c["chunk_id"] for c in candidates]          # already score-sorted by Qdrant
    lexical_rank = _lexical_rank(query, candidates)
    fused = rrf([dense_rank, lexical_rank])
    top_ids = sorted(fused, key=fused.get, reverse=True)[:20]
    docs = [by_id[i]["text"] for i in top_ids]
    rr = reranker.rerank(query, docs)
    ranked = sorted(zip(top_ids, rr), key=lambda x: x[1], reverse=True)[:limit]
    out = []
    for cid, score in ranked:
        c = by_id[cid]
        out.append(RetrievedChunk(cid, c["note_id"], c["text"], c["heading_path"], score,
                                  why=f"dense+lexical RRF then rerank={score:.3f}"))
    return out
```

- [ ] **Step 2: Failing e2e test (FakeEmbedder + real Qdrant/PG)**

```python
# core/tests/test_index_recall_e2e.py
import os, tempfile, pytest
from vault import db
from vault.embed import FakeEmbedder
from vault.rerank import FakeReranker
from vault.index import index_note
from vault.recall import retrieve

@pytest.fixture(scope="module")
def conn():
    c = db.connect(); db.bootstrap_schema(c); return c

def _write(md):
    f = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
    f.write(md); f.close(); return f.name

def test_index_then_recall_returns_cited_chunk(conn):
    path = _write("# Acme Account\n\n## Renewal\nAcme renews in Q3. Risk: the champion left the company.\n")
    n = index_note(path, FakeEmbedder(), conn, "alice", "alice-private", "t1")
    assert n >= 1
    hits = retrieve("Acme renewal champion risk", FakeEmbedder(), FakeReranker(),
                    allowed_scope_ids=["alice-private"], tenant_id="t1")
    assert hits and hits[0].note_id
    assert any("champion" in h.text for h in hits)

def test_acl_excludes_other_scope(conn):
    path = _write("# Secret\n\n## Bonus\nBob bonus is 50k.\n")
    index_note(path, FakeEmbedder(), conn, "bob", "bob-private", "t1")
    hits = retrieve("Bob bonus", FakeEmbedder(), FakeReranker(),
                    allowed_scope_ids=["alice-private"], tenant_id="t1")
    assert all("bonus" not in h.text.lower() for h in hits)
```

- [ ] **Step 3: Run, expect FAIL then PASS**

Run: `docker compose up -d && cd core && pytest tests/test_index_recall_e2e.py -v`
Expected: first run guides implementation; final run PASS (both tests). The ACL test proves scope isolation at the Qdrant filter level.

- [ ] **Step 4: Commit**

```bash
git add core/vault/recall.py core/tests/test_index_recall_e2e.py
git commit -m "feat(core): hybrid recall (RRF+rerank) + e2e index/recall/ACL tests"
```

---

### Task 8: FastAPI `/ask` + answer synthesis with citations

**Files:**
- Create: `core/vault/api.py`
- Test: `core/tests/test_api.py`

**Interfaces:**
- Produces: FastAPI app with `POST /ask {question, principal_scopes:list[str], tenant_id}` → `{answer, citations:[{note_id, heading_path, why}]}`. M1 answer synthesis: deterministic template that lists the top cited chunks (LLM answer generation can be swapped in behind `synthesize()` later). `POST /reindex {path}` indexes one file.

- [ ] **Step 1: Failing test (httpx + FakeEmbedder via dependency override)**

```python
# core/tests/test_api.py
from fastapi.testclient import TestClient
from vault.api import app, get_embedder, get_reranker
from vault.embed import FakeEmbedder
from vault.rerank import FakeReranker
app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
app.dependency_overrides[get_reranker] = lambda: FakeReranker()
client = TestClient(app)

def test_ask_returns_citations(tmp_path):
    p = tmp_path / "acme.md"
    p.write_text("# Acme\n\n## Renewal\nAcme renews Q3. Risk: champion left.\n", encoding="utf-8")
    client.post("/reindex", json={"path": str(p), "owner_id":"alice","scope_id":"alice-private","tenant_id":"t1"})
    r = client.post("/ask", json={"question":"Acme renewal risk","principal_scopes":["alice-private"],"tenant_id":"t1"})
    assert r.status_code == 200
    body = r.json()
    assert body["citations"] and body["citations"][0]["note_id"]
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd core && pytest tests/test_api.py -v`
Expected: FAIL.

- [ ] **Step 3: api.py**

```python
# core/vault/api.py
from fastapi import FastAPI, Depends
from pydantic import BaseModel
from . import db
from .config import settings
from .embed import FakeEmbedder, VoyageEmbedder
from .rerank import FakeReranker, VoyageReranker
from .index import index_note
from .recall import retrieve

app = FastAPI(title="Vault Core")
_conn = db.connect(); db.bootstrap_schema(_conn)

def get_embedder():
    return VoyageEmbedder(settings.voyage_api_key) if settings.voyage_api_key else FakeEmbedder()
def get_reranker():
    return VoyageReranker(settings.voyage_api_key) if settings.voyage_api_key else FakeReranker()

class ReindexReq(BaseModel):
    path: str; owner_id: str = "alice"; scope_id: str = "alice-private"; tenant_id: str = "t1"
class AskReq(BaseModel):
    question: str; principal_scopes: list[str]; tenant_id: str = "t1"

def synthesize(question, hits):
    if not hits:
        return "No relevant knowledge found in your scope."
    lines = [f"- {h.text.strip()[:200]}  [{h.heading_path}]" for h in hits[:5]]
    return f"Based on your vault:\n" + "\n".join(lines)

@app.post("/reindex")
def reindex(req: ReindexReq, embedder=Depends(get_embedder)):
    n = index_note(req.path, embedder, _conn, req.owner_id, req.scope_id, req.tenant_id)
    return {"indexed_chunks": n}

@app.post("/ask")
def ask(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker)):
    hits = retrieve(req.question, embedder, reranker, req.principal_scopes, req.tenant_id)
    return {"answer": synthesize(req.question, hits),
            "citations": [{"note_id": h.note_id, "heading_path": h.heading_path, "why": h.why} for h in hits]}
```

- [ ] **Step 4: Run, expect PASS**

Run: `docker compose up -d && cd core && pytest tests/test_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/vault/api.py core/tests/test_api.py
git commit -m "feat(core): FastAPI /ask + /reindex with citations"
```

---

### Task 9: Watcher (folder → reindex)

**Files:**
- Create: `core/vault/watcher.py`
- Test: `core/tests/test_watcher.py`

**Interfaces:**
- Produces: `watcher.handle_change(path, embedder, conn) -> int` (debounced caller indexes one `.md`); `watcher.run(vault_root)` starts a `watchdog` observer that calls `index_note` on `.md` create/modify. Test exercises `handle_change` directly (no observer thread).

- [ ] **Step 1: Failing test**

```python
# core/tests/test_watcher.py
from vault import db
from vault.embed import FakeEmbedder
from vault.watcher import handle_change
def test_handle_change_indexes_md(tmp_path):
    c = db.connect(); db.bootstrap_schema(c)
    p = tmp_path / "note.md"; p.write_text("# T\n\n## S\nHello world content here.\n", encoding="utf-8")
    n = handle_change(str(p), FakeEmbedder(), c, "alice", "alice-private", "t1")
    assert n >= 1
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd core && pytest tests/test_watcher.py -v`
Expected: FAIL.

- [ ] **Step 3: watcher.py**

```python
# core/vault/watcher.py
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from .index import index_note
from .config import settings
from . import db
from .embed import FakeEmbedder, VoyageEmbedder

def handle_change(path, embedder, conn, owner_id=None, scope_id=None, tenant_id=None):
    if not path.endswith(".md"):
        return 0
    return index_note(path, embedder, conn,
                      owner_id or settings.owner_id, scope_id or settings.scope_id, tenant_id or settings.tenant_id)

class _Handler(FileSystemEventHandler):
    def __init__(self, embedder, conn): self.embedder, self.conn, self._last = embedder, conn, {}
    def on_any_event(self, e):
        if e.is_directory or not str(e.src_path).endswith(".md"): return
        now = time.time()
        if now - self._last.get(e.src_path, 0) < 2: return   # debounce
        self._last[e.src_path] = now
        handle_change(str(e.src_path), self.embedder, self.conn)

def run(vault_root=None):
    conn = db.connect(); db.bootstrap_schema(conn)
    embedder = VoyageEmbedder(settings.voyage_api_key) if settings.voyage_api_key else FakeEmbedder()
    obs = Observer(); obs.schedule(_Handler(embedder, conn), vault_root or settings.vault_root, recursive=True)
    obs.start()
    try:
        while True: time.sleep(1)
    finally:
        obs.stop(); obs.join()
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd core && pytest tests/test_watcher.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/vault/watcher.py core/tests/test_watcher.py
git commit -m "feat(core): watchdog folder watcher with debounce"
```

---

### Task 10: Node thin API proxy

**Files:**
- Create: `api/package.json`, `api/server.js`, `api/test/server.test.js`
- Test: `api/test/server.test.js`

**Interfaces:**
- Produces: Express server on `:3030` exposing `POST /ask` that forwards JSON to the Python core (`CORE_URL`, default `http://localhost:8099/ask`) and returns its response. Matches the Wingman/Express stack so the SaaS shell can sit here later.

- [ ] **Step 1: package.json**

```json
{
  "name": "vault-api", "version": "0.1.0", "type": "module",
  "scripts": { "start": "node server.js", "test": "node --test" },
  "dependencies": { "express": "^4.19.2" }
}
```

- [ ] **Step 2: Failing test (mock core with a local server)**

```javascript
// api/test/server.test.js
import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { makeApp } from "../server.js";

test("POST /ask forwards to core and returns its body", async () => {
  const core = http.createServer((req, res) => {
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({ answer: "ok", citations: [{ note_id: "n1" }] }));
  }).listen(0);
  const coreUrl = `http://localhost:${core.address().port}/ask`;
  const app = makeApp(coreUrl);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://localhost:${port}/ask`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "hi", principal_scopes: ["alice-private"], tenant_id: "t1" })
  });
  const body = await r.json();
  assert.equal(body.answer, "ok");
  assert.equal(body.citations[0].note_id, "n1");
  server.close(); core.close();
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd api && npm install && npm test`
Expected: FAIL (no `makeApp`).

- [ ] **Step 4: server.js**

```javascript
// api/server.js
import express from "express";
export function makeApp(coreUrl = process.env.CORE_URL || "http://localhost:8099/ask") {
  const app = express();
  app.use(express.json());
  app.post("/ask", async (req, res) => {
    try {
      const r = await fetch(coreUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) });
      res.status(r.status).json(await r.json());
    } catch (e) { res.status(502).json({ error: String(e) }); }
  });
  return app;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  makeApp().listen(3030, () => console.log("vault-api on :3030"));
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd api && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/server.js api/test/server.test.js
git commit -m "feat(api): node thin proxy forwarding /ask to python core"
```

---

### Task 11: Manual end-to-end demo + docs

**Files:**
- Create: `core/run.md` (run instructions), `sample-vault/acme.md`

**Interfaces:** none (manual verification of the whole loop).

- [ ] **Step 1: Sample note + run doc**

```markdown
<!-- sample-vault/acme.md -->
# Acme Account

## Renewal
Acme's annual contract renews in Q3 2026. Risk: our champion (VP Eng) left the company last month, and the new VP hasn't been briefed.

## Pricing
List price $120k; we approved a discount to $96k contingent on a 2-year term.
```

```markdown
<!-- core/run.md -->
# Run M1
1. `docker compose up -d`
2. `cd core && pip install -e ".[dev]"`
3. Set `VOYAGE_API_KEY` in `.env` (or leave blank to use FakeEmbedder).
4. Index the sample: `python -c "from vault import db; from vault.embed import *; from vault.index import index_note; c=db.connect(); db.bootstrap_schema(c); print(index_note('../sample-vault/acme.md', (VoyageEmbedder.__init__ and FakeEmbedder()), c,'alice','alice-private','t1'))"`
5. `uvicorn vault.api:app --port 8099` (in core/)
6. `curl -s localhost:8099/ask -H 'content-type: application/json' -d '{"question":"why is the Acme renewal at risk?","principal_scopes":["alice-private"],"tenant_id":"t1"}' | jq`
7. Expect an answer citing the Renewal section ("champion left").
```

- [ ] **Step 2: Run the full loop manually**

Run steps 1–6 in `core/run.md`.
Expected: `/ask` returns an answer whose citation `heading_path` includes `Acme Account > Renewal` and text mentions "champion left".

- [ ] **Step 3: Commit**

```bash
git add core/run.md sample-vault/acme.md
git commit -m "docs: M1 run instructions + sample vault; manual e2e verified"
```

---

## Self-Review

**Spec coverage (M1 slice of the spec):**
- Watcher → §4.1 ✅ Task 9 · Distiller(.md) → §4.2 ✅ Task 6 (distill.py) · Indexer + Contextual Retrieval → §4.3 ✅ Tasks 2–6 · Qdrant+Postgres data model → §5 ✅ Tasks 1,5,6 · Recall (hybrid+RRF+rerank, ACL-in-query) → §4.4 ✅ Tasks 4,5,7 · /ask cited → §4.5 ✅ Task 8 · Node API → §9 ✅ Task 10 · Acceptance #1–#2 (drop file → cited answer) → ✅ Task 11; #4 (ACL excludes other scope) → ✅ Task 7 `test_acl_excludes_other_scope`.
- **Deferred to later plans (correctly out of M1 scope):** PDF/OCR ingestion (M2), real sparse/BM25 vectors + graph expansion + eval harness (M3), team scope + cross-person demo query (M4). Acceptance #3/#5 land in M4/M3.

**Placeholder scan:** No TBD/TODO; every code step has real code; LLM answer-synthesis is a deliberate deterministic template with a named swap point (`synthesize()`), not a placeholder.

**Type consistency:** `Chunk` (note_id, chunk_index, heading_path, text, context, has_context, has_context_text()) consistent across chunker/contextualize/index. `RetrievedChunk` fields consistent recall→api. `index_note(path, embedder, conn, owner_id, scope_id, tenant_id)` signature identical in index.py, api.py, watcher.py, tests. `qdrant_store.search(vector, allowed_scope_ids, tenant_id, limit)` consistent. `rrf(rankings, k)` consistent.

## Notes for the implementer
- Run `docker compose up -d` before any test that touches Qdrant/Postgres (Tasks 1, 7, 8).
- Unit tests (chunker, contextualize, rrf, watcher, node) need **no** network and **no** Voyage key — they use Fakes.
- Keep the LLM out of M1's contextualize path (metadata-only default) to stay fast/cheap; the `llm=` hook is where M3 wires real Contextual Retrieval + the eval A/B.
