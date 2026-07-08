FROM oven/bun:alpine
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --ignore-scripts --production
COPY src src
COPY scripts scripts
ENV NODE_ENV=production
EXPOSE 6680
CMD ["bun", "start"]
