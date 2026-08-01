"""Which embedding model built the index — recorded, and enforced on every write.

A Qdrant collection stores the vector DIMENSION and nothing about the model that
produced the vectors. That makes the dangerous case silent: bge-small-en-v1.5,
all-MiniLM-L6-v2 and e5-small-v2 are all 384-dim, so swapping one for another is
invisible to the store. Cosine similarity keeps working, queries keep returning
results, and every one of them is nonsense from an unrelated vector space. No
exception, no log line — just recall that quietly got worse and looks like a
ranking regression.

The swap is one environment variable away: `get_embedder()` returns Voyage the
moment VOYAGE_API_KEY is set, on a machine whose index was built locally.

So: the SQLite/Postgres store (source of truth) records the model identity for
each collection, and the write path refuses to mix. A real model change is then
an explicit rebuild — the ONLY correct response, since the old vectors cannot be
translated into the new space.

Not part of the identity: the BGE query-instruction prefix. It is applied to the
QUERY side only (recall.dense_query_text), never to stored vectors, so it is free
to vary per request — which is what makes it a legitimate profile knob.
"""
from dataclasses import dataclass

# Identities that must never be written to the store. VAULT_FAKE runs (tests, CI)
# use a hash-based stand-in embedder; stamping that onto a real collection would
# then refuse every subsequent real write.
_UNBINDABLE = frozenset({"fake"})


class IndexIdentityMismatch(RuntimeError):
    """The live embedder is not the one that built this index."""


@dataclass(frozen=True)
class EmbedIdentity:
    model_id: str
    dim: int


def local_model_id(model_name: str) -> str:
    """Identity for a fastembed model. Namespaced by provider so a local model can
    never collide with a hosted one of the same name."""
    return f"fastembed:{model_name}"


def voyage_model_id(model_name: str) -> str:
    return f"voyage:{model_name}"


def identity_of(embedder, dim: int) -> EmbedIdentity:
    """The identity of a live embedder. `dim` comes from the vectors it just
    produced — the only source that cannot disagree with reality."""
    return EmbedIdentity(getattr(embedder, "model_id", type(embedder).__name__), dim)


# --- storage ---------------------------------------------------------------

def _collection(collection=None) -> str:
    if collection is not None:
        return collection
    from . import qdrant_store
    return qdrant_store.COLLECTION


def recorded(conn, collection=None):
    """The identity bound to this collection, or None if nothing has bound it."""
    row = conn.execute(
        "select model_id, dim from index_identity where collection=%s",
        (_collection(collection),)).fetchone()
    return EmbedIdentity(row[0], row[1]) if row else None


def record(conn, identity: EmbedIdentity, collection=None) -> None:
    """Bind an identity to a collection (idempotent)."""
    conn.execute(
        """insert into index_identity(collection, model_id, dim, recorded_at)
           values(%s,%s,%s,now())
           on conflict (collection)
           do update set model_id=excluded.model_id, dim=excluded.dim,
                         recorded_at=now()""",
        (_collection(collection), identity.model_id, identity.dim))


def unbind(conn, collection=None) -> None:
    """Forget which model built this collection. Only valid once the vectors are
    actually gone — the next write binds whatever model produces them."""
    conn.execute("delete from index_identity where collection=%s",
                 (_collection(collection),))


def rebind(conn, identity: EmbedIdentity, collection=None) -> None:
    """Replace the recorded identity — for use AFTER a genuine rebuild, once the
    old vectors are gone. Never call this to silence a mismatch: the vectors in
    the store would stay in the old model's space."""
    record(conn, identity, collection)


def check_read(conn, embedder, collection=None) -> None:
    """Gate a read. Model identity only — the read path has no vectors to measure
    a dimension from, and dimension is already enforced on write. A query embedded
    by the wrong model returns confident nonsense, which is worse than an error."""
    model_id = getattr(embedder, "model_id", type(embedder).__name__)
    if model_id in _UNBINDABLE:
        return
    have = recorded(conn, collection)
    if have is None or have.model_id == model_id:
        return
    raise IndexIdentityMismatch(
        f"index '{_collection(collection)}' was built with {have.model_id}; this "
        f"engine resolves {model_id}. Queries embedded by a different model return "
        f"meaningless results. Fastest fix: restore the previous model (the "
        f"VOYAGE_API_KEY / LORE_*_MODEL that was set when it was indexed). "
        f"Otherwise rebuild: POST /admin/rebuild-index {{\"confirm\": true}}.")


def enforce(conn, identity: EmbedIdentity, collection=None) -> None:
    """Gate a write. Binds on first use, passes on a match, raises on a change."""
    if identity.model_id in _UNBINDABLE:
        return
    have = recorded(conn, collection)
    if have is None:
        record(conn, identity, collection)
        return
    if have == identity:
        return
    raise IndexIdentityMismatch(
        f"index '{_collection(collection)}' was built with {have.model_id} "
        f"({have.dim}-dim); this engine resolves {identity.model_id} "
        f"({identity.dim}-dim). Vectors from different models are not comparable. "
        f"Fastest fix: restore the previous model. Otherwise rebuild: "
        f"POST /admin/rebuild-index {{\"confirm\": true}}.")
