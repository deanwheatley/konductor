# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Copy konductor source
COPY konductor/package.json konductor/package-lock.json konductor/
COPY konductor/src/ konductor/src/
COPY konductor/tsconfig.json konductor/

# Copy konductor-setup source (for installer bundle packing)
COPY konductor-setup/ konductor-setup/

# Install all deps (including devDependencies for TypeScript compilation)
WORKDIR /app/konductor
RUN npm ci

# Install konductor-setup deps
WORKDIR /app/konductor-setup
RUN npm ci

# Compile TypeScript
WORKDIR /app/konductor
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app/konductor

# Copy compiled output
COPY --from=build /app/konductor/dist/ dist/
COPY --from=build /app/konductor/package.json /app/konductor/package-lock.json ./

# Copy konductor-setup (for installer bundle packing at startup)
COPY --from=build /app/konductor-setup/ /app/konductor-setup/

# Copy konductor.yaml config
COPY konductor/konductor.yaml ./

# Install production deps only
RUN npm ci --omit=dev

# App Runner terminates TLS — container runs plain HTTP
ENV KONDUCTOR_PORT=3100
ENV KONDUCTOR_PROTOCOL=http

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r=>{if(!r.ok)throw 1})"

CMD ["node", "dist/index.js"]
