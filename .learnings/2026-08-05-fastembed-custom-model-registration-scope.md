# fastembed custom models register per-process via LocalEmbedder, not globally

**Date:** 2026-08-05
**Context:** embedder bake-off wave 2 (EmbeddingGemma/Qwen custom ONNX arms)

## Problem

Both custom arms failed instantly with "Model google/embeddinggemma-300m is
not supported in TextEmbedding" — the bake-off driver's predownload step
called bare `fastembed.TextEmbedding(model_name=...)`. Sol's
`add_custom_model` registration lives inside `lore.embed.LocalEmbedder.__init__`
(via `_register_custom_model`), so any code path that constructs TextEmbedding
directly never sees the custom registry. Registration is per-process and
lore-side, not a fastembed-global side effect.

## Rule

Anything that instantiates embedding models for lore arms (drivers, scripts,
tests) must go through `LocalEmbedder(model=...)` — or call
`_register_custom_model(TextEmbedding, model)` first. Applies to every future
custom-ONNX model. Verified fix: predownload via LocalEmbedder; registration
confirmed for both gemma and qwen.
