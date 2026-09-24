FROM oven/bun:1-debian

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    libvips-dev \
    libfontconfig1-dev \
    libzxing-dev \
    cmake \
    build-essential \
    python3 \
    python3-pip \
    pkg-config \
    ffmpeg \
    && pip3 install -q --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build:native

CMD ["bun", "run", "start:production"]
