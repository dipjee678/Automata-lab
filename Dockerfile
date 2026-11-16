# Automata Lab – one container that serves both the API and the built frontend.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer is cached until a manifest changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY algorithms/package.json algorithms/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
# Most hosts inject PORT; 4000 is the fallback.
ENV PORT=4000
EXPOSE 4000

# Run as the unprivileged user that the node image provides.
USER node
CMD ["npm", "run", "start"]
