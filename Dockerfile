FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1 AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/panel.db BACKUP_DIR=/data/backups
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/cli ./cli
COPY --from=build /app/src ./src
RUN mkdir /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", ".output/server/index.mjs"]
