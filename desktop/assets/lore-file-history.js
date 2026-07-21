const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = 8099;
const TIMEOUT_MS = 800;
const MAX_OBSERVATIONS = 3;
const MAX_SUMMARY_CHARS = 140;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function exitSilent() {
  process.exit(0);
}

function cleanOneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFilePath(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;

  try {
    const base = typeof cwd === 'string' && cwd.trim() ? cwd : process.cwd();
    return path.normalize(path.isAbsolute(filePath) ? filePath : path.resolve(base, filePath));
  } catch {
    return null;
  }
}

function comparablePath(filePath) {
  const normalized = path.normalize(filePath).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isUnderPath(filePath, parentPath) {
  if (!filePath || !parentPath) return false;

  const subject = comparablePath(path.resolve(filePath));
  const parent = comparablePath(path.resolve(parentPath)).replace(/\/+$/, '');
  return subject === parent || subject.startsWith(`${parent}/`);
}

function isExcludedPath(normalizedPath, tmpDir = os.tmpdir()) {
  const comparable = comparablePath(normalizedPath);
  const blockedSegments = ['/node_modules/', '/.git/', '/dist/', '/build/'];

  if (blockedSegments.some((segment) => comparable.includes(segment))) return true;
  return isUnderPath(normalizedPath, tmpDir);
}

function gateDecision(payload, options = {}) {
  if (!payload || payload.tool_name !== 'Read') {
    return { skip: true, reason: 'tool' };
  }

  const normalizedPath = normalizeFilePath(payload.tool_input && payload.tool_input.file_path, payload.cwd || options.cwd);
  if (!normalizedPath) {
    return { skip: true, reason: 'file_path' };
  }

  if (isExcludedPath(normalizedPath, options.tmpDir || os.tmpdir())) {
    return { skip: true, reason: 'excluded_path', normalizedPath };
  }

  return { skip: false, normalizedPath };
}

function safeSessionId(sessionId) {
  const cleaned = cleanOneLine(sessionId || 'unknown')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 128);

  return cleaned || 'unknown';
}

function seenSetPath(sessionId, tmpDir = os.tmpdir()) {
  return path.join(tmpDir, `lore-file-history-${safeSessionId(sessionId)}.json`);
}

function readSeenSet(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (Array.isArray(parsed)) {
      return parsed.reduce((acc, item) => {
        if (typeof item === 'string') acc[item] = true;
        return acc;
      }, {});
    }

    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeenSet(filePath, seenSet) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(seenSet), 'utf8');
  } catch {
    // Best effort only. This hook must never block reads.
  }
}

function rememberSeenPath(normalizedPath, sessionId, tmpDir = os.tmpdir()) {
  const filePath = seenSetPath(sessionId, tmpDir);
  const seenSet = readSeenSet(filePath);

  if (seenSet[normalizedPath]) {
    return { alreadySeen: true, seenSetPath: filePath };
  }

  seenSet[normalizedPath] = true;
  writeSeenSet(filePath, seenSet);

  return { alreadySeen: false, seenSetPath: filePath };
}

function configPaths() {
  const candidates = [];
  const appData = process.env.APPDATA;

  if (appData) {
    candidates.push(path.join(appData, 'lore-desktop', 'lore-config.json'));
    candidates.push(path.join(appData, 'Lore', 'lore-config.json'));
  }

  const home = os.homedir();
  if (home) {
    candidates.push(path.join(home, '.config', 'lore-desktop', 'lore-config.json'));
    candidates.push(path.join(home, '.config', 'Lore', 'lore-config.json'));
  }

  return candidates;
}

function normalizePort(port) {
  const parsed = Number(port);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? Math.floor(parsed) : DEFAULT_PORT;
}

function discoverConfig() {
  for (const filePath of configPaths()) {
    try {
      if (!fs.existsSync(filePath)) continue;

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        port: normalizePort(parsed.port),
        localToken: cleanOneLine(parsed.localToken),
        tenant: cleanOneLine(parsed.tenant),
      };
    } catch {
      continue;
    }
  }

  return { port: DEFAULT_PORT, localToken: '', tenant: '' };
}

function fetchObservations(config, normalizedPath, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    const requestPath = `/observations?tenant=${encodeURIComponent(config.tenant)}&file=${encodeURIComponent(normalizedPath)}&limit=${MAX_OBSERVATIONS}`;
    const headers = config.localToken ? { 'X-Lore-Token': config.localToken } : {};
    let settled = false;

    function done(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: config.port,
        path: requestPath,
        method: 'GET',
        headers,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          done([]);
          return;
        }

        let body = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 262144) {
            req.destroy();
            done([]);
          }
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            done(Array.isArray(parsed.observations) ? parsed.observations : []);
          } catch {
            done([]);
          }
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      done([]);
    }, timeoutMs);

    req.on('error', () => done([]));
    req.end();
  });
}

function humanizeDate(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'recently';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function truncateSummary(summary, maxChars = MAX_SUMMARY_CHARS) {
  const cleaned = cleanOneLine(summary);
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function observationTag(observation) {
  const parts = [];
  const type = cleanOneLine(observation.type);
  const outcome = cleanOneLine(observation.outcome);

  if (type) parts.push(type);
  if (outcome === 'verified-success') parts.push('verified');
  if (outcome === 'failed') parts.push('failed');

  return parts.length ? `<${parts.join(', ')}>` : '';
}

function formatTimeline(observations, normalizedPath) {
  const basename = cleanOneLine(path.basename(normalizedPath)) || 'this file';
  const sorted = observations
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a && a.ts);
      const bTime = Date.parse(b && b.ts);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })
    .slice(0, MAX_OBSERVATIONS);

  const lines = [];

  for (const observation of sorted) {
    if (!observation || typeof observation !== 'object') continue;

    const summary = truncateSummary(observation.summary);
    if (!summary) continue;

    const tag = observationTag(observation);
    lines.push(`· ${humanizeDate(observation.ts)}${tag ? ` ${tag}` : ''} — ${summary}`);
  }

  if (!lines.length) return '';

  return [
    "Lore: you've worked on this file before —",
    ...lines,
    `(details: ask Lore about ${basename})`,
  ].join('\n');
}

async function run() {
  let raw = '';

  try {
    process.stdin.setEncoding('utf8');

    for await (const chunk of process.stdin) {
      raw += chunk;
    }

    const payload = JSON.parse(raw);
    const decision = gateDecision(payload);
    if (decision.skip) return;

    const seen = rememberSeenPath(decision.normalizedPath, payload.session_id);
    if (seen.alreadySeen) return;

    const config = discoverConfig();
    if (!config.tenant) return;

    const observations = await fetchObservations(config, decision.normalizedPath);
    if (!Array.isArray(observations) || observations.length === 0) return;

    const additionalContext = formatTimeline(observations, decision.normalizedPath);
    if (!additionalContext) return;

    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext,
      },
    })}\n`);
  } catch {
    exitSilent();
  }
}

module.exports = {
  cleanOneLine,
  normalizeFilePath,
  comparablePath,
  isUnderPath,
  isExcludedPath,
  gateDecision,
  safeSessionId,
  seenSetPath,
  readSeenSet,
  writeSeenSet,
  rememberSeenPath,
  configPaths,
  normalizePort,
  discoverConfig,
  fetchObservations,
  humanizeDate,
  truncateSummary,
  observationTag,
  formatTimeline,
  run,
};

if (require.main === module) {
  run();
}