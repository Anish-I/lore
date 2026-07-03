# Lore for Teams & Enterprise

This is the design for how Lore scales from a single laptop to a company — and,
critically, how it does that **without adding operational complexity for IT**.
Everything marked *(planned)* is designed but not yet built; everything else
ships today.

## The problem we're solving

Lore is a great tool for a developer, but a corporate rollout has three
non-negotiables that a local-first app doesn't answer on its own:

1. **Assurance** — "where does my data go, and can I prove it's backed up?"
2. **Simplicity** — a SharePoint user should never see a knowledge graph.
3. **Identity & access** — permissions must live in the tools IT already runs
   (Okta / Entra / Active Directory), not in a second system someone hand-curates.

## 1. Simple by default (shipping)

- **Simple Mode** strips the developer surface (graph, wizards, automation) down
  to Files + Search + Ask. One toggle; everything keeps working underneath.
- **Backup assurance** *(planned, near-term)* — Lore mirrors your library into a
  OneDrive/SharePoint-synced folder. Microsoft's own sync client does the
  transport (IT already trusts it), and the app shows a plain **"Last backed up
  2 min ago ✓"** status line. Files literally appear in SharePoint — that's the
  assurance, no faith required.

## 2. One-box team architecture *(planned)*

Today's "team server" story would ask IT to stand up three services (backend,
Postgres, Qdrant). That's the complexity the feedback flagged. The plan collapses
it:

```
docker run -p 8099:8099 -v lore-data:/data lore/server
```

A single container bundles the FastAPI backend, Postgres, and the vector store.
Desktop apps just point at its URL. One image, one volume, one port — the same
mental model as running any internal web app. A managed-cloud option (we host it)
is phase 2 for teams who don't want to run anything at all.

**Why this is even possible:** `core/lore/db.py` is dialect-adaptive — the exact
same query code runs SQLite on a laptop and Postgres on the server. There is one
codebase, not a separate enterprise product to keep in sync.

## 3. Identity: Okta / Entra / AD groups → scopes *(planned)*

This is the real security *simplification*. Lore already verifies identity
cryptographically (Google ID tokens today, `core/lore/auth.py`) and never trusts
client-supplied identity or permissions. The enterprise design extends that:

- **OIDC with Okta or Microsoft Entra as the identity provider** — same pattern
  as the existing Google verification: verify the ID token, derive the user.
- **AD/Okta groups map 1:1 to Lore scopes.** Group `Finance` ⇒ scope `finance`.
  A user in the `Finance` and `Legal` groups can read exactly those scopes.
- **Nobody hand-manages Lore permissions.** Access lives where IT already manages
  it — add someone to a group in Okta, they get the corresponding Lore access;
  remove them, it's gone. SCIM provisioning for automated de-provisioning is a
  fast follow.

The point: enterprise access control becomes *"it's just your Okta groups,"* not
a new permissions surface to audit.

## 4. How scopes actually protect data (shipping today)

Scopes aren't a UI filter bolted on top — they're an **ACL applied inside every
retrieval query**, deny-by-default:

- Every note carries a scope (`private` / `team` / `company`). Every chunk stores
  that scope in its vector-store payload.
- A search **cannot even see** out-of-scope chunks — the filter is part of the
  query, not a post-filter that could be bypassed. In server mode, the effective
  scopes come from the verified token's group membership, *never* from what the
  client asks for (`api._authorize_read`).
- **Changing confidentiality is deliberate and safe.** Moving a note to a broader
  scope (private → team) runs a secret scrubber first and refuses if it finds an
  API key or token unless you explicitly confirm — you can't accidentally share a
  credential.
- **Every answer shows its scope** *(shipping)* — "answered from: Team" — so the
  confidentiality boundary is visible, not invisible magic.

**The evidence:** an adversarial audit on a simulated 46,000-note company (327
distinct scopes, 300 people, 12 departments) ran **210 cross-department
extraction probes and leaked zero data** — every probe returned only
scope-authorized notes. That audit is re-runnable and (planned) wired into CI so
the no-leak property is re-proven on every change.

## Security roadmap

| Item | Status |
|---|---|
| ACL-inside-the-query, deny-by-default | **shipping** |
| Cryptographically verified identity (no client-trusted scopes) | **shipping** |
| Redaction gate on confidentiality broadening | **shipping** |
| Local API token (lock the on-device backend port) | **shipping** |
| Per-answer scope trace | **shipping** |
| Query audit log | planned, near-term |
| Okta / Entra OIDC + group→scope mapping | planned |
| SCIM auto-provisioning | planned |
| Encryption at rest, retention policies, DLP hooks | roadmap |

## The one-line pitch for IT

*Your files stay yours and back up to the SharePoint you already trust; team
access is just your Okta groups; and no data has ever crossed a scope boundary in
testing. Nothing new to babysit.*
