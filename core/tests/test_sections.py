"""Sections: auto-classification (tags/topics) + proposed Sections.

The contract under test, including the CRITICAL SAFEGUARD: the backend never
touches the filesystem.  Proposals are DB rows; apply/undo only flip state and
return move plans (recording each note's original path for undo).  The desktop
performs any actual move, and only on explicit user action.
"""
import json
import os

from fastapi.testclient import TestClient

from lore import db
from lore.api import app
from lore.classify import classify_fallback, classify_untagged
from lore.sections import (
    SectionError, apply_section, dismiss_section, list_sections,
    propose_sections, undo_section,
)
from lore.upkeep import run_upkeep
from lore.embed import FakeEmbedder

client = TestClient(app)

_SCOPE = "private"


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    return c


def _insert_note(conn, tenant, nid, title, body, path=None, source_type="note"):
    conn.execute(
        """insert into notes(id, tenant_id, owner_id, scope_id, source_path, title,
                             source_type, body, updated_at)
           values(%s,%s,'me',%s,%s,%s,%s,%s,now())
           on conflict (id) do update
           set title=excluded.title, body=excluded.body, source_path=excluded.source_path,
               updated_at=now()""",
        (nid, tenant, _SCOPE, path, title, source_type, body),
    )


def _topic_of(conn, tenant, nid):
    row = conn.execute(
        "select tag from note_tags where tenant_id=%s and note_id=%s and kind='topic'",
        (tenant, nid)).fetchone()
    return row[0] if row else None


def _tags_of(conn, tenant, nid):
    return sorted(r[0] for r in conn.execute(
        "select tag from note_tags where tenant_id=%s and note_id=%s and kind='tag'",
        (tenant, nid)).fetchall())


# ---------------------------------------------------------------------------
# classification
# ---------------------------------------------------------------------------

def test_classify_fallback_frontmatter_hashtags_wikilink():
    res = classify_fallback(
        "Kalshi notes",
        "---\ntags: [Trading, Crypto Bots]\n---\n\nWorking on [[Kalshi Bot]] today. #python\n")
    assert res["tags"] == ["trading", "crypto-bots", "python"]
    assert res["topic"] == "Kalshi Bot"


def test_classify_fallback_block_tags_and_topic_field():
    res = classify_fallback(
        "n", "---\ntags:\n  - alpha\n  - beta\ntopic: Wingman V3\n---\nbody\n")
    assert res["tags"] == ["alpha", "beta"]
    assert res["topic"] == "Wingman V3"


def test_classify_untagged_with_injected_llm():
    tenant = "sec-classify-llm"
    conn = _conn()
    _insert_note(conn, tenant, "cl-1", "Note One", "Some prose about deployment pipelines.")
    _insert_note(conn, tenant, "cl-2", "Note Two", "More prose about kubernetes.")

    def fake_llm(prompt):
        assert "STRICT JSON" in prompt
        # Batch order is by recency — answer per title so the test is order-agnostic.
        import re as _re
        out = []
        for m in _re.finditer(r'NOTE (\d+): title="([^"]+)"', prompt):
            idx, title = int(m.group(1)), m.group(2)
            tags = ["DevOps", "ci"] if title == "Note One" else ["k8s"]
            out.append({"id": idx, "tags": tags, "topic": "Infrastructure"})
        return json.dumps(out)

    stats = classify_untagged(conn, tenant, llm_call=fake_llm)
    assert stats["status"] == "ok"
    assert stats["llmTagged"] == 2
    assert _tags_of(conn, tenant, "cl-1") == ["ci", "devops"]
    assert _topic_of(conn, tenant, "cl-2") == "Infrastructure"

    # Idempotent: already-tagged notes are not reprocessed.
    stats2 = classify_untagged(conn, tenant, llm_call=fake_llm)
    assert stats2["notesTagged"] == 0


def test_classify_provider_unavailable_falls_back(monkeypatch):
    """No usable LLM provider → status 'provider-unavailable' + deterministic tags."""
    import lore.classify as classify_mod
    monkeypatch.setattr(classify_mod, "provider_available", lambda p: False)
    tenant = "sec-classify-fb"
    conn = _conn()
    _insert_note(conn, tenant, "fb-1", "FB note", "Notes on [[Wingman]] rework. #expo\n")
    stats = classify_untagged(conn, tenant)
    assert stats["status"] == "provider-unavailable"
    assert stats["fallbackTagged"] == 1
    assert _tags_of(conn, tenant, "fb-1") == ["expo"]
    assert _topic_of(conn, tenant, "fb-1") == "Wingman"


