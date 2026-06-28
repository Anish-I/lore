"""Generate & bulk-index a realistic car-insurance company into Vault.

Apex Auto Insurance: CEO -> C-suite -> 12 teams -> people, plus 6 cross-cutting
circles. Each person authors role-appropriate notes tagged to a scope
(private / team / circle / enterprise). Bulk batch-embeds (BGE + BM25) and
batch-upserts to an ISOLATED Qdrant collection (vault_company) + Postgres
(tenant 'apex'), so the live demo (vault_chunks) is untouched.

Config via env:
  PEOPLE_PER_TEAM   (default 25  -> ~300 people)
  NOTES_PER_PERSON  (default 150 -> ~45k notes)
Run from core/:  python ../sim/generate_company.py
"""
import os, hashlib, uuid, random, time

os.environ["QDRANT_COLLECTION"] = os.environ.get("VAULT_COLLECTION", "vault_company")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
TENANT = "apex"
SEED = 42
PEOPLE_PER_TEAM = int(os.environ.get("PEOPLE_PER_TEAM", "25"))
NOTES_PER_PERSON = int(os.environ.get("NOTES_PER_PERSON", "150"))
BATCH = 512
UPSERT_BATCH = 1000

from lore import db, qdrant_store
from lore.embed import LocalEmbedder, LocalSparseEmbedder
from lore.chunker import chunk_markdown

rng = random.Random(SEED)

TEAMS = ["underwriting", "claims", "actuarial", "fraud-siu", "customer-service",
         "legal-compliance", "marketing", "it-eng", "finance", "hr",
         "sales-distribution", "product"]
CIRCLES = {
    "exec-committee":       set(),  # filled with C-suite
    "rate-filing-2026":     {"actuarial", "legal-compliance", "finance"},
    "project-telematics":   {"actuarial", "it-eng", "product"},
    "catastrophe-response": {"claims", "finance", "legal-compliance"},
    "ma-diligence":         {"finance", "legal-compliance", "product"},
    "data-governance":      {"it-eng", "legal-compliance", "actuarial"},
}
CSUITE = [("ceo", "Chief Executive Officer", None),
          ("cfo", "Chief Financial Officer", "finance"),
          ("cto", "Chief Technology Officer", "it-eng"),
          ("coo", "Chief Operating Officer", "claims"),
          ("cmo", "Chief Marketing Officer", "marketing"),
          ("chief-actuary", "Chief Actuary", "actuarial"),
          ("gc", "General Counsel", "legal-compliance"),
          ("cco", "Chief Claims Officer", "claims")]

STATES = ["CA", "TX", "FL", "NY", "IL", "PA", "OH", "GA", "NC", "MI", "NJ", "AZ"]
PERILS = ["collision", "comprehensive", "bodily injury", "property damage",
          "uninsured motorist", "hail", "theft", "flood", "rear-end", "rollover"]
FIRST = ["Alex","Sam","Jordan","Taylor","Morgan","Casey","Riley","Jamie","Avery","Quinn",
         "Drew","Reese","Skyler","Cameron","Hayden","Parker","Rowan","Emerson","Devon","Blair"]
LAST = ["Nguyen","Patel","Garcia","Smith","Khan","Johnson","Lopez","Brown","Davis","Martin",
        "Lee","Walker","Hall","Young","Allen","Wright","Scott","Green","Adams","Baker"]

def pol(): return f"POL-{rng.randint(100000,999999)}"
def clm(): return f"CLM-{rng.randint(10000,99999)}"
def eng(): return f"ENG-{rng.randint(1000,9999)}"
def fil(): return f"RF-{rng.choice(STATES)}-{rng.randint(2026000,2026999)}"
def usd(a, b): return f"${rng.randint(a, b):,}"
def dt(): return f"2026-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}"

# Per-team note generators: (kind, title_fn, body_fn). Heavy randomization.
def _p(*lines): return "\n\n".join(lines)

