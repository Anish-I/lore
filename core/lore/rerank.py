from typing import Protocol

class Reranker(Protocol):
    def rerank(self, query: str, docs: list[str]) -> list[float]: ...

class FakeReranker:
    def rerank(self, query, docs):
        q = set(query.lower().split())
        return [len(q & set(d.lower().split())) / (len(q) + 1) for d in docs]

class VoyageReranker:
    DEFAULT_MODEL = "rerank-2.5"
    def __init__(self, api_key, model=DEFAULT_MODEL):
        import voyageai
        self.client = voyageai.Client(api_key=api_key); self.model = model
        self.model_name = model
    def rerank(self, query, docs):
        r = self.client.rerank(query, docs, model=self.model, top_k=len(docs))
        scores = [0.0]*len(docs)
        for res in r.results: scores[res.index] = res.relevance_score
        return scores

import os as _os

class LocalReranker:
    """Real cross-encoder reranking via fastembed (ONNX, offline)."""
    # L6 is the local default: on the 2026-07-18 Trusted Recall note fixture it
    # preserved hit@1/3/5 while reducing P95 from 701ms to 370ms. L12 retains a
    # small MRR advantage and remains available through LORE_RERANK_MODEL.
    DEFAULT_MODEL = _os.environ.get("LORE_RERANK_MODEL") or "Xenova/ms-marco-MiniLM-L-6-v2"
    _cache = {}
    def __init__(self, model=DEFAULT_MODEL):
        from fastembed.rerank.cross_encoder import TextCrossEncoder
        if model not in LocalReranker._cache:
            LocalReranker._cache[model] = TextCrossEncoder(model_name=model)
        self.model = LocalReranker._cache[model]
        self.model_name = model
    def rerank(self, query, docs):
        if not docs:
            return []
        return list(self.model.rerank(query, list(docs)))
