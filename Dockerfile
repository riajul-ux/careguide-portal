# Public demo / showcase image. SQLite lives inside the container and is
# re-seeded with fake data on first start (and refreshed daily in DEMO_MODE).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:./dev.db" \
    APP_TIMEZONE="America/New_York" \
    DEMO_MODE="true"
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx next build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "node scripts/ensure-db.mjs && npx next start -p ${PORT:-3000}"]
