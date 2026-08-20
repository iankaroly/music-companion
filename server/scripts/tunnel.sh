#!/usr/bin/env bash
# Put the pipeline on the internet, with a password, so the app on a phone can
# reach it from anywhere.
#
# WHY THIS EXISTS: the recogniser is a JVM and a neural network. It cannot run
# on a phone, and the app installed on a home screen is served over https, which
# a browser will not let call a plain-http service on the home network. A tunnel
# is the one arrangement that satisfies both: this laptop does the reading, and
# the phone reaches it over https from anywhere.
#
# WHAT IT COSTS, said plainly: while this is running, pages scanned on the phone
# travel over the internet to this machine. The address is public — Cloudflare
# hands out a random one — so the pipeline is started with a PASSWORD and every
# call has to carry it. Close this window and the address is gone.
#
#   ./scripts/tunnel.sh
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${PORT:-4000}"

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared is not installed — brew install cloudflared" >&2
  exit 1
fi

# A password, unless one was given. A public URL with no password is a stranger's
# twenty-minute recognition job on your laptop.
# openssl rather than `tr < /dev/urandom | head`: head closes the pipe, tr dies
# of SIGPIPE, and `set -o pipefail` then kills this script before it starts
# anything — which it did, silently, the first time it was run.
token="${OMR_TOKEN:-$(openssl rand -hex 16)}"

cleanup() {
  [ -n "${service_pid:-}" ] && kill "$service_pid" 2>/dev/null || true
  [ -n "${tunnel_pid:-}" ] && kill "$tunnel_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> starting the pipeline on 127.0.0.1:$port"
( cd "$here" && OMR_TOKEN="$token" PORT="$port" node src/index.js ) &
service_pid=$!

# Wait for it rather than racing it.
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$port/healthz" >/dev/null && break
  sleep 0.5
done

log="$(mktemp)"
echo "==> opening a tunnel to it"
cloudflared tunnel --url "http://127.0.0.1:$port" --no-autoupdate > "$log" 2>&1 &
tunnel_pid=$!

url=""
for _ in $(seq 1 60); do
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -n1 || true)"
  [ -n "$url" ] && break
  sleep 1
done

if [ -z "$url" ]; then
  echo "the tunnel did not come up — see $log" >&2
  exit 1
fi

cat <<INFO

  ────────────────────────────────────────────────────────────
  Put these two into the app: Settings → Score recogniser

    address    $url
    password   $token

  Then scan a page. It converts by itself and the notes are
  paired onto the scan.

  While this window is open, pages you scan travel over the
  internet to this machine. Close it and the address stops
  working — the app finds nothing and goes back to behaving
  exactly as it did before.
  ────────────────────────────────────────────────────────────

INFO

wait $tunnel_pid
