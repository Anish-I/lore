#!/usr/bin/env python3
import argparse
import json
import random
import re
import sys
from datetime import date, timedelta

ID_RE = re.compile(r"\b([A-Za-z]{2,}-(?:[A-Za-z]{2}-)?\d{2,})\b")

DEFAULT_NOTES = {
    "insurance": 5000,
    "townclerk": 1200,
    "office": 1200,
}

SCENARIOS = tuple(DEFAULT_NOTES)


FIRST_NAMES = [
    "Aaliyah", "Aaron", "Abigail", "Adam", "Adrian", "Aisha", "Alan", "Alexa", "Alice", "Alicia",
    "Amara", "Amelia", "Andre", "Angela", "Anish", "Anna", "Anthony", "Aria", "Arielle", "Arthur",
    "Audrey", "Avery", "Ben", "Bianca", "Blake", "Brenda", "Caleb", "Camila", "Carla", "Carlos",
    "Carmen", "Carter", "Celeste", "Charles", "Chloe", "Cole", "Connor", "Daisy", "Daniel", "Danielle",
    "David", "Derek", "Diana", "Dominic", "Elena", "Eli", "Elijah", "Emily", "Emma", "Ethan",
    "Eva", "Evelyn", "Felix", "Gabriel", "Grace", "Hannah", "Harper", "Henry", "Isabel", "Isaiah",
    "Ivy", "Jack", "Jada", "James", "Jasmine", "Jason", "Jenna", "Jerome", "John", "Jordan",
    "Joseph", "Julia", "Kai", "Karen", "Katelyn", "Kevin", "Kimberly", "Lena", "Leo", "Liam",
    "Lily", "Logan", "Lucas", "Lucia", "Luis", "Maya", "Mia", "Michael", "Mila", "Naomi",
    "Natalie", "Nathan", "Nia", "Noah", "Nora", "Olivia", "Omar", "Oscar", "Paige", "Peter",
    "Priya", "Quinn", "Rachel", "Rebecca", "Riley", "Rosa", "Ryan", "Samir", "Sarah", "Sebastian",
    "Sofia", "Talia", "Theo", "Thomas", "Uma", "Valerie", "Victor", "Violet", "Wesley", "Xavier",
    "Yara", "Zachary",
]

LAST_NAMES = [
    "Adams", "Ahmed", "Allen", "Anderson", "Bailey", "Baker", "Barnes", "Baxter", "Bennett", "Brooks",
    "Brown", "Bryant", "Campbell", "Carter", "Castillo", "Chen", "Clark", "Collins", "Cooper", "Cruz",
    "Davis", "Diaz", "Edwards", "Evans", "Fisher", "Flores", "Foster", "Garcia", "Gomez", "Gray",
    "Green", "Griffin", "Hall", "Harris", "Hayes", "Henderson", "Hernandez", "Hill", "Howard", "Hughes",
    "Jackson", "Jenkins", "Johnson", "Jones", "Khan", "Kim", "King", "Lee", "Lewis", "Long",
    "Lopez", "Martin", "Martinez", "Miller", "Mitchell", "Moore", "Morgan", "Murphy", "Nelson", "Nguyen",
    "Ortiz", "Parker", "Patel", "Perez", "Peterson", "Phillips", "Powell", "Price", "Ramirez", "Reed",
    "Rivera", "Roberts", "Robinson", "Rodriguez", "Ross", "Russell", "Sanchez", "Sanders", "Scott", "Shah",
    "Smith", "Stewart", "Taylor", "Thomas", "Thompson", "Torres", "Turner", "Walker", "Ward", "Watson",
    "White", "Williams", "Wilson", "Wood", "Wright", "Young",
]

ORG_WORDS_A = [
    "Meridian", "Northstar", "Summit", "Harbor", "Pioneer", "Evergreen", "Crescent", "Oakridge", "Bluefield", "Redstone",
    "Granite", "Silverline", "Keystone", "Cedar", "Fairview", "Briar", "Horizon", "Lakeside", "Ironwood", "Highland",
    "Riverton", "Westbridge", "Eastgate", "Clearwater", "Maple", "Stonebridge", "Willow", "Ashford", "Boulder", "Seaside",
    "Greenway", "Prospect", "Brighton", "Meadow", "Juniper", "Hawthorne", "Orchard", "Camden", "Franklin", "Kingston",
]

ORG_WORDS_B = [
    "Mutual", "Partners", "Group", "Services", "Associates", "Holdings", "Agency", "Cooperative", "Trust", "Bureau",
    "Logistics", "Systems", "Works", "Consulting", "Enterprises", "Management", "Supply", "Industries", "Labs", "Solutions",
]

STREET_NAMES = [
    "Baxter Street", "Oak Lane", "Maple Avenue", "Cedar Road", "Pine Terrace", "Willow Drive", "River Road", "Elm Street",
    "Prospect Avenue", "Harbor Way", "Mason Court", "Franklin Street", "Adams Road", "Lincoln Avenue", "Union Street",
    "Church Street", "School Street", "Mill Road", "Depot Street", "Park Avenue", "Chestnut Lane", "Birch Road",
    "Highland Avenue", "Meadow Street", "Juniper Way", "Laurel Lane", "Grove Street", "Spruce Road", "Washington Avenue",
    "Main Street", "Market Street", "Garden Lane", "Hillcrest Drive", "Sunset Road", "Broadway", "Bridge Street",
    "Canal Road", "Lakeview Drive", "Ridge Road", "Valley Street", "Forest Avenue", "Walnut Street", "Center Street",
    "North Street", "South Street", "East Avenue", "West Road", "Briar Court", "Orchard Lane", "Summit Avenue",
    "King Street", "Queen Street", "Pearl Street", "Liberty Road", "Spring Street", "Winter Street", "Autumn Lane",
    "Summer Avenue", "Foundry Road", "Commerce Street",
]


