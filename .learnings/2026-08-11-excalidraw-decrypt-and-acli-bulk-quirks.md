# Excalidraw share-link decryption + Atlassian CLI bulk quirks (2026-08-11)

## Context
Needed to read the Lore architecture board from an excalidraw.com `#json=<id>,<key>` share link headlessly, then mass-create Jira stories from it with the official Atlassian CLI (acli).

## Learning 1: Excalidraw share links decrypt client-side — replicate it in 15 lines
`https://excalidraw.com/#json=<docId>,<key>` is end-to-end encrypted; scraping the page gets nothing (canvas render, scene not in localStorage until edited). The scene is fetched and decrypted like this:

1. `GET https://json.excalidraw.com/api/v2/<docId>` → binary buffer.
2. Buffer format: 4-byte big-endian version, then repeated `[4-byte BE length][chunk]` until EOF. Chunks: `[metadataJSON, iv, ciphertext]`.
3. Metadata is `{"version":2,"compression":"pako@1","encryption":"AES-GCM"}`.
4. Key: the URL-fragment `<key>` used verbatim as JWK `{kty:"oct", alg:"A128GCM", k:<key>}`, AES-GCM with the 12-byte IV chunk.
5. Decrypted bytes are zlib (pako) — native `DecompressionStream("deflate")` handles it.
6. Result is the same chunk format again: `[contentsMetadata, sceneJSON]`. Scene JSON has `elements[]`; filter `type === "text"`, sort by y then x to read a board as text.

Gotcha: my first guess at the chunk format (leading chunk-count) was wrong — it's version-then-chunks-until-EOF. Inspect the first 16 bytes before assuming.

## Learning 2: acli `create-bulk` JSON silently supports fewer fields than CSV
`acli jira workitem create-bulk --from-json` rejects payloads containing `description` / `parentIssueId` with an opaque "request body is missing or invalid" — even though the `--from-csv` help documents those exact columns. Workaround: loop single `acli jira workitem create` calls (~1s each, 68/68 succeeded) with `--description-file` to dodge PS 5.1 multiline-arg mangling; `--json` output gives the created key.

Other acli notes:
- `acli jira workitem assign --jql "project = KAN AND labels = anish" --assignee <email>` is the fast bulk-assign path; assigning an email that isn't a site member fails with "unexpected error" + trace id (not a clear "user not found").
- Team-managed Kanban project (KAN) accepted `--type Story` and `--parent <epic>` fine.
- `acli jira project list` requires one of `--limit/--recent/--paginate`.

## Learning 2b: more acli quirks (description/labels pass, 2026-08-11)
- `workitem edit --description-file` accepts full ADF JSON — headings, orderedList, bulletList, codeBlock all render. Build ADF programmatically, don't fight plain text.
- PowerShell 5.1 trap: a function named `H` is shadowed by the built-in alias `h` → Get-History (alias > function in command precedence). The edit loop "succeeded" while every heading call errored. Name helper functions ≥2 chars.
- `workitem view --json` and `search --json` OMIT the labels field even when labels exist — they look wiped. JQL (`labels = x`) is the only ground truth for label state.
- `edit --labels "a,b,c"` REPLACES the full label set (works, comma-separated). `edit --from-json` with `labelsToAdd` did not behave additively in testing — avoid; replace with the full known set instead.
- `workitem link create --out A --in B --type Blocks` = "A blocks B". Available types on team-managed: Blocks, Cloners, Duplicate, Relates.

## Learning 3 (project state)
Jira for Lore lives at **lore-engine.atlassian.net**, project **KAN** ("Team Lore"), authed via OAuth as allison.lamp@sowhat.company. Ownership labels: `marcy` (DS/engine) / `anish` (SWE). Anish = ivaturi.anish@gmail.com on that site; Marcy Truong had no account as of 2026-08-11 (guessed sowhat.company addresses all failed) — her 25 items are labeled but unassigned.
