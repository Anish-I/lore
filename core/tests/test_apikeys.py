"""API keys (2026-07-28 spec): hashed bearer keys resolving to users."""
from lore import apikeys, db, tenancy


def _conn():
    c = db.connect()
    db.bootstrap_schema(c)
    tenancy.bootstrap_tenancy(c)
    return c


def test_create_verify_roundtrip():
    conn = _conn()
    made = apikeys.create_key(conn, "t1", "alice", "dev laptop", role="admin")
    assert made["key"].startswith("lore_sk_") and len(made["key"]) > 40
    got = apikeys.verify_key(conn, made["key"])
    assert got and got["user_id"] == "alice" and got["tenant_id"] == "t1"
    assert got["role"] == "admin" and got["id"] == made["id"]


def test_wrong_and_revoked_keys_fail():
    conn = _conn()
    made = apikeys.create_key(conn, "t1", "bob", "ci")
    assert apikeys.verify_key(conn, "lore_sk_" + "x" * 43) is None
    apikeys.revoke_key(conn, "t1", made["id"])
    assert apikeys.verify_key(conn, made["key"]) is None


def test_no_plaintext_stored_and_list_hides_hash():
    conn = _conn()
    made = apikeys.create_key(conn, "t1", "carol", "phone")
    row = conn.execute("select key_hash from api_keys where id=%s", (made["id"],)).fetchone()
    assert row and made["key"] not in row[0] and len(row[0]) == 64
    listed = apikeys.list_keys(conn, "t1")
    assert listed and all("key_hash" not in k and "key" not in k for k in listed)
    assert any(k["label"] == "phone" for k in listed)