INSURANCE_TOPICS = [
    "Claims - Auto", "Claims - Property", "Subrogation", "Policy Renewals", "Underwriting", "Carrier Relations",
    "Litigation", "Fraud/SIU", "Reinsurance", "Billing", "Premium Audit", "Workers Compensation", "General Liability",
    "Cyber Liability", "Commercial Auto", "Personal Lines", "Catastrophe Response", "Medical Payments",
    "Salvage", "Total Loss", "Coverage Opinions", "Loss Runs", "Certificates", "Endorsements",
    "Risk Engineering", "Large Loss", "Appraisal", "Arbitration", "Agent Licensing", "Claims - Inland Marine",
    "Carrier - Meridian Mutual", "Carrier - Northstar Assurance", "Carrier - Harbor Casualty", "Carrier - Keystone Indemnity",
]

TOWN_TOPICS = [
    "Council Minutes", "Ordinances", "Zoning Board", "Dog Licenses", "Marriage Licenses", "FOIA Requests",
    "Elections", "Road Maintenance", "Budget Hearings", "Permits", "Tax Collection", "Public Notices",
    "Vital Records", "Parks Commission", "Planning Commission", "Historic Preservation", "Water Department",
    "Cemetery Records", "Business Licenses", "Ethics Filings", "Board of Health", "Procurement",
]

OFFICE_TOPICS = [
    "Project PRJ-104", "Project PRJ-219", "Project PRJ-332", "Project PRJ-447", "Project PRJ-508", "Vendor Contracts",
    "Invoices", "HR Onboarding", "IT Tickets", "OKRs", "Facilities", "Procurement", "Legal Review", "Security",
    "Customer Escalations", "Product Research", "Finance Planning", "Travel", "Training", "Compliance",
    "Executive Staff", "Data Operations",
]

VARIANTS = {
    "Claims - Auto": ["Auto Claims", "Vehicle Losses", "claims-auto"],
    "Claims - Property": ["Property Claims", "Home Losses", "claims-property"],
    "Subrogation": ["Subro Recovery", "subrogation-cases", "Recovery Actions"],
    "Policy Renewals": ["Renewals", "Policy Renewal Desk", "renewal-files"],
    "Underwriting": ["UW Review", "Risk Selection", "underwriting-queue"],
    "Carrier Relations": ["Carrier Desk", "Market Relations", "carrier-relations"],
    "Litigation": ["Legal Claims", "Suit Files", "litigation-matters"],
    "Fraud/SIU": ["SIU", "Fraud Review", "special-investigation"],
    "Reinsurance": ["Treaty Review", "Reinsurance Desk", "reinsurance-files"],
    "Billing": ["Premium Billing", "Billing Desk", "billing-issues"],
    "Premium Audit": ["Audit Premiums", "premium-audit", "Payroll Audits"],
    "Workers Compensation": ["Workers Comp", "WC Claims", "workers-compensation"],
    "General Liability": ["GL Claims", "Liability Files", "general-liability"],
    "Cyber Liability": ["Cyber Claims", "Network Liability", "cyber-liability"],
    "Commercial Auto": ["Fleet Auto", "Business Auto", "commercial-auto"],
    "Personal Lines": ["Personal Policies", "Personal Lines Desk", "personal-lines"],
    "Catastrophe Response": ["CAT Response", "Catastrophe Desk", "storm-response"],
    "Medical Payments": ["MedPay", "Medical Payables", "medical-payments"],
    "Salvage": ["Vehicle Salvage", "Salvage Desk", "salvage-files"],
    "Total Loss": ["TL Desk", "Totaled Vehicles", "total-loss"],
    "Coverage Opinions": ["Coverage Review", "Coverage Counsel", "coverage-opinions"],
    "Loss Runs": ["Loss History", "loss-runs", "Experience Reports"],
    "Certificates": ["COI Requests", "Insurance Certificates", "certificates"],
    "Endorsements": ["Policy Changes", "Endorsement Desk", "endorsements"],
    "Risk Engineering": ["Loss Control", "Risk Surveys", "risk-engineering"],
    "Large Loss": ["Complex Loss", "Major Claims", "large-loss"],
    "Appraisal": ["Appraisal Desk", "Damage Appraisals", "appraisal-files"],
    "Arbitration": ["Arb Forum", "Arbitration Files", "arb-matters"],
    "Agent Licensing": ["Producer Licensing", "Agent Appointments", "agent-licensing"],
    "Claims - Inland Marine": ["Inland Marine Claims", "Equipment Claims", "claims-inland-marine"],
    "Carrier - Meridian Mutual": ["Meridian Mutual", "Meridian Carrier", "carrier-meridian"],
    "Carrier - Northstar Assurance": ["Northstar Assurance", "Northstar Carrier", "carrier-northstar"],
    "Carrier - Harbor Casualty": ["Harbor Casualty", "Harbor Carrier", "carrier-harbor"],
    "Carrier - Keystone Indemnity": ["Keystone Indemnity", "Keystone Carrier", "carrier-keystone"],
    "Council Minutes": ["Town Council", "Council Notes", "council-minutes"],
    "Ordinances": ["Local Laws", "Ordinance Records", "ordinances"],
    "Zoning Board": ["ZBA", "Zoning Appeals", "zoning-board"],
    "Dog Licenses": ["Canine Licenses", "Dog Tags", "dog-licenses"],
    "Marriage Licenses": ["Marriage Records", "Wedding Licenses", "marriage-licenses"],
    "FOIA Requests": ["FOIA", "Public Records Requests", "records-access"],
    "Elections": ["Election Office", "Voting Records", "elections"],
    "Road Maintenance": ["Highway Department", "Road Repairs", "road-maintenance"],
    "Budget Hearings": ["Budget Meetings", "Fiscal Hearings", "budget-hearings"],
    "Permits": ["Permit Desk", "Building Permits", "permits"],
    "Tax Collection": ["Tax Collector", "Tax Receipts", "tax-collection"],
    "Public Notices": ["Legal Notices", "Posted Notices", "public-notices"],
    "Vital Records": ["Birth Death Records", "Vital Registry", "vital-records"],
    "Parks Commission": ["Parks Board", "Recreation Commission", "parks-commission"],
    "Planning Commission": ["Planning Board", "Planning Reviews", "planning-commission"],
    "Historic Preservation": ["Historic Board", "Landmark Review", "historic-preservation"],
    "Water Department": ["Water Office", "Water Billing", "water-department"],
    "Cemetery Records": ["Burial Records", "Cemetery Files", "cemetery-records"],
    "Business Licenses": ["Business Permits", "Trade Licenses", "business-licenses"],
    "Ethics Filings": ["Disclosure Filings", "Ethics Board", "ethics-filings"],
    "Board of Health": ["Health Board", "Public Health", "board-of-health"],
    "Procurement": ["Purchasing", "Bid Records", "procurement"],
    "Project PRJ-104": ["PRJ-104", "Atlas Project", "project-atlas"],
    "Project PRJ-219": ["PRJ-219", "Beacon Project", "project-beacon"],
    "Project PRJ-332": ["PRJ-332", "Cobalt Project", "project-cobalt"],
    "Project PRJ-447": ["PRJ-447", "Delta Project", "project-delta"],
    "Project PRJ-508": ["PRJ-508", "Ember Project", "project-ember"],
    "Vendor Contracts": ["Supplier Agreements", "Vendor Legal", "vendor-contracts"],
    "Invoices": ["Accounts Payable", "Invoice Desk", "invoices"],
    "HR Onboarding": ["New Hire Setup", "People Ops Onboarding", "hr-onboarding"],
    "IT Tickets": ["Helpdesk", "Support Tickets", "it-tickets"],
    "OKRs": ["Objectives", "Quarterly Goals", "okrs"],
    "Facilities": ["Office Operations", "Workplace Facilities", "facilities"],
    "Legal Review": ["Counsel Review", "Legal Queue", "legal-review"],
    "Security": ["Security Review", "Trust Desk", "security"],
    "Customer Escalations": ["Client Escalations", "Customer Issues", "customer-escalations"],
    "Product Research": ["Product Discovery", "Research Notes", "product-research"],
    "Finance Planning": ["Financial Planning", "Budget Planning", "finance-planning"],
    "Travel": ["Travel Desk", "Trip Planning", "travel"],
    "Training": ["Learning Programs", "Staff Training", "training"],
    "Compliance": ["Compliance Review", "Audit Readiness", "compliance"],
    "Executive Staff": ["Leadership Staff", "Exec Office", "executive-staff"],
    "Data Operations": ["Data Ops", "Reporting Operations", "data-operations"],
}

