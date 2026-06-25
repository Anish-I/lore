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
