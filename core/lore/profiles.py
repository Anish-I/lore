"""RetrievalProfile — the retrieval stack's tuning, as data instead of deployment.

Every knob below used to be a module-level constant in `recall`, read from env at
import time. That made tuning process-wide: one daemon could serve exactly one
tuning, so an app that wanted a different recency weight needed its own engine
process — which forfeits the shared daemon, the single model load, and the one
shared memory.

A profile is that tuning made explicit and per-call. Apps sharing one engine can
each ask for different retrieval behaviour without touching each other's results,
and the eval harness can A/B a tuning instead of guessing at an env var.

    from lore.profiles import RetrievalProfile
    clerk = RetrievalProfile(name="clerk-dashboard", recency_weight=0.05)
    recall.retrieve(q, emb, rr, scopes, tenant, profile=clerk)

Frozen: a profile is a value, and the retrieval path must never be able to mutate
one caller's tuning from inside another's request. Derive variants with
`dataclasses.replace(profile, entity_boost=0.3)`.

The DEFAULT profile is not defined here — `recall._default_profile()` assembles it
from the module globals, so env-at-import and the ablation harnesses that assign
those globals at runtime both keep working unchanged.
"""
import json
from dataclasses import asdict, dataclass, fields

# "default" is not a stored profile — it names the engine's own tuning
# (recall._default_profile()). Storing one under that name would shadow the
# process default and make a caller believe their tuning applied when the
# resolution path never looked it up.
RESERVED_NAME = "default"


@dataclass(frozen=True)
class RetrievalProfile:
    """One named bundle of retrieval tuning. Defaults mirror the engine's
    shipped values (see `recall`'s module constants)."""

    name: str = "default"

    # --- rerank / hybrid blend -------------------------------------------
    # Final score blends the cross-encoder against the RRF hybrid score. The
    # weight is chosen per query type (rerank helps semantic queries, hurts
    # exact-identifier ones); `rerank_weight_forced` pins it for ablations.
    rerank_weight_forced: float | None = None
    rerank_weight_semantic: float = 0.8
    rerank_weight_lexical: float = 0.15

    # --- query side -------------------------------------------------------
    bge_query_prefix: bool = False   # BGE asymmetric-retrieval instruction prefix
    expand: bool = True              # domain-glossary query expansion

    # --- note-level signals (bounded multiplicative, applied post-blend) ---
    session_weight: float = 0.75     # raw captured-session chunks
    agent_weight: float = 0.90       # agent memory
    importance_weight: float = 0.10
    recency_weight: float = 0.20
    recency_half_life_days: float = 30.0
    entity_boost: float = 0.15
    superseded_weight: float = 0.80
    feedback_weight: float = 0.15
    tag_boost: float = 0.20          # per query-named tag carried by the note

    @property
    def memory_type_weights(self) -> dict[str, float]:
        """Memory-type axis: durable knowledge > agent memory > raw session scratch."""
        return {
            "durable": 1.0,
            "agent": self.agent_weight,
            "session": self.session_weight,
        }


# --- serialization ----------------------------------------------------------

def to_dict(profile: RetrievalProfile) -> dict:
    """Every knob in force — the EFFECTIVE view, for API responses. A caller
    inspecting its profile wants the values it will actually get, not a diff."""
    return asdict(profile)


def to_overrides(profile: RetrievalProfile) -> dict:
    """Only what this profile actually changes, plus its name — the STORED view.

    Storing a full snapshot would pin all 13 knobs at creation time, so a later
    engine that improves a default could never reach an existing profile: the
    app would silently keep the old tuning forever. Storing intent instead means
    an upgrade keeps the deliberate tweaks and refreshes everything else.

    A knob explicitly set to today's default is therefore NOT stored — "give me
    the default" keeps tracking the default rather than freezing this value.
    """
    base = RetrievalProfile()
    return {f.name: getattr(profile, f.name) for f in fields(RetrievalProfile)
            if f.name == "name" or getattr(profile, f.name) != getattr(base, f.name)}


def from_dict(d: dict, strict: bool = True) -> RetrievalProfile:
    """Build a profile from a dict; absent knobs take the engine's CURRENT default.

    strict=True (caller input): unknown keys raise. A typo'd knob
    (`recencyweight`) that silently fell through to the default is the exact
    failure this whole mechanism exists to prevent — an app believing it tuned
    something it didn't.

    strict=False (data already in the store): unknown keys are dropped. A knob
    renamed or removed by a later engine must not make a stored profile
    unloadable — that would 400 every request from the app that owns it. The same
    path covers a downgrade reading a profile a newer engine wrote.
    """
    known = {f.name for f in fields(RetrievalProfile)}
    unknown = sorted(set(d) - known)
    if unknown and strict:
        raise ValueError(f"unknown retrieval-profile field(s): {', '.join(unknown)}")
    return RetrievalProfile(**{k: v for k, v in d.items() if k in known})


# --- storage (per tenant, source of truth = the relational store) -----------

def save_profile(conn, tenant_id: str, profile: RetrievalProfile) -> RetrievalProfile:
    """Upsert a named profile for a tenant. Returns what was stored."""
    if profile.name == RESERVED_NAME:
        raise ValueError(f"{RESERVED_NAME!r} is a reserved profile name")
    if not profile.name or not profile.name.strip():
        raise ValueError("profile name must not be blank")
    conn.execute(
        """insert into retrieval_profiles(tenant_id, name, config, updated_at)
           values(%s,%s,%s,now())
           on conflict (tenant_id, name)
           do update set config=excluded.config, updated_at=now()""",
        (tenant_id, profile.name, json.dumps(to_overrides(profile))))
    return profile


def load_profile(conn, tenant_id: str, name: str):
    """The named profile, or None if this tenant has no such profile."""
    if not name or name == RESERVED_NAME:
        return None
    row = conn.execute(
        "select config from retrieval_profiles where tenant_id=%s and name=%s",
        (tenant_id, name)).fetchone()
    return from_dict(json.loads(row[0]), strict=False) if row else None


def list_profiles(conn, tenant_id: str) -> list[RetrievalProfile]:
    rows = conn.execute(
        "select config from retrieval_profiles where tenant_id=%s order by name",
        (tenant_id,)).fetchall()
    return [from_dict(json.loads(r[0]), strict=False) for r in rows]


def delete_profile(conn, tenant_id: str, name: str) -> bool:
    """True if a profile was removed, False if there was nothing to remove."""
    if load_profile(conn, tenant_id, name) is None:
        return False
    conn.execute("delete from retrieval_profiles where tenant_id=%s and name=%s",
                 (tenant_id, name))
    return True
