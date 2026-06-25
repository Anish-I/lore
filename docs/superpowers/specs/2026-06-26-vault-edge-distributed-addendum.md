# Vault — Edge-Assisted / Distributed Compute (Design Addendum)

> **Status:** Draft · **Date:** 2026-06-25 · Extends `2026-06-25-vault-knowledge-os-design.md`

## 1. Idea

The local agent already runs on every employee's machine (it watches their files). So let that machine also do
the **compute** — embedding, distillation, indexing of *that person's own files* — using idle cycles on hardware
the company already owns. A central **server** remains the durable backbone (source of truth, permissions,
cross-person retrieval, answer generation). Employees connect to it over a shared secure channel.

This drives the per-employee embedding/ingestion cost to **$0 marginal** (it runs on the laptop) and strengthens
the privacy story (raw files never need to leave the machine).

## 2. The one trap to avoid (key design tension)

The whole product promise is *"knowledge survives when someone retires / is on PTO."* That **requires durability**:
if a person's knowledge lived only on their laptop, it would vanish the moment the laptop is off — defeating the
purpose.

**Resolution:** the **server is the durable source of truth.** The edge is a **compute accelerator + local-first
cache**, never the sole store. "Private scope" means *access-controlled on the server* (encrypted, per-user key),
not *physically-only-on-device*. Everything syncs up (encrypted); the edge just makes it free to produce and fast
to read locally.

## 3. Three planes

### 3.1 Edge agent (per employee machine)
- Watches files; distills → linked Markdown; chunks; **embeds locally** (BGE ONNX on CPU/iGPU — same models we
  validated at 95% recall, $0 API).
- Maintains a **local vector index** (e.g. sqlite-vec / LanceDB) for **instant, offline** queries over the user's
  OWN vault.
- Syncs (encrypted) chunk text + vectors + scope tags to the server via an **outbox** (queues when offline,
  flushes when reconnected).
- Serves **private-scope queries fully locally** (low latency, works on a plane).

### 3.2 Control/data plane (central server)
- **Postgres** = source of truth: note metadata, ACL/scopes, graph edges, sync/version state, device registry.
- **Qdrant** = aggregated vectors for **team/enterprise** scopes (+ encrypted durable copy of private vectors).
- **Sync service**: receives edge uploads over mTLS, **re-validates ACL** (never trusts the edge), content-hash
  dedups, resolves versions.
- **Cross-person retrieval + answer generation**: server-side (reliable, ACL-enforced, can use a bigger LLM).

### 3.3 Transport (the "shared connection")
- Edge ↔ server: persistent secure channel (WebSocket or gRPC + **mTLS**, per-device client certs).
- Edge work is **idempotent + resumable** (outbox + content hashes) so flaky laptops never corrupt state.

## 4. The placement rule

> **Edge** does work that is *per-user, async-tolerant, and embarrassingly parallel* (ingest/distill/embed of
> one's own files + local-first read of one's own vault).
> **Server** does work that is *durable, cross-user, latency/consistency-sensitive, or trust-sensitive*
> (ACL, cross-person retrieval, answer-gen, durable storage).

Corollary: **never put a critical-path query on a colleague's laptop.** A cross-person query reads the server's
already-synced copy — it must not depend on a peer device being awake. (No hard P2P dependency; laptops sleep.)

## 5. Security / trust model

- **Server is the ACL authority.** A compromised edge cannot be trusted to enforce permissions; the edge ACL is
  only a local-cache optimization. The server re-validates scope on every cross-person read.
- **Encryption:** in transit (mTLS); at rest per-scope keys. Private vectors encrypted under a user key; the
  server stores ciphertext for durability. Team/enterprise scopes use shared scope keys so the server can serve
  cross-person reads.
- **Device identity binds principal → scopes** (per-device capability token). This also closes the M4 authn gap:
  `/ask` no longer trusts client-supplied `principal_scopes` — they're derived from the authenticated device.
- Signed edge builds; least-privilege file access; user-visible "what is being indexed/shared" controls.

## 6. Reliability under heterogeneity

Laptops are weak, sleep, and go offline. Mitigations:
- **Outbox + content-hash dedup** → resumable, exactly-once-ish sync.
- **Server-side re-embed fallback:** if an edge never syncs (offline for days), the server can embed from the last
  synced raw/Markdown so shared knowledge isn't blocked (degraded mode).
- **Backpressure:** edge throttles embedding to idle/charging windows so it never harms the employee's machine.
- **Capability negotiation:** weak machines offload heavier steps (e.g. distillation LLM) to the server; strong
  machines do more locally.

## 7. Cost impact (vs the central-only model)

- **Embedding/ingestion compute → ~$0** (employee hardware, already owned).
- Server shrinks to: Postgres + Qdrant + **answer-gen GPU** + sync service. Answer-gen + storage become the only
  real server costs (see economics in the main spec / cost note).
- Reinforces the enterprise self-host economics: a 10k-employee deployment's server cost is dominated by the
  answer-LLM, which can itself be self-hosted or skipped (return cited chunks) for many queries.

## 8. Phasing (maps onto the milestones)

- M1 (done) → M4: build the loop + recall + scopes **server-side first** (simpler, one place to reason about).
- **M5 — Edge agent:** lift watch/distill/embed onto the employee machine; add the sync protocol (outbox + mTLS),
  per-device identity, local-first private queries, and server-side re-embed fallback. This is the productization
  of the "a model that sits in their machine" vision.

Rationale for server-first then edge: the edge is an *optimization + privacy/cost win* over a correct central
design. Prove correctness centrally (M1–M4), then distribute the parallelizable compute (M5) without changing the
trust or durability guarantees.
