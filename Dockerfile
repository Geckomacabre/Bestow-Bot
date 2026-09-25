FROM oven/bun:1-debian

WORKDIR /app

# ffmpeg: all media effects, voice messages, transcription audio prep and safe image decoding.
# yt-dlp: /media download.  libvips/fontconfig/cmake/build-essential: the optional native image addon (`bun run build:native`).
# fonts-noto-color-emoji: emoji in generated images.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates openssl ffmpeg python3 python3-pip \
      libvips-dev libfontconfig1-dev cmake build-essential pkg-config \
      fonts-noto-color-emoji \
    && pip3 install -q --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The native addon is optional: if it fails to build, the image effects that need it are disabled, everything else works.
RUN bun run build:native || echo "native image addon not built"

# Run as an unprivileged user; /app/data holds the database, voice models and uploads (mount a volume there).
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
ENV NODE_ENV=production DB_PATH=/app/data/onyx.db
VOLUME ["/app/data"]
EXPOSE 3000
# No HEALTHCHECK on purpose: the web dashboard only starts when DISCORD_CLIENT_SECRET is set, so probing it would
# mark a perfectly healthy bot as unhealthy. The process exits (and `restart: unless-stopped` restarts it) on fatal errors.

CMD ["bun", "run", "start:production"]
