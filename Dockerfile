FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter backend build
RUN pnpm --filter frontend build
RUN pnpm --filter backend deploy --prod --legacy /prod/backend
RUN pnpm --filter frontend deploy --prod --legacy /prod/frontend

# Dev Containers / local development only — never used for the deployed
# image. Same install as `build` above (full workspace, so backend's
# devDependencies like ts-node-dev are present) but skips the
# build/deploy steps and runs the TS source directly with hot reload.
# The devcontainer bind-mounts the repo over this at runtime; this layer
# just needs to exist so `pnpm install` has already happened in the image.
FROM base AS backend-dev
# curl is dev-convenience only — for hitting the API by hand while
# testing. Deliberately scoped to this stage alone: `backend` (the
# production target below) builds `FROM base` independently and never
# sees this layer, so the deployed image stays minimal.
RUN apk add --no-cache curl
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "backend", "dev"]

FROM base AS backend
COPY --from=build /prod/backend ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS frontend
COPY --from=build /prod/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