TEAM_NOTES = {
 "claims": [
   ("claim-file", lambda: f"Claim {clm()} — {rng.choice(PERILS)} loss",
     lambda: _p(f"Insured on policy {pol()} reported a {rng.choice(PERILS)} loss in {rng.choice(STATES)} on {dt()}.",
       f"Estimated damages {usd(2000,60000)}; initial reserve set at {usd(2000,80000)}. SIU red-flag score {rng.randint(0,9)}/9.",
       f"Liability assessment: {rng.choice(['clear','disputed','comparative'])}. Adjuster #{rng.randint(10,99)} assigned; next review {dt()}.")),
   ("reserve-update", lambda: f"Reserve adjustment — claim {clm()}",
     lambda: _p(f"Reserve on claim moved from {usd(5000,40000)} to {usd(5000,90000)} after new medical specials.",
       f"Severity trend in {rng.choice(STATES)} running {rng.randint(3,18)}% above plan; reserving philosophy unchanged.")),
   ("litigation", lambda: f"Litigated claim memo — {clm()}",
     lambda: _p(f"Plaintiff demand {usd(40000,400000)}; our evaluation {usd(15000,150000)}. Venue {rng.choice(STATES)}.",
       f"Defense counsel engaged; mediation scheduled {dt()}. Exposure flagged to Catastrophe Response if storm-linked.")),
 ],
 "actuarial": [
   ("loss-ratio", lambda: f"Loss ratio analysis — {rng.choice(STATES)} auto",
     lambda: _p(f"Q{rng.randint(1,4)} accident-year loss ratio {rng.randint(58,86)}%, vs {rng.randint(60,80)}% plan.",
       f"Frequency {'+' if rng.random()>.4 else '-'}{rng.randint(1,9)}%, severity +{rng.randint(4,15)}% driven by {rng.choice(PERILS)}.",
       f"Indicated rate change +{rng.randint(2,14)}%; feeds filing {fil()}.")),
   ("reserving", lambda: "Reserving memo — IBNR review",
     lambda: _p(f"Bornhuetter-Ferguson IBNR for {rng.choice(STATES)} indicates {usd(2,40)}M held.",
       f"Tail factor {round(rng.uniform(1.02,1.18),3)}; development consistent with prior. Capital model note to follow.")),
   ("rate-indication", lambda: f"Rate indication — filing {fil()}",
     lambda: _p(f"Statewide indicated need +{rng.randint(3,16)}%; proposing +{rng.randint(2,12)}% to balance retention.",
       f"Telematics variable expected to lower pure premium {rng.randint(2,9)}% for low-mileage segment.")),
 ],
 "underwriting": [
   ("risk-guideline", lambda: f"Underwriting guideline — {rng.choice(PERILS)} appetite",
     lambda: _p(f"Tighten appetite in {rng.choice(STATES)} for {rng.choice(['young drivers','high-value vehicles','prior-lapse'])}.",
       f"Refer accounts with premium over {usd(8000,25000)} or {rng.randint(2,4)}+ at-fault losses to senior UW.")),
   ("account-review", lambda: f"Account review — policy {pol()}",
     lambda: _p(f"Renewal review: 3-yr loss ratio {rng.randint(20,140)}%. Recommend {rng.choice(['renew','non-renew','re-rate'])}.",
       f"Telematics score {rng.randint(40,99)}; credit tier {rng.choice('ABCD')}. Decision logged {dt()}.")),
 ],
 "fraud-siu": [
   ("investigation", lambda: f"SIU investigation — claim {clm()}",
     lambda: _p(f"Indicators: {rng.choice(['staged collision','phantom passenger','prior damage','inflated specials'])} in {rng.choice(STATES)}.",
       f"Linked to ring under review; {rng.randint(2,9)} related claims share repair shop and provider. Referral to NICB {rng.choice(['filed','pending'])}.")),
   ("red-flag", lambda: "Red-flag pattern report",
     lambda: _p(f"Cluster of {rng.randint(3,12)} claims in {rng.choice(STATES)} with same tow operator within {rng.randint(5,30)} days.",
       f"Estimated exposure if fraudulent {usd(40000,500000)}.")),
 ],
 "legal-compliance": [
   ("rate-filing", lambda: f"Rate filing {fil()} — {rng.choice(STATES)} DOI",
     lambda: _p(f"Filed +{rng.randint(2,12)}% auto rate change with {rng.choice(STATES)} DOI on {dt()}.",
       f"Objection risk on {rng.choice(['telematics use','credit factor','territory definition'])}; actuarial support attached.")),
   ("reg-response", lambda: "Regulatory inquiry response",
     lambda: _p(f"{rng.choice(STATES)} DOI market-conduct inquiry on claims handling timeliness.",
       f"Sample of {rng.randint(50,400)} claims pulled; avg cycle time {rng.randint(8,40)} days. Response due {dt()}.")),
   ("complaint", lambda: f"Complaint handling — case {clm()}",
     lambda: _p(f"DOI complaint re: denial on policy {pol()}. Position: {rng.choice(['upheld','partial pay','reopened'])}.")),
 ],
 "finance": [
   ("close", lambda: "Monthly close — combined ratio",
     lambda: _p(f"Combined ratio {rng.randint(92,108)}% ({rng.randint(58,78)}% loss + {rng.randint(26,34)}% expense).",
       f"Reinsurance recoverables {usd(5,80)}M; cat load {usd(2,30)}M this period.")),
   ("reinsurance", lambda: "Reinsurance treaty note",
     lambda: _p(f"Cat XoL attaches at {usd(50,150)}M, limit {usd(200,600)}M; rate-on-line {round(rng.uniform(3,9),1)}%.",
       f"Renewal {dt()}; modeled 1-in-100 PML {usd(120,400)}M.")),
   ("budget", lambda: "Budget variance memo",
     lambda: _p(f"Expense {'over' if rng.random()>.5 else 'under'} plan by {usd(200000,3000000)} driven by {rng.choice(['claims staffing','tech spend','acquisition cost'])}.")),
 ],
 "it-eng": [
   ("incident", lambda: f"Incident {eng()} — {rng.choice(['quote API','claims portal','rating engine','payments'])} outage",
     lambda: _p(f"Sev{rng.randint(1,3)}: {rng.choice(['quote API','claims portal','rating engine','payments'])} returned errors for {rng.randint(10,180)} min.",
       f"Root cause: {rng.choice(['DB connection pool exhaustion','expired TLS cert','bad deploy','cache stampede','null pointer in rating'])}. Fixed in build {rng.randint(1,9)}.{rng.randint(0,9)}.{rng.randint(0,9)}.")),
   ("design-doc", lambda: f"Design doc {eng()} — telematics ingestion",
     lambda: _p(f"Stream {rng.randint(1,20)}M trips/day from devices; score in near-real-time for usage-based pricing.",
       f"Stores to feature service; actuarial consumes via data-governance contract.")),
   ("runbook", lambda: f"Runbook {eng()} — rating engine failover",
     lambda: _p(f"On primary failure, cut over to region-B within {rng.randint(2,10)} min; verify quote parity.")),
 ],
 "customer-service": [
   ("call-summary", lambda: f"Call summary — policy {pol()}",
     lambda: _p(f"Insured called re: {rng.choice(['billing','claim status','coverage question','cancellation'])}. Resolved: {rng.choice(['yes','escalated','callback'])}.",
       f"CSAT {rng.randint(1,5)}/5; handle time {rng.randint(3,22)} min.")),
   ("escalation", lambda: f"Escalation — claim {clm()}",
     lambda: _p(f"Insured dissatisfied with {rng.choice(['delay','estimate','rental coverage'])}. Routed to supervisor; goodwill {usd(50,500)} offered.")),
 ],
 "marketing": [
   ("campaign", lambda: f"Campaign brief — {rng.choice(['bundle','telematics','safe-driver','new-mover'])} {rng.choice(STATES)}",
     lambda: _p(f"Target CPA {usd(40,180)}; channel mix search/social/CTV. Forecast {rng.randint(2,40)}k quotes.",
       f"Creative leans on {rng.choice(['price','trust','app experience'])}.")),
   ("channel-report", lambda: "Channel performance report",
     lambda: _p(f"Direct CAC {usd(120,400)}, agent CAC {usd(200,700)}; blended LTV/CAC {round(rng.uniform(1.2,4.0),1)}.")),
 ],
 "sales-distribution": [
   ("producer-report", lambda: "Producer performance report",
     lambda: _p(f"Agency #{rng.randint(100,999)} written premium {usd(200000,4000000)}, loss ratio {rng.randint(40,110)}%.",
       f"Contingent commission {'at risk' if rng.random()>.5 else 'on track'}.")),
   ("pipeline", lambda: "Distribution pipeline note",
     lambda: _p(f"{rng.randint(3,25)} new agency appointments in {rng.choice(STATES)} this quarter; onboarding cycle {rng.randint(2,8)} weeks.")),
 ],
 "product": [
   ("prd", lambda: f"PRD {eng()} — usage-based insurance",
     lambda: _p(f"Launch UBI program: discount up to {rng.randint(10,40)}% for low-mileage, low-risk driving.",
       f"Depends on telematics ingestion and actuarial rate plan; legal review for {rng.randint(2,8)} states.")),
   ("ab-test", lambda: "A/B test result — quote funnel",
     lambda: _p(f"Variant lifted bind rate {round(rng.uniform(1,12),1)}% (p={round(rng.uniform(0.001,0.06),3)}). Roll out to 100%.")),
 ],
 "hr": [
   ("comp", lambda: "Compensation review (confidential)",
     lambda: _p(f"Merit pool {round(rng.uniform(2.5,5.5),1)}%; equity refresh for {rng.randint(5,40)} key engineers.",
       f"Pay-equity audit found {rng.randint(0,4)} flags; remediation {usd(20000,300000)}.")),
   ("hiring", lambda: "Hiring plan",
     lambda: _p(f"Open {rng.randint(3,30)} reqs across claims and actuarial; backfill cycle {rng.randint(20,60)} days.")),
 ],
}
# teams without bespoke templates reuse a generic memo
GENERIC = [("memo", lambda: f"Working memo {rng.randint(1000,9999)}",
   lambda: _p(f"Status note for the team dated {dt()}; covering {rng.choice(['process','staffing','metrics','vendor'])}.",
     f"Action items assigned; follow-up {dt()}."))]

