#!/usr/bin/env python3
"""Convert a CMU-distributed Enron mailbox into eval scenario JSON."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
from dataclasses import dataclass
from datetime import date
from email import policy
from email.header import decode_header, make_header
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


DROP_FOLDERS = {
    "all_documents",
    "calendar",
    "contacts",
    "deleted_items",
    "discussion_threads",
    "inbox",
    "notes_inbox",
    "sent",
    "sent_items",
    "_sent_mail",
    "sent_mail",
    "tasks",
}

MIN_BODY_CHARS = 200
MAX_BODY_CHARS = 4000
MIN_FOLDER_MESSAGES = 5
MIN_KNOWNITEM_QUERIES = 40
MIN_NOANSWER_QUERIES = 15

STOPWORDS = {
    "about", "above", "after", "again", "against", "all", "also", "and", "any",
    "are", "because", "been", "before", "being", "between", "both", "but", "can",
    "could", "did", "does", "doing", "don", "down", "each", "few", "for", "from",
    "had", "has", "have", "having", "her", "here", "hers", "him", "his", "how",
    "into", "its", "itself", "just", "may", "more", "most", "not", "now", "off",
    "our", "ours", "out", "over", "own", "same", "she", "should", "some", "such",
    "than", "that", "the", "their", "them", "then", "there", "these", "they",
    "this", "those", "through", "too", "under", "until", "very", "was", "were",
    "what", "when", "where", "which", "while", "who", "why", "will", "with",
    "would", "you", "your",
}

FORWARDED_CUT_PATTERNS = (
    re.compile(r"^\s*-{2,}\s*Original Message\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^\s*Begin forwarded message:\s*$", re.IGNORECASE),
    re.compile(r"^\s*-{2,}\s*Forwarded by\b.*$", re.IGNORECASE),
)
HEADERISH_RE = re.compile(
    r"^\s*(from|to|cc|bcc|sent|date|subject|reply-to):\s+",
    re.IGNORECASE,
)
REPLY_MARKER_RE = re.compile(r"^\s*On .{10,240}\bwrote:\s*$", re.IGNORECASE)
WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'._/-]*")
SEARCH_WORD_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class Candidate:
    folder: str
    relpath: str
    subject: str
    created: str
    body: str
    from_names: Tuple[str, ...]
    to_names: Tuple[str, ...]
    body_hash: str


@dataclass(frozen=True)
class Span:
    display: str
    search: str
    start: int
    end: int
    content_words: frozenset[str]


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def natural_key(value: str) -> Tuple[Tuple[int, object], ...]:
    parts: List[Tuple[int, object]] = []
    for part in re.split(r"(\d+)", value.casefold()):
        if not part:
            continue
        if part.isdigit():
            parts.append((1, int(part)))
        else:
            parts.append((0, part))
    return tuple(parts)


def clean_header(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        text = str(make_header(decode_header(value)))
    except Exception:
        text = str(value)
    text = text.replace("\x00", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_created(value: Optional[str]) -> str:
    text = clean_header(value)
    if not text:
        return ""
    try:
        parsed = parsedate_to_datetime(text)
    except Exception:
        parsed = None
    if parsed is not None:
        return parsed.date().isoformat()

    match = re.search(r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b", text)
    if match:
        year, month, day = (int(group) for group in match.groups())
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return ""

    match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", text)
    if match:
        month, day, year = (int(group) for group in match.groups())
        if year < 100:
            year += 1900 if year >= 70 else 2000
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return ""
    return ""


def decode_payload(part) -> str:
    try:
        content = part.get_content()
        if isinstance(content, str):
            return content
    except Exception:
        pass

    payload = part.get_payload(decode=True)
    if isinstance(payload, bytes):
        charset = part.get_content_charset() or "utf-8"
        try:
            return payload.decode(charset, errors="replace")
        except LookupError:
            return payload.decode("utf-8", errors="replace")
    payload = part.get_payload()
    if isinstance(payload, str):
        return payload
    return ""


def extract_text_body(message) -> str:
    if message.is_multipart():
        parts: List[str] = []
        for part in message.walk():
            if part.is_multipart():
                continue
            if part.get_content_type() != "text/plain":
                continue
            if part.get_content_disposition() == "attachment":
                continue
            text = decode_payload(part)
            if text:
                parts.append(text)
        return "\n\n".join(parts)
    return decode_payload(message)


def cut_forwarded_blocks(lines: Sequence[str]) -> List[str]:
    for index, line in enumerate(lines):
        if any(pattern.match(line) for pattern in FORWARDED_CUT_PATTERNS):
            return list(lines[:index])
    return list(lines)


def strip_quoted_and_header_blocks(lines: Sequence[str]) -> List[str]:
    cleaned: List[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if REPLY_MARKER_RE.match(line):
            break
        if stripped.startswith(">"):
            index += 1
            continue

        if HEADERISH_RE.match(line):
            cursor = index
            header_count = 0
            while cursor < len(lines):
                cursor_line = lines[cursor]
                if HEADERISH_RE.match(cursor_line):
                    header_count += 1
                    cursor += 1
                    continue
                if not cursor_line.strip():
                    cursor += 1
                    continue
                break
            if header_count >= 2:
                index = cursor
                continue

        cleaned.append(line)
        index += 1

    return cleaned


def collapse_body_lines(lines: Iterable[str]) -> str:
    collapsed: List[str] = []
    previous_blank = True
    for line in lines:
        text = line.replace("\x00", "").rstrip()
        if not text.strip():
            if not previous_blank and collapsed:
                collapsed.append("")
            previous_blank = True
            continue
        collapsed.append(text.strip())
        previous_blank = False
    while collapsed and collapsed[-1] == "":
        collapsed.pop()
    return "\n".join(collapsed).strip()


def clean_body(raw: str) -> str:
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    lines = cut_forwarded_blocks(lines)
    lines = strip_quoted_and_header_blocks(lines)
    return collapse_body_lines(lines)


def normalize_body_hash_text(text: str) -> str:
    text = text.casefold()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def body_hash(text: str) -> str:
    normalized = normalize_body_hash_text(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_search_text(text: str) -> str:
    words = SEARCH_WORD_RE.findall(text.casefold())
    return " " + " ".join(words) + " "


def normalize_phrase(text: str) -> str:
    words = SEARCH_WORD_RE.findall(text.casefold())
    return " ".join(words)


def content_words(text: str) -> frozenset[str]:
    words = {
        word
        for word in SEARCH_WORD_RE.findall(text.casefold())
        if len(word) >= 3 and word not in STOPWORDS and not word.isdigit()
    }
    return frozenset(words)


def contains_phrase(search_text: str, phrase: str) -> bool:
    normalized = normalize_phrase(phrase)
    if not normalized:
        return False
    return f" {normalized} " in search_text


def extract_names(header_value: Optional[str]) -> Tuple[str, ...]:
    names: List[str] = []
    seen = set()
    header_text = clean_header(header_value)
    for name, address in getaddresses([header_text]):
        display = clean_header(name)
        if not display and address:
            display = address.split("@", 1)[0]
        display = re.sub(r"[<>]", "", display).strip(" '\"\t")
        if not display:
            continue
        key = display.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(display)
    return tuple(names)


def read_candidate(path: Path, user_root: Path, folder: str) -> Optional[Candidate]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        fail(f"could not read {path}: {exc}")

    try:
        message = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception as exc:
        fail(f"could not parse {path}: {exc}")

    cleaned = clean_body(extract_text_body(message))
    if len(cleaned) < MIN_BODY_CHARS:
        return None

    digest = body_hash(cleaned)
    body = cleaned[:MAX_BODY_CHARS].rstrip()
    relpath = path.relative_to(user_root).as_posix()
    return Candidate(
        folder=folder,
        relpath=relpath,
        subject=clean_header(message.get("Subject")),
        created=parse_created(message.get("Date")),
        body=body,
        from_names=extract_names(message.get("From")),
        to_names=extract_names(message.get("To")),
        body_hash=digest,
    )


def iter_folder_files(folder_path: Path) -> List[Path]:
    files = [path for path in folder_path.rglob("*") if path.is_file()]
    return sorted(files, key=lambda path: natural_key(path.as_posix()))


def load_candidates(maildir: Path, user: str) -> Tuple[List[Candidate], int]:
    user_root = maildir / user
    if not user_root.is_dir():
        fail(f"user mailbox not found: {user_root}")

    seen_hashes = set()
    dedup_drops = 0
    candidates: List[Candidate] = []

    folder_paths = [path for path in user_root.iterdir() if path.is_dir()]
    for folder_path in sorted(folder_paths, key=lambda path: natural_key(path.name)):
        folder = folder_path.name
        if folder.strip().casefold() in DROP_FOLDERS:
            continue
        for path in iter_folder_files(folder_path):
            candidate = read_candidate(path, user_root, folder)
            if candidate is None:
                continue
            if candidate.body_hash in seen_hashes:
                dedup_drops += 1
                continue
            seen_hashes.add(candidate.body_hash)
            candidates.append(candidate)

    return candidates, dedup_drops


def group_by_folder(candidates: Sequence[Candidate]) -> Dict[str, List[Candidate]]:
    grouped: Dict[str, List[Candidate]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate.folder, []).append(candidate)
    for folder in grouped:
        grouped[folder].sort(key=lambda item: natural_key(item.relpath))
    return grouped


def select_kept_candidates(
    candidates: Sequence[Candidate],
    max_notes: int,
    rng: random.Random,
) -> Tuple[List[Candidate], List[str]]:
    grouped = group_by_folder(candidates)
    kept_folders = sorted(
        [
            folder
            for folder, items in grouped.items()
            if len(items) >= MIN_FOLDER_MESSAGES
        ],
        key=natural_key,
    )
    if not kept_folders:
        fail("no topical folders have at least 5 surviving messages")

    kept = [
        candidate
        for folder in kept_folders
        for candidate in grouped[folder]
    ]

    if len(kept) > max_notes:
        minimum_needed = len(kept_folders) * MIN_FOLDER_MESSAGES
        if max_notes < minimum_needed:
            fail(
                f"--max-notes {max_notes} is too small to retain "
                f"{MIN_FOLDER_MESSAGES} messages in each of {len(kept_folders)} folders"
            )

        selected_relpaths = set()
        remainder: List[Candidate] = []
        for folder in kept_folders:
            items = list(grouped[folder])
            rng.shuffle(items)
            for candidate in items[:MIN_FOLDER_MESSAGES]:
                selected_relpaths.add(candidate.relpath)
            remainder.extend(items[MIN_FOLDER_MESSAGES:])

        rng.shuffle(remainder)
        slots = max_notes - len(selected_relpaths)
        for candidate in remainder[:slots]:
            selected_relpaths.add(candidate.relpath)

        kept = [
            candidate
            for candidate in kept
            if candidate.relpath in selected_relpaths
        ]

    kept.sort(key=lambda item: (natural_key(item.folder), natural_key(item.relpath)))

    final_grouped = group_by_folder(kept)
    short_folders = [
        folder
        for folder, items in final_grouped.items()
        if len(items) < MIN_FOLDER_MESSAGES
    ]
    if short_folders:
        fail(f"folder retention guard failed for: {', '.join(short_folders)}")

    return kept, kept_folders


def format_participants(from_names: Sequence[str], to_names: Sequence[str]) -> str:
    from_text = ", ".join(from_names) if from_names else "(unknown)"
    to_text = ", ".join(to_names) if to_names else "(unknown)"
    return f"From: {from_text}; To: {to_text}"


def markdown_body(candidate: Candidate) -> str:
    created = candidate.created if candidate.created else '""'
    return (
        f"---\ncreated: {created}\n---\n\n"
        f"## Message\n\n{candidate.body}\n\n"
        f"## Participants\n\n{format_participants(candidate.from_names, candidate.to_names)}"
    )


def build_notes(user: str, candidates: Sequence[Candidate]) -> List[dict]:
    notes: List[dict] = []
    title_counts: Dict[str, int] = {}
    emitted_titles = set()

    for index, candidate in enumerate(candidates, start=1):
        if candidate.subject:
            base_title = candidate.subject
        else:
            base_title = f"(no subject) {index:05d}"

        seen = title_counts.get(base_title, 0) + 1
        title = base_title if seen == 1 else f"{base_title} \u00b7 {seen}"
        while title in emitted_titles:
            seen += 1
            title = f"{base_title} \u00b7 {seen}"
        title_counts[base_title] = seen
        emitted_titles.add(title)

        notes.append(
            {
                "id": f"enr-{user}-{index:05d}",
                "title": title,
                "body": markdown_body(candidate),
                "topic_gold": candidate.folder,
                "topic_variant": candidate.folder,
                "source_type": "note",
                "_message_body": candidate.body,
                "_body_search": normalize_search_text(candidate.body),
                "_title_content_words": content_words(title),
            }
        )

    return notes


def make_candidate_spans(note: dict, rng: random.Random) -> List[Span]:
    title_words = note["_title_content_words"]
    tokens = [match.group(0).strip("._/-'\"") for match in WORD_RE.finditer(note["_message_body"])]
    tokens = [token for token in tokens if token]

    spans: List[Span] = []
    seen_searches = set()
    for start in range(len(tokens)):
        for length in range(4, 9):
            end = start + length
            if end > len(tokens):
                continue
            phrase_tokens = tokens[start:end]
            if any(len(token) > 32 for token in phrase_tokens):
                continue
            display = " ".join(phrase_tokens)
            if len(display) < 20 or len(display) > 140:
                continue
            phrase_content = content_words(display)
            if len(phrase_content) < 2:
                continue
            if phrase_content & title_words:
                continue
            search = normalize_phrase(display)
            if len(search.split()) != length:
                continue
            if search in seen_searches:
                continue
            seen_searches.add(search)
            spans.append(
                Span(
                    display=display,
                    search=search,
                    start=start,
                    end=end,
                    content_words=phrase_content,
                )
            )

    rng.shuffle(spans)
    return spans[:350]


def phrase_matches(
    phrase: str,
    body_searches: Sequence[Tuple[str, str]],
) -> frozenset[str]:
    needle = f" {phrase} "
    return frozenset(
        note_id
        for note_id, search_text in body_searches
        if needle in search_text
    )


def build_knownitem_queries(notes: Sequence[dict], rng: random.Random) -> List[dict]:
    if len(notes) < MIN_KNOWNITEM_QUERIES:
        fail(
            f"need at least {MIN_KNOWNITEM_QUERIES} notes to build knownitem queries; "
            f"only {len(notes)} notes survived"
        )

    body_searches = [(note["id"], note["_body_search"]) for note in notes]
    note_order = list(notes)
    rng.shuffle(note_order)

    queries: List[dict] = []
    used_note_ids = set()
    for note in note_order:
        if note["id"] in used_note_ids:
            continue
        spans = make_candidate_spans(note, rng)
        if len(spans) < 2:
            continue

        match_cache: Dict[str, frozenset[str]] = {}
        for span in spans:
            matches = phrase_matches(span.search, body_searches)
            if note["id"] in matches:
                match_cache[span.search] = matches

        for span_a in spans:
            matches_a = match_cache.get(span_a.search)
            if not matches_a:
                continue
            for span_b in spans:
                if span_a is span_b:
                    continue
                if not (span_a.end <= span_b.start or span_b.end <= span_a.start):
                    continue
                matches_b = match_cache.get(span_b.search)
                if not matches_b:
                    continue
                if matches_a & matches_b != {note["id"]}:
                    continue

                query_index = len(queries) + 1
                note_id = note["id"]
                queries.append(
                    {
                        "id": f"enr-knownitem-{query_index:03d}",
                        "bucket": "knownitem",
                        "query": (
                            f"which email discusses {span_a.display} "
                            f"and {span_b.display}"
                        ),
                        "expected_note_ids": [note_id],
                        "expected_ids": [note_id],
                        "expect": note_id,
                    }
                )
                used_note_ids.add(note_id)
                break
            if note["id"] in used_note_ids:
                break

        if len(queries) >= MIN_KNOWNITEM_QUERIES:
            break

    if len(queries) < MIN_KNOWNITEM_QUERIES:
        fail(
            f"could only build {len(queries)} corpus-unique knownitem queries; "
            f"need {MIN_KNOWNITEM_QUERIES}"
        )

    return queries


NOANSWER_CANDIDATES = (
    ("Ariadne Quill", "Monteverde Robotics", "the condenser maintenance renewal", "Did Ariadne Quill send the Monteverde Robotics condenser maintenance renewal?"),
    ("Bastian Vale", "Northstar Lyceum", "the guest lecture invoice", "Which email mentions Bastian Vale and the Northstar Lyceum guest lecture invoice?"),
    ("Celeste Rowan", "Blueglass Aerostat", "the helium storage schedule", "Was Celeste Rowan copied on the Blueglass Aerostat helium storage schedule?"),
    ("Dorian Kestrel", "Pinebridge Cartography", "the revised atlas proofs", "Did Dorian Kestrel approve Pinebridge Cartography's revised atlas proofs?"),
    ("Elian Voss", "Copper Lantern Labs", "the prototype battery memo", "Which message discusses Elian Voss and the Copper Lantern Labs prototype battery memo?"),
    ("Farah Nadir", "Silver Orchard Trust", "the museum catering estimate", "Did Farah Nadir send the Silver Orchard Trust museum catering estimate?"),
    ("Gideon Marlow", "Atlas Finch Bakery", "the wholesale croissant order", "Which email refers to Gideon Marlow and the Atlas Finch Bakery wholesale croissant order?"),
    ("Helena Quade", "Riverbend Planetarium", "the telescope calibration appointment", "Was Helena Quade asked about the Riverbend Planetarium telescope calibration appointment?"),
    ("Inez Calder", "Bright Harbor Textiles", "the dye lot replacement", "Did Inez Calder discuss the Bright Harbor Textiles dye lot replacement?"),
    ("Julian Mire", "Quartzline Foundry", "the sculpture casting quote", "Which email discusses Julian Mire and the Quartzline Foundry sculpture casting quote?"),
    ("Kaia Solenne", "Meridian Kiteworks", "the festival permit packet", "Did Kaia Solenne send the Meridian Kiteworks festival permit packet?"),
    ("Lucan Embry", "Willowmere Archives", "the manuscript humidity report", "Which message mentions Lucan Embry and the Willowmere Archives humidity report?"),
    ("Mira Sable", "Opal Street Conservatory", "the recital seating chart", "Was Mira Sable included on the Opal Street Conservatory recital seating chart?"),
    ("Nolan Briar", "Redwood Semaphore", "the signal tower inspection", "Did Nolan Briar ask about the Redwood Semaphore signal tower inspection?"),
    ("Oriana Flux", "Cobalt Sundial Works", "the gnomon replacement order", "Which email discusses Oriana Flux and the Cobalt Sundial Works replacement order?"),
    ("Petra Valeen", "Hearthstone Marimba", "the instrument freight claim", "Did Petra Valeen forward the Hearthstone Marimba instrument freight claim?"),
    ("Quentin Lark", "Nimbus Porcelain", "the kiln repair deposit", "Which message mentions Quentin Lark and the Nimbus Porcelain kiln repair deposit?"),
    ("Rhea Mistral", "Golden Saffron Imports", "the customs broker question", "Did Rhea Mistral answer the Golden Saffron Imports customs broker question?"),
    ("Silas Fen", "Marble Tern Studios", "the gallery lighting plan", "Which email discusses Silas Fen and the Marble Tern Studios gallery lighting plan?"),
    ("Talia Wren", "Aster Vale Apothecary", "the lavender shipment delay", "Did Talia Wren mention the Aster Vale Apothecary lavender shipment delay?"),
    ("Ulric Bane", "Pearl Indexing Bureau", "the archival label contract", "Was Ulric Bane copied on the Pearl Indexing Bureau archival label contract?"),
    ("Vera Lumen", "Ironwood Ballet", "the rehearsal floor repair", "Which message asks about Vera Lumen and the Ironwood Ballet rehearsal floor repair?"),
    ("Wesley Nocturne", "Cedar Loom Guild", "the weaving workshop roster", "Did Wesley Nocturne send the Cedar Loom Guild weaving workshop roster?"),
    ("Xenia Vale", "Amberglass Mycology", "the culture freezer alarm", "Which email mentions Xenia Vale and the Amberglass Mycology freezer alarm?"),
    ("Yara Sloane", "Granite Lantern Press", "the bookbinding invoice", "Did Yara Sloane approve the Granite Lantern Press bookbinding invoice?"),
    ("Zev Halcyon", "Ivory Meridian Museum", "the exhibit crate pickup", "Which message discusses Zev Halcyon and the Ivory Meridian Museum crate pickup?"),
)


def build_noanswer_queries(notes: Sequence[dict]) -> List[dict]:
    corpus_search = normalize_search_text(
        "\n".join(f"{note['title']}\n{note['_message_body']}" for note in notes)
    )
    queries: List[dict] = []

    for person, organization, _topic, query in NOANSWER_CANDIDATES:
        absent_terms = (person, organization)
        if any(contains_phrase(corpus_search, term) for term in absent_terms):
            continue
        query_index = len(queries) + 1
        queries.append(
            {
                "id": f"enr-noanswer-{query_index:03d}",
                "bucket": "noanswer",
                "query": query,
                "expected_note_ids": [],
                "expected_ids": [],
                "expect": None,
            }
        )
        if len(queries) >= MIN_NOANSWER_QUERIES:
            break

    if len(queries) < MIN_NOANSWER_QUERIES:
        fail(
            f"could only build {len(queries)} noanswer queries with absent entities; "
            f"need {MIN_NOANSWER_QUERIES}"
        )
    return queries


def strip_private_note_fields(notes: Sequence[dict]) -> List[dict]:
    public_notes: List[dict] = []
    for note in notes:
        public_notes.append(
            {
                key: value
                for key, value in note.items()
                if not key.startswith("_")
            }
        )
    return public_notes


def assert_scenario(scenario: dict, kept_folders: Sequence[str]) -> None:
    notes = scenario.get("notes")
    queries = scenario.get("queries")
    if not isinstance(notes, list) or not notes:
        fail("scenario has no notes")
    if not isinstance(queries, dict):
        fail("scenario queries must be a bucket object")

    note_ids = [note.get("id") for note in notes]
    if len(note_ids) != len(set(note_ids)):
        fail("duplicate note ids emitted")

    titles = [note.get("title") for note in notes]
    if len(titles) != len(set(titles)):
        fail("duplicate note titles emitted")

    folder_counts: Dict[str, int] = {}
    for note in notes:
        for key in ("id", "title", "body", "topic_gold", "topic_variant", "source_type"):
            if key not in note:
                fail(f"note missing required key: {key}")
        if note["source_type"] != "note":
            fail(f"unexpected source_type for {note['id']}: {note['source_type']}")
        if note["topic_gold"] != note["topic_variant"]:
            fail(f"topic variant diverged from gold for {note['id']}")
        folder_counts[note["topic_gold"]] = folder_counts.get(note["topic_gold"], 0) + 1

    for folder in kept_folders:
        count = folder_counts.get(folder, 0)
        if count < MIN_FOLDER_MESSAGES:
            fail(f"kept folder {folder} has only {count} emitted notes")

    for bucket in ("knownitem", "noanswer", "exact", "temporal"):
        if bucket not in queries:
            fail(f"missing query bucket: {bucket}")
        if not isinstance(queries[bucket], list):
            fail(f"query bucket is not a list: {bucket}")

    if len(queries["knownitem"]) < MIN_KNOWNITEM_QUERIES:
        fail("knownitem query guard failed")
    if len(queries["noanswer"]) < MIN_NOANSWER_QUERIES:
        fail("noanswer query guard failed")
    if queries["exact"] != [] or queries["temporal"] != []:
        fail("exact and temporal buckets must be empty")

    note_id_set = set(note_ids)
    for query in queries["knownitem"]:
        expected = query.get("expected_note_ids")
        if not isinstance(expected, list) or len(expected) != 1:
            fail(f"knownitem query has invalid expectation: {query.get('id')}")
        if expected[0] not in note_id_set:
            fail(f"knownitem query expects missing note: {query.get('id')}")
    for query in queries["noanswer"]:
        if query.get("expected_note_ids") != []:
            fail(f"noanswer query has non-empty expectation: {query.get('id')}")


def write_json(path: Path, scenario: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(scenario, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a CMU-distributed Enron mailbox to eval scenario JSON."
    )
    parser.add_argument("--maildir", required=True, type=Path)
    parser.add_argument("--user", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--max-notes", type=int, default=1500)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args(argv)

    if args.max_notes <= 0:
        fail("--max-notes must be positive")
    return args


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    rng = random.Random(f"{args.user}\0{args.seed}")

    # Enron message files end in a bare dot ("1.", "2.") — Win32 path
    # normalization strips trailing dots, so stat/open silently miss every
    # file. The \\?\ extended-length prefix disables that normalization.
    maildir = args.maildir.resolve()
    if os.name == "nt" and not str(maildir).startswith("\\\\?\\"):
        maildir = Path("\\\\?\\" + str(maildir))

    candidates, dedup_drops = load_candidates(maildir, args.user)
    if not candidates:
        fail("no messages survived folder, body-length, and parsing filters")

    kept_candidates, kept_folders = select_kept_candidates(
        candidates=candidates,
        max_notes=args.max_notes,
        rng=rng,
    )
    notes_with_private_fields = build_notes(args.user, kept_candidates)

    queries = {
        "knownitem": build_knownitem_queries(notes_with_private_fields, rng),
        "noanswer": build_noanswer_queries(notes_with_private_fields),
        "exact": [],
        "temporal": [],
    }
    scenario = {
        "notes": strip_private_note_fields(notes_with_private_fields),
        "queries": queries,
    }

    assert_scenario(scenario, kept_folders)

    # Harness contract (run_scenario_eval.py): top-level scenario/seed keys and
    # a FLAT query list with qid/q/bucket/expect_note_ids. Sol's internal bucket
    # dict is validated above, then flattened here (integration-side reconcile).
    flat_queries = [
        {
            "qid": q["id"],
            "q": q["query"],
            "bucket": q["bucket"],
            "expect_note_ids": q["expected_note_ids"],
            "note": "enron real-data query",
        }
        for q in queries["knownitem"] + queries["noanswer"]
    ]
    scenario = {
        "scenario": f"enron-{args.user}",
        "seed": args.seed,
        "generated": len(scenario["notes"]),
        "notes": scenario["notes"],
        "queries": flat_queries,
    }
    write_json(args.out, scenario)

    print(f"user: {args.user}")
    print(f"folders kept: {len(kept_folders)}")
    print(f"notes: {len(scenario['notes'])}")
    print(f"dedup drops: {dedup_drops}")
    for bucket in ("knownitem", "noanswer", "exact", "temporal"):
        print(f"queries.{bucket}: {len(queries[bucket])}")
    print("assertions PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())