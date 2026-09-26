#!/usr/bin/env bash
# Local dev only: a `file:` install is a symlink, so Node resolves @metamask/agent-wallet from this
# folder's node_modules and loads a second copy of the CLI, which crashes the plugin host with
# "window.addEventListener is not a function". Point the dev dependency at the host's own install.
set -euo pipefail
cd "$(dirname "$0")"
HOST="$(cd "$(dirname "$(readlink -f "$(command -v mm)")")/.." && pwd)"
[ -f "$HOST/package.json" ] || { echo "cannot locate host @metamask/agent-wallet from $(command -v mm)"; exit 1; }
if [ -d node_modules/@metamask/agent-wallet ] && [ ! -L node_modules/@metamask/agent-wallet ]; then
  mv node_modules/@metamask/agent-wallet node_modules/@metamask/agent-wallet.dev
fi
ln -sfn "$HOST" node_modules/@metamask/agent-wallet
echo "linked node_modules/@metamask/agent-wallet -> $HOST"
