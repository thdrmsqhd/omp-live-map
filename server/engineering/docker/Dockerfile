FROM node:24.13.0-bookworm-slim
ARG OMP_VERSION=18.8.9
ARG CLAUDE_VERSION=2.1.70
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git bash && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@1.3.13 @anthropic-ai/claude-code@${CLAUDE_VERSION} \
    && BUN_INSTALL=/usr/local bun install -g @oh-my-pi/pi-coding-agent@${OMP_VERSION}
LABEL dev.omplivemap.runtime="engine-v2.1"
COPY bridge.cjs /usr/local/lib/omp-engineering/bridge.cjs
ENTRYPOINT []
