FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts/build.cjs ./scripts/build.cjs
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
COPY --from=build /app/dist ./dist
COPY public ./public
COPY data ./data
COPY migrations ./migrations
COPY scripts/database/migrate-container.cjs ./scripts/database/migrate-container.cjs
USER node
CMD ["node","dist/server.js"]
