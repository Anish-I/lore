# GitHub `.lore` packages

Lore can carry selected project knowledge inside a Git repository without committing the local
database, account identifiers, or worklog. Git remains the transport; no GitHub token or hosted Lore
account is required.

## Share notes

Sharing is opt-in per note. Add this to a note's YAML frontmatter:

```yaml
---
share: github
---
```

Then open **Settings → GitHub package → Create package**. Lore writes two paths with different
privacy rules:

- `.lore/package.json` — portable, compressed shared notes; commit this file.
- `.lore/manifest.json` — local discovery metadata, tenant/scope IDs, and worklog; keep ignored.

The exporter updates `.gitignore` so only `package.json` can be tracked under `.lore`. Commit both the
package and the `.gitignore` change. An unchanged note set produces no package rewrite, which keeps Git
diffs quiet.

## Import after pull

Open the pulled repository as a Lore library, then use **Settings → GitHub package → Import shared
notes**. The first import is explicit because a repository controls the package contents. It establishes
trust for that package ID; **Import updates on launch** can then ingest changed content after later pulls.

Imported notes go directly to Lore's on-device index with `github-package` provenance. Lore does not
write package contents into the repository. If the corresponding Markdown path exists locally, the file
is the source of truth and the packaged copy is skipped, preventing duplicate notes and file overwrite.

## Format and validation

`.lore/package.json` is a versioned JSON envelope containing:

- a stable random package ID;
- a SHA-256 content digest;
- note, compressed-size, and expanded-size counts;
- a deterministic `gzip+base64` payload;
- per-note relative path, title, body, and SHA-256 digest.

Import rejects unsupported versions and encodings, malformed base64/gzip, digest mismatches, duplicate or
escaping paths, oversized notes, and oversized packages. Current limits are 200 notes, 512 KiB per note,
5 MiB expanded, and 2 MiB compressed.

## Privacy boundary

A package is compressed, not encrypted. Anyone who can read the repository can recover every shared
note. Lore applies its existing secret scanner before export: recognizable credentials are redacted and
secret-dominated files are skipped. That is a last line of defense, not a classification system. Only mark
content `share: github` when it is appropriate for every person with repository access, and review the Git
diff before pushing.

Legacy single-file `.lore` manifests migrate automatically to `.lore/manifest.json`; their local metadata
is never copied into `package.json`.
