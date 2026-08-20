#!/usr/bin/env bash
# Install Audiveris 5, the engine that reads a MULTI-PAGE PDF in one go.
#
# Audiveris is a Java application and there is no Homebrew formula for it, so
# this builds it from source. It needs a JDK 21 and Tesseract; both are
# installed here if they are missing, with the KEG-ONLY openjdk formula rather
# than the Temurin cask — a formula needs no administrator password and touches
# nothing outside Homebrew's own prefix.
#
# Budget ten minutes and about 1GB. Nothing outside $target and Homebrew is
# changed, and the script prints the export lines rather than editing a shell
# profile behind your back.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${AUDIVERIS_DIR:-$here/.audiveris}"

if ! command -v brew >/dev/null; then
  echo "Homebrew is needed for the JDK and Tesseract. See https://brew.sh" >&2
  exit 1
fi

# Which JDK. Audiveris's development branch tracks the current Java release —
# it wanted 21, then 25 — so this takes the NEWEST one on the machine rather
# than pinning a number that goes stale, and installs Homebrew's `openjdk` if
# there is nothing recent. The keg-only formula needs no administrator password
# and touches nothing outside Homebrew's prefix.
java_home=""
for candidate in "$(brew --prefix)/opt/openjdk" "$(brew --prefix)/opt/openjdk@25" "$(brew --prefix)/opt/openjdk@21"; do
  if [ -d "$candidate" ]; then java_home="$candidate"; break; fi
done
if [ -z "$java_home" ]; then
  echo "==> installing a JDK (keg-only openjdk — no password needed)"
  brew install openjdk
  java_home="$(brew --prefix)/opt/openjdk"
fi
export JAVA_HOME="$java_home"
echo "==> JAVA_HOME=$JAVA_HOME ($("$JAVA_HOME/bin/java" -version 2>&1 | head -1))"

# Tesseract's LANGUAGE DATA, which is fiddlier than it looks.
#
# Audiveris initialises Tesseract in LEGACY mode, and the eng.traineddata that
# Homebrew installs is the LSTM-only "fast" build — it has no legacy engine in
# it, so Audiveris finds the file, fails to load it, and reports "Tesseract
# couldn't load any languages!" while still exporting the notes. The file that
# works is the full one from the tessdata repository, and it belongs in the
# folder Audiveris makes for itself. TESSDATA_PREFIX is deliberately NOT set:
# pointing it at Homebrew's copy is what breaks this.
tessdata="$HOME/Library/Application Support/AudiverisLtd/audiveris/tessdata"
if [ ! -s "$tessdata/eng.traineddata" ] || [ "$(wc -c < "$tessdata/eng.traineddata")" -lt 10000000 ]; then
  echo "==> fetching the full eng.traineddata (23MB — the legacy engine Audiveris needs)"
  mkdir -p "$tessdata"
  curl -fsSL -o "$tessdata/eng.traineddata" \
    https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata \
    || echo "    (could not download it — Audiveris will still read notes, just not text)"
fi

if [ ! -d "$target" ]; then
  echo "==> cloning Audiveris into $target"
  git clone --depth 1 https://github.com/Audiveris/audiveris.git "$target"
fi

echo "==> building (gradle, several minutes)"
cd "$target"
./gradlew --no-daemon installDist

# Audiveris is a multi-project build: the start script lands under the app
# subproject, not the root.
launcher="$(find "$target" -type f -path '*/build/install/*/bin/Audiveris' | head -n1 || true)"
if [ -z "$launcher" ]; then
  echo "==> build finished but no launcher was found under */build/install/*/bin" >&2
  exit 1
fi
chmod +x "$launcher"

echo
echo "Audiveris is built at:"
echo "  $launcher"
echo
echo "The server finds it there by itself. Nothing to export — the engine"
echo "adapter also passes JAVA_HOME and TESSDATA_PREFIX, because Homebrew's JDK"
echo "is keg-only and is not on PATH."
