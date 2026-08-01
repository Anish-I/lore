"""Score lore's inbox tagging vs the Ellington ground truth (topics + roles).

Usage: python eval/scenarios/score_inbox_tagging.py --db /tmp/inbox-eval.db

Gates (spec 2026-07-27-classify-role-axis-design.md):
  G1 SPAM recall by solicitation|bulk        >= 0.85
  G2 non-SPAM emails roled solicitation      <= 5%
  G3 human mail (Context/Search/Exhibit*) roled correspondence >= 90%
  G4 distinct topics                         <= 40
  G5 topic->class purity                     >= 0.75
Role gates report SKIP when the DB predates the role axis (coverage 0).
Exit 1 if any evaluated gate fails.

Corpus provenance: extracted from "[2026.07.27]-lore-test-inbox-500-v1.html"
(const EMAILS array; double-encoded UTF-8 repaired via cp1252->utf-8 round-trip).
"""
import argparse
import json
import math
import os
import sqlite3
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
TENANT = "ellington-eval"
HUMAN = ("Context", "Search", "Exhibit 1", "Exhibit 2", "Exhibit 3")


def nmi(a, b):
    ids = sorted(set(a) & set(b))
    n = len(ids)
    if not n:
        return 0.0
    ca, cb, cab = Counter(), Counter(), Counter()
    for i in ids:
        ca[a[i]] += 1
        cb[b[i]] += 1
        cab[(a[i], b[i])] += 1
    mi = sum((c / n) * math.log((c * n) / (ca[x] * cb[y]))
             for (x, y), c in cab.items())
    ha = -sum((c / n) * math.log(c / n) for c in ca.values())
    hb = -sum((c / n) * math.log(c / n) for c in cb.values())
    d = math.sqrt(ha * hb)
    return mi / d if d else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--corpus", default=os.path.join(HERE, "inbox_ellington_494.json"))
    args = ap.parse_args()

    emails = {e["id"]: e for e in json.load(open(args.corpus, encoding="utf-8"))}
    dbc = sqlite3.connect(args.db)
    topic, role = {}, {}
    for nid, kind, tag in dbc.execute(
            "select note_id, kind, tag from note_tags where tenant_id=?", (TENANT,)):
        if kind == "topic":
            topic[nid] = tag
        elif kind == "role":
            role[nid] = tag

    ids = [i for i in emails if i in topic]
    print(f"emails {len(emails)}  topics assigned {len(ids)}  roles assigned "
          f"{sum(1 for i in ids if i in role)}")

    klass = {i: "+".join(sorted(emails[i]["tags"])) for i in ids}
    thread = {i: emails[i]["thread"] for i in ids}
    tcount = Counter(topic[i] for i in ids)
    groups = defaultdict(list)
    for i in ids:
        groups[topic[i]].append(i)
    purity = sum(Counter(klass[i] for i in m).most_common(1)[0][1]
                 for m in groups.values()) / len(ids)
    print(f"distinct topics {len(tcount)}  purity {purity:.3f}  "
          f"nmi/class {nmi(topic, klass):.3f}  nmi/thread {nmi(topic, thread):.3f}")

    results = []
    have_roles = any(i in role for i in ids)
    if have_roles:
        spam = [i for i in ids if "SPAM" in emails[i]["tags"]]
        nonspam = [i for i in ids if "SPAM" not in emails[i]["tags"]]
        human = [i for i in ids
                 if any(t in HUMAN for t in emails[i]["tags"])
                 and "SPAM" not in emails[i]["tags"]]
        g1 = sum(1 for i in spam if role.get(i) in ("solicitation", "bulk")) / len(spam)
        g2 = sum(1 for i in nonspam if role.get(i) == "solicitation") / len(nonspam)
        g3 = sum(1 for i in human if role.get(i) == "correspondence") / len(human)
        rd = Counter(role.get(i, "(none)") for i in ids)
        print(f"role distribution: {dict(rd)}")
        results += [("G1 spam recall by solicitation|bulk >= 0.85", g1, g1 >= 0.85),
                    ("G2 non-spam roled solicitation <= 0.05", g2, g2 <= 0.05),
                    ("G3 human mail roled correspondence >= 0.90", g3, g3 >= 0.90)]
    else:
        print("no role rows - role gates SKIP (baseline DB)")
    results += [("G4 distinct topics <= 40", len(tcount), len(tcount) <= 40),
                ("G5 purity >= 0.75", purity, purity >= 0.75)]

    ok = True
    for name, val, passed in results:
        ok &= passed
        shown = val if isinstance(val, int) else f"{val:.3f}"
        print(f"{'PASS' if passed else 'FAIL'}  {name}  (got {shown})")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
