FROM node:20-slim

WORKDIR /bot

# Install dependencies first so this layer caches when only source files change.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Source is bind-mounted at runtime, so we don't COPY it here.
# Keep the container alive so `docker exec` can drive scripts on demand.
CMD ["sleep", "infinity"]
