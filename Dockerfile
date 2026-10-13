# Linux environment for the project, without an interface.
#
#   docker build --target core -t agent-controller-core .
#   docker run --rm agent-controller-core                 core tests (default)
#   docker run --rm agent-controller-core npm run lint
#
# The `e2e` stage adds what Electron needs to open a window on a virtual display:
#
#   docker build --target e2e -t agent-controller-e2e .
#   docker run --rm --ipc=host agent-controller-e2e      packages the app and runs the e2e tests on it
FROM node:22-bookworm AS core

# node-pty has no prebuilt binary for Linux: it is compiled by `npm ci`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 git ca-certificates procps \
  && rm -rf /var/lib/apt/lists/*

# The tests must not run as root: the hook socket checks are about a regular user.
RUN useradd --create-home --shell /bin/bash dev
USER dev
WORKDIR /home/dev/app

COPY --chown=dev:dev package.json package-lock.json ./
RUN npm ci

COPY --chown=dev:dev . .

CMD ["npm", "run", "test:core"]

FROM core AS e2e

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0 \
    libdrm2 libxkbcommon0 libnotify4 libsecret-1-0 fonts-dejavu-core rpm fakeroot dpkg libfuse2 \
  && rm -rf /var/lib/apt/lists/*
USER dev

CMD ["bash", "-c", "npm run build && npx electron-builder --linux --dir && AGENT_CONTROLLER_EXE=$PWD/dist/linux-unpacked/agent-controller xvfb-run -a npm run test:e2e"]
