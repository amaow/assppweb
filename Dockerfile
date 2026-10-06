# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Fetch ipatool for the target architecture
FROM alpine AS ipatool-fetch
ARG TARGETARCH
ARG IPATOOL_VERSION=2.6.0
RUN apk add --no-cache curl tar && \
    curl -sL -o /tmp/ipatool.tar.gz \
      "https://github.com/majd/ipatool/releases/download/v${IPATOOL_VERSION}/ipatool-${IPATOOL_VERSION}-linux-${TARGETARCH}.tar.gz" && \
    tar xzf /tmp/ipatool.tar.gz -C /tmp && \
    mv /tmp/bin/ipatool-${IPATOOL_VERSION}-linux-${TARGETARCH} /tmp/ipatool && \
    chmod +x /tmp/ipatool

# Stage 4: Runtime
FROM node:20-alpine
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=frontend-build /app/frontend/dist ./public
# ipatool binary
COPY --from=ipatool-fetch /tmp/ipatool /usr/local/bin/ipatool
# Pre-baked Apple SAP signing assets (avoids swcdn.apple.com at runtime)
COPY docker/sap-assets/ /root/.cache/ipatool/sap/apple-assets-v2/
RUN mkdir -p /data/packages
EXPOSE 8080
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ENV DATA_DIR=/data PORT=8080 BUILD_COMMIT=$BUILD_COMMIT BUILD_DATE=$BUILD_DATE
CMD ["node", "dist/index.js"]
