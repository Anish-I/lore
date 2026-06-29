"""Optional cloud-LLM relation enrichment (origin='llm').

The heuristic reasoned-graph is precise but can only extract relationships that notes
state explicitly. Descriptive prose ("the assistant migrated off Composio to X") implies
relations a cue lexicon can't catch. This module asks a CLOUD LLM (Together AI by default)
to INFER typed relations from a note's prose — but with hard guards so it can never invent
nodes or outrank the trusted heuristic layer (design chosen + specced by Codex):

  * endpoints are constrained to EXISTING note titles (both must resolve — no hallucinated nodes)
  * relation must be one of the fixed kinds; confidence threshold (default 0.55)
  * evidence (a short quote/paraphrase) is required
  * edges land with origin='llm' and NEVER overwrite a higher-confidence heuristic/capture edge
  * cached by body hash so unchanged notes aren't re-billed

Runs on-demand (`POST /enrich`, `lore enrich`) or from upkeep — never blocking ingest.
"""
import os
import re
import json
import hashlib

from .relations import RELATION_KINDS, build_title_index, _is_distinctive

_PROMPT_VERSION = "v1"
_DEFAULT_MODEL = os.environ.get("LORE_ENRICH_MODEL", "meta-llama/Llama-4-Maverick-17B-128E-Instruct")
_MIN_CONF = 0.55
_MAX_CANDIDATES = 60          # cap the candidate whitelist put in the prompt
_BODY_CHARS = 2400            # cap the note text sent to the model

_RELATIONS_STR = " | ".join(RELATION_KINDS)


def _prompt(title: str, text: str, candidates: list) -> str:
    cand = "\n".join(f"- {c}" for c in candidates[:_MAX_CANDIDATES])
    return (
        "You extract typed relationships between notes in a knowledge base.\n"
        f"SOURCE NOTE TITLE: {title}\n"
        f"SOURCE NOTE TEXT:\n{text[:_BODY_CHARS]}\n\n"
        "CANDIDATE TARGET NOTES (you may ONLY use these exact titles as targets — never invent one):\n"
        f"{cand}\n\n"
        f"Allowed relation types: {_RELATIONS_STR}.\n"
        "Return a STRICT JSON array (no prose) of edges FROM the source note TO a candidate note that the "
        "source text actually implies. Each item: "
        '{"target":"<exact candidate title>","relation":"<one allowed type>",'
        '"confidence":<0..1>,"evidence":"<short quote/paraphrase from the source text>"}. '
        "Only include a relation if the text genuinely supports it. If none, return []."
    )


def together_chat(prompt: str, model: str = None, timeout: int = 60) -> str:
    """Call Together AI's OpenAI-compatible chat API. Requires TOGETHER_API_KEY."""
    key = os.environ.get("TOGETHER_API_KEY")
    if not key:
        raise RuntimeError("TOGETHER_API_KEY not set")
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url="https://api.together.xyz/v1")
    resp = client.chat.completions.create(
        model=model or _DEFAULT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        timeout=timeout,
    )
    return resp.choices[0].message.content or ""


def parse_relations(raw: str, candidate_map: dict, min_conf: float = _MIN_CONF) -> list:
    """Parse + VALIDATE the model's JSON. Returns [(dst_id, kind, confidence, evidence)].
    Drops anything whose target isn't a known note, relation isn't allowed, confidence is
    below threshold, or evidence is missing. The model can infer edges, never invent nodes."""
    m = re.search(r"\[.*\]", raw or "", re.DOTALL)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except Exception:
        return []
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        target = str(it.get("target", "")).strip().lower()
        kind = str(it.get("relation", "")).strip()
        evidence = str(it.get("evidence", "")).strip()
        try:
            conf = float(it.get("confidence", 0))
        except Exception:
            conf = 0.0
        dst = candidate_map.get(target)
        if not dst or kind not in RELATION_KINDS or conf < min_conf or not evidence:
            continue
        out.append((dst, kind, round(min(conf, 0.95), 3), evidence[:240]))
    return out