INS_EVENTS = [
    ("water damage from burst pipe", "pipe leak flooding the kitchen", "burst pipe water damage"),
    ("rear-end collision at a red light", "traffic stop impact from behind", "rear-end auto loss"),
    ("hail damage to roof shingles", "storm stones striking the roof", "hail roof damage"),
    ("smoke damage after an electrical fire", "electrical blaze residue in the home", "smoke fire damage"),
    ("stolen work laptop from parked vehicle", "missing company computer after car break-in", "vehicle contents theft"),
    ("wind damage to detached garage", "gust damage affecting an outbuilding", "wind garage damage"),
    ("slip and fall in the lobby", "visitor fall near the entrance", "premises injury"),
    ("sewer backup in basement", "wastewater overflow below grade", "sewer backup"),
    ("fleet van side swipe", "company van scraped along the side", "fleet vehicle scrape"),
    ("malware incident on accounting server", "accounting system security breach", "cyber malware incident"),
]

TOWN_EVENTS = [
    ("variance request for a side-yard setback", "exception request for a narrow lot line", "zoning variance"),
    ("public records request for police invoices", "open government request about law enforcement bills", "FOIA request"),
    ("dog license renewal for a senior owner", "pet tag renewal for an older resident", "dog license renewal"),
    ("marriage license appointment reschedule", "wedding paperwork meeting moved", "marriage appointment"),
    ("culvert repair on a washed-out road", "drainage crossing work after road erosion", "road culvert repair"),
    ("budget hearing on library funding", "public fiscal meeting about library money", "library budget hearing"),
    ("ordinance amendment for food trucks", "local law update about mobile vendors", "food truck ordinance"),
    ("absentee ballot cure notice", "mail ballot signature correction", "ballot cure notice"),
    ("water bill abatement request", "utility charge reduction request", "water abatement"),
    ("cemetery plot ownership transfer", "burial lot title change", "cemetery transfer"),
]

OFFICE_EVENTS = [
    ("vendor renewal for analytics software", "supplier extension for reporting tools", "analytics renewal"),
    ("invoice dispute for implementation hours", "billing challenge over setup labor", "invoice dispute"),
    ("new hire laptop provisioning", "employee computer setup", "laptop onboarding"),
    ("VPN access failure after password reset", "remote access issue following credential change", "VPN ticket"),
    ("quarterly objective dependency review", "goal planning dependency check", "OKR review"),
    ("conference room HVAC repair", "meeting space climate fix", "HVAC repair"),
    ("security questionnaire from enterprise client", "customer trust assessment form", "security questionnaire"),
    ("contract redline on indemnity terms", "legal edit to risk allocation language", "contract redline"),
    ("customer escalation about delayed migration", "client complaint over postponed data move", "migration escalation"),
    ("research interview synthesis for roadmap", "discovery call summary for product planning", "research synthesis"),
]


def full_names(prefix):
    names = []
    offset = sum(ord(c) for c in prefix) % len(LAST_NAMES)
    for i, first in enumerate(FIRST_NAMES):
        for j in range(2):
            names.append(f"{first} {LAST_NAMES[(i + j * 17 + offset) % len(LAST_NAMES)]}")
    return names


def orgs(prefix):
    offset = sum(ord(c) for c in prefix) % len(ORG_WORDS_B)
    return [f"{a} {ORG_WORDS_B[(i + offset) % len(ORG_WORDS_B)]}" for i, a in enumerate(ORG_WORDS_A)]


def streets(prefix):
    offset = sum(ord(c) for c in prefix) % len(STREET_NAMES)
    return STREET_NAMES[offset:] + STREET_NAMES[:offset]


def created_date(rng):
    start = date(2023, 1, 1)
    end = date(2026, 7, 20)
    return (start + timedelta(days=rng.randrange((end - start).days + 1))).isoformat()


