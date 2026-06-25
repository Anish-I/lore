import os
from qdrant_client import QdrantClient
from qdrant_client.http import models as qm
from .config import settings

# Collection is overridable (eval/test isolation). Set QDRANT_COLLECTION before import.
COLLECTION = os.environ.get("QDRANT_COLLECTION", "vault_chunks")
_client = QdrantClient(url=settings.qdrant_url)


def ensure_collection(dim, with_sparse=False):
    """Create the Qdrant collection with named dense vector "dense" and optional
    sparse vector "bm25" (IDF-weighted).  If the collection exists in the old
    unnamed-vector format it is deleted and recreated automatically (migration).

    Deviation from spec: SparseVectorParams accepts an *index* kwarg of type
    SparseIndexParams (not a plain on_disk bool), and modifier is passed directly
    as qm.Modifier.IDF — there is no separate Bm25Config wrapper needed.
    """
    existing = [c.name for c in _client.get_collections().collections]
    if COLLECTION in existing:
        # Migrate old unnamed-vector format to named-vector format.
        info = _client.get_collection(COLLECTION)
        if not isinstance(info.config.params.vectors, dict):
            _client.delete_collection(COLLECTION)
            existing = [c.name for c in _client.get_collections().collections]
    if COLLECTION not in existing:
        sparse_cfg = None
        if with_sparse:
            sparse_cfg = {
                "bm25": qm.SparseVectorParams(
                    index=qm.SparseIndexParams(on_disk=False),
                    modifier=qm.Modifier.IDF,
                )
            }
        _client.create_collection(
            collection_name=COLLECTION,
            vectors_config={"dense": qm.VectorParams(size=dim, distance=qm.Distance.COSINE)},
            sparse_vectors_config=sparse_cfg,
        )
        _client.create_payload_index(COLLECTION, "tenant_id", qm.PayloadSchemaType.KEYWORD)
        _client.create_payload_index(COLLECTION, "scope_ids", qm.PayloadSchemaType.KEYWORD)
    ensure_text_index()  # always (idempotent) so the exact-identifier lane works


def delete_note(note_id: str) -> None:
    """Delete all Qdrant points whose payload note_id matches the given note_id."""
    existing = [c.name for c in _client.get_collections().collections]
    if COLLECTION not in existing:
        return
    _client.delete(
        COLLECTION,
        points_selector=qm.FilterSelector(
            filter=qm.Filter(must=[
                qm.FieldCondition(key="note_id", match=qm.MatchValue(value=note_id))
            ])
        ),
    )


def upsert(points):
    """Upsert points with named vectors.  Accepts both legacy flat-list vectors
    (dense-only) and named-vector dicts ({"dense": [...], "bm25": {...}}).
    Sparse bm25 values (plain dicts) are converted to qm.SparseVector objects.
    """
    struct_points = []
    for p in points:
        vec = p["vector"]
        # Support legacy flat list (dense-only) from pre-named-vector code paths.
        if isinstance(vec, list):
            vec = {"dense": vec}
        # Convert bm25 sparse dict to SparseVector object if needed.
        if "bm25" in vec and isinstance(vec["bm25"], dict):
            vec = dict(vec)  # shallow copy so we don't mutate caller's dict
            vec["bm25"] = qm.SparseVector(
                indices=vec["bm25"]["indices"],
                values=vec["bm25"]["values"],
            )
        struct_points.append(
            qm.PointStruct(id=p["id"], vector=vec, payload=p["payload"])
        )
    _client.upsert(COLLECTION, points=struct_points)


def search(vector, allowed_scope_ids, tenant_id, limit=40):
    """Dense-only ANN search over the named "dense" vector.

    Note: _client.search() was removed in qdrant-client 1.7+; using query_points instead.
    """
    flt = qm.Filter(must=[
        qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
        qm.FieldCondition(key="scope_ids", match=qm.MatchAny(any=list(allowed_scope_ids))),
    ])
    res = _client.query_points(
        collection_name=COLLECTION,
        query=vector,
        using="dense",
        query_filter=flt,
        limit=limit,
        with_payload=True,
    )
    return [{"score": r.score, **r.payload} for r in res.points]


def ensure_text_index():
    """Add a full-text payload index on 'text' so exact identifier tokens are searchable.
    Idempotent; safe to call on an existing populated collection (indexes in place)."""
    try:
        _client.create_payload_index(
            COLLECTION, "text",
            field_schema=qm.TextIndexParams(type="text", tokenizer=qm.TokenizerType.WORD,
                                            min_token_len=2, lowercase=True),
        )
    except Exception:
        pass

def search_exact(token, allowed_scope_ids, tenant_id, limit=10):
    """Filter-only retrieval of chunks whose text literally contains the token
    (used as an exact-identifier lane). ACL-filtered. Returns payload dicts."""
    flt = qm.Filter(must=[
        qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
        qm.FieldCondition(key="scope_ids", match=qm.MatchAny(any=list(allowed_scope_ids))),
        qm.FieldCondition(key="text", match=qm.MatchText(text=token)),
    ])
    try:
        pts, _ = _client.scroll(COLLECTION, scroll_filter=flt, limit=limit, with_payload=True)
    except Exception:
        return []
    return [dict(p.payload) for p in pts]


def search_sparse(sparse_vector, allowed_scope_ids, tenant_id, limit=40):
    """BM25-only sparse search over the "bm25" named sparse vector (for tracing/UI)."""
    flt = qm.Filter(must=[
        qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
        qm.FieldCondition(key="scope_ids", match=qm.MatchAny(any=list(allowed_scope_ids))),
    ])
    sv = qm.SparseVector(indices=sparse_vector["indices"], values=sparse_vector["values"])
    res = _client.query_points(
        collection_name=COLLECTION, query=sv, using="bm25",
        query_filter=flt, limit=limit, with_payload=True,
    )
    return [{"score": r.score, **r.payload} for r in res.points]


def search_hybrid(dense_vector, sparse_vector, allowed_scope_ids, tenant_id, limit=40):
    """Two-lane prefetch (dense ANN + BM25 sparse) fused via Qdrant RRF.

    ACL filter is applied inside each prefetch lane so tenant/scope access
    control is enforced before results are fused, not after.

    sparse_vector must be a dict: {"indices": List[int], "values": List[float]}.
    Returns the same structure as search(): list of {score, **payload} dicts,
    where score is Qdrant's RRF-fused relevance score.
    """
    flt = qm.Filter(must=[
        qm.FieldCondition(key="tenant_id", match=qm.MatchValue(value=tenant_id)),
        qm.FieldCondition(key="scope_ids", match=qm.MatchAny(any=list(allowed_scope_ids))),
    ])
    sv = qm.SparseVector(
        indices=sparse_vector["indices"],
        values=sparse_vector["values"],
    )
    res = _client.query_points(
        collection_name=COLLECTION,
        prefetch=[
            qm.Prefetch(query=dense_vector, using="dense", filter=flt, limit=limit),
            qm.Prefetch(query=sv, using="bm25", filter=flt, limit=limit),
        ],
        query=qm.FusionQuery(fusion=qm.Fusion.RRF),
        limit=limit,
        with_payload=True,
    )
    return [{"score": r.score, **r.payload} for r in res.points]