def _body_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", "ignore")).hexdigest()


def _ensure_cache(conn):
    conn.execute(
        "create table if not exists llm_enrich_cache ("
        " note_id text, tenant_id text, body_hash text, model text, prompt_version text,"
        " primary key (note_id, tenant_id))")


def _upsert_llm_edge(conn, tenant, src, dst, kind, conf, evidence) -> bool:
    """Insert an origin='llm' edge, but NEVER overwrite a higher-confidence existing edge
    (heuristic/capture edges are first-class). Returns True if written."""
    row = conn.execute(
        "select weight, origin from edges where tenant_id=%s and src_note_id=%s and dst_note_id=%s and kind=%s",
        (tenant, src, dst, kind)).fetchone()
    if row is not None and (row[0] or 0) >= conf:
        return False  # an equal/stronger edge already exists — leave it
    conn.execute(
        """insert into edges(tenant_id, src_note_id, dst_note_id, kind, weight, evidence, origin)
           values(%s,%s,%s,%s,%s,%s,'llm')
           on conflict (tenant_id, src_note_id, dst_note_id, kind)
           do update set weight=excluded.weight, evidence=excluded.evidence,
                         origin=case when edges.origin in ('capture') then edges.origin else 'llm' end,
                         updated_at=now()""",
        (tenant, src, dst, kind, conf, evidence))
    return True


def enrich_relations(conn, tenant: str, llm_call=None, min_conf: float = _MIN_CONF,
                     limit: int = 40, model: str = None, force: bool = False) -> dict:
    """Enrich the reasoned graph with LLM-inferred relations for notes whose body changed.

    Args:
        llm_call: callable(prompt)->str. Defaults to together_chat. Injectable for tests.
        limit: max notes to process this run (cost control).
        force: re-enrich even if the body hash is cached.

    Returns {"notesProcessed", "edges", "skipped"}.
    """
    llm_call = llm_call or together_chat
    _ensure_cache(conn)

    # Candidate whitelist: distinctive existing titles -> id (no invented nodes possible).
    idx = build_title_index(conn, tenant)
    candidate_map = {t.lower(): i for t, i, _p in idx}
    candidate_titles = [t for t, _i, _p in idx]

    notes = conn.execute(
        "select id, title, body from notes where tenant_id=%s and body is not null and length(body)>40 "
        "order by updated_at desc limit %s", (tenant, limit)).fetchall()

    processed = edges = skipped = 0
    for nid, title, body in notes:
        bh = _body_hash(body)
        if not force:
            cached = conn.execute(
                "select body_hash from llm_enrich_cache where note_id=%s and tenant_id=%s", (nid, tenant)).fetchone()
            if cached and cached[0] == bh:
                skipped += 1
                continue
        # candidates minus self; skip notes with nothing to relate to
        cands = [t for t in candidate_titles if candidate_map.get(t.lower()) != nid]
        if not cands or not _is_distinctive(title or ""):
            # still cache so we don't retry every run
            pass
        try:
            raw = llm_call(_prompt(title or "", body, cands))
        except Exception:
            skipped += 1
            continue
        for dst, kind, conf, evidence in parse_relations(raw, candidate_map, min_conf):
            if dst == nid:
                continue
            if _upsert_llm_edge(conn, tenant, nid, dst, kind, conf, evidence):
                edges += 1
        conn.execute(
            "insert into llm_enrich_cache(note_id,tenant_id,body_hash,model,prompt_version) "
            "values(%s,%s,%s,%s,%s) on conflict (note_id,tenant_id) "
            "do update set body_hash=excluded.body_hash, model=excluded.model, prompt_version=excluded.prompt_version",
            (nid, tenant, bh, model or _DEFAULT_MODEL, _PROMPT_VERSION))
        processed += 1
    return {"notesProcessed": processed, "edges": edges, "skipped": skipped}
