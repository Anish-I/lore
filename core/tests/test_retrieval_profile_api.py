"""Named retrieval profiles: stored per tenant, selected per request or per API key.

Step 2 made the tuning a value (RetrievalProfile) threaded through recall. This
pins how a CALLER gets one: a named profile stored in the engine, chosen by the
request body or bound to the API key, resolved server-side and echoed back so an
app can prove its tuning actually applied.
"""
import json

import pytest
from fastapi.testclient import TestClient

import lore.api as api
from lore import apikeys, profiles
from lore.embed import FakeEmbedder
from lore.profiles import RetrievalProfile
from lore.rerank import FakeReranker

api.app.dependency_overrides[api.get_embedder] = lambda: FakeEmbedder()
api.app.dependency_overrides[api.get_reranker] = lambda: FakeReranker()
client = TestClient(api.app)

TENANT = "t-profiles"


# ---------------------------------------------------------------------------
# serialization
# ---------------------------------------------------------------------------

def test_to_dict_from_dict_round_trip():
    p = RetrievalProfile(name="clerk", recency_weight=0.05, entity_boost=0.4,
                         rerank_weight_forced=0.5)
    assert profiles.from_dict(profiles.to_dict(p)) == p


def test_from_dict_rejects_unknown_key():
    with pytest.raises(ValueError, match="unknown"):
        profiles.from_dict({"name": "x", "recencyweight": 0.1})


def test_from_dict_tolerates_unknown_key_when_not_strict():
    """Load path: a knob renamed or removed by a later engine must not make an
    already-stored profile unloadable (that would 400 every request from the app
    that owns it). Same path covers a downgrade reading a newer profile."""
    p = profiles.from_dict({"name": "x", "entity_boost": 0.4, "knob_from_v9": 1},
                           strict=False)
    assert p.name == "x" and p.entity_boost == 0.4


# ---------------------------------------------------------------------------
# sparse storage: intent, not a snapshot
# ---------------------------------------------------------------------------

def test_to_overrides_keeps_only_what_was_changed():
    p = RetrievalProfile(name="clerk", entity_boost=0.4)
    assert profiles.to_overrides(p) == {"name": "clerk", "entity_boost": 0.4}


def test_to_overrides_drops_a_knob_set_to_its_default():
    """Explicitly setting today's default means "give me the default" — so it
    keeps tracking the default rather than pinning this value forever."""
    p = RetrievalProfile(name="c", entity_boost=RetrievalProfile().entity_boost)
    assert "entity_boost" not in profiles.to_overrides(p)


def test_untweaked_knobs_follow_the_engine_default(conn):
    """The upgrade contract: tweaks survive, everything else inherits."""
    profiles.save_profile(conn, TENANT, RetrievalProfile(name="inherit",
                                                         entity_boost=0.4))
    row = conn.execute(
        "select config from retrieval_profiles where tenant_id=%s and name=%s",
        (TENANT, "inherit")).fetchone()
    stored = json.loads(row[0])
    # not merely absent from the loaded object — absent from the STORE, so a
    # future default change cannot be shadowed by a stale pinned value.
    assert set(stored) == {"name", "entity_boost"}
    assert profiles.load_profile(conn, TENANT, "inherit").recency_weight == \
        RetrievalProfile().recency_weight


def test_load_survives_a_knob_that_no_longer_exists(conn):
    """A profile stored by a newer/older engine still loads."""
    conn.execute(
        """insert into retrieval_profiles(tenant_id, name, config, updated_at)
           values(%s,%s,%s,now())
           on conflict (tenant_id, name)
           do update set config=excluded.config""",
        (TENANT, "legacy", json.dumps({"name": "legacy", "entity_boost": 0.4,
                                       "removed_knob": 7})))
    p = profiles.load_profile(conn, TENANT, "legacy")
    assert p is not None and p.entity_boost == 0.4


def test_load_still_reads_a_full_snapshot_row(conn):
    """Rows written before sparse storage shipped keep working."""
    full = profiles.to_dict(RetrievalProfile(name="snap", entity_boost=0.4))
    conn.execute(
        """insert into retrieval_profiles(tenant_id, name, config, updated_at)
           values(%s,%s,%s,now())
           on conflict (tenant_id, name)
           do update set config=excluded.config""",
        (TENANT, "snap", json.dumps(full)))
    assert profiles.load_profile(conn, TENANT, "snap").entity_boost == 0.4


def test_api_returns_the_effective_profile_not_the_overrides():
    """A caller inspecting its profile wants every value in force, not a diff."""
    r = client.post("/profiles", json={"name": "eff", "tenant_id": TENANT,
                                       "entity_boost": 0.4})
    body = r.json()["profile"]
    assert body["entity_boost"] == 0.4
    assert body["recency_weight"] == RetrievalProfile().recency_weight


# ---------------------------------------------------------------------------
# storage
# ---------------------------------------------------------------------------

