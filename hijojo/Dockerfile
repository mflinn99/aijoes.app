# Hijojo: one container serving the UI, the API (including the Copilot API) and
# the background worker on $PORT. Built for Azure Container Apps.
# Debian slim rather than Alpine so better-sqlite3 uses its prebuilt binary.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm test && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 HIJOJO_DB_PATH=/data/hijojo.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
