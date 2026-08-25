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

FROM base AS backend
COPY --from=build /prod/backend ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS frontend
COPY --from=build /prod/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