def test_save_then_load_round_trips(conn):
    p = RetrievalProfile(name="rt", session_weight=0.3, recency_weight=0.44)
    profiles.save_profile(conn, TENANT, p)
    assert profiles.load_profile(conn, TENANT, "rt") == p


def test_load_unknown_name_returns_none(conn):
    assert profiles.load_profile(conn, TENANT, "no-such-profile") is None


def test_default_name_is_reserved(conn):
    """'default' means "the engine's own tuning" — storing one would silently
    shadow it and make a caller think their profile applied."""
    with pytest.raises(ValueError, match="reserved"):
        profiles.save_profile(conn, TENANT, RetrievalProfile(name="default"))


def test_save_is_an_upsert(conn):
    profiles.save_profile(conn, TENANT, RetrievalProfile(name="up", entity_boost=0.1))
    profiles.save_profile(conn, TENANT, RetrievalProfile(name="up", entity_boost=0.9))
    assert profiles.load_profile(conn, TENANT, "up").entity_boost == 0.9
    assert [p.name for p in profiles.list_profiles(conn, TENANT)].count("up") == 1


def test_profiles_are_tenant_isolated(conn):
    profiles.save_profile(conn, "t-alpha", RetrievalProfile(name="mine"))
    assert profiles.load_profile(conn, "t-beta", "mine") is None
    assert "mine" not in [p.name for p in profiles.list_profiles(conn, "t-beta")]


def test_delete_profile(conn):
    profiles.save_profile(conn, TENANT, RetrievalProfile(name="doomed"))
    assert profiles.delete_profile(conn, TENANT, "doomed") is True
    assert profiles.load_profile(conn, TENANT, "doomed") is None
    assert profiles.delete_profile(conn, TENANT, "doomed") is False


# ---------------------------------------------------------------------------
# CRUD surface
# ---------------------------------------------------------------------------

def test_create_and_list_profiles_over_http():
    r = client.post("/profiles", json={"name": "http-a", "tenant_id": TENANT,
                                       "entity_boost": 0.42})
    assert r.status_code == 200, r.text
    assert r.json()["profile"]["entity_boost"] == 0.42

    names = [p["name"] for p in client.get(
        "/profiles", params={"tenant": TENANT}).json()["profiles"]]
    assert "http-a" in names

    got = client.get("/profiles/http-a", params={"tenant": TENANT})
    assert got.status_code == 200 and got.json()["profile"]["entity_boost"] == 0.42


def test_get_unknown_profile_is_404():
    assert client.get("/profiles/ghost", params={"tenant": TENANT}).status_code == 404


def test_create_profile_rejects_unknown_knob():
    r = client.post("/profiles", json={"name": "bad", "tenant_id": TENANT,
                                       "recencyweight": 0.1})
    assert r.status_code == 400


def test_profiles_are_in_the_v1_contract():
    paths = {r.path for r in api.app.router.routes}
    assert "/api/v1/profiles" in paths
    assert "/api/v1/profiles/{name}" in paths


# ---------------------------------------------------------------------------
# request-time selection
# ---------------------------------------------------------------------------

@pytest.fixture
def spy(monkeypatch):
    """Capture the profile retrieve() is called with."""
    seen = {}

    def _fake(query, embedder, reranker, scopes, tenant, **kw):
        seen["profile"] = kw.get("profile")
        return []
    monkeypatch.setattr(api, "retrieve", _fake)
    return seen


def test_search_threads_stored_profile_to_retrieve(spy):
    client.post("/profiles", json={"name": "sharp", "tenant_id": TENANT,
                                   "recency_weight": 0.02})
    r = client.post("/search", json={"query": "anything", "scopes": ["s1"],
                                     "tenant_id": TENANT, "profile": "sharp"})
    assert r.status_code == 200
    assert spy["profile"] == profiles.load_profile(api._conn, TENANT, "sharp")


def test_ask_threads_stored_profile_to_retrieve(spy):
    client.post("/profiles", json={"name": "asky", "tenant_id": TENANT,
                                   "entity_boost": 0.31})
    r = client.post("/ask", json={"question": "anything", "principal_scopes": ["s1"],
                                  "tenant_id": TENANT, "profile": "asky"})
    assert r.status_code == 200
    assert spy["profile"].entity_boost == 0.31


def test_context_pack_threads_stored_profile_to_retrieve(spy):
    client.post("/profiles", json={"name": "packy", "tenant_id": TENANT,
                                   "superseded_weight": 0.11})
    r = client.post("/context-pack", json={"task": "anything", "scopes": ["s1"],
                                           "tenant_id": TENANT, "profile": "packy"})
    assert r.status_code == 200
    assert spy["profile"].superseded_weight == 0.11


def test_no_profile_means_engine_default(spy):
    r = client.post("/search", json={"query": "anything", "scopes": ["s1"],
                                     "tenant_id": TENANT})
    assert r.status_code == 200
    assert spy["profile"] is None


