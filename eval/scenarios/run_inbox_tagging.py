"""Ingest the Ellington inbox corpus into a fresh lore DB and classify it.

Usage (from repo root):
    python eval/scenarios/run_inbox_tagging.py --db /tmp/inbox-eval.db [--smoke]

Sets DATABASE_URL to the --db sqlite path BEFORE importing lore, so it can
never touch a live store. Provider: LORE_LLM_PROVIDER (default codex, low
effort). The corpus JSON ships beside this script.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="sqlite db file (created fresh)")
    ap.add_argument("--corpus", default=os.path.join(HERE, "inbox_ellington_494.json"))
    ap.add_argument("--smoke", action="store_true", help="classify one batch of 8 only")
    args = ap.parse_args()

    if os.path.exists(args.db):
        sys.exit(f"refusing to reuse existing db {args.db} - delete it first")
    os.environ["DATABASE_URL"] = "sqlite:///" + args.db.replace("\\", "/")
    os.environ.setdefault("LORE_LLM_PROVIDER", "codex")
    os.environ.setdefault("LORE_CODEX_EFFORT", "low")
    sys.path.insert(0, os.path.join(HERE, "..", "..", "core"))

    from lore import db
    from lore.classify import classify_untagged
    from lore.llm_providers import resolve_llm_call

    tenant = "ellington-eval"
    emails = json.load(open(args.corpus, encoding="utf-8"))
    conn = db.connect()
    db.bootstrap_schema(conn)

    for i, e in enumerate(emails):
        to = ", ".join(f"{p.get('name','')} <{p.get('addr','')}>" for p in e.get("to", []))
        cc = ", ".join(f"{p.get('name','')} <{p.get('addr','')}>" for p in e.get("cc", []))
        frm = f"{e['from'].get('name','')} <{e['from'].get('addr','')}>"
        head = [f"From: {frm}", f"To: {to}"]
        if cc:
            head.append(f"Cc: {cc}")
        head.append(f"Date: {e.get('date','')}")
        if e.get("attachment"):
            head.append(f"Attachment: {e['attachment']}")
        body = "\n".join(head) + "\n\n" + (e.get("body") or "")
        # updated_at from the email date (+minute tiebreak): classify orders
        # newest-first like a real dump onboard, not by id prefix (which would
        # group ground-truth classes into homogeneous batches).
        ts = f"{e['date']} 12:{i % 60:02d}:{i // 60:02d}"
        conn.execute(
            """insert into notes(id, tenant_id, owner_id, scope_id, title, body,
                                 source_type, updated_at)
               values(%s,%s,'me','private',%s,%s,'email',%s)
               on conflict (id) do nothing""",
            (e["id"], tenant, e.get("subject") or "(no subject)", body, ts))
    print(f"ingested {len(emails)} emails", flush=True)

    llm = resolve_llm_call(os.environ["LORE_LLM_PROVIDER"])
    if args.smoke:
        print(classify_untagged(conn, tenant, llm_call=llm, limit=8), flush=True)
        conn.close()
        return

    for run in range(1, 12):
        remaining = conn.execute(
            "select count(*) from notes n where n.tenant_id=%s and not exists "
            "(select 1 from note_tags t where t.note_id=n.id and t.tenant_id=%s)",
            (tenant, tenant)).fetchone()[0]
        if remaining == 0:
            break
        t0 = time.time()
        stats = classify_untagged(conn, tenant, llm_call=llm)
        print(f"run {run}: {remaining} remained, {stats} in {time.time()-t0:.0f}s",
              flush=True)
    conn.close()


if __name__ == "__main__":
    main()
