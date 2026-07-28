#!/usr/bin/env python3
"""
Build per-town Town Clerk document corpora for Connecticut towns.

Input towns.json shape:
[
  {
    "town": "Hartford",
    "clerk_url": "https://www.hartfordct.gov/Government/Departments/Town-Clerk",
    "site_root": "https://www.hartfordct.gov"
  }
]

Firecrawl hook:
    The runner calls discover(town, config, client, logger). The default
    implementation is pure HTTP. To wire Firecrawl MCP, replace firecrawl_discover()
    or pass --external-discovery-cmd. The external command receives one town JSON
    object on stdin and should print either:
      - JSON list of URLs or {"urls": [...]} or {"documents": [{"url": "..."}]}
      - plain newline-delimited URLs

    The Firecrawl hook is called only when the HTTP crawl sees fewer than
    --js-link-threshold unique links. It should return document URLs discovered
    by firecrawl_map/scrape, not page bodies.

Puppeteer fallback:
    Install the isolated bridge with:
      cd tools/ct-clerk-puppeteer && npm install
    Then pass --puppeteer-fallback. The browser renders only seed pages already
    approved by this driver's robots policy (including public pages whose plain
    HTTP fetch returned 403) and emits candidate URLs; Python still performs
    every document download. When --external-discovery-cmd is also set, that
    Firecrawl/helper command runs first and Puppeteer runs only if it produces
    no viable document candidates.

Output:
    <out>/<town-slug>/files/*
    <out>/<town-slug>/manifest.csv
    <out>/<town-slug>/state.json
    <out>/zips/<town-slug>.zip
    <out>/index.csv
    <out>/run.log

Required dependency:
    python -m pip install requests
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
import zipfile
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Set, Tuple
from urllib import robotparser
from urllib.parse import unquote, urldefrag, urljoin, urlparse, urlunparse

try:
    import requests
except ImportError as exc:  # pragma: no cover - helpful for first run.
    raise SystemExit("Missing dependency: pip install requests") from exc


DOC_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".txt",
    ".rtf",
    ".odt",
    ".zip",
}

PAGE_EXTENSIONS = {
    "",
    ".html",
    ".htm",
    ".shtml",
    ".xhtml",
    ".php",
    ".asp",
    ".aspx",
    ".cfm",
    ".cgi",
    ".do",
    ".action",
    ".jsp",
}

PROBE_HANDLER_EXTENSIONS = {".ashx", ".axd", ".svc", ".download"}

ASSET_EXTENSIONS = {
    ".7z",
    ".avi",
    ".bmp",
    ".css",
    ".eot",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".map",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".png",
    ".rar",
    ".svg",
    ".tar",
    ".tif",
    ".tiff",
    ".ttf",
    ".wav",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
}

DOC_CONTENT_TYPES = {
    "application/csv",
    "application/msword",
    "application/pdf",
    "application/rtf",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-rtf",
    "application/zip",
    "text/csv",
    "text/plain",
    "text/rtf",
}

DOC_CONTENT_TYPE_TOKENS = (
    "application/pdf",
    "application/msword",
    "officedocument",
    "vnd.ms-excel",
    "text/csv",
    "application/csv",
    "application/rtf",
    "text/rtf",
    "opendocument",
    "application/zip",
)

CONTENT_TYPE_EXTENSION = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/rtf": ".rtf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/zip": ".zip",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "text/rtf": ".rtf",
}

RETRY_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}
REDIRECT_HTTP_STATUSES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 10
MANIFEST_FIELDS = [
    "url",
    "filename",
    "bytes",
    "content_type",
    "sha256",
    "http_status",
    "discovered_from",
    "status",
    "notes",
]
INDEX_FIELDS = [
    "town",
    "slug",
    "clerk_url",
    "files_count",
    "total_bytes",
    "zip_path",
    "status",
    "notes",
]
RESERVED_WINDOWS_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
CLERK_TERMS = (
    "town-clerk",
    "town_clerk",
    "town clerk",
    "clerk",
    "land-record",
    "land_record",
    "land record",
    "vital-record",
    "vital_record",
    "vital record",
    "election",
    "license",
    "licenses",
    "marriage",
    "birth",
    "death",
    "recording",
    "records",
    "forms",
)
DOWNLOAD_TERMS = (
    "download",
    "document",
    "file",
    "attachment",
    "media",
    "minutes",
    "agenda",
    "form",
    "forms",
    "record",
    "records",
    "uploads",
)
PORTAL_TERMS = (
    "land-record",
    "land_record",
    "landrecord",
    "searchiqs",
    "uslandrecords",
    "recordhub",
    "login",
    "paywall",
    "portal",
)


@dataclass(frozen=True)
class Town:
    town: str
    clerk_url: str
    site_root: str = ""


@dataclass(frozen=True)
class DocumentLink:
    url: str
    discovered_from: str
    reason: str = ""


@dataclass
class ParsedLink:
    url: str
    text: str = ""
    tag: str = ""
    attr: str = ""
    content_type: str = ""
    download: bool = False


@dataclass
class DiscoveryResult:
    documents: List[DocumentLink] = field(default_factory=list)
    pages_fetched: int = 0
    links_seen: int = 0
    notes: List[str] = field(default_factory=list)


@dataclass
class Config:
    depth: int
    rate: float
    max_bytes: int
    concurrency: int
    timeout: float
    retries: int
    backoff: float
    user_agent: str
    js_link_threshold: int
    probe_limit: int
    max_pages: int
    resume: bool
    external_discovery_cmd: str = ""
    browser_discovery_cmd: str = ""
    external_discovery_timeout: float = 300.0


@dataclass
class DownloadOutcome:
    url: str
    discovered_from: str
    http_status: str = ""
    content_type: str = ""
    bytes: int = 0
    sha256: str = ""
    temp_path: str = ""
    proposed_filename: str = ""
    status: str = "error"
    notes: str = ""


class RobotsDisallowed(Exception):
    pass


class RobotsUnavailable(RobotsDisallowed):
    pass


class LinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: List[ParsedLink] = []
        self._active_anchor_indexes: List[int] = []

    def handle_starttag(self, tag: str, attrs: Sequence[Tuple[str, Optional[str]]]) -> None:
        attr_map = {name.lower(): value or "" for name, value in attrs}
        tag = tag.lower()
        if tag == "base" and attr_map.get("href"):
            normalized_base = normalize_url(attr_map["href"], self.base_url)
            if normalized_base:
                self.base_url = normalized_base
            return
        candidates: List[Tuple[str, str]] = []
        if tag in {"a", "area", "link"} and "href" in attr_map:
            candidates.append(("href", attr_map["href"]))
        if tag in {"iframe", "frame", "embed", "script", "img", "source"} and "src" in attr_map:
            candidates.append(("src", attr_map["src"]))
        if tag == "object" and "data" in attr_map:
            candidates.append(("data", attr_map["data"]))

        for attr, raw_url in candidates:
            normalized = normalize_url(raw_url, self.base_url)
            if not normalized:
                continue
            self.links.append(
                ParsedLink(
                    url=normalized,
                    tag=tag,
                    attr=attr,
                    content_type=attr_map.get("type", ""),
                    download="download" in attr_map,
                )
            )
            if tag == "a" and attr == "href":
                self._active_anchor_indexes.append(len(self.links) - 1)

    def handle_data(self, data: str) -> None:
        if self._active_anchor_indexes and data.strip():
            idx = self._active_anchor_indexes[-1]
            current = self.links[idx]
            self.links[idx] = ParsedLink(
                url=current.url,
                text=(current.text + " " + data.strip()).strip(),
                tag=current.tag,
                attr=current.attr,
                content_type=current.content_type,
                download=current.download,
            )

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._active_anchor_indexes:
            self._active_anchor_indexes.pop()


class DomainThrottle:
    def __init__(self, requests_per_second: float) -> None:
        self.default_min_interval = 0.0 if requests_per_second <= 0 else 1.0 / requests_per_second
        self._global_lock = threading.Lock()
        self._locks: Dict[str, threading.Lock] = {}
        self._last_start: Dict[str, float] = {}
        self._host_min_intervals: Dict[str, float] = {}

    def require_interval(self, url: str, seconds: float) -> None:
        host = host_key(url)
        with self._global_lock:
            current = self._host_min_intervals.get(host, self.default_min_interval)
            self._host_min_intervals[host] = max(current, seconds)

    def interval_for(self, url: str) -> float:
        host = host_key(url)
        with self._global_lock:
            return self._host_min_intervals.get(host, self.default_min_interval)

    @contextmanager
    def slot(self, url: str) -> Iterator[None]:
        host = host_key(url)
        with self._global_lock:
            lock = self._locks.setdefault(host, threading.Lock())
            min_interval = self._host_min_intervals.get(host, self.default_min_interval)

        with lock:
            now = time.monotonic()
            last = self._last_start.get(host, 0.0)
            wait_for = (last + min_interval) - now
            if wait_for > 0:
                time.sleep(wait_for)
            self._last_start[host] = time.monotonic()
            yield


class RobotsCache:
    def __init__(
        self,
        user_agent: str,
        timeout: float,
        logger: logging.Logger,
        throttle: DomainThrottle,
        retries: int,
        backoff: float,
    ) -> None:
        self.user_agent = user_agent
        self.timeout = timeout
        self.logger = logger
        self.throttle = throttle
        self.retries = retries
        self.backoff = backoff
        self._lock = threading.Lock()
        self._cache: Dict[str, robotparser.RobotFileParser] = {}
        self._origin_locks: Dict[str, threading.Lock] = {}
        self._unreachable: Set[str] = set()

    def allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return False
        key = f"{parsed.scheme}://{parsed.netloc.lower()}"
        with self._lock:
            parser = self._cache.get(key)
            origin_lock = self._origin_locks.setdefault(key, threading.Lock())
        if parser is not None:
            with self._lock:
                if key in self._unreachable:
                    raise RobotsUnavailable(url)
            return parser.can_fetch(self.user_agent, url)

        with origin_lock:
            with self._lock:
                parser = self._cache.get(key)
            if parser is None:
                parser = self._load_parser(key)
                with self._lock:
                    self._cache[key] = parser
        with self._lock:
            if key in self._unreachable:
                raise RobotsUnavailable(url)
        return parser.can_fetch(self.user_agent, url)

    def _load_parser(self, origin: str) -> robotparser.RobotFileParser:
        robots_url = origin.rstrip("/") + "/robots.txt"
        parser = robotparser.RobotFileParser()
        parser.set_url(robots_url)
        try:
            response = self._fetch_robots(robots_url)
            if response.status_code == 200:
                parser.parse(response.text.splitlines())
                crawl_delay = parser.crawl_delay(self.user_agent) or parser.crawl_delay("*")
                request_rate = parser.request_rate(self.user_agent) or parser.request_rate("*")
                if crawl_delay is not None:
                    self.throttle.require_interval(origin, float(crawl_delay))
                if request_rate and request_rate.requests > 0:
                    self.throttle.require_interval(origin, request_rate.seconds / request_rate.requests)
            elif 500 <= response.status_code:
                self.logger.warning(
                    "robots_unreachable url=%s status=%s; disallowing by default",
                    robots_url,
                    response.status_code,
                )
                parser.parse(["User-agent: *", "Disallow: /"])
                with self._lock:
                    self._unreachable.add(origin)
            else:
                # RFC 9309 treats 4xx as unavailable, meaning no rules are known.
                parser.parse([])
            response.close()
        except requests.RequestException as exc:
            self.logger.warning("robots_fetch_failed url=%s error=%s; disallowing by default", robots_url, exc)
            parser.parse(["User-agent: *", "Disallow: /"])
            with self._lock:
                self._unreachable.add(origin)
        return parser

    def _fetch_robots(self, url: str) -> requests.Response:
        last_exc: Optional[requests.RequestException] = None
        for attempt in range(self.retries + 1):
            try:
                response = self._fetch_robots_once(url)
                if response.status_code in RETRY_HTTP_STATUSES and attempt < self.retries:
                    response.close()
                    time.sleep(self.backoff * (2 ** attempt))
                    continue
                return response
            except requests.RequestException as exc:
                last_exc = exc
                if attempt >= self.retries:
                    raise
                time.sleep(self.backoff * (2 ** attempt))
        raise RuntimeError(f"robots fetch failed for {url}: {last_exc}")

    def _fetch_robots_once(self, url: str) -> requests.Response:
        current = url
        for _redirect in range(MAX_REDIRECTS + 1):
            with self.throttle.slot(current):
                response = requests.get(
                    current,
                    timeout=self.timeout,
                    headers={"User-Agent": self.user_agent},
                    allow_redirects=False,
                )
            if response.status_code not in REDIRECT_HTTP_STATUSES:
                return response
            location = response.headers.get("Location", "")
            next_url = normalize_url(location, current)
            response.close()
            if not next_url:
                raise requests.TooManyRedirects(f"invalid robots redirect from {current}")
            current = next_url
        raise requests.TooManyRedirects(f"too many robots redirects from {url}")


class HttpClient:
    def __init__(self, config: Config, logger: logging.Logger) -> None:
        self.config = config
        self.logger = logger
        self.throttle = DomainThrottle(config.rate)
        self.robots = RobotsCache(
            config.user_agent,
            config.timeout,
            logger,
            self.throttle,
            config.retries,
            config.backoff,
        )
        self._thread_local = threading.local()

    def session(self) -> requests.Session:
        session = getattr(self._thread_local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers.update({"User-Agent": self.config.user_agent})
            self._thread_local.session = session
        return session

    def ensure_allowed(self, url: str) -> None:
        if not self.robots.allowed(url):
            raise RobotsDisallowed(url)

    def request(self, method: str, url: str, *, headers: Optional[Dict[str, str]] = None) -> requests.Response:
        last_exc: Optional[BaseException] = None
        for attempt in range(self.config.retries + 1):
            try:
                response, slot = self._open_response(method, url, headers=headers, stream=False)
                slot.__exit__(None, None, None)
                if response.status_code in RETRY_HTTP_STATUSES and attempt < self.config.retries:
                    response.close()
                    self._sleep_backoff(attempt)
                    continue
                return response
            except requests.RequestException as exc:
                last_exc = exc
                if attempt >= self.config.retries:
                    break
                self._sleep_backoff(attempt)
        raise RuntimeError(f"{method} failed for {url}: {last_exc}")

    @contextmanager
    def stream(self, method: str, url: str, *, headers: Optional[Dict[str, str]] = None) -> Iterator[requests.Response]:
        last_exc: Optional[BaseException] = None
        response: Optional[requests.Response] = None
        slot: Optional[Any] = None
        for attempt in range(self.config.retries + 1):
            try:
                response, slot = self._open_response(method, url, headers=headers, stream=True)
                if response.status_code in RETRY_HTTP_STATUSES and attempt < self.config.retries:
                    response.close()
                    slot.__exit__(None, None, None)
                    response = None
                    slot = None
                    self._sleep_backoff(attempt)
                    continue
                break
            except requests.RequestException as exc:
                if response is not None:
                    response.close()
                if slot is not None:
                    slot.__exit__(type(exc), exc, exc.__traceback__)
                response = None
                slot = None
                last_exc = exc
                if attempt >= self.config.retries:
                    break
                self._sleep_backoff(attempt)

        if response is None or slot is None:
            raise RuntimeError(f"{method} stream failed for {url}: {last_exc}")
        try:
            # Body-read errors intentionally propagate to the downloader, which
            # can discard the partial file and restart the complete transfer.
            yield response
        finally:
            response.close()
            slot.__exit__(None, None, None)

    def _open_response(
        self,
        method: str,
        url: str,
        *,
        headers: Optional[Dict[str, str]],
        stream: bool,
    ) -> Tuple[requests.Response, Any]:
        current = url
        for _redirect in range(MAX_REDIRECTS + 1):
            self.ensure_allowed(current)
            slot = self.throttle.slot(current)
            slot.__enter__()
            try:
                response = self.session().request(
                    method,
                    current,
                    allow_redirects=False,
                    headers=headers,
                    stream=stream,
                    timeout=self.config.timeout,
                )
            except BaseException:
                slot.__exit__(*sys.exc_info())
                raise

            if response.status_code not in REDIRECT_HTTP_STATUSES:
                return response, slot

            location = response.headers.get("Location", "")
            next_url = normalize_url(location, current)
            response.close()
            slot.__exit__(None, None, None)
            if not next_url:
                raise requests.TooManyRedirects(f"invalid redirect from {current}")
            current = next_url

        raise requests.TooManyRedirects(f"too many redirects from {url}")

    def probe_document(self, url: str) -> Tuple[bool, str, str]:
        try:
            response = self.request("HEAD", url, headers={"Accept": "*/*"})
            content_type = response.headers.get("Content-Type", "")
            status = str(response.status_code)
            is_document = response_looks_like_document(response.url, response.headers)
            response.close()
            ambiguous_binary = content_type_base(content_type) == "application/octet-stream"
            if is_document or (content_type and not ambiguous_binary and status not in {"403", "405"}):
                return is_document, content_type, status
        except RobotsUnavailable:
            return False, "", "robots_unavailable"
        except RobotsDisallowed:
            return False, "", "robots_disallowed"
        except Exception as exc:
            self.logger.debug("HEAD probe failed url=%s error=%s", url, exc)

        try:
            with self.stream("GET", url, headers={"Accept": "*/*", "Range": "bytes=0-0"}) as response:
                content_type = response.headers.get("Content-Type", "")
                return response_looks_like_document(response.url, response.headers), content_type, str(response.status_code)
        except RobotsUnavailable:
            return False, "", "robots_unavailable"
        except RobotsDisallowed:
            return False, "", "robots_disallowed"
        except Exception as exc:
            self.logger.debug("GET probe failed url=%s error=%s", url, exc)
            return False, "", f"probe_error:{type(exc).__name__}"

    def _sleep_backoff(self, attempt: int) -> None:
        time.sleep(self.config.backoff * (2 ** attempt))


class HttpDiscoverer:
    def __init__(self, config: Config, client: HttpClient, logger: logging.Logger) -> None:
        self.config = config
        self.client = client
        self.logger = logger

    def discover(self, town: Town) -> DiscoveryResult:
        result = DiscoveryResult()
        start_url = normalize_url(town.clerk_url, town.clerk_url)
        if not start_url:
            result.notes.append("invalid_clerk_url")
            return result

        allowed_hosts = allowed_host_keys(town)
        start_prefix = clerk_scope_prefix(start_url)
        queue: deque[Tuple[str, int, str]] = deque([(start_url, 0, start_url)])
        visited_pages: Set[str] = set()
        seen_links: Set[str] = set()
        doc_map: Dict[str, DocumentLink] = {}
        probe_map: Dict[str, str] = {}
        browser_seed_pages: List[str] = []

        while queue and result.pages_fetched < self.config.max_pages:
            page_url, depth, discovered_from = queue.popleft()
            if page_url in visited_pages:
                continue
            if not is_allowed_host(page_url, allowed_hosts):
                continue
            visited_pages.add(page_url)

            try:
                page_kind, final_page_url, content_type, http_status, html = self._fetch_page(page_url)
            except RobotsUnavailable:
                note = f"robots_unavailable_page:{page_url}"
                result.notes.append(note)
                self.logger.warning("town=%s %s", town.town, note)
                continue
            except RobotsDisallowed:
                note = f"robots_disallowed_page:{page_url}"
                result.notes.append(note)
                self.logger.info("town=%s %s", town.town, note)
                continue
            except Exception as exc:
                result.notes.append(f"page_fetch_error:{page_url}:{type(exc).__name__}")
                self.logger.warning("page_fetch_error town=%s url=%s error=%s", town.town, page_url, exc)
                continue

            result.pages_fetched += 1
            if page_kind == "http_error":
                result.notes.append(f"page_http_{http_status}:{page_url}")
                # Some municipal CMS products reject requests-style clients
                # while serving the same public page to a real browser. The
                # HTTP request already passed robots.txt enforcement, so a 403
                # page is safe to hand to the configured discovery fallback.
                if (
                    http_status == 403
                    and not any(term in unquote(page_url).lower() for term in PORTAL_TERMS)
                    and page_url not in browser_seed_pages
                ):
                    browser_seed_pages.append(page_url)
                continue

            if page_kind == "document":
                add_document(doc_map, page_url, discovered_from, reason=f"page_is_document:{content_type}")
                continue

            if not is_allowed_host(final_page_url, allowed_hosts):
                result.notes.append(f"cross_domain_page_redirect_skipped:{page_url}->{final_page_url}")
                continue

            if page_kind != "html":
                continue

            if final_page_url not in browser_seed_pages:
                browser_seed_pages.append(final_page_url)
            parser = LinkParser(final_page_url)
            try:
                parser.feed(html)
            except Exception as exc:
                result.notes.append(f"html_parse_error:{page_url}:{type(exc).__name__}")
                self.logger.debug("html_parse_error town=%s url=%s error=%s", town.town, page_url, exc)

            for link in parser.links:
                url = link.url
                seen_links.add(url)
                if is_document_url(url) or content_type_is_document(link.content_type):
                    # Linked documents may live on a municipal CDN or document
                    # host. Only HTML crawling is restricted to allowed hosts.
                    reason = "document_extension" if is_document_url(url) else f"link_type:{link.content_type}"
                    add_document(doc_map, url, final_page_url, reason=reason)
                    continue
                same_domain = is_allowed_host(url, allowed_hosts)
                if link.download or should_probe_url(url, link.text):
                    probe_map.setdefault(url, final_page_url)
                if not same_domain:
                    continue
                if depth < self.config.depth and should_follow_page(url, link.text, start_prefix, depth):
                    if url not in visited_pages:
                        queue.append((url, depth + 1, final_page_url))

        if queue:
            result.notes.append(f"max_pages_reached:{self.config.max_pages}")

        result.links_seen = len(seen_links)
        if result.links_seen < self.config.js_link_threshold:
            extra_docs: List[Any] = []
            if browser_seed_pages:
                try:
                    extra_docs.extend(firecrawl_discover(town, self.config, self.logger))
                except Exception as exc:
                    note = f"firecrawl_discovery_error:{type(exc).__name__}:{exc}"
                    result.notes.append(note)
                    self.logger.warning("town=%s %s", town.town, note)
                rate_delay = max(self.client.throttle.interval_for(url) for url in browser_seed_pages)
                if not external_items_have_candidates(extra_docs, town.clerk_url):
                    extra_docs.extend(
                        run_external_discovery(
                            town,
                            self.config,
                            self.logger,
                            seed_urls=browser_seed_pages,
                            rate_delay_seconds=rate_delay,
                            notes_out=result.notes,
                        )
                    )
                if not external_items_have_candidates(extra_docs, town.clerk_url) and self.config.browser_discovery_cmd:
                    extra_docs.extend(
                        run_external_discovery(
                            town,
                            self.config,
                            self.logger,
                            seed_urls=browser_seed_pages,
                            rate_delay_seconds=rate_delay,
                            notes_out=result.notes,
                            command=self.config.browser_discovery_cmd,
                        )
                    )
            if extra_docs:
                accepted = 0
                for doc in coerce_document_links(extra_docs, town.clerk_url):
                    if is_document_url(doc.url) or reason_indicates_document(doc.reason):
                        add_document(doc_map, doc.url, doc.discovered_from, reason=doc.reason or "external_discovery")
                        accepted += 1
                    elif should_probe_url(doc.url, doc.reason):
                        probe_map.setdefault(doc.url, doc.discovered_from)
                        accepted += 1
                if accepted:
                    result.notes.append(f"external_discovery_candidates:{accepted}/{len(extra_docs)}")
                else:
                    result.notes.append(
                        f"low_link_count:{result.links_seen};external_discovery_no_document_candidates"
                    )
            else:
                suffix = (
                    "external_discovery_not_configured_or_empty"
                    if browser_seed_pages
                    else "no_robots_approved_renderable_pages"
                )
                result.notes.append(f"low_link_count:{result.links_seen};{suffix}")

        probe_count = 0
        for url, source in list(probe_map.items()):
            if url in doc_map or probe_count >= self.config.probe_limit:
                continue
            probe_count += 1
            is_document, content_type, status = self.client.probe_document(url)
            if is_document:
                add_document(doc_map, url, source, reason=f"content_type:{content_type}:{status}")
            elif status == "robots_unavailable":
                note = f"robots_unavailable_probe:{url}"
                result.notes.append(note)
                self.logger.warning("town=%s %s", town.town, note)
            elif status == "robots_disallowed":
                note = f"robots_disallowed_probe:{url}"
                result.notes.append(note)
                self.logger.info("town=%s %s", town.town, note)
            elif status.startswith("probe_error:"):
                note = f"probe_error:{url}:{status}"
                result.notes.append(note)
                self.logger.warning("town=%s %s", town.town, note)
            elif parse_int(status) in RETRY_HTTP_STATUSES:
                note = f"probe_http_{status}:{url}"
                result.notes.append(note)
                self.logger.warning("town=%s %s", town.town, note)
            elif status in {"401", "403"}:
                note = f"probe_access_denied:{status}:{url}"
                result.notes.append(note)
                self.logger.info("town=%s %s", town.town, note)
            elif any(term in unquote(url).lower() for term in PORTAL_TERMS):
                note = f"portal_or_non_document_skipped:{status}:{content_type}:{url}"
                result.notes.append(note)
                self.logger.info("town=%s %s", town.town, note)

        if len(probe_map) > self.config.probe_limit:
            result.notes.append(f"probe_limit_reached:{self.config.probe_limit}/{len(probe_map)}")

        result.documents = list(doc_map.values())
        return result

    def _fetch_page(self, url: str) -> Tuple[str, str, str, int, str]:
        headers = {"Accept": "text/html,application/xhtml+xml,*/*;q=0.2"}
        for attempt in range(self.config.retries + 1):
            try:
                with self.client.stream("GET", url, headers=headers) as response:
                    content_type = response.headers.get("Content-Type", "")
                    final_url = normalize_url(response.url, url) or url
                    if response.status_code >= 400:
                        return "http_error", final_url, content_type, response.status_code, ""
                    if response_looks_like_document(final_url, response.headers):
                        return "document", final_url, content_type, response.status_code, ""
                    if content_type and not content_type_is_html(content_type):
                        return "other", final_url, content_type, response.status_code, ""
                    return "html", final_url, content_type, response.status_code, response.text
            except requests.RequestException:
                if attempt >= self.config.retries:
                    raise
                self.client._sleep_backoff(attempt)
        raise AssertionError("unreachable")


def firecrawl_discover(town: Town, config: Config, logger: logging.Logger) -> Iterable[Any]:
    """
    Replace this stub if running inside an environment that can call Firecrawl MCP.

    Return values can be URL strings, DocumentLink objects, or dicts with
    "url" and optional "discovered_from"/"source"/"reason".
    """
    return []


def discover(town: Town, config: Config, client: HttpClient, logger: logging.Logger) -> DiscoveryResult:
    """Pluggable discovery seam. Override this function to change discovery behavior."""
    return HttpDiscoverer(config, client, logger).discover(town)


class TownRunner:
    def __init__(self, town: Town, out_root: Path, config: Config, client: HttpClient, logger: logging.Logger) -> None:
        self.town = town
        self.slug = slugify(town.town)
        self.out_root = out_root
        self.town_dir = out_root / self.slug
        self.files_dir = self.town_dir / "files"
        self.zip_dir = out_root / "zips"
        self.zip_path = self.zip_dir / f"{self.slug}.zip"
        self.manifest_path = self.town_dir / "manifest.csv"
        self.state_path = self.town_dir / "state.json"
        self.done_path = self.town_dir / ".done"
        self.config = config
        self.client = client
        self.logger = logger
        self.state = self._load_state()

    def run(self) -> Dict[str, Any]:
        self.town_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.zip_dir.mkdir(parents=True, exist_ok=True)

        state_matches_input = (
            self.state.get("town") == self.town.town
            and self.state.get("clerk_url") == self.town.clerk_url
            and self.state.get("site_root", "") == self.town.site_root
        )
        if self.config.resume and state_matches_input and self.done_path.exists() and self.zip_path.exists():
            return self._summary("complete", "skipped_done")
        if not state_matches_input:
            self.state.setdefault("notes", []).append("town_input_changed;rediscovering")
            self.state.update(
                {
                    "town": self.town.town,
                    "clerk_url": self.town.clerk_url,
                    "site_root": self.town.site_root,
                }
            )
            remove_file_quietly(self.done_path)

        self.logger.info("town_start town=%s url=%s", self.town.town, self.town.clerk_url)

        try:
            discovery = discover(self.town, self.config, self.client, self.logger)
            self.state["discovery"] = {
                "pages_fetched": discovery.pages_fetched,
                "links_seen": discovery.links_seen,
                "documents_found": len(discovery.documents),
                "notes": discovery.notes,
            }
            self._save_state()
        except Exception as exc:
            self.logger.exception("discovery_failed town=%s", self.town.town)
            self.state.setdefault("notes", []).append(f"discovery_failed:{type(exc).__name__}:{exc}")
            self.state["completed"] = False
            self._save_state()
            self._write_manifest()
            zip_town_dir(self.town_dir, self.zip_path)
            return self._summary("error", "discovery_failed")

        documents = unique_documents(discovery.documents)
        self.logger.info(
            "town_discovery_complete town=%s pages=%s links=%s docs=%s",
            self.town.town,
            discovery.pages_fetched,
            discovery.links_seen,
            len(documents),
        )

        self._download_documents(documents)
        self._write_manifest()
        completed = self._write_done_and_zip()
        status = "complete" if completed else "partial"
        return self._summary(status, ";".join(discovery.notes[:8]))

    def _download_documents(self, documents: Sequence[DocumentLink]) -> None:
        pending: List[DocumentLink] = []
        records_by_url = self.state.setdefault("records_by_url", {})
        for doc in documents:
            existing = records_by_url.get(doc.url)
            if existing and self._record_is_resumable(existing):
                continue
            pending.append(doc)

        if not pending:
            self.logger.info("town_downloads_skipped_or_empty town=%s", self.town.town)
            return

        from concurrent.futures import ThreadPoolExecutor, as_completed

        max_workers = max(1, self.config.concurrency)
        pending = interleave_documents_by_host(pending)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(download_document_to_temp, doc, self.files_dir, self.config, self.client): doc
                for doc in pending
            }
            for future in as_completed(futures):
                doc = futures[future]
                try:
                    outcome = future.result()
                except Exception as exc:
                    self.logger.warning("download_uncaught town=%s url=%s error=%s", self.town.town, doc.url, exc)
                    outcome = DownloadOutcome(
                        url=doc.url,
                        discovered_from=doc.discovered_from,
                        status="error",
                        notes=f"uncaught:{type(exc).__name__}:{exc}",
                    )
                self._finalize_download(outcome)
                self._write_manifest()
                self._save_state()

    def _finalize_download(self, outcome: DownloadOutcome) -> None:
        record = {
            "url": outcome.url,
            "filename": "",
            "bytes": outcome.bytes,
            "content_type": outcome.content_type,
            "sha256": outcome.sha256,
            "http_status": outcome.http_status,
            "discovered_from": outcome.discovered_from,
            "status": outcome.status,
            "notes": outcome.notes,
        }

        if outcome.status == "downloaded":
            sha_map = self.state.setdefault("sha256", {})
            existing = sha_map.get(outcome.sha256)
            existing_filename = str(existing.get("filename") or "") if isinstance(existing, dict) else ""
            existing_path = self.files_dir / existing_filename if existing_filename else None
            if existing and existing_path and existing_path.exists():
                remove_file_quietly(Path(outcome.temp_path))
                record["filename"] = existing_filename
                record["status"] = "duplicate_sha"
                record["notes"] = append_note(record["notes"], f"same_as:{existing.get('url', '')}")
            else:
                if existing:
                    sha_map.pop(outcome.sha256, None)
                final_name = resolve_filename_collision(self.files_dir, outcome.proposed_filename, outcome.sha256)
                final_path = self.files_dir / final_name
                os.replace(outcome.temp_path, final_path)
                record["filename"] = final_name
                sha_map[outcome.sha256] = {
                    "filename": final_name,
                    "url": outcome.url,
                    "bytes": outcome.bytes,
                }
        elif outcome.temp_path:
            remove_file_quietly(Path(outcome.temp_path))

        self.state.setdefault("records_by_url", {})[outcome.url] = record
        self.logger.info(
            "download_result town=%s status=%s bytes=%s url=%s",
            self.town.town,
            record["status"],
            record["bytes"],
            outcome.url,
        )

    def _write_done_and_zip(self) -> bool:
        records = self.state.get("records_by_url", {}).values()
        records_complete = all(self._record_is_resumable(record) for record in records)
        discovery_complete = not self._has_retryable_discovery_failure()
        completed = records_complete and discovery_complete
        self.state["completed"] = completed
        if completed:
            self.state["completed_at"] = timestamp()
        else:
            self.state.pop("completed_at", None)
        self._save_state()
        self._write_manifest()
        zip_town_dir(self.town_dir, self.zip_path)
        if completed:
            done_tmp = self.town_dir / ".done.part"
            done_tmp.write_text(timestamp() + "\n", encoding="utf-8")
            os.replace(done_tmp, self.done_path)
        else:
            remove_file_quietly(self.done_path)
        return completed

    def _summary(self, status: str, notes: str = "") -> Dict[str, Any]:
        records = list(self.state.get("records_by_url", {}).values())
        stored_files = [
            entry
            for entry in self.state.get("sha256", {}).values()
            if isinstance(entry, dict)
            and entry.get("filename")
            and (self.files_dir / str(entry["filename"])).exists()
        ]
        total_bytes = sum(int(entry.get("bytes") or 0) for entry in stored_files)
        status_counts: Dict[str, int] = {}
        for record in records:
            record_status = str(record.get("status") or "unknown")
            status_counts[record_status] = status_counts.get(record_status, 0) + 1
        counts_note = ",".join(f"{key}={status_counts[key]}" for key in sorted(status_counts))
        if counts_note:
            notes = append_note(notes, counts_note)
        return {
            "town": self.town.town,
            "slug": self.slug,
            "clerk_url": self.town.clerk_url,
            "files_count": len(stored_files),
            "total_bytes": total_bytes,
            "zip_path": str(self.zip_path),
            "status": status,
            "notes": notes,
        }

    def _record_is_resumable(self, record: Dict[str, Any]) -> bool:
        status = record.get("status")
        if status == "duplicate_sha":
            filename = record.get("filename")
            return bool(filename and (self.files_dir / filename).exists())
        if status in {
            "skipped_oversize",
            "skipped_not_document",
            "skipped_access_denied",
            "skipped_missing",
            "robots_disallowed",
        }:
            return True
        if status == "http_error":
            http_status = parse_int(str(record.get("http_status") or ""))
            return http_status not in RETRY_HTTP_STATUSES
        if status != "downloaded":
            return False
        filename = record.get("filename")
        return bool(filename and (self.files_dir / filename).exists())

    def _has_retryable_discovery_failure(self) -> bool:
        discovery = self.state.get("discovery", {})
        for note in discovery.get("notes", []):
            note_text = str(note)
            if note_text.startswith(
                (
                    "page_fetch_error:",
                    "html_parse_error:",
                    "robots_unavailable_page:",
                    "robots_unavailable_probe:",
                    "probe_error:",
                    "external_discovery:page_render_error:",
                    "external_discovery:frame_extract_error:",
                    "invalid_clerk_url",
                    "low_link_count:",
                    "max_pages_reached:",
                    "probe_limit_reached:",
                    "cross_domain_page_redirect_skipped:",
                )
            ):
                return True
            if note_text.startswith("probe_http_"):
                return True
            match = re.match(r"page_http_(\d+):", note_text)
            if match and int(match.group(1)) in RETRY_HTTP_STATUSES:
                return True
        return False

    def _load_state(self) -> Dict[str, Any]:
        if self.state_path.exists():
            try:
                state = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(state, dict):
                    return state
                raise ValueError("state root must be an object")
            except (json.JSONDecodeError, ValueError):
                corrupt_path = self.state_path.with_suffix(".corrupt.json")
                os.replace(self.state_path, corrupt_path)
        return self._new_state()

    def _new_state(self) -> Dict[str, Any]:
        return {
            "version": 2,
            "town": self.town.town,
            "slug": self.slug,
            "clerk_url": self.town.clerk_url,
            "site_root": self.town.site_root,
            "created_at": timestamp(),
            "completed": False,
            "records_by_url": {},
            "sha256": {},
            "notes": [],
        }

    def _save_state(self) -> None:
        tmp = self.state_path.with_suffix(".json.part")
        tmp.write_text(json.dumps(self.state, indent=2, sort_keys=True), encoding="utf-8")
        os.replace(tmp, self.state_path)

    def _write_manifest(self) -> None:
        records = sorted(self.state.get("records_by_url", {}).values(), key=lambda r: r.get("url", ""))
        tmp = self.manifest_path.with_suffix(".csv.part")
        with tmp.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")
            writer.writeheader()
            for record in records:
                writer.writerow({field: record.get(field, "") for field in MANIFEST_FIELDS})
        os.replace(tmp, self.manifest_path)


def download_document_to_temp(
    doc: DocumentLink,
    files_dir: Path,
    config: Config,
    client: HttpClient,
) -> DownloadOutcome:
    temp_path = files_dir / f".{short_hash(doc.url, 16)}.part"
    last_exc: Optional[BaseException] = None
    for attempt in range(config.retries + 1):
        remove_file_quietly(temp_path)
        try:
            return _download_document_once(doc, temp_path, config, client)
        except RobotsUnavailable:
            return DownloadOutcome(
                url=doc.url,
                discovered_from=doc.discovered_from,
                http_status="robots_unavailable",
                status="robots_unavailable",
                notes="robots_policy_could_not_be_retrieved;retry_on_resume",
            )
        except RobotsDisallowed:
            return DownloadOutcome(
                url=doc.url,
                discovered_from=doc.discovered_from,
                http_status="robots_disallowed",
                status="robots_disallowed",
            )
        except requests.RequestException as exc:
            # This catches connection failures while reading a streaming body.
            # Request setup and retryable HTTP responses are retried by HttpClient.
            last_exc = exc
            remove_file_quietly(temp_path)
            if attempt < config.retries:
                client._sleep_backoff(attempt)
                continue
        except Exception as exc:
            last_exc = exc
            remove_file_quietly(temp_path)
        break

    return DownloadOutcome(
        url=doc.url,
        discovered_from=doc.discovered_from,
        status="error",
        notes=f"{type(last_exc).__name__}:{last_exc}",
    )


def _download_document_once(
    doc: DocumentLink,
    temp_path: Path,
    config: Config,
    client: HttpClient,
) -> DownloadOutcome:
    with client.stream("GET", doc.url, headers={"Accept": "*/*"}) as response:
        final_url = response.url
        content_type = response.headers.get("Content-Type", "")
        http_status = str(response.status_code)
        redirect_note = "" if final_url == doc.url else f"redirect_target:{final_url}"

        if response.status_code >= 400:
            if response.status_code in {401, 403}:
                status = "skipped_access_denied"
                notes = "possible_paywall_or_auth"
            elif response.status_code in {404, 410}:
                status = "skipped_missing"
                notes = "document_not_found"
            else:
                status = "http_error"
                notes = "retryable_http_status" if response.status_code in RETRY_HTTP_STATUSES else ""
            return DownloadOutcome(
                url=doc.url,
                discovered_from=doc.discovered_from,
                http_status=http_status,
                content_type=content_type,
                status=status,
                notes=append_note(notes, redirect_note) if redirect_note else notes,
            )

        if not response_looks_like_document(final_url, response.headers):
            note = "response_is_not_a_supported_document"
            if content_type_base(content_type) and content_type_is_html(content_type):
                note = "html_response_possible_login_or_portal"
            return DownloadOutcome(
                url=doc.url,
                discovered_from=doc.discovered_from,
                http_status=http_status,
                content_type=content_type,
                status="skipped_not_document",
                notes=append_note(note, redirect_note) if redirect_note else note,
            )

        content_length = parse_int(response.headers.get("Content-Length"))
        if content_length is not None and content_length > config.max_bytes:
            notes = f"content_length_over_limit:{config.max_bytes}"
            return DownloadOutcome(
                url=doc.url,
                discovered_from=doc.discovered_from,
                http_status=http_status,
                content_type=content_type,
                bytes=content_length,
                status="skipped_oversize",
                notes=append_note(notes, redirect_note) if redirect_note else notes,
            )

        sha = hashlib.sha256()
        total = 0
        with temp_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > config.max_bytes:
                    handle.close()
                    remove_file_quietly(temp_path)
                    notes = f"stream_over_limit:{config.max_bytes}"
                    return DownloadOutcome(
                        url=doc.url,
                        discovered_from=doc.discovered_from,
                        http_status=http_status,
                        content_type=content_type,
                        bytes=total,
                        status="skipped_oversize",
                        notes=append_note(notes, redirect_note) if redirect_note else notes,
                    )
                sha.update(chunk)
                handle.write(chunk)

        digest = sha.hexdigest()
        proposed = proposed_filename(final_url, response.headers, content_type, digest)
        return DownloadOutcome(
            url=doc.url,
            discovered_from=doc.discovered_from,
            http_status=http_status,
            content_type=content_type,
            bytes=total,
            sha256=digest,
            temp_path=str(temp_path),
            proposed_filename=proposed,
            status="downloaded",
            notes=redirect_note,
        )


def run_external_discovery(
    town: Town,
    config: Config,
    logger: logging.Logger,
    *,
    seed_urls: Sequence[str] = (),
    rate_delay_seconds: float = 0.0,
    notes_out: Optional[List[str]] = None,
    command: str = "",
) -> List[Any]:
    discovery_command = command or config.external_discovery_cmd
    if not discovery_command:
        return []
    payload = json.dumps(
        {
            "town": town.town,
            "clerk_url": town.clerk_url,
            "site_root": town.site_root,
            "seed_urls": list(seed_urls),
            "timeout_ms": max(1, int(config.timeout * 1000)),
            "rate_delay_ms": max(0, int(rate_delay_seconds * 1000)),
            "user_agent": config.user_agent,
        }
    )
    try:
        proc = subprocess.run(
            discovery_command,
            input=payload,
            capture_output=True,
            text=True,
            shell=True,
            timeout=config.external_discovery_timeout,
            check=False,
        )
    except Exception as exc:
        logger.warning("external_discovery_failed town=%s error=%s", town.town, exc)
        return []
    if proc.returncode != 0:
        logger.warning(
            "external_discovery_nonzero town=%s code=%s stderr=%s",
            town.town,
            proc.returncode,
            proc.stderr.strip()[:1000],
        )
        return []
    stdout = proc.stdout.strip()
    if not stdout:
        return []
    try:
        parsed = json.loads(stdout)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            if parsed.get("error"):
                note_text = f"external_discovery:error:{str(parsed['error'])[:500]}"
                if notes_out is not None:
                    notes_out.append(note_text)
                logger.warning("town=%s %s", town.town, note_text)
                return []
            external_notes = parsed.get("notes", [])
            if not isinstance(external_notes, list):
                external_notes = []
            for note in external_notes:
                note_text = f"external_discovery:{note}"
                if notes_out is not None:
                    notes_out.append(note_text)
                logger.warning("town=%s %s", town.town, note_text)
            for key in ("documents", "urls", "links"):
                value = parsed.get(key)
                if isinstance(value, list):
                    return value
            logger.warning(
                "external_discovery_json_without_urls town=%s keys=%s",
                town.town,
                ",".join(sorted(str(key) for key in parsed)),
            )
            return []
    except json.JSONDecodeError:
        pass
    lines = [line.strip() for line in stdout.splitlines() if line.strip() and not line.strip().startswith("#")]
    return [line for line in lines if urlparse(line).scheme in {"http", "https"}]


def coerce_document_links(items: Iterable[Any], default_source: str) -> Iterator[DocumentLink]:
    for item in items:
        if isinstance(item, DocumentLink):
            yield item
        elif isinstance(item, str):
            url = normalize_url(item, default_source)
            if url:
                yield DocumentLink(url=url, discovered_from=default_source, reason="external")
        elif isinstance(item, dict):
            raw_url = item.get("url") or item.get("href") or item.get("sourceURL")
            if not raw_url:
                continue
            url = normalize_url(str(raw_url), default_source)
            if not url:
                continue
            content_type_hint = str(item.get("content_type") or item.get("contentType") or item.get("mimeType") or "")
            reason = str(item.get("reason") or item.get("type") or content_type_hint or "external")
            yield DocumentLink(
                url=url,
                discovered_from=str(item.get("discovered_from") or item.get("source") or default_source),
                reason=reason,
            )


def external_items_have_candidates(items: Iterable[Any], default_source: str) -> bool:
    return any(
        is_document_url(document.url)
        or reason_indicates_document(document.reason)
        or should_probe_url(document.url, document.reason)
        for document in coerce_document_links(items, default_source)
    )


def add_document(doc_map: Dict[str, DocumentLink], url: str, discovered_from: str, reason: str = "") -> None:
    existing = doc_map.get(url)
    if existing:
        if discovered_from not in existing.discovered_from.split(";"):
            doc_map[url] = DocumentLink(
                url=url,
                discovered_from=existing.discovered_from + ";" + discovered_from,
                reason=existing.reason or reason,
            )
        return
    doc_map[url] = DocumentLink(url=url, discovered_from=discovered_from, reason=reason)


def unique_documents(documents: Sequence[DocumentLink]) -> List[DocumentLink]:
    doc_map: Dict[str, DocumentLink] = {}
    for doc in documents:
        add_document(doc_map, doc.url, doc.discovered_from, doc.reason)
    return list(doc_map.values())


def interleave_documents_by_host(documents: Sequence[DocumentLink]) -> List[DocumentLink]:
    buckets: Dict[str, deque[DocumentLink]] = {}
    for document in documents:
        buckets.setdefault(host_key(document.url), deque()).append(document)
    interleaved: List[DocumentLink] = []
    while buckets:
        for host in list(buckets):
            interleaved.append(buckets[host].popleft())
            if not buckets[host]:
                del buckets[host]
    return interleaved


def normalize_url(raw_url: str, base_url: str) -> Optional[str]:
    raw_url = (raw_url or "").strip()
    if not raw_url or raw_url.startswith("#"):
        return None
    if raw_url.lower().startswith(("mailto:", "tel:", "javascript:", "data:", "sms:")):
        return None
    joined = urljoin(base_url, raw_url)
    joined, _fragment = urldefrag(joined)
    parsed = urlparse(joined)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    normalized = parsed._replace(scheme=parsed.scheme.lower(), netloc=parsed.netloc.lower(), fragment="")
    return urlunparse(normalized)


def host_key(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.hostname or parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    port = f":{parsed.port}" if parsed.port else ""
    return host + port


def allowed_host_keys(town: Town) -> Set[str]:
    hosts = {host_key(town.clerk_url)}
    if town.site_root:
        hosts.add(host_key(town.site_root))
    return {host for host in hosts if host}


def is_allowed_host(url: str, allowed_hosts: Set[str]) -> bool:
    return host_key(url) in allowed_hosts


def url_extension(url: str) -> str:
    path = unquote(urlparse(url).path)
    name = path.rsplit("/", 1)[-1]
    if "." not in name:
        return ""
    return "." + name.rsplit(".", 1)[-1].lower()


def is_document_url(url: str) -> bool:
    return url_extension(url) in DOC_EXTENSIONS


def reason_indicates_document(reason: str) -> bool:
    lowered = (reason or "").strip().lower()
    return content_type_is_document(lowered) or lowered in {
        "document",
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "csv",
        "rtf",
        "odt",
        "zip",
    }


def content_type_base(content_type: str) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def content_type_is_document(content_type: str) -> bool:
    base = content_type_base(content_type)
    if not base:
        return False
    if base in DOC_CONTENT_TYPES:
        return True
    return any(token in base for token in DOC_CONTENT_TYPE_TOKENS)


def content_type_is_html(content_type: str) -> bool:
    base = content_type_base(content_type)
    return not base or base in {"text/html", "application/xhtml+xml"} or base.endswith("+html")


def response_looks_like_document(url: str, headers: Any) -> bool:
    content_type = headers.get("Content-Type", "")
    if content_type_base(content_type) and content_type_is_html(content_type):
        return False
    if is_document_url(url) or content_type_is_document(content_type):
        return True
    disposition_name = filename_from_content_disposition(headers.get("Content-Disposition", ""))
    return bool(disposition_name and Path(disposition_name).suffix.lower() in DOC_EXTENSIONS)


def should_probe_url(url: str, link_text: str = "") -> bool:
    ext = url_extension(url)
    if ext in ASSET_EXTENSIONS:
        return False
    if ext and ext not in PAGE_EXTENSIONS and ext not in PROBE_HANDLER_EXTENSIONS:
        return False
    lowered = unquote(url).lower() + " " + (link_text or "").lower()
    if any(term in lowered for term in DOWNLOAD_TERMS + PORTAL_TERMS):
        return True
    return any(token in lowered for token in ("pdf", "doc", "spreadsheet", "report", "application"))


def should_follow_page(url: str, link_text: str, start_prefix: str, current_depth: int) -> bool:
    ext = url_extension(url)
    if ext in ASSET_EXTENSIONS or ext in DOC_EXTENSIONS:
        return False
    if ext not in PAGE_EXTENSIONS:
        return False
    path = urlparse(url).path or "/"
    path_l = unquote(path).lower()
    text_l = (link_text or "").lower()
    if path_in_scope(path, start_prefix):
        return True
    if any(term in path_l or term in text_l for term in CLERK_TERMS):
        return True
    return current_depth == 0


def path_in_scope(path: str, start_prefix: str) -> bool:
    if start_prefix == "/":
        return True
    path = path.rstrip("/") or "/"
    prefix = start_prefix.rstrip("/") or "/"
    return path == prefix or path.startswith(prefix + "/")


def clerk_scope_prefix(clerk_url: str) -> str:
    parsed = urlparse(clerk_url)
    path = parsed.path or "/"
    if path == "/":
        return "/"
    if path.endswith("/"):
        return path
    last = path.rsplit("/", 1)[-1]
    if "." in last:
        parent = path.rsplit("/", 1)[0]
        return (parent or "/").rstrip("/") + "/"
    return path.rstrip("/") + "/"


def proposed_filename(url: str, headers: Dict[str, str], content_type: str, sha256_hex: str) -> str:
    name = filename_from_content_disposition(headers.get("Content-Disposition", ""))
    if not name:
        path_name = unquote(urlparse(url).path.rsplit("/", 1)[-1])
        name = path_name or f"document-{sha256_hex[:12]}"
    name = sanitize_filename(name)
    ext = Path(name).suffix.lower()
    mapped_ext = CONTENT_TYPE_EXTENSION.get(content_type_base(content_type), "")
    if ext not in DOC_EXTENSIONS and mapped_ext:
        name = sanitize_filename(name + mapped_ext)
    elif not ext and is_document_url(url):
        name = sanitize_filename(name + url_extension(url))
    return name or f"document-{sha256_hex[:12]}"


def filename_from_content_disposition(content_disposition: str) -> str:
    if not content_disposition:
        return ""
    match = re.search(r"filename\*\s*=\s*([^']*)''([^;]+)", content_disposition, flags=re.I)
    if match:
        return unquote(match.group(2).strip().strip('"'))
    match = re.search(r"filename\s*=\s*(\"[^\"]+\"|[^;]+)", content_disposition, flags=re.I)
    if match:
        return unquote(match.group(1).strip().strip('"'))
    return ""


def sanitize_filename(name: str, max_len: int = 140) -> str:
    name = unquote(name or "").strip()
    name = re.sub(r'[\x00-\x1f\\/:*?"<>|]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    name = name.rstrip(" .")
    if not name:
        name = "document"
    stem = Path(name).stem.rstrip(" .") or "document"
    suffix = Path(name).suffix
    if stem.upper() in RESERVED_WINDOWS_NAMES:
        stem = stem + "_"
    available = max_len - len(suffix)
    if len(stem) > available:
        stem = stem[:available].rstrip(" ._-") or "document"
    return stem + suffix


def resolve_filename_collision(files_dir: Path, proposed: str, sha256_hex: str) -> str:
    proposed = sanitize_filename(proposed)
    candidate = proposed
    if not (files_dir / candidate).exists():
        return candidate
    candidate = filename_with_tag(proposed, sha256_hex[:10])
    counter = 2
    while (files_dir / candidate).exists():
        candidate = filename_with_tag(proposed, f"{sha256_hex[:10]}-{counter}")
        counter += 1
    return candidate


def filename_with_tag(name: str, tag: str, max_len: int = 140) -> str:
    path = Path(sanitize_filename(name, max_len=max_len))
    suffix = path.suffix
    separator_and_tag = f"-{tag}"
    stem_limit = max(1, max_len - len(suffix) - len(separator_and_tag))
    stem = path.stem[:stem_limit].rstrip(" ._-") or "document"
    return sanitize_filename(f"{stem}{separator_and_tag}{suffix}", max_len=max_len)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    return value or "town"


def parse_int(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def short_hash(value: str, length: int = 10) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def append_note(existing: str, note: str) -> str:
    if not existing:
        return note
    return existing + ";" + note


def timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def remove_file_quietly(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def zip_town_dir(town_dir: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    temp_zip = zip_path.with_suffix(".zip.part")
    remove_file_quietly(temp_zip)
    with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for path in sorted(town_dir.rglob("*")):
            if not path.is_file():
                continue
            if path.name == ".done" or path.name.endswith(".part") or path.suffix == ".part":
                continue
            archive.write(path, arcname=str(path.relative_to(town_dir.parent)))
    os.replace(temp_zip, zip_path)


def load_towns(path: Path) -> List[Town]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, list):
        raise ValueError("towns.json must be a JSON list")
    towns: List[Town] = []
    seen_slugs: Set[str] = set()
    for idx, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f"towns[{idx}] must be an object")
        town_name = str(item.get("town") or "").strip()
        clerk_url = str(item.get("clerk_url") or "").strip()
        site_root = str(item.get("site_root") or "").strip()
        if not town_name or not clerk_url:
            raise ValueError(f"towns[{idx}] must include town and clerk_url")
        town_slug = slugify(town_name)
        if town_slug in seen_slugs:
            raise ValueError(f"towns[{idx}] duplicates town slug {town_slug!r}")
        seen_slugs.add(town_slug)
        towns.append(Town(town=town_name, clerk_url=clerk_url, site_root=site_root))
    return towns


def filter_towns(towns: Sequence[Town], only: str) -> List[Town]:
    if not only:
        return list(towns)
    wanted = {part.strip().lower() for part in only.split(",") if part.strip()}
    wanted_slugs = {slugify(part) for part in wanted}
    return [
        town
        for town in towns
        if town.town.lower() in wanted or slugify(town.town) in wanted_slugs
    ]


def write_index(out_root: Path, rows: Sequence[Dict[str, Any]]) -> None:
    path = out_root / "index.csv"
    tmp = path.with_suffix(".csv.part")
    with tmp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=INDEX_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in INDEX_FIELDS})
    os.replace(tmp, path)


def load_index(out_root: Path) -> Dict[str, Dict[str, Any]]:
    path = out_root / "index.csv"
    if not path.exists():
        return {}
    try:
        with path.open("r", newline="", encoding="utf-8-sig") as handle:
            return {
                str(row.get("slug") or ""): row
                for row in csv.DictReader(handle)
                if row.get("slug")
            }
    except (OSError, UnicodeError, csv.Error):
        return {}


def setup_logging(out_root: Path) -> logging.Logger:
    out_root.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("ct_clerks")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    file_handler = logging.FileHandler(out_root / "run.log", encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    return logger


def build_config(args: argparse.Namespace) -> Config:
    browser_discovery_cmd = ""
    if args.puppeteer_fallback:
        bridge_path = Path(__file__).resolve().parent / "tools" / "ct-clerk-puppeteer" / "discover.mjs"
        browser_discovery_cmd = subprocess.list2cmdline(["node", str(bridge_path)])
    return Config(
        depth=args.depth,
        rate=args.rate,
        max_bytes=int(args.max_mb * 1024 * 1024),
        concurrency=args.concurrency,
        timeout=args.timeout,
        retries=args.retries,
        backoff=args.backoff,
        user_agent=args.user_agent,
        js_link_threshold=args.js_link_threshold,
        probe_limit=args.probe_limit,
        max_pages=args.max_pages,
        resume=args.resume,
        external_discovery_cmd=args.external_discovery_cmd,
        browser_discovery_cmd=browser_discovery_cmd,
        external_discovery_timeout=args.external_discovery_timeout,
    )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download Town Clerk document corpora into one zip per town.")
    parser.add_argument("--towns", required=True, type=Path, help="Path to towns.json")
    parser.add_argument("--out", required=True, type=Path, help="Output root, e.g. data/ct-town-clerks")
    parser.add_argument("--only", default="", help='Comma-separated town subset, e.g. "Hartford,New Haven"')
    parser.add_argument("--depth", type=int, default=2, help="Same-domain crawl depth from clerk_url")
    parser.add_argument("--rate", type=float, default=1.0, help="Requests per second per domain; 1.0 means one start per second")
    parser.add_argument("--max-mb", type=float, default=200.0, help="Skip documents larger than this many MB")
    parser.add_argument("--resume", action="store_true", help="Skip towns already marked .done; file records are always reused when valid")
    parser.add_argument("--concurrency", type=int, default=4, help="Download workers across domains")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds")
    parser.add_argument("--retries", type=int, default=3, help="Retry count for transient failures")
    parser.add_argument("--backoff", type=float, default=1.5, help="Initial retry backoff seconds")
    parser.add_argument("--max-pages", type=int, default=120, help="Max HTML pages to fetch per town")
    parser.add_argument("--probe-limit", type=int, default=250, help="Max non-extension links to probe per town")
    parser.add_argument("--js-link-threshold", type=int, default=8, help="Call discovery hook if HTTP crawl sees fewer links")
    parser.add_argument("--external-discovery-cmd", default="", help="Optional command for Firecrawl-backed discovery hook")
    parser.add_argument(
        "--puppeteer-fallback",
        action="store_true",
        help="Use the bundled Puppeteer bridge for low-link JavaScript pages",
    )
    parser.add_argument("--external-discovery-timeout", type=float, default=300.0, help="External discovery timeout seconds")
    parser.add_argument(
        "--user-agent",
        default="LoreCTTownClerkCorpus/0.1 (+research corpus; contact: local runner)",
        help="HTTP User-Agent and robots.txt agent name",
    )
    args = parser.parse_args(argv)
    if args.depth < 0:
        parser.error("--depth must be at least 0")
    if args.rate < 0:
        parser.error("--rate must be at least 0")
    if args.max_mb <= 0:
        parser.error("--max-mb must be greater than 0")
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    if args.timeout <= 0 or args.retries < 0 or args.backoff < 0:
        parser.error("--timeout must be positive; --retries and --backoff must be non-negative")
    if args.max_pages < 1 or args.probe_limit < 0 or args.js_link_threshold < 0:
        parser.error("--max-pages must be positive; --probe-limit and --js-link-threshold must be non-negative")
    return args


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    out_root = args.out
    logger = setup_logging(out_root)
    config = build_config(args)

    try:
        towns = filter_towns(load_towns(args.towns), args.only)
    except Exception as exc:
        logger.error("towns_load_failed error=%s", exc)
        return 2

    if not towns:
        logger.error("no_towns_selected only=%s", args.only)
        return 2

    client = HttpClient(config, logger)
    index_rows = load_index(out_root)
    for town in towns:
        try:
            row = TownRunner(town, out_root, config, client, logger).run()
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            logger.exception("town_failed_uncaught town=%s", town.town)
            row = {
                "town": town.town,
                "slug": slugify(town.town),
                "clerk_url": town.clerk_url,
                "files_count": 0,
                "total_bytes": 0,
                "zip_path": str(out_root / "zips" / f"{slugify(town.town)}.zip"),
                "status": "error",
                "notes": f"{type(exc).__name__}:{exc}",
            }
        index_rows[str(row["slug"])] = row
        write_index(out_root, sorted(index_rows.values(), key=lambda item: str(item.get("town", "")).lower()))

    logger.info("run_complete towns=%s output=%s", len(towns), out_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
