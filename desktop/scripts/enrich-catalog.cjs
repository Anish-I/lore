// Enrich wizards-catalog.json with REAL, sourced popularity signals and strip
// the synthetic ones. Run at catalog-build/release time, not app runtime:
//   node scripts/enrich-catalog.cjs
//
// - Tools scraped from crossaitools keep their real `installs` and gain
//   `stars`/`starsRepo` from the GitHub repo their source URL points at.
// - The hand-invented `rating` field is removed everywhere: the app shows
//   only sourced badges plus the user's OWN star rating (myRating).
// - Featured "Lore Library" entries lose their invented `installs` too.
//
// GitHub auth: GITHUB_TOKEN env var, else `gh auth token`. Unknown repos
// (404/renamed) are skipped — the card simply shows no star badge.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CATALOG = path.join(__dirname, '..', 'wizards-catalog.json');
const CROSSAI_RE = /https:\/\/crossaitools\.com\/skills\/([\w.-]+)\/([\w.-]+)\//;

function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execSync('gh auth token', { encoding: 'utf8' }).trim(); } catch { return null; }
}

async function fetchRepo(repo, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { 'User-Agent': 'lore-catalog-enrich', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return { stars: j.stargazers_count, pushedAt: j.pushed_at };
}

(async () => {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const items = catalog.wizards;
  const token = ghToken();
  if (!token) console.warn('WARN: no GitHub token (set GITHUB_TOKEN or `gh auth login`) — 60 req/hr limit applies');

  // repo -> entries that live in it (many skills share one repo)
  const byRepo = new Map();
  for (const w of items) {
    delete w.rating; // synthetic — never shipped by any real source
    const src = (w.sources || []).find((s) => CROSSAI_RE.test(s));
    const m = src && src.match(CROSSAI_RE);
    if (m) {
      const repo = `${m[1]}/${m[2]}`;
      w.installsSource = 'crossaitools';
      if (!byRepo.has(repo)) byRepo.set(repo, []);
      byRepo.get(repo).push(w);
    } else if (w.author === 'Lore Library') {
      delete w.installs; // invented for the featured six — no source behind it
    }
  }

  console.log(`entries: ${items.length}, unique repos: ${byRepo.size}`);
  let done = 0, missed = 0;
  for (const [repo, ws] of byRepo) {
    const info = await fetchRepo(repo, token).catch(() => null);
    if (info) {
      for (const w of ws) { w.stars = info.stars; w.starsRepo = repo; w.repoPushedAt = info.pushedAt; }
      done++;
    } else {
      missed++;
      console.log('  no repo:', repo);
    }
  }
  catalog.enrichedAt = new Date().toISOString();
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`done — ${done} repos starred, ${missed} not found; wrote ${path.basename(CATALOG)}`);
})();