def test_classify_llm_garbage_falls_back_per_note():
    tenant = "sec-classify-garbage"
    conn = _conn()
    _insert_note(conn, tenant, "g-1", "G note", "About [[Graphs]]. #viz\n")
    stats = classify_untagged(conn, tenant, llm_call=lambda p: "not json at all")
    assert stats["fallbackTagged"] == 1
    assert _topic_of(conn, tenant, "g-1") == "Graphs"


# ---------------------------------------------------------------------------
# proposals: threshold
# ---------------------------------------------------------------------------

def _seed_topic_notes(conn, tenant, topic, n, prefix="p"):
    for i in range(n):
        nid = f"{prefix}-{i}"
        _insert_note(conn, tenant, nid, f"{prefix} {i}", "body",
                     path=f"/fake/lib/{prefix}-{i}.md")
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,%s,'topic','llm') on conflict do nothing",
            (nid, tenant, topic))


def test_proposal_created_at_threshold_not_below():
    tenant = "sec-threshold"
    conn = _conn()
    _seed_topic_notes(conn, tenant, "Alpha Topic", 5, prefix="al")
    _seed_topic_notes(conn, tenant, "Beta Topic", 4, prefix="be")

    stats = propose_sections(conn, tenant, threshold=5)
    assert stats["proposed"] == 1

    secs = list_sections(conn, tenant)
    assert len(secs) == 1
    sec = secs[0]
    assert sec["name"] == "Alpha Topic"
    assert sec["status"] == "proposed"
    assert len(sec["notes"]) == 5
    assert all(n["path"] for n in sec["notes"])

    # Re-running refreshes rather than duplicating.
    stats2 = propose_sections(conn, tenant, threshold=5)
    assert stats2["proposed"] == 0 and stats2["updated"] == 1
    assert len(list_sections(conn, tenant)) == 1


def test_notes_already_in_topic_folder_are_not_proposed():
    tenant = "sec-already"
    conn = _conn()
    for i in range(5):
        nid = f"in-{i}"
        _insert_note(conn, tenant, nid, f"in {i}", "body",
                     path=f"/fake/lib/Gamma Topic/in-{i}.md")
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Gamma Topic','topic','llm') on conflict do nothing",
            (nid, tenant))
    stats = propose_sections(conn, tenant, threshold=5)
    assert stats["proposed"] == 0
    assert list_sections(conn, tenant) == []


# ---------------------------------------------------------------------------
# apply / dismiss / undo state machine + no-auto-move safeguard
# ---------------------------------------------------------------------------

def test_apply_records_original_paths_and_never_touches_files(tmp_path):
    tenant = "sec-apply"
    conn = _conn()
    files = []
    for i in range(5):
        p = tmp_path / f"note-{i}.md"
        p.write_text(f"# note {i}\n", encoding="utf-8")
        files.append(str(p))
        nid = f"ap-{i}"
        _insert_note(conn, tenant, nid, f"ap {i}", "body", path=str(p))
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Delta Topic','topic','llm') on conflict do nothing",
            (nid, tenant))
    propose_sections(conn, tenant, threshold=5)
    sid = list_sections(conn, tenant)[0]["id"]

    dest = str(tmp_path / "Delta Topic").replace("\\", "/")
    plan = apply_section(conn, tenant, sid, dest_dir=dest)
    assert plan["ok"] and plan["folder"] == "Delta Topic"
    assert len(plan["moves"]) == 5
    for mv in plan["moves"]:
        assert mv["from"] in files
        assert mv["to"] == f"{dest}/{os.path.basename(mv['from'])}"

    # SAFEGUARD: the backend recorded a plan but moved NOTHING.
    for f in files:
        assert os.path.exists(f), "backend must never move files"
    assert not os.path.exists(str(tmp_path / "Delta Topic"))

    sec = list_sections(conn, tenant)[0]
    assert sec["status"] == "applied"
    assert len(sec["original_paths"]) == 5

    # Cannot re-apply or dismiss an applied section.
    for fn in (apply_section, dismiss_section):
        try:
            fn(conn, tenant, sid)
            assert False, f"{fn.__name__} should have raised on applied section"
        except SectionError:
            pass

    # Undo: returns the recorded originals and reverts to proposed.
    undo = undo_section(conn, tenant, sid)
    assert len(undo["moves"]) == 5
    assert {m["from"] for m in undo["moves"]} == set(files)
    sec = list_sections(conn, tenant)[0]
    assert sec["status"] == "proposed"
    assert sec["original_paths"] is None

    # Undo only valid from applied.
    try:
        undo_section(conn, tenant, sid)
        assert False, "undo should have raised on proposed section"
    except SectionError:
        pass


