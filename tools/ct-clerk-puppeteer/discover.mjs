#!/usr/bin/env node

import puppeteer from "puppeteer";

const DOCUMENT_EXTENSION = /\.(pdf|doc|docx|xls|xlsx|csv|txt|rtf|odt|zip)(?:$|[?#])/i;
const DOCUMENT_CONTENT_TYPE = /(application\/pdf|application\/msword|officedocument|vnd\.ms-excel|text\/csv|application\/csv|application\/rtf|text\/rtf|opendocument|application\/zip)/i;
const CONTENT_DISPOSITION_DOCUMENT = /\.(pdf|doc|docx|xls|xlsx|csv|txt|rtf|odt|zip)(?:["';\s]|$)/i;
const DOCUMENT_LINK_HINT = /(?:^|[\s/_?&=.-])(download|document|form|application|agenda|minutes|report|filing|record|pdf|doc|spreadsheet)(?:$|[\s/_?&=.-])/i;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font", "stylesheet"]);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  if (!input.trim()) {
    throw new Error("expected one town JSON object on stdin");
  }
  return JSON.parse(input);
}

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function addDocument(documents, rawUrl, discoveredFrom, reason) {
  const url = normalizeUrl(rawUrl, discoveredFrom);
  if (!url) {
    return;
  }
  const existing = documents.get(url);
  if (existing) {
    const sources = new Set(existing.discovered_from.split(";"));
    sources.add(discoveredFrom);
    existing.discovered_from = [...sources].join(";");
    return;
  }
  documents.set(url, {
    url,
    discovered_from: discoveredFrom,
    reason: reason || "puppeteer",
  });
}

function isDocumentCandidate(link) {
  return DOCUMENT_EXTENSION.test(link.url)
    || DOCUMENT_CONTENT_TYPE.test(link.contentType)
    || link.download
    || DOCUMENT_LINK_HINT.test(`${link.url} ${link.text}`);
}

async function extractFrameLinks(frame) {
  return frame.evaluate(() => {
    const selectors = [
      ["a[href]", "href"],
      ["area[href]", "href"],
      ["link[href]", "href"],
      ["iframe[src]", "src"],
      ["embed[src]", "src"],
      ["object[data]", "data"],
    ];
    const links = [];
    for (const [selector, attribute] of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rawUrl = element.getAttribute(attribute);
        if (!rawUrl) {
          continue;
        }
        links.push({
          url: rawUrl,
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200),
          contentType: element.getAttribute("type") || "",
          download: element.hasAttribute("download"),
        });
      }
    }
    return links;
  });
}

async function renderSeed(browser, seedUrl, input, documents, notes) {
  const page = await browser.newPage();
  const timeoutMs = positiveInteger(input.timeout_ms, 30_000);
  const settleMs = positiveInteger(process.env.CT_CLERK_BROWSER_SETTLE_MS, 2_000);

  try {
    if (input.user_agent) {
      await page.setUserAgent(input.user_agent);
    }
    page.setDefaultNavigationTimeout(timeoutMs);
    await page.setRequestInterception(true);

    page.on("request", (request) => {
      const requestUrl = request.url();
      if (DOCUMENT_EXTENSION.test(requestUrl)) {
        addDocument(documents, requestUrl, seedUrl, "puppeteer_request_extension");
        request.abort().catch(() => {});
        return;
      }
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        request.abort().catch(() => {});
        return;
      }
      request.continue().catch(() => {});
    });

    page.on("response", (response) => {
      const headers = response.headers();
      const contentType = headers["content-type"] || "";
      const contentDisposition = headers["content-disposition"] || "";
      const dispositionMatch = contentDisposition.match(CONTENT_DISPOSITION_DOCUMENT);
      if (DOCUMENT_CONTENT_TYPE.test(contentType) || dispositionMatch) {
        const reason = DOCUMENT_CONTENT_TYPE.test(contentType)
          ? `content_type:${contentType.split(";", 1)[0]}`
          : dispositionMatch[1].toLowerCase();
        addDocument(
          documents,
          response.url(),
          seedUrl,
          reason,
        );
      }
    });

    await page.goto(seedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await sleep(settleMs);
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight || 0));
    await sleep(Math.min(settleMs, 1_500));

    for (const frame of page.frames()) {
      try {
        const frameUrl = normalizeUrl(frame.url(), page.url()) || page.url();
        for (const link of await extractFrameLinks(frame)) {
          if (!isDocumentCandidate(link)) {
            continue;
          }
          const reasonParts = [];
          if (link.contentType) {
            reasonParts.push(`content_type:${link.contentType}`);
          }
          if (link.download) {
            reasonParts.push("download");
          }
          if (link.text) {
            reasonParts.push(`link_text:${link.text}`);
          }
          addDocument(documents, link.url, frameUrl, reasonParts.join(";") || "puppeteer_dom_link");
        }
      } catch (error) {
        notes.push(`frame_extract_error:${frame.url()}:${error.name}`);
      }
    }
  } catch (error) {
    notes.push(`page_render_error:${seedUrl}:${error.name}:${error.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const input = await readInput();
  const maxPages = positiveInteger(process.env.CT_CLERK_BROWSER_MAX_PAGES, 20);
  const rateDelayMs = positiveInteger(input.rate_delay_ms, 1_000);
  const rawSeeds = Array.isArray(input.seed_urls) && input.seed_urls.length
    ? input.seed_urls
    : [input.clerk_url];
  const seedUrls = [...new Set(rawSeeds.map((url) => normalizeUrl(url, input.clerk_url)).filter(Boolean))]
    .slice(0, maxPages);

  const documents = new Map();
  const notes = [];
  if (!seedUrls.length) {
    process.stdout.write(JSON.stringify({ documents: [], notes: ["no_seed_urls"] }));
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  try {
    for (const seedUrl of seedUrls) {
      await sleep(rateDelayMs);
      await renderSeed(browser, seedUrl, input, documents, notes);
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(JSON.stringify({
    documents: [...documents.values()],
    notes,
    pages_rendered: seedUrls.length,
  }));
}

main().catch((error) => {
  process.stderr.write(`puppeteer_discovery_failed ${error.stack || error}\n`);
  process.exitCode = 1;
});
