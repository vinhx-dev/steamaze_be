# Backend: Express + Prisma (PostgreSQL)
FROM node:22-bookworm-slim

# Prisma engine cần openssl
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Cài cả devDependencies vì cần prisma CLI để chạy migrate deploy / seed
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev && npx prisma generate && npm cache clean --force

COPY src ./src

ENV HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080

# Áp migration mới (nếu có) rồi chạy server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
