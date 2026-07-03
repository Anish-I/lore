#!/usr/bin/env bash
# Freeze the Lore FastAPI backend into a standalone macOS `lore-backend` binary
# (no system Python). Mirror of build_backend.sh (Windows) with POSIX --add-data
# separators. Heavy torch/transformers stack is EXCLUDED; embeddings use
# fastembed (ONNX, no torch). Embedded Qdrant runs in local path mode
# (qdrant_client.local, selected by QDRANT_PATH) — collect its submodules so the
# lazy local-mode imports survive freezing.
#
# Usage:  PYTHON=/path/to/venv/bin/python ./build_backend_mac.sh
# Output: core/pyi-dist/lore-backend/lore-backend  (onedir layout, same as Windows)
set -euo pipefail
cd "$(dirname "$0")"   # = core/

PYTHON="${PYTHON:-../.venv/bin/python}"

"$PYTHON" -m PyInstaller \
  --noconfirm \
  --onedir \
  --name lore-backend \
  --distpath pyi-dist \
  --workpath pyi-build \
  --specpath pyi-spec \
  --paths . \
  --add-data "$(pwd)/lore/static:lore/static" \
  --collect-submodules uvicorn \
  --collect-submodules lore \
  --collect-submodules qdrant_client \
  --collect-all fastembed \
  --collect-all onnxruntime \
  --collect-all tokenizers \
  --collect-all tiktoken_ext \
  --hidden-import tiktoken_ext \
  --hidden-import tiktoken_ext.openai_public \
  --hidden-import lore.api \
  --hidden-import portalocker \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --exclude-module torch \
  --exclude-module torchvision \
  --exclude-module torchaudio \
  --exclude-module torchmetrics \
  --exclude-module pytorch_lightning \
  --exclude-module pytorch_metric_learning \
  --exclude-module transformers \
  --exclude-module sentence_transformers \
  --exclude-module triton \
  --exclude-module nvidia \
  --exclude-module matplotlib \
  --exclude-module IPython \
  --exclude-module notebook \
  --exclude-module scipy \
  --exclude-module sympy \
  --exclude-module pandas \
  --exclude-module jax \
  --exclude-module jaxlib \
  --exclude-module cv2 \
  --exclude-module av \
  --exclude-module imageio_ffmpeg \
  --exclude-module imageio \
  --exclude-module pyarrow \
  --exclude-module nltk \
  --exclude-module spacy \
  --exclude-module sklearn \
  --exclude-module numba \
  --exclude-module llvmlite \
  run_server.py
