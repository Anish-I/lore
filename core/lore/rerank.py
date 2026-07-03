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
    def rerank(self, query, docs):
        r = self.client.rerank(query, docs, model=self.model, top_k=len(docs))
        scores = [0.0]*len(docs)
        for res in r.results: scores[res.index] = res.relevance_score
        return scores

class LocalReranker:
    """Real cross-encoder reranking via fastembed (ONNX, offline)."""
    DEFAULT_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"
    _cache = {}
    def __init__(self, model=DEFAULT_MODEL):
        from fastembed.rerank.cross_encoder import TextCrossEncoder
        if model not in LocalReranker._cache:
            LocalReranker._cache[model] = TextCrossEncoder(model_name=model)
        self.model = LocalReranker._cache[model]
    def rerank(self, query, docs):
        if not docs:
            return []
        return list(self.model.rerank(query, list(docs)))
