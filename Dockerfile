# Stage 1 — build the React client
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --include=dev
COPY client/ ./
RUN npm run build

# Stage 2 — run the Express server
FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client-build /app/client/dist /app/server/public

EXPOSE 3001
CMD ["node", "index.js"]
