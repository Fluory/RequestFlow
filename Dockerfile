# TS app image (ADR-0001 D11): one image, two commands.
#   web    – Next.js standalone server (default CMD)
#   worker – `node /ops/node_modules/.bin/tsx src/worker.ts` (working dir /ops)
#   setup  – `node /ops/node_modules/.bin/tsx src/setup.ts` (migrations + bucket, explicit deploy step)
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Worker and deploy step run the TypeScript sources with tsx from a separate production install.
COPY --from=prod-deps --chown=node:node /app/node_modules /ops/node_modules
COPY --chown=node:node package.json tsconfig.json /ops/
COPY --chown=node:node src /ops/src
USER node
EXPOSE 3000
CMD ["node", "server.js"]
