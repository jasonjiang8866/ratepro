FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY src/lib ./src/lib
COPY scripts ./scripts
COPY tests ./tests
RUN mkdir -p research-output && chown node:node research-output
USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/maybank-job.ts"]
