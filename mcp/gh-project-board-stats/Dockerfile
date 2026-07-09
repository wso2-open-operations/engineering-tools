FROM node:22-bookworm AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --include=dev

COPY . .

RUN npm run build

FROM node:22-bookworm

ARG TARGETARCH

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl tar && \
    if [ "$TARGETARCH" = "amd64" ]; then \
        MCP_ARCH="x86_64"; \
    else \
        MCP_ARCH="$TARGETARCH"; \
    fi && \
    curl -L https://github.com/github/github-mcp-server/releases/download/v1.5.0/github-mcp-server_Linux_${MCP_ARCH}.tar.gz \
      -o /tmp/github-mcp-server.tar.gz && \
    tar -xzf /tmp/github-mcp-server.tar.gz -C /tmp && \
    mv /tmp/github-mcp-server /usr/local/bin/github-mcp-server && \
    chmod +x /usr/local/bin/github-mcp-server && \
    rm /tmp/github-mcp-server.tar.gz && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && \
    useradd -r -g app -d /app app

USER app

ENV MCP_SERVER_PATH=/usr/local/bin/github-mcp-server

CMD ["node", "dist/index.js"]