def test_dismiss_is_sticky():
    tenant = "sec-dismiss"
    conn = _conn()
    _seed_topic_notes(conn, tenant, "Epsilon Topic", 5, prefix="di")
    propose_sections(conn, tenant, threshold=5)
    sid = list_sections(conn, tenant)[0]["id"]
    assert dismiss_section(conn, tenant, sid)["status"] == "dismissed"
    # Never re-proposed after dismiss.
    stats = propose_sections(conn, tenant, threshold=5)
    assert stats["proposed"] == 0 and stats["updated"] == 0
    assert list_sections(conn, tenant)[0]["status"] == "dismissed"


def test_applied_notes_not_reproposed_under_new_topic():
    tenant = "sec-claimed"
    conn = _conn()
    _seed_topic_notes(conn, tenant, "Zeta Topic", 5, prefix="zc")
    propose_sections(conn, tenant, threshold=5)
    sid = list_sections(conn, tenant)[0]["id"]
    apply_section(conn, tenant, sid, dest_dir="/fake/lib/Zeta Topic")
    # The same notes acquire a second topic — but they're claimed by an applied section.
    for i in range(5):
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Other Topic','topic','llm') on conflict do nothing",
            (f"zc-{i}", tenant))
    stats = propose_sections(conn, tenant, threshold=5)
    assert stats["proposed"] == 0


# ---------------------------------------------------------------------------
# HTTP endpoints + upkeep integration
# ---------------------------------------------------------------------------

def test_sections_endpoints_roundtrip(tmp_path):
    tenant = "sec-http"
    conn = _conn()
    files = []
    for i in range(5):
        p = tmp_path / f"h-{i}.md"
        p.write_text("# h\n", encoding="utf-8")
        files.append(str(p))
        nid = f"ht-{i}"
        _insert_note(conn, tenant, nid, f"ht {i}", "body", path=str(p))
        conn.execute(
            "insert into note_tags(note_id, tenant_id, tag, kind, source) "
            "values(%s,%s,'Http Topic','topic','llm') on conflict do nothing",
            (nid, tenant))
    propose_sections(conn, tenant, threshold=5)

    r = client.get("/sections", params={"tenant": tenant})
    assert r.status_code == 200
    secs = r.json()["sections"]
    assert len(secs) == 1 and secs[0]["status"] == "proposed"
    sid = secs[0]["id"]

    r = client.post(f"/sections/{sid}/apply",
                    json={"tenant": tenant, "dest_dir": str(tmp_path / "Http Topic")})
    assert r.status_code == 200
    assert len(r.json()["moves"]) == 5
    for f in files:
        assert os.path.exists(f)  # SAFEGUARD: HTTP apply moved nothing

    # 409 on invalid transitions.
    assert client.post(f"/sections/{sid}/apply", json={"tenant": tenant}).status_code == 409
    assert client.post(f"/sections/{sid}/dismiss", json={"tenant": tenant}).status_code == 409

    r = client.post(f"/sections/{sid}/undo", json={"tenant": tenant})
    assert r.status_code == 200 and len(r.json()["moves"]) == 5
    assert client.post(f"/sections/{sid}/undo", json={"tenant": tenant}).status_code == 409

    r = client.post(f"/sections/{sid}/dismiss", json={"tenant": tenant})
    assert r.status_code == 200

    # /tags reports the topic.
    r = client.get("/tags", params={"tenant": tenant})
    assert r.status_code == 200
    assert "Http Topic" in r.json()["topics"]

    # unknown id → 409 (section not found)
    assert client.post("/sections/sec:none:x/apply", json={"tenant": tenant}).status_code == 409


def test_run_upkeep_auto_classify_proposes_sections():
    tenant = "sec-upkeep"
    conn = _conn()
    for i in range(5):
        _insert_note(conn, tenant, f"uk-{i}", f"Note uk {i}",
                     f"Progress on [[Shared Project]] item {i}. #work\n",
                     path=f"/fake/lib/uk-{i}.md")

    def fake_llm(prompt):
        return json.dumps([
            {"id": j, "tags": ["work"], "topic": "Shared Project"} for j in range(8)
        ])

    stats = run_upkeep(conn, FakeEmbedder(), tenant, scope=_SCOPE,
                       auto_classify=True, classify_llm=fake_llm, section_threshold=5)
    assert stats["classify"]["notesTagged"] >= 5
    assert stats["sections"]["proposed"] == 1
    secs = list_sections(conn, tenant)
    assert secs and secs[0]["name"] == "Shared Project"

    # Default runs (auto_classify off) don't add classification keys.
    stats2 = run_upkeep(conn, FakeEmbedder(), tenant, scope=_SCOPE)
    assert "classify" not in stats2
