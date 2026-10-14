FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM gcr.io/distroless/nodejs24-debian13:nonroot

WORKDIR /app

COPY package.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY src/ ./src/

ENV PORT=3000

EXPOSE 3000

CMD ["src/server.js"]
