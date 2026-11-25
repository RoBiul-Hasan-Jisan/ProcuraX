# syntax=docker/dockerfile:1
# Multi-stage build. Targets: runtime (default, production) and tools (adds dev dependencies and scripts, for seeding).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# One-off tasks such as `npm run seed` (needs tsx and the scripts folder). Never used to serve traffic.
FROM deps AS tools
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=development
USER node
CMD ["npm", "run", "seed"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=5000 STORAGE_DRIVER=local UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Uploaded business documents live on a volume, never in the image.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
