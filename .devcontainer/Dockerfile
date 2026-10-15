FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git bubblewrap \
    && rm -rf /var/lib/apt/lists/*

# 開発CLIは製品依存に混ぜず、明示的な版で再構築する。
RUN npm install --global @openai/codex@0.162.1 \
    && npm cache clean --force

# volume初回作成時に非root所有権を引き継ぎ、ホストの依存や認証を共有しない。
RUN mkdir -p /workspaces/jevault /workspaces/node_modules /home/node/.codex \
    && chown -R node:node /workspaces /home/node/.codex \
    && chmod 700 /home/node/.codex

USER node
WORKDIR /workspaces/jevault
