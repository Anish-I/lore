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
    # Note: _client.search() was removed in qdrant-client 1.7+; using query_points instead.
    flt = qm.Filter(must=[
        qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
        qm.FieldCondition(key="scope_ids", match=qm.MatchAny(any=list(allowed_scope_ids))),
    ])
    res = _client.query_points(
        collection_name=COLLECTION,
        query=vector,
        query_filter=flt,
        limit=limit,
        with_payload=True,
    )
    return [{"score": r.score, **r.payload} for r in res.points]
