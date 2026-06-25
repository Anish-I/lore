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
