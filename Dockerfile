FROM oven/bun:alpine
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --ignore-scripts --production
COPY src src
COPY scripts scripts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 6680
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "start"]
