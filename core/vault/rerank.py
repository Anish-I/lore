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
