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

app = FastAPI(title="Lore Core")
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

_TEAMS = ["underwriting","claims","actuarial","fraud-siu","customer-service","legal-compliance",
          "marketing","it-eng","finance","hr","sales-distribution","product"]
_CIRCLES = ["exec-committee","rate-filing-2026","project-telematics","catastrophe-response","ma-diligence","data-governance"]
PROFILES = {
  "acme": {"tenant": "acme", "company": "Acme (demo)", "personas": [
      {"label": "Alice", "scopes": ["alice-private","eng-team","acme-corp"]},
      {"label": "Bob", "scopes": ["bob-private","eng-team","acme-corp"]},
      {"label": "New hire", "scopes": ["eng-team","acme-corp"]},
      {"label": "Admin (all)", "scopes": ["alice-private","bob-private","eng-team","acme-corp"]}],
    "examples": ["what do we know about Project Phoenix?","why is the Acme renewal at risk?",
                 "root cause of incident PROJ-1037","how do we handle database connection limits?"]},
  "apex": {"tenant": "apex", "company": "Apex Auto Insurance", "personas": [
      {"label": "CEO", "scopes": ["ceo-private","exec-committee","team-finance","team-claims","team-actuarial","apex-enterprise"]},
      {"label": "Chief Actuary", "scopes": ["chief-actuary-private","exec-committee","team-actuarial","rate-filing-2026","data-governance","apex-enterprise"]},
      {"label": "Actuary", "scopes": ["team-actuarial","apex-enterprise"]},
      {"label": "Underwriter", "scopes": ["team-underwriting","apex-enterprise"]},
      {"label": "Claims Adjuster", "scopes": ["team-claims","apex-enterprise"]},
      {"label": "Finance Analyst", "scopes": ["team-finance","apex-enterprise"]},
      {"label": "HR Partner", "scopes": ["team-hr","apex-enterprise"]},
      {"label": "Rate-Filing circle", "scopes": ["rate-filing-2026","apex-enterprise"]},
      {"label": "Marketer", "scopes": ["team-marketing","apex-enterprise"]},
      {"label": "Admin (all)", "scopes": [f"team-{t}" for t in _TEAMS] + _CIRCLES + ["apex-enterprise"]}],
    "examples": ["loss ratio trend and rate indication","catastrophe reinsurance exposure",
                 "incident in the rating engine","fraud ring investigation in Florida",
                 "rate filing for telematics usage-based pricing"]},
}
PROFILE = os.environ.get("VAULT_PROFILE", "acme")

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

@app.get("/presets")
def presets():
    return PROFILES.get(PROFILE, PROFILES["acme"])

@app.get("/", response_class=HTMLResponse)
def home():
    path = os.path.join(os.path.dirname(__file__), "static", "app.html")
    with open(path, encoding="utf-8") as f:
        return f.read()
