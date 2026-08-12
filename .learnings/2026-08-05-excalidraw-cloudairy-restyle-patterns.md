# Excalidraw MCP: Cloudairy/AWS-style architecture boards

**Date:** 2026-08-05 · **Context:** restyling the Lore municipal E2E board on the
remote Excalidraw MCP (mcp.excalidraw.com) per owner's Cloudairy reference.

## Patterns that worked

- **Architect mode:** `"roughness": 0` + `"strokeWidth": 1` on every shape/arrow
  kills the hand-drawn wobble. `"fontFamily": 2` on standalone text = sans
  (Helvetica); default is Virgil (hand-drawn). Not documented in the MCP read_me
  but passes through fine.
- **Service chips:** bound `label` objects can't be given a text color, so white
  glyphs on saturated chips require *standalone* text elements: 56px rounded rect
  (saturated fill) + white glyph text (fs16, x = chipX+28-4·len) + dark name text
  below (fs14, x = chipX+28-3.5·len). Same trick for purple number badges
  (24px ellipse + white numeral).
- **Reskin = fresh canvas:** omitting `restoreCheckpoint` starts a blank canvas —
  right move for a full restyle (old checkpoints remain for rollback). Chain
  `restoreCheckpoint` across multi-call draws; each call returns a new checkpointId.
- **Soft canvas:** one giant `#eef2f6` rect first, then white panel frames
  (`#ffffff` fill, `#cbd5e1` 1px border) on top — reads like Cloudairy/AWS refs.
  Sub-groups: dashed `#94a3b8` rounded rects with small gray labels.
- **Clean tables:** header band rect (`#eef1f4`) + per-column multi-line texts with
  identical fontSize (rows align at lh = 1.25·fs). Split each column into a dark
  block and a muted `#94a3b8` block to gray out TBD rows.
- **JSON gotcha:** create_view rejects the whole array on one malformed element
  (a stray `}}` cost a retry) — worth mentally linting large payloads first.
- **export_to_excalidraw text bug (confirmed by pixel probe):** excalidraw.com's
  importer silently DROPS text elements that lack explicit `width`/`height`/
  `baseline` — the shared link renders all shapes but zero labels. The MCP chat
  canvas measures text itself, so the same JSON looks fine there; the bug only
  shows on the exported link. Fix: before export, inject
  `width ≈ maxLineLen·fontSize·0.62`, `height = lines·fontSize·1.25`,
  `baseline = height − fontSize·0.25`, `lineHeight: 1.25` into every text
  element. `fontFamily: 2` (Helvetica) is NOT the culprit — it renders fine.
  Verify headlessly by sampling the scene canvas via `javascript_tool`
  getImageData (count dark pixels where text should be) when the Browser pane
  isn't displayed and screenshots time out.
- **Probe gotcha:** if the tab already holds a scene, a new `#json=` link shows
  a "Load from link" dialog and the canvas keeps showing the OLD scene — pixel
  probes silently measure stale content. Click "Replace my content" via JS
  first. Fresh opens (the user's case) don't hit this.
- **Iterating cheaply:** keep a python generator (gen_v3.py) as source of truth;
  appended-only edits leave the JSON prefix byte-identical, so only the changed
  tail needs re-printing before the next export_to_excalidraw call.
- **Best pipeline (v5, proven):** skip the MCP export tool entirely.
  `publish.py` replicates Excalidraw's Export-to-link in ~20 lines: AES-GCM-128
  key, 12-byte IV, encrypt the scene JSON (legacy uncompressed format — the app
  still decrypts it via its fallback), POST iv||ciphertext to
  `https://json.excalidraw.com/api/v2/post/`, link =
  `#json=<id>,<base64url key>`. Generator + publisher = one Bash run per
  iteration, zero large tool payloads. Verified end-to-end with the canvas
  pixel probe.

## Gotcha carried from session 51417124

Wave 2/3 bake-off rows land only per-arm; a bench mid-run means locomo.jsonl
looks "done" at the last completed arm. Check the driver PID chain
(run_bakeoff2.py → bench_locomo.py) before declaring results final.