def build_org():
    people = []
    # C-suite
    for cid, title, team in CSUITE:
        scopes = {f"{cid}-private", "exec-committee", "apex-enterprise"}
        if team: scopes.add(f"team-{team}")
        people.append({"id": cid, "name": title, "team": team or "exec", "role": title, "scopes": scopes})
        CIRCLES["exec-committee"].add(cid)
    # team members
    for team in TEAMS:
        for i in range(PEOPLE_PER_TEAM):
            pid = f"{team}-{i:02d}"
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            scopes = {f"{pid}-private", f"team-{team}", "apex-enterprise"}
            for circ, members in CIRCLES.items():
                if isinstance(members, set) and team in members and rng.random() < 0.5:
                    scopes.add(circ)
            people.append({"id": pid, "name": name, "team": team, "role": f"{team} specialist", "scopes": scopes})
    return people

# Note kinds that are confidential and must NEVER be company-wide (enterprise).
SENSITIVE = {"comp", "investigation", "red-flag", "litigation", "reinsurance",
             "budget", "close", "rate-filing", "reg-response", "complaint"}

def pick_scope(person, sensitive=False):
    r = rng.random()
    circles = [s for s in person["scopes"] if s in CIRCLES]
    team = f"team-{person['team']}" if person["team"] != "exec" else "exec-committee"
    if not sensitive and r < 0.03: return "apex-enterprise"  # ~3% company-wide (non-sensitive only)
    if circles and r < 0.15: return rng.choice(circles)      # ~12% to a circle (members only)
    if r < 0.45: return f"{person['id']}-private"            # ~30% private
    return team                                               # ~55% team

