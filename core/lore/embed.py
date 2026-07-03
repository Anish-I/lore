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
    DEFAULT_MODEL = "voyage-4-large"
    def __init__(self, api_key, model=DEFAULT_MODEL):
        import voyageai
        self.client = voyageai.Client(api_key=api_key); self.model = model
    def embed(self, texts):
        return self.client.embed(texts, model=self.model, input_type="document").embeddings

class LocalEmbedder:
    """Real semantic embeddings via fastembed (ONNX, no torch, offline).
    Default BAAI/bge-small-en-v1.5 -> 384-dim. Model downloads + caches on first use."""
    DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
    _cache = {}
    def __init__(self, model=DEFAULT_MODEL):
        from fastembed import TextEmbedding
        if model not in LocalEmbedder._cache:
            LocalEmbedder._cache[model] = TextEmbedding(model_name=model)
        self.model = LocalEmbedder._cache[model]
    def embed(self, texts):
        return [v.tolist() for v in self.model.embed(list(texts))]

# ---------------------------------------------------------------------------
# Sparse embedders (BM25 / SPLADE lane)
# ---------------------------------------------------------------------------

class SparseEmbedder(Protocol):
    """Protocol for sparse token-weight embedders (BM25, SPLADE, …).

    embed_sparse returns one dict per input text:
        {"indices": List[int], "values": List[float]}
    where indices are vocabulary token IDs and values are their weights.
    """
    def embed_sparse(self, texts: list[str]) -> list[dict]: ...


class LocalSparseEmbedder:
    """BM25 sparse embeddings via fastembed (Qdrant/bm25 ONNX model, offline).

    Returns list of {"indices": List[int], "values": List[float]} dicts
    suitable for direct insertion into Qdrant sparse vectors.

    The model downloads and caches to ~/.cache/fastembed on first use.
    """
    _cache: dict = {}

    def __init__(self, model: str = "Qdrant/bm25"):
        from fastembed import SparseTextEmbedding
        if model not in LocalSparseEmbedder._cache:
            LocalSparseEmbedder._cache[model] = SparseTextEmbedding(model_name=model)
        self.model = LocalSparseEmbedder._cache[model]

    def embed_sparse(self, texts: list[str]) -> list[dict]:
        results = list(self.model.embed(texts))
        return [{"indices": r.indices.tolist(), "values": r.values.tolist()} for r in results]
