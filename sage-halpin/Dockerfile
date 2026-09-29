# Sage Halpin — one container: Express serves the built web app and the
# boardroom API on $PORT. Built for Azure Container Apps.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Optional, baked into the web bundle: the bespoke-challenge waitlist address.
ARG VITE_ENQUIRY_EMAIL=""
ENV VITE_ENQUIRY_EMAIL=$VITE_ENQUIRY_EMAIL
RUN npm run typecheck && npm test && npm run build && node scripts/check-brand.mjs

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/healthz || exit 1
CMD ["node", "dist/server.mjs"]
