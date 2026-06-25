import os
from fastapi import FastAPI, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from . import db
from .config import settings
from .embed import FakeEmbedder, VoyageEmbedder, LocalEmbedder, LocalSparseEmbedder
from .rerank import FakeReranker, VoyageReranker, LocalReranker
from .index import index_note
from .recall import retrieve, retrieve_traced
from . import llm

app = FastAPI(title="Vault Core")
_conn = db.connect(); db.bootstrap_schema(_conn)

# Model selection: Voyage if an API key is set, else REAL local models (fastembed),
# and only Fake if explicitly forced (VAULT_FAKE=1) for fast unit tests.
_FAKE = os.environ.get("VAULT_FAKE") == "1"

def get_embedder():
    if _FAKE:
        return FakeEmbedder()
    return VoyageEmbedder(settings.voyage_api_key) if settings.voyage_api_key else LocalEmbedder()

def get_reranker():
    if _FAKE:
        return FakeReranker()
    return VoyageReranker(settings.voyage_api_key) if settings.voyage_api_key else LocalReranker()

def get_sparse_embedder():
    return None if _FAKE else LocalSparseEmbedder()

class ReindexReq(BaseModel):
    path: str; owner_id: str = "alice"; scope_id: str = "alice-private"; tenant_id: str = "t1"
class AskReq(BaseModel):
    question: str; principal_scopes: list[str]; tenant_id: str = "t1"

@app.post("/reindex")
def reindex(req: ReindexReq, embedder=Depends(get_embedder), sparse=Depends(get_sparse_embedder)):
    n = index_note(req.path, embedder, _conn, req.owner_id, req.scope_id, req.tenant_id,
                   sparse_embedder=sparse)
    return {"indexed_chunks": n}

@app.post("/ask")
def ask(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
        sparse=Depends(get_sparse_embedder)):
    hits = retrieve(req.question, embedder, reranker, req.principal_scopes, req.tenant_id,
                    sparse_embedder=sparse)
    chunks = [{"title": h.heading_path, "text": h.text} for h in hits]
    text, engine = llm.answer(req.question, chunks)
    return {"answer": text, "engine": engine,
            "citations": [{"note_id": h.note_id, "heading_path": h.heading_path, "why": h.why} for h in hits]}

@app.post("/trace")
def trace(req: AskReq, embedder=Depends(get_embedder), reranker=Depends(get_reranker),
          sparse=Depends(get_sparse_embedder)):
    """Full pipeline trace for the visualizer: per-lane candidates, fusion, rerank, answer."""
    if sparse is None:
        return {"error": "trace requires real models (unset VAULT_FAKE)"}
    final, tr = retrieve_traced(req.question, embedder, reranker, sparse,
                                req.principal_scopes, req.tenant_id)
    chunks = [{"title": f["title"], "text": f["text"]} for f in tr["final"]]
    text, engine = llm.answer(req.question, chunks)
    tr["answer"] = text
    tr["engine"] = engine
    tr["scopes_asked"] = req.principal_scopes
    return tr

@app.get("/", response_class=HTMLResponse)
def home():
    path = os.path.join(os.path.dirname(__file__), "static", "app.html")
    with open(path, encoding="utf-8") as f:
        return f.read()
