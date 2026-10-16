# syntax=docker/dockerfile:1
#
# Image for self-hosting (Dokploy on a VPS). Vercel ignores this file.
# Built by GitHub Actions (.github/workflows/docker.yml), never on the server.
#
#   runner  (default) small production image: the Next.js standalone server
#   tools             full source + dependencies, for one-off scripts (pnpm db:indexes, admin:create, ...)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
# mongodb-memory-server downloads a test database program on install; the image does not need it.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Public settings are baked into the pages at build time. Secrets are NOT needed here.
ARG NEXT_PUBLIC_SIGNUP_ENABLED
ENV NEXT_PUBLIC_SIGNUP_ENABLED=$NEXT_PUBLIC_SIGNUP_ENABLED \
    DOCKER_BUILD=1
RUN pnpm build

FROM build AS tools
ENV NODE_ENV=production
CMD ["sh"]

FROM node:22-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
