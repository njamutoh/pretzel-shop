# Stage 1: Install dependencies
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Production image
FROM node:24-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY config/ ./config/
COPY routes/ ./routes/
COPY scripts/ ./scripts/
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

USER appuser

EXPOSE 3001

CMD ["./docker-entrypoint.sh"]