def fixed_date(month_offset, day):
    y = 2023 + month_offset // 12
    m = month_offset % 12 + 1
    if y > 2026 or (y == 2026 and m > 7):
        y = 2026
        m = 7
    return date(y, m, min(day, 28)).isoformat()


def make_id(prefix, used_ids, rng, digits=5):
    while True:
        value = f"{prefix}-{rng.randrange(10 ** (digits - 1), 10 ** digits)}"
        if value not in used_ids and ID_RE.fullmatch(value):
            used_ids.add(value)
            return value


def make_pair_ids(prefix, used_ids, rng):
    while True:
        base = rng.randrange(10000, 99999)
        s = str(base)
        pos = rng.randrange(len(s))
        old_digit = int(s[pos])
        new_digit = (old_digit + rng.randrange(1, 10)) % 10
        paired = s[:pos] + str(new_digit) + s[pos + 1:]
        a = f"{prefix}-{s}"
        b = f"{prefix}-{paired}"
        if a != b and a not in used_ids and b not in used_ids and ID_RE.fullmatch(a) and ID_RE.fullmatch(b):
            used_ids.add(a)
            used_ids.add(b)
            return a, b


def weighted_topics(topics, n):
    weights = []
    for i in range(len(topics)):
        weights.append(max(6, int((len(topics) - i) ** 1.35)))
    total = sum(weights)
    counts = [max(6, int(n * w / total)) for w in weights]
    while sum(counts) > n:
        for i in range(len(counts) - 1, -1, -1):
            if sum(counts) <= n:
                break
            if counts[i] > 6:
                counts[i] -= 1
    while sum(counts) < n:
        idx = len(counts) - 1 - ((sum(counts) - n) % len(counts))
        counts[idx] += 1
    pairs = []
    for topic, count in zip(topics, counts):
        pairs.extend([topic] * count)
    return pairs[:n]


def topic_variant(rng, gold):
    variants = VARIANTS[gold]
    if rng.random() < 0.55:
        return gold
    return variants[rng.randrange(len(variants))]


def md_body(created, sections):
    parts = ["---", f"created: {created}", "---", ""]
    for heading, text in sections:
        parts.append(f"## {heading}")
        parts.append(text.strip())
        parts.append("")
    return "\n".join(parts).strip()


def words_count(text):
    return len(re.findall(r"\b\w+\b", text))


def ensure_body_size(body):
    count = words_count(body)
    if not 80 <= count <= 350:
        raise ValueError(f"body word count out of range: {count}")


def sentence_pool(domain, primary_id, title, event, plain_event, person, org, street, amount, created, topic, seq, extra):
    if domain == "insurance":
        adjuster = extra.get("adjuster", person)
        claimant = extra.get("claimant", person)
        policy = extra.get("policy", "POL-10000")
        deductible = extra.get("deductible", "$1,000")
        carrier = extra.get("carrier", org)
        return [
            f"{primary_id} is assigned to {adjuster} for {plain_event} reported by {claimant} at {street}.",
            f"The file is with {carrier}; current reserve is {amount} and the deductible recorded on {policy} is {deductible}.",
            f"Coverage notes describe {event}, with photos, estimates, and contact attempts logged on {created}.",
            f"The next action is to confirm mitigation invoices, review policy endorsements, and update the diary before closing authority changes.",
            f"Internal reference marker SCN-{seq:05d} keeps this synthetic record unique for evaluation.",
        ]
    if domain == "townclerk":
        clerk = extra.get("clerk", person)
        resident = extra.get("resident", person)
        docket = extra.get("docket", "DCK-10000")
        department = extra.get("department", org)
        return [
            f"{primary_id} records {plain_event} involving {resident} at {street}, handled by {clerk}.",
            f"The matter is filed under {docket} with {department}; fee or budget impact is {amount}.",
            f"The clerk note says {event}, and the public counter entry was created on {created}.",
            f"Follow-up includes agenda posting, statutory notice checks, receipt indexing, and response tracking for the board packet.",
            f"Internal reference marker SCN-{seq:05d} keeps this synthetic record unique for evaluation.",
        ]
    owner = extra.get("owner", person)
    project = extra.get("project", "PRJ-104")
    vendor = extra.get("vendor", org)
    ticket = extra.get("ticket", "TCK-10000")
    return [
        f"{primary_id} covers {plain_event} for {owner} on {project}, with {vendor} and the office team linked in the note.",
        f"The related internal tracker is {ticket}; budget or invoice exposure is {amount}, opened on {created}.",
        f"The body describes {event}, including dependency notes, owners, due dates, and operating impact.",
        f"Follow-up is to confirm approval, update the shared tracker, notify stakeholders, and archive the final decision.",
        f"Internal reference marker SCN-{seq:05d} keeps this synthetic record unique for evaluation.",
    ]


def build_body(domain, created, primary_id, title, event, plain_event, person, org, street, amount, topic, seq, extra=None):
    extra = extra or {}
    sentences = sentence_pool(domain, primary_id, title, event, plain_event, person, org, street, amount, created, topic, seq, extra)
    sections = [
        ("Summary", " ".join(sentences[:2])),
        ("Context", " ".join(sentences[2:4])),
        ("Action", sentences[4] + " " + extra.get("action", "Reviewer should keep the subject, entity, and identifier together when testing retrieval.")),
    ]
    if extra.get("supersedes"):
        sections.insert(1, ("Supersession", f"Supersedes {extra['supersedes']}. This entry is the later record for current-state retrieval."))
    if extra.get("detail"):
        sections.append(("Detail", extra["detail"]))
    # ALL sections: the old [:4] slice silently dropped Detail whenever a
    # Supersession section was inserted — losing exactly the value facts the
    # temporal queries key on (smoke run: temporal bucket 0.0).
    body = md_body(created, sections)
    ensure_body_size(body)
    if primary_id not in title or primary_id not in body:
        raise ValueError("primary id missing from title or body")
    return body


def unique_title(base, used_titles, seq):
    title = base
    if title in used_titles:
        title = f"{base} Record {seq:05d}"
    used_titles.add(title)
    return title


