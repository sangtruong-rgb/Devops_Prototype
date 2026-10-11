FROM gcr.io/distroless/nodejs24-debian13:nonroot

WORKDIR /app

COPY package.json ./
COPY src/ ./src/

ENV PORT=3000

EXPOSE 3000

CMD ["src/server.js"]