FROM node:22-alpine
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy workspace config and lockfile first (for caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy package.json of each workspace package (needed for pnpm install)
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Frontend runs from apps/web
WORKDIR /app/apps/web
EXPOSE 4173
CMD ["pnpm", "run", "dev"]