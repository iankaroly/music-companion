#!/usr/bin/env bash
# Install the oemer OMR engine into server/.venv.
#
# oemer is the no-Java path: a pip install and an ONNX model, nothing else. The
# virtualenv is kept inside the repo (and git-ignored) so the engine adapter can
# find it without the user editing a PATH, and so removing the feature is
# `rm -rf server/.venv` rather than a hunt through a global site-packages.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="$here/.venv"
python="${PYTHON:-python3}"

echo "==> creating $venv with $($python -V)"
"$python" -m venv "$venv"
"$venv/bin/pip" install --quiet --upgrade pip
echo "==> installing oemer (this pulls onnxruntime, opencv and scipy — a few minutes)"
"$venv/bin/pip" install oemer

# oemer 0.1.5 does not pin its numeric stack and does not run on the current one:
# staffline_extraction.py still calls np.int, which numpy removed in 1.24, so a
# fresh install fails on the first page with an AttributeError. opencv 5 in turn
# wants numpy 2. Pinning both is what makes `pip install oemer` actually work.
echo "==> pinning numpy<1.24 and opencv<4.9 (oemer 0.1.5 uses the removed np.int)"
"$venv/bin/pip" install --quiet "numpy<1.24" "opencv-python<4.9"

echo "==> installed: $("$venv/bin/oemer" --help >/dev/null 2>&1 && echo ok || echo FAILED)"
echo
echo "The first conversion downloads the model checkpoints (~80MB) into the"
echo "package directory. Run one now to get that out of the way:"
echo "  npm run engines:probe"
