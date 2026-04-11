# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Production stage
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist/ ./dist/
COPY start.sh ./
RUN chmod +x start.sh && mkdir -p /app/data

EXPOSE 3000
VOLUME ["/app/data"]
USER node
CMD ["./start.sh"]
