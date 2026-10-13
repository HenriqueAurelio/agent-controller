#!/usr/bin/env bash
# Prepares an Ubuntu (WSL2 or a real machine) to run the project and the smoke tests with the
# real agents: build tools, the libraries Electron needs, Node 22, Claude Code and Codex.
#
#   sudo bash tools/wsl-setup.sh system      packages and Node (as root)
#   bash tools/wsl-setup.sh user [repo]      agents and a clone of the repository (as you)
#
# Logging in to the agents is left to you: run `claude` and `codex` once each.
set -euo pipefail

case "${1:-}" in
  system)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends \
      build-essential python3 git curl ca-certificates xvfb xauth \
      libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0t64 \
      libdrm2 libxkbcommon0 libnotify4 libsecret-1-0 fonts-dejavu-core
    if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
    fi
    node --version
    ;;
  user)
    # Global npm packages go to the home folder: no sudo, and the agents can update themselves.
    mkdir -p "$HOME/.local"
    npm config set prefix "$HOME/.local"
    export PATH="$HOME/.local/bin:$PATH"
    npm install -g @anthropic-ai/claude-code @openai/codex
    claude --version
    codex --version

    # The repository lives in the Linux file system: under /mnt, file events are unreliable.
    source_repo="${2:-}"
    target="$HOME/src/agent-controller"
    if [ -n "$source_repo" ] && [ ! -d "$target/.git" ]; then
      mkdir -p "$HOME/src"
      git clone "$source_repo" "$target"
    fi
    if [ -d "$target/.git" ]; then
      cd "$target"
      [ -n "$source_repo" ] && git pull --ff-only || true
      npm ci
      echo "Repositório pronto em $target"
    fi
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 1
    ;;
esac