def add_note(notes, used_titles, scenario, note_id, title, body, topic_gold, topic_var, created):
    notes.append({
        "id": note_id,
        "title": title,
        "body": body,
        "topic_gold": topic_gold,
        "topic_variant": topic_var,
        "created": created,
        "source_type": "note",
    })


def corpus_text(notes):
    return "\n".join(n["title"] + "\n" + n["body"] for n in notes)


def assert_unique(notes):
    bodies = {n["body"] for n in notes}
    titles = {n["title"] for n in notes}
    if len(bodies) != len(notes) or len(titles) != len(notes):
        raise AssertionError("uniqueness violation: note bodies and titles must be unique")
    for n in notes:
        ensure_body_size(n["body"])
        ids = ID_RE.findall(n["title"])
        if not ids:
            raise AssertionError(f"title missing matching id: {n['title']}")
        if ids[0] not in n["body"]:
            raise AssertionError(f"body missing primary id: {n['id']}")


def pick_distinct(rng, pool, used, fallback_prefix):
    for _ in range(200):
        value = pool[rng.randrange(len(pool))]
        if value not in used:
            used.add(value)
            return value
    value = f"{fallback_prefix} {len(used) + 1:05d}"
    used.add(value)
    return value


def make_insurance_notes(rng, n):
    names = full_names("insurance")
    companies = orgs("insurance")
    roads = streets("insurance")
    used_ids = set()
    used_titles = set()
    notes = []
    topics = weighted_topics(INSURANCE_TOPICS, n)
    rng.shuffle(topics)

    pair_records = []
    for pair_idx in range(min(20, max(0, n // 2))):
        v1_id, v2_id = make_pair_ids("CLM", used_ids, rng)
        topic = "Policy Renewals" if pair_idx % 2 else "Carrier - Meridian Mutual"
        policy = make_id("POL", used_ids, rng)
        person = names[(pair_idx * 7) % len(names)]
        adjuster = names[(pair_idx * 7 + 3) % len(names)]
        carrier = "Meridian Mutual"
        street = roads[(pair_idx * 5) % len(roads)]
        old_ded = f"${500 + (pair_idx % 5) * 250:,}"
        new_ded = f"${750 + (pair_idx % 6) * 250:,}"
        subject = f"Meridian policy for {person}"
        created1 = fixed_date(pair_idx, 8)
        created2 = fixed_date(pair_idx + 18, 16)
        title1 = unique_title(f"{v1_id} Meridian Policy Renewal Draft for {person}", used_titles, pair_idx)
        body1 = build_body(
            "insurance", created1, v1_id, title1, "renewal review for commercial property coverage",
            "commercial policy renewal", person, carrier, street, f"${35_000 + pair_idx * 421:,}", topic, pair_idx,
            {"adjuster": adjuster, "claimant": person, "policy": policy, "deductible": old_ded, "carrier": carrier,
             "detail": f"Temporal subject: {subject}. The deductible before the 2025 renewal is {old_ded}."}
        )
        add_note(notes, used_titles, "insurance", f"ins-{len(notes)+1:05d}", title1, body1, topic, topic_variant(rng, topic), created1)
        title2 = unique_title(f"{v2_id} Meridian Policy Renewal Final for {person}", used_titles, pair_idx + 1000)
        body2 = build_body(
            "insurance", created2, v2_id, title2, "final renewal terms for commercial property coverage",
            "current commercial policy renewal", person, carrier, street, f"${37_000 + pair_idx * 487:,}", topic, pair_idx + 1000,
            {"adjuster": adjuster, "claimant": person, "policy": policy, "deductible": new_ded, "carrier": carrier,
             "supersedes": title1,
             "detail": f"Temporal subject: {subject}. The current deductible on the Meridian policy is {new_ded}."}
        )
        add_note(notes, used_titles, "insurance", f"ins-{len(notes)+1:05d}", title2, body2, topic, topic_variant(rng, topic), created2)
        pair_records.append((notes[-2], notes[-1], person, old_ded, new_ded))

    for i in range(len(notes), n):
        topic = topics[i]
        primary = make_id("CLM" if "Claims" in topic or topic in {"Subrogation", "Fraud/SIU", "Litigation"} else "POL", used_ids, rng)
        event, paraphrase, plain = INS_EVENTS[i % len(INS_EVENTS)]
        person = names[(i * 11 + rng.randrange(len(names))) % len(names)]
        adjuster = names[(i * 13 + 5) % len(names)]
        carrier = companies[(i * 3 + rng.randrange(len(companies))) % len(companies)]
        street = roads[(i * 7 + rng.randrange(len(roads))) % len(roads)]
        amount = f"${rng.randrange(1200, 98000):,}"
        policy = make_id("POL", used_ids, rng)
        deductible = f"${rng.choice([250, 500, 750, 1000, 1500, 2500, 5000]):,}"
        created = created_date(rng)
        title = unique_title(f"{primary} {plain.title()} for {person}", used_titles, i)
        body = build_body(
            "insurance", created, primary, title, event, plain, person, carrier, street, amount, topic, i,
            {"adjuster": adjuster, "claimant": person, "policy": policy, "deductible": deductible, "carrier": carrier,
             "detail": f"Topic desk: {topic}. Handler pairing: {adjuster} at {street}."}
        )
        add_note(notes, used_titles, "insurance", f"ins-{len(notes)+1:05d}", title, body, topic, topic_variant(rng, topic), created)

    return notes, pair_records


def make_town_notes(rng, n):
    names = full_names("townclerk")
    companies = orgs("townclerk")
    roads = streets("townclerk")
    used_ids = set()
    used_titles = set()
    notes = []
    topics = weighted_topics(TOWN_TOPICS, n)
    rng.shuffle(topics)

    pair_records = []
    for pair_idx in range(min(20, max(0, n // 2))):
        v1_id, v2_id = make_pair_ids("ORD", used_ids, rng)
        topic = "Ordinances" if pair_idx % 2 else "Budget Hearings"
        resident = names[(pair_idx * 9) % len(names)]
        clerk = names[(pair_idx * 9 + 4) % len(names)]
        # Stride 3 keeps all 20 pair streets distinct over the 60-street pool
        # (stride 4 wrapped at pair 15, giving five pairs colliding subjects).
        street = roads[(pair_idx * 3) % len(roads)]
        dept = "Town Clerk Office"
        old_fee = f"${25 + (pair_idx % 5) * 10}"
        new_fee = f"${35 + (pair_idx % 6) * 10}"
        subject = f"food truck permit fee for {street}"
        docket = make_id("DCK", used_ids, rng)
        created1 = fixed_date(pair_idx, 10)
        created2 = fixed_date(pair_idx + 20, 18)
        title1 = unique_title(f"{v1_id} Draft Fee Schedule for {street}", used_titles, pair_idx)
        body1 = build_body(
            "townclerk", created1, v1_id, title1, "draft ordinance amendment for mobile vendor permit fees",
            "food truck permit fee draft", resident, dept, street, old_fee, topic, pair_idx,
            {"clerk": clerk, "resident": resident, "docket": docket, "department": dept,
             "detail": f"Temporal subject: {subject}. The fee before the 2025 adoption is {old_fee}."}
        )
        add_note(notes, used_titles, "townclerk", f"tc-{len(notes)+1:05d}", title1, body1, topic, topic_variant(rng, topic), created1)
        title2 = unique_title(f"{v2_id} Adopted Fee Schedule for {street}", used_titles, pair_idx + 1000)
        body2 = build_body(
            "townclerk", created2, v2_id, title2, "adopted ordinance amendment for mobile vendor permit fees",
            "current food truck permit fee", resident, dept, street, new_fee, topic, pair_idx + 1000,
            {"clerk": clerk, "resident": resident, "docket": docket, "department": dept,
             "supersedes": title1,
             "detail": f"Temporal subject: {subject}. The current food truck permit fee is {new_fee}."}
        )
        add_note(notes, used_titles, "townclerk", f"tc-{len(notes)+1:05d}", title2, body2, topic, topic_variant(rng, topic), created2)
        pair_records.append((notes[-2], notes[-1], street, old_fee, new_fee))

    for i in range(len(notes), n):
        topic = topics[i]
        primary = make_id("REC" if topic in {"FOIA Requests", "Vital Records", "Cemetery Records"} else "DCK", used_ids, rng)
        event, paraphrase, plain = TOWN_EVENTS[i % len(TOWN_EVENTS)]
        resident = names[(i * 5 + rng.randrange(len(names))) % len(names)]
        clerk = names[(i * 17 + 2) % len(names)]
        dept = companies[(i * 3 + rng.randrange(len(companies))) % len(companies)]
        street = roads[(i * 11 + rng.randrange(len(roads))) % len(roads)]
        amount = f"${rng.randrange(15, 250000):,}"
        docket = make_id("DCK", used_ids, rng)
        created = created_date(rng)
        title = unique_title(f"{primary} {plain.title()} for {resident}", used_titles, i)
        body = build_body(
            "townclerk", created, primary, title, event, plain, resident, dept, street, amount, topic, i,
            {"clerk": clerk, "resident": resident, "docket": docket, "department": dept,
             "detail": f"Board or desk: {topic}. Pairing clue: {clerk} at {street}."}
        )
        add_note(notes, used_titles, "townclerk", f"tc-{len(notes)+1:05d}", title, body, topic, topic_variant(rng, topic), created)

    return notes, pair_records


def make_office_notes(rng, n):
    names = full_names("office")
    companies = orgs("office")
    roads = streets("office")
    used_ids = set()
    used_titles = set()
    notes = []
    topics = weighted_topics(OFFICE_TOPICS, n)
    rng.shuffle(topics)

    pair_records = []
    for pair_idx in range(min(20, max(0, n // 2))):
        v1_id, v2_id = make_pair_ids("REQ", used_ids, rng)
        topic = "Vendor Contracts" if pair_idx % 2 else "Project PRJ-104"
        owner = names[(pair_idx * 8) % len(names)]
        # One vendor+project+owner combination PER PAIR: the original constant
        # "Meridian Systems / PRJ-104" made all 40 pair notes near-identical, so
        # temporal queries couldn't single out their gold version (smoke: 0.0).
        vendor = companies[pair_idx % len(companies)]
        project = f"PRJ-{110 + pair_idx}"
        old_limit = f"${40_000 + pair_idx * 1000:,}"
        new_limit = f"${55_000 + pair_idx * 1500:,}"
        subject = f"the {vendor} contract on {project} owned by {owner}"
        ticket = make_id("TCK", used_ids, rng)
        created1 = fixed_date(pair_idx, 7)
        created2 = fixed_date(pair_idx + 19, 21)
        title1 = unique_title(f"{v1_id} Draft Approval Cap for {project}", used_titles, pair_idx)
        body1 = build_body(
            "office", created1, v1_id, title1, "draft vendor approval cap for analytics implementation",
            "draft vendor approval cap", owner, vendor, roads[pair_idx % len(roads)], old_limit, topic, pair_idx,
            {"owner": owner, "project": project, "vendor": vendor, "ticket": ticket,
             "detail": f"Temporal subject: {subject}. The approval cap before renewal is {old_limit}."}
        )
        add_note(notes, used_titles, "office", f"off-{len(notes)+1:05d}", title1, body1, topic, topic_variant(rng, topic), created1)
        title2 = unique_title(f"{v2_id} Current Approval Cap for {project}", used_titles, pair_idx + 1000)
        body2 = build_body(
            "office", created2, v2_id, title2, "current vendor approval cap for analytics implementation",
            "current vendor approval cap", owner, vendor, roads[pair_idx % len(roads)], new_limit, topic, pair_idx + 1000,
            {"owner": owner, "project": project, "vendor": vendor, "ticket": ticket,
             "supersedes": title1,
             "detail": f"Temporal subject: {subject}. The current approval cap is {new_limit}."}
        )
        add_note(notes, used_titles, "office", f"off-{len(notes)+1:05d}", title2, body2, topic, topic_variant(rng, topic), created2)
        pair_records.append((notes[-2], notes[-1], project, old_limit, new_limit))

    for i in range(len(notes), n):
        topic = topics[i]
        primary = make_id("TCK" if topic == "IT Tickets" else "REQ", used_ids, rng)
        event, paraphrase, plain = OFFICE_EVENTS[i % len(OFFICE_EVENTS)]
        owner = names[(i * 19 + rng.randrange(len(names))) % len(names)]
        vendor = companies[(i * 7 + rng.randrange(len(companies))) % len(companies)]
        project = next((p.split()[-1] for p in [topic] if topic.startswith("Project ")), f"PRJ-{100 + (i % 800)}")
        street = roads[(i * 13 + rng.randrange(len(roads))) % len(roads)]
        amount = f"${rng.randrange(300, 180000):,}"
        ticket = make_id("TCK", used_ids, rng)
        created = created_date(rng)
        title = unique_title(f"{primary} {plain.title()} for {owner}", used_titles, i)
        body = build_body(
            "office", created, primary, title, event, plain, owner, vendor, street, amount, topic, i,
            {"owner": owner, "project": project, "vendor": vendor, "ticket": ticket,
             "detail": f"Workstream: {topic}. Linking clue: {owner} and {vendor}."}
        )
        add_note(notes, used_titles, "office", f"off-{len(notes)+1:05d}", title, body, topic, topic_variant(rng, topic), created)

    return notes, pair_records


def generate_insurance(rng, n):
    return make_insurance_notes(rng, n)


def generate_townclerk(rng, n):
    return make_town_notes(rng, n)


def generate_office(rng, n):
    return make_office_notes(rng, n)


def note_primary_id(note):
    m = ID_RE.search(note["title"])
    if not m:
        raise AssertionError(f"missing id in title: {note['title']}")
    return m.group(1)


def title_words(note):
    return {w.lower() for w in re.findall(r"[A-Za-z]{3,}", note["title"])}


def distinctive_absent(tokens, notes):
    text = corpus_text(notes).lower()
    return all(t.lower() not in text for t in tokens)


def make_queries(scenario, rng, notes, temporal_pairs):
    queries = []
    by_bucket = {"exact": 0, "paraphrase": 0, "temporal": 0, "multihop": 0, "noanswer": 0}

    def add(bucket, q, expect, why):
        by_bucket[bucket] += 1
        queries.append({
            "qid": f"q-{bucket}-{by_bucket[bucket]:03d}",
            "q": q,
            "bucket": bucket,
            "expect_note_ids": expect,
            "note": why,
        })

    exact_candidates = notes[:]
    rng.shuffle(exact_candidates)
    for note in exact_candidates[:max(30, min(60, len(exact_candidates)))]:
        pid = note_primary_id(note)
        add("exact", f"what is the status of {pid}", [note["id"]], "identifier verbatim should retrieve one note")

    for old, new, _, _, _ in temporal_pairs[:8]:
        add("exact", f"pull the exact file for {note_primary_id(old)} not {note_primary_id(new)}", [old["id"]], "lookalike identifier pair targets the first note")
        add("exact", f"pull the exact file for {note_primary_id(new)} not {note_primary_id(old)}", [new["id"]], "lookalike identifier pair targets the second note")

    paraphrases = INS_EVENTS if scenario == "insurance" else TOWN_EVENTS if scenario == "townclerk" else OFFICE_EVENTS
    # Event templates repeat every len(events) notes, so a paraphrase of the
    # event ALONE matches dozens of notes (smoke run: gold buried under clones).
    # Bind each query to a signature that is UNIQUE across the corpus:
    #   insurance/townclerk: (event, street, org)   office: (event, org, project)
    # street/org/project live in bodies, never in titles, so the
    # no-title-words rule still holds.
    from collections import Counter as _Counter
    name_pool_re = re.compile(r"\b(" + "|".join(re.escape(n) for n in full_names(scenario)) + r")\b")
    street_pool_re = re.compile(r"\b(" + "|".join(re.escape(s) for s in STREET_NAMES) + r")\b")
    org_pool_re = re.compile(r"\b(" + "|".join(re.escape(o) for o in orgs(scenario)) + r")\b")
    project_pool_re = re.compile(r"\bPRJ-\d+\b")

    sig_counter = _Counter()
    note_sigs = []
    for note in notes:
        body_l = note["body"].lower()
        ev = next((k for k, (event, _, _) in enumerate(paraphrases) if event in body_l), None)
        st = street_pool_re.search(note["body"])
        og = org_pool_re.search(note["body"])
        pj = project_pool_re.search(note["body"])
        if ev is None or not og:
            continue
        if scenario == "office":
            if not pj:
                continue
            sig = (ev, og.group(1), pj.group(0))
        else:
            if not st:
                continue
            sig = (ev, og.group(1), st.group(1))
        sig_counter[sig] += 1
        note_sigs.append((note, sig))

    para_candidates = []
    for note, sig in note_sigs:
        if sig_counter[sig] != 1:
            continue   # signature collides with another note — query would be ambiguous
        phrase = paraphrases[sig[0]][1]
        if set(re.findall(r"[A-Za-z]{3,}", phrase.lower())) & title_words(note):
            continue
        para_candidates.append((note, phrase, sig))
    rng.shuffle(para_candidates)
    for note, phrase, sig in para_candidates[:max(30, min(50, len(para_candidates)))]:
        if scenario == "insurance":
            q = f"which file discusses {phrase} at {sig[2]} involving {sig[1]}"
        elif scenario == "townclerk":
            q = f"which town record covers {phrase} at {sig[2]} for {sig[1]}"
        else:
            q = f"which office note tracks {phrase} with {sig[1]} on {sig[2]}"
        add("paraphrase", q, [note["id"]], "synonym phrasing + corpus-unique entity binding")

    for old, new, subject, old_value, new_value in temporal_pairs:
        if scenario == "insurance":
            add("temporal", f"what is the current deductible on the {subject}", [new["id"]], "newer note supersedes older policy value")
            add("temporal", f"what was the deductible before the 2025 renewal for {subject}", [old["id"]], "older note is expected for before-renewal wording")
        elif scenario == "townclerk":
            add("temporal", f"what is the current food truck permit fee for {subject}", [new["id"]], "newer clerk note supersedes older fee")
            add("temporal", f"what was the fee before the 2025 adoption for {subject}", [old["id"]], "older clerk note is expected for before-adoption wording")
        else:
            add("temporal", f"what is the current approval cap for {subject}", [new["id"]], "newer office note supersedes older approval cap")
            add("temporal", f"what was the approval cap before renewal for {subject}", [old["id"]], "older office note is expected for before-renewal wording")

    # Multihop: the query names TWO entities whose co-occurrence must identify
    # exactly one note — VERIFIED against the corpus, not assumed (with 5000
    # notes the same name+street pair can easily recur).
    pair_counter = _Counter()
    note_pairs = []
    for note in notes:
        body = note["body"]
        found_name = name_pool_re.search(body)
        second = street_pool_re.search(body) if scenario != "office" else org_pool_re.search(body)
        if not found_name or not second:
            note_pairs.append(None)
            continue
        pair = (found_name.group(1), second.group(1))
        pair_counter[pair] += 1
        note_pairs.append(pair)

    multihop_candidates = list(zip(notes, note_pairs))
    rng.shuffle(multihop_candidates)
    for note, pair in multihop_candidates:
        if not pair or pair_counter[pair] != 1:
            continue   # ambiguous pair — would have multiple valid answers
        if scenario == "insurance":
            add("multihop", f"which adjuster handles the matter involving {pair[0]} at {pair[1]}", [note["id"]], "person and street co-occur only in the target note (verified)")
        elif scenario == "townclerk":
            add("multihop", f"which clerk record links {pair[0]} with {pair[1]}", [note["id"]], "resident and location co-occur only in the target note (verified)")
        else:
            add("multihop", f"which office item links {pair[0]} with {pair[1]}", [note["id"]], "owner and vendor co-occur only in the target note (verified)")
        if by_bucket["multihop"] >= 30:
            break

    impossible_sets = {
        "insurance": [
            ("Zurichstone", "Moonfall", "CLM-999991"), ("PeregrineGlass", "Nebula", "POL-999992"),
            ("VantaCrest", "Starbridge", "CLM-999993"), ("CopperHaven", "Sunspoke", "POL-999994"),
            ("NorthQuartz", "Cloudrift", "CLM-999995"), ("BlueCinder", "Rainspire", "POL-999996"),
        ],
        "townclerk": [
            ("Wolcottvale", "Moonmarket", "DCK-999991"), ("Pinewharf", "Starpermit", "REC-999992"),
            ("Amberford", "Cloudzoning", "DCK-999993"), ("Silvermere", "Sunballot", "REC-999994"),
            ("Cobaltwick", "Rainnotice", "DCK-999995"), ("Juniperbay", "Mistledger", "REC-999996"),
        ],
        "office": [
            ("ZephyrNova", "PRJ-999", "REQ-999991"), ("LumenQuartz", "ghostvendor", "TCK-999992"),
            ("AsterCobalt", "PRJ-998", "REQ-999993"), ("NimbusCopper", "phantomdesk", "TCK-999994"),
            ("OrbitSlate", "PRJ-997", "REQ-999995"), ("VertexPearl", "shadowqueue", "TCK-999996"),
        ],
    }
    idx = 0
    while by_bucket["noanswer"] < 30:
        tokens = impossible_sets[scenario][idx % len(impossible_sets[scenario])]
        suffix = idx // len(impossible_sets[scenario])
        unique_tokens = [f"{t}{suffix}" if i < 2 else t for i, t in enumerate(tokens)]
        if not distinctive_absent(unique_tokens, notes):
            raise AssertionError(f"noanswer token unexpectedly present: {unique_tokens}")
        if scenario == "insurance":
            q = f"who is handling the {unique_tokens[0]} claim for {unique_tokens[1]} under {unique_tokens[2]}"
        elif scenario == "townclerk":
            q = f"where is the {unique_tokens[0]} public record for {unique_tokens[1]} docket {unique_tokens[2]}"
        else:
            q = f"what is the status of {unique_tokens[0]} work for {unique_tokens[1]} item {unique_tokens[2]}"
        add("noanswer", q, [], "distinctive tokens are absent from every title and body")
        idx += 1

    for bucket in by_bucket:
        if by_bucket[bucket] < 30:
            raise AssertionError(f"query bucket {bucket} has fewer than 30 queries")
    return queries, by_bucket


def build_payload(scenario, notes, seed, queries):
    return {
        "scenario": scenario,
        "seed": seed,
        "generated": len(notes),
        "notes": notes,
        "queries": queries,
    }


def print_summary(payload, query_counts):
    notes = payload["notes"]
    topics = len({n["topic_gold"] for n in notes})
    fragmented = sum(1 for n in notes if n["topic_variant"] != n["topic_gold"])
    rate = fragmented / len(notes) if notes else 0.0
    print(f"notes: {len(notes)}")
    print(f"topics: {topics}")
    print(f"variant_fragmentation_rate: {rate:.3f}")
    print("queries: " + ", ".join(f"{k}={query_counts[k]}" for k in sorted(query_counts)))
    print("uniqueness check PASSED")


def parse_args(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", required=True, choices=SCENARIOS)
    parser.add_argument("--notes", type=int)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if args.notes is None:
        args.notes = DEFAULT_NOTES[args.scenario]
    if args.notes < 100:
        parser.error("--notes must be at least 100 to satisfy scenario query requirements")
    return args


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    rng = random.Random(args.seed)

    if args.scenario == "insurance":
        notes, temporal_pairs = generate_insurance(rng, args.notes)
    elif args.scenario == "townclerk":
        notes, temporal_pairs = generate_townclerk(rng, args.notes)
    elif args.scenario == "office":
        notes, temporal_pairs = generate_office(rng, args.notes)
    else:
        raise AssertionError(args.scenario)

    assert_unique(notes)
    queries, query_counts = make_queries(args.scenario, rng, notes, temporal_pairs)
    payload = build_payload(args.scenario, notes, args.seed, queries)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=False)

    print_summary(payload, query_counts)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)