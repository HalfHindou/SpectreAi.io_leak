# spectre-order-engine - build from the MONOREPO ROOT so the shared CJS
# core is available:
#   docker build -f services/order-engine/Dockerfile -t order-engine .
FROM node:22-alpine

WORKDIR /app

# Shared store core (agent-orders-core requires nothing outside itself).
COPY packages/server/lib/agent-orders-core.js packages/server/lib/agent-orders-core.js

# Engine
COPY services/order-engine/package.json services/order-engine/package-lock.json* services/order-engine/
RUN cd services/order-engine && npm install --omit=dev --no-audit --no-fund
COPY services/order-engine/src services/order-engine/src

USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "services/order-engine/src/index.js"]