def test_unknown_profile_name_is_rejected_not_silently_defaulted():
    """Silently falling back would let an app believe its tuning is live."""
    r = client.post("/search", json={"query": "anything", "scopes": ["s1"],
                                     "tenant_id": TENANT, "profile": "nope"})
    assert r.status_code == 400
    assert "nope" in r.text


def test_search_echoes_the_profile_it_used(spy):
    client.post("/profiles", json={"name": "echo", "tenant_id": TENANT})
    used = client.post("/search", json={"query": "q", "scopes": ["s1"],
                                        "tenant_id": TENANT, "profile": "echo"}).json()
    assert used["profile"] == "echo"
    plain = client.post("/search", json={"query": "q", "scopes": ["s1"],
                                         "tenant_id": TENANT}).json()
    assert plain["profile"] == "default"


# ---------------------------------------------------------------------------
# API-key binding — an app's identity carries its tuning
# ---------------------------------------------------------------------------

def test_key_bound_profile_applies_without_a_request_param(spy, monkeypatch):
    profiles.save_profile(api._conn, "t-key-prof",
                          RetrievalProfile(name="bound", recency_weight=0.07))
    key = apikeys.create_key(api._conn, "t-key-prof", "u-bound",
                             label="app", profile="bound")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/search", json={"query": "anything"},
                    headers={"Authorization": f"Bearer {key['key']}"})
    assert r.status_code == 200, r.text
    assert spy["profile"].recency_weight == 0.07
    assert r.json()["profile"] == "bound"


def test_request_profile_overrides_key_bound_profile(spy, monkeypatch):
    profiles.save_profile(api._conn, "t-key-prof2",
                          RetrievalProfile(name="bound2", recency_weight=0.07))
    profiles.save_profile(api._conn, "t-key-prof2",
                          RetrievalProfile(name="explicit", recency_weight=0.99))
    key = apikeys.create_key(api._conn, "t-key-prof2", "u-bound2",
                             label="app", profile="bound2")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/search", json={"query": "anything", "profile": "explicit"},
                    headers={"Authorization": f"Bearer {key['key']}"})
    assert r.status_code == 200, r.text
    assert spy["profile"].recency_weight == 0.99


def test_key_without_a_profile_uses_the_engine_default(spy, monkeypatch):
    key = apikeys.create_key(api._conn, "t-key-prof3", "u-plain", label="app")
    monkeypatch.setenv("LORE_API_KEYS", "1")
    r = client.post("/search", json={"query": "anything"},
                    headers={"Authorization": f"Bearer {key['key']}"})
    assert r.status_code == 200, r.text
    assert spy["profile"] is None


# ---------------------------------------------------------------------------
# LoreClient — the supported path an app actually uses
# ---------------------------------------------------------------------------

def _sdk(**kw):
    """LoreClient with its transport routed through the in-process app, plus a
    record of every request body it sent."""
    from lore.client import LoreClient

    sent = []

    class _T(LoreClient):
        def _request(self, method, path, *, body=None, params=None):
            sent.append({"path": path, "body": body, "params": params})
            r = client.request(method, "/api/v1" + path, json=body, params=params)
            return r.json() if r.status_code < 400 else {}

    return _T(tenant=TENANT, scopes=["s1"], **kw), sent


def test_sdk_sends_per_call_profile(spy):
    client.post("/profiles", json={"name": "sdk-a", "tenant_id": TENANT})
    lore, sent = _sdk()
    lore.search("q", profile="sdk-a")
    assert sent[-1]["body"]["profile"] == "sdk-a"
    assert spy["profile"].name == "sdk-a"


def test_sdk_default_profile_applies_to_every_call(spy):
    client.post("/profiles", json={"name": "sdk-b", "tenant_id": TENANT})
    lore, sent = _sdk(profile="sdk-b")
    lore.ask("q")
    lore.context_pack("t")
    assert [s["body"]["profile"] for s in sent] == ["sdk-b", "sdk-b"]


def test_sdk_per_call_profile_overrides_the_default(spy):
    client.post("/profiles", json={"name": "sdk-c", "tenant_id": TENANT})
    client.post("/profiles", json={"name": "sdk-d", "tenant_id": TENANT})
    lore, sent = _sdk(profile="sdk-c")
    lore.search("q", profile="sdk-d")
    assert sent[-1]["body"]["profile"] == "sdk-d"


def test_sdk_default_profile_comes_from_env(monkeypatch, spy):
    monkeypatch.setenv("LORE_PROFILE", "sdk-env")
    client.post("/profiles", json={"name": "sdk-env", "tenant_id": TENANT})
    lore, sent = _sdk()
    lore.search("q")
    assert sent[-1]["body"]["profile"] == "sdk-env"


def test_sdk_omits_profile_when_unset(spy):
    """No profile on the wire => the API key's binding still decides."""
    lore, sent = _sdk()
    lore.search("q")
    assert "profile" not in sent[-1]["body"]