def gen_notes(person):
    gens = TEAM_NOTES.get(person["team"], GENERIC)
    out = []
    for n in range(NOTES_PER_PERSON):
        kind, title_fn, body_fn = rng.choice(gens)
        title = title_fn()
        body = body_fn()
        md = f"# {title}\n\n{body}\n"
        out.append((person, title, md, kind))
    return out

def main():
    t_start = time.time()
    conn = db.connect(); db.bootstrap_schema(conn)
    try: qdrant_store._client.delete_collection(os.environ["QDRANT_COLLECTION"])
    except Exception: pass
    conn.execute("delete from chunks where note_id in (select id from notes where tenant_id=%s)", (TENANT,))
    conn.execute("delete from notes where tenant_id=%s", (TENANT,))

    people = build_org()
    print(f"Org: {len(people)} people, {len(TEAMS)} teams, {len(CIRCLES)} circles. "
          f"Target notes: {len(people)*NOTES_PER_PERSON:,}")

    embedder = LocalEmbedder(EMBED_MODEL); sparse = LocalSparseEmbedder()
    dim = len(embedder.embed(["dimension probe"])[0])
    print(f"Embedder: {EMBED_MODEL} ({dim}d) -> collection {os.environ['QDRANT_COLLECTION']}")
    qdrant_store.ensure_collection(dim, with_sparse=True)

    # collect chunks
    note_rows = []      # (note_id, owner, scope, title)
    chunk_rows = []     # (chunk_id, note_id, heading_path, text, idx, scope, owner)
    for person in people:
        for (p, title, md, kind) in gen_notes(person):
            note_id = hashlib.sha1(f"{p['id']}|{title}|{rng.random()}".encode()).hexdigest()[:16]
            scope = pick_scope(p, kind in SENSITIVE)
            note_rows.append((note_id, p["id"], scope, title))
            for c in chunk_markdown(note_id, md):
                cid = hashlib.sha1(f"{note_id}|{c.heading_path}|{c.chunk_index}".encode()).hexdigest()[:24]
                # Fold the heading/title into the embedded+indexed text so identifiers that
                # live only in the title (claim/policy/incident IDs) are searchable (dense+BM25).
                text = f"{c.heading_path}\n{c.text}" if c.heading_path else c.text
                chunk_rows.append((cid, note_id, c.heading_path, text, c.chunk_index, scope, p["id"]))
    print(f"Generated {len(note_rows):,} notes -> {len(chunk_rows):,} chunks. Embedding…")

    # batch insert notes
    with conn.cursor() as cur:
        cur.executemany("insert into notes(id,tenant_id,owner_id,scope_id,source_path,title) values(%s,%s,%s,%s,%s,%s) on conflict (id) do nothing",
                        [(nid, TENANT, owner, scope, f"sim://{nid}", title) for (nid, owner, scope, title) in note_rows])

    texts = [r[3] for r in chunk_rows]
    done = 0
    for i in range(0, len(texts), BATCH):
        batch = texts[i:i+BATCH]
        dvecs = embedder.embed(batch)
        svecs = sparse.embed_sparse(batch)
        points, pg = [], []
        for j, (dv, sv) in enumerate(zip(dvecs, svecs)):
            cid, note_id, hp, text, idx, scope, owner = chunk_rows[i+j]
            pid = str(uuid.uuid5(uuid.NAMESPACE_URL, cid))
            points.append({"id": pid, "vector": {"dense": dv, "bm25": sv},
                "payload": {"tenant_id": TENANT, "owner_id": owner, "scope_ids": [scope],
                            "note_id": note_id, "heading_path": hp, "text": text, "chunk_id": cid}})
            pg.append((cid, note_id, hp, text, idx))
        for k in range(0, len(points), UPSERT_BATCH):
            qdrant_store.upsert(points[k:k+UPSERT_BATCH])
        with conn.cursor() as cur:
            cur.executemany("insert into chunks(id,note_id,heading_path,text,chunk_index) values(%s,%s,%s,%s,%s) on conflict (id) do nothing", pg)
        done += len(batch)
        if i % (BATCH*10) == 0 or done == len(texts):
            el = time.time()-t_start
            print(f"  indexed {done:,}/{len(texts):,} chunks  ({done/max(el,1):.0f} chunks/s, {el:.0f}s elapsed)")
    print(f"DONE: {len(note_rows):,} notes / {len(chunk_rows):,} chunks in {time.time()-t_start:.0f}s "
          f"into collection {os.environ['QDRANT_COLLECTION']} (tenant apex).")

if __name__ == "__main__":
    main()
