'use strict';
/**
 * Embedded-Postgres lifecycle for Lore Desktop.
 *
 * Wraps the `embedded-postgres` npm package (MIT) which ships real PostgreSQL
 * binaries for Windows-x64, macOS, and Linux — no Docker needed.
 *
 * Exported API:
 *   start({ dataDir, port }) → Promise<Result>
 *
 *   Result (success): { ok: true,  url: string, stop: () => Promise<void> }
 *   Result (failure): { ok: false, reason: string }
 *
 * This module is only loaded when config.embeddedPg === true.
 * The default Docker-based setup is completely unaffected when the flag is off.
 *
 * Idempotency:
 *   - First run: runs initdb, starts server, creates database.
 *   - Subsequent runs: detects existing PG_VERSION → skips initdb, just starts.
 *   - "Already running" errors from pg_ctl are caught and treated as success
 *     so hot-reloads or leftover processes don't crash startup.
 */

const path = require('path');
const fs   = require('fs');

const DB_USER     = 'vault';
const DB_PASS     = 'vault';
const DB_NAME     = 'vault';
const DEFAULT_PORT = 5433;

/**
 * Start (or attach to) an embedded Postgres server.
 *
 * @param {object} [opts]
 * @param {string} opts.dataDir  Absolute path to the PG data directory.
 *                               Created automatically if it does not exist.
 * @param {number} [opts.port]   TCP port to bind (default 5433).
 *
 * @returns {Promise<{ ok: true,  url: string, stop: () => Promise<void> }
 *                 | { ok: false, reason: string }>}
 */
async function start({ dataDir, port = DEFAULT_PORT } = {}) {
  // Log file sits one level above the data dir (i.e. directly in userData).
  const logPath = path.join(path.dirname(dataDir), 'lore-embedded-pg.log');

  function logLine(msg) {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
      /* logging must never throw */
    }
  }

  try {
    // embedded-postgres ships as ESM ("type": "module").
    // Dynamic import() works from CJS async functions in Node ≥ 14 / Electron ≥ 21.
    const { default: EmbeddedPostgres } = await import('embedded-postgres');

    // Ensure the data directory exists before passing it to EmbeddedPostgres.
    fs.mkdirSync(dataDir, { recursive: true });

    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user:        DB_USER,
      password:    DB_PASS,
      port,
      persistent:  true,       // keep data between restarts
      authMethod:  'password',
      onLog:       (msg) => logLine(`[pg] ${msg}`),
      onError:     (err) => logLine(`[pg:error] ${String(err)}`),
    });

    // PG_VERSION is written by initdb on first cluster creation.
    // If it exists, the cluster is already initialised — skip initdb.
    const isInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

    if (!isInitialised) {
      logLine(`First run — initialising cluster in ${dataDir} …`);
      await pg.initialise();
      logLine('initdb complete — starting server …');
      await pg.start();
      logLine(`Server up on port ${port} — creating database "${DB_NAME}" …`);
      try {
        await pg.createDatabase(DB_NAME);
        logLine(`Database "${DB_NAME}" created.`);
      } catch (dbErr) {
        // Tolerate "already exists" in case a partial first-run left it behind.
        const msg = String(dbErr);
        if (msg.includes('already exists') || msg.includes('42P04')) {
          logLine(`Database "${DB_NAME}" already existed — continuing.`);
        } else {
          throw dbErr;
        }
      }
    } else {
      logLine(`Cluster exists — starting server on port ${port} …`);
      try {
        await pg.start();
      } catch (startErr) {
        // "already running" means a previous process is still alive — treat as ok.
        const msg = String(startErr);
        if (msg.toLowerCase().includes('already running') || msg.includes('lock file')) {
          logLine('Server appears already running — continuing.');
        } else {
          throw startErr;
        }
      }
      logLine('Server ready.');
    }

    const url = `postgresql://${DB_USER}:${DB_PASS}@localhost:${port}/${DB_NAME}`;
    logLine(`DATABASE_URL → ${url}`);

    /** Gracefully stop the embedded server. Never throws. */
    async function stop() {
      try {
        logLine('Stopping embedded Postgres …');
        await pg.stop();
        logLine('Embedded Postgres stopped.');
      } catch (e) {
        logLine(`Stop error (ignored): ${e}`);
      }
    }

    return { ok: true, url, stop };

  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

module.exports = { start };
