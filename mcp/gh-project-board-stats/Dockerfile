FROM node:22-bookworm AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --include=dev

COPY . .

RUN npm run build

FROM node:22-bookworm-slim

ARG TARGETARCH

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends curl tar && \
    REAL_ARCH="${TARGETARCH:-amd64}" && \
    if [ "$REAL_ARCH" = "amd64" ]; then \
    MCP_ARCH="x86_64"; \
    elif [ "$REAL_ARCH" = "arm64" ]; then \
    MCP_ARCH="arm64"; \
    else \
    echo "Unsupported architecture: $REAL_ARCH" && exit 1; \
    fi && \
    curl -L "https://github.com/github/github-mcp-server/releases/download/v1.5.0/github-mcp-server_Linux_${MCP_ARCH}.tar.gz" \
      -o /tmp/github-mcp-server.tar.gz && \
    tar -xzf /tmp/github-mcp-server.tar.gz -C /tmp && \
    mv /tmp/github-mcp-server /usr/local/bin/github-mcp-server && \
    chmod +x /usr/local/bin/github-mcp-server && \
    ls -l /usr/local/bin/github-mcp-server && \
    rm /tmp/github-mcp-server.tar.gz && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 app && \
    useradd -u 10001 -g app -d /app -m app

# Run as non-root user (required by Choreo security policy)
USER 10001

ENV MCP_SERVER_PATH=/usr/local/bin/github-mcp-server
EXPOSE 8080

CMD ["node", "dist/index.js"]