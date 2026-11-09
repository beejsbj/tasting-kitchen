# Film toolchain v1: the one image every model and skill layer of a film Recipe
# works in, and that Kitchen validates and plays back with. Every input is
# pinned in toolchain.json; tests/taste-toolchain.test.mjs keeps them in step.
# Build from the repository root:
#   node scripts/build-toolchain.mjs film-v1   (labels the image with its toolchain hash)
FROM docker.io/library/node:22-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6

ARG DEBIAN_SNAPSHOT=20261101T000000Z
ARG BUN_VERSION=1.4.4
COPY catalog/toolchains/film/toolchain.json /opt/kitchen/toolchain.json

# Debian packages come from one dated snapshot, so a rebuild resolves the same versions.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
 && printf '%s\n' \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT} trixie main" \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT} trixie-updates main" \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT} trixie-security main" \
    > /etc/apt/sources.list \
 && apt-get -o Acquire::Retries=5 update \
 && apt-get install -y --no-install-recommends $(node -p "require('/opt/kitchen/toolchain.json').packages.join(' ')") \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "bun@${BUN_VERSION}" \
 && npm cache clean --force

COPY catalog/toolchains/film/install-engine.mjs /opt/kitchen/install-engine.mjs
COPY catalog/toolchains/film/engine/brand.ts /opt/kitchen/brand.ts
COPY catalog/skills/lyric-music-video/files /opt/kitchen/lyric-skill
RUN node /opt/kitchen/install-engine.mjs /opt/kitchen/toolchain.json /opt/kitchen/lyric-skill /opt/kitchen/brand.ts /opt/kitchen/engine \
 && rm -rf /opt/kitchen/lyric-skill \
 && chmod -R a+rX /opt/kitchen \
 && { node --version; python3 --version; chromium --version; ffmpeg -version | head -1; bun --version; } > /opt/kitchen/versions.txt

ENV CHROME_PATH=/usr/bin/chromium \
    RENDER_CPU=1 \
    HOME=/tmp \
    KITCHEN_ENGINE=/opt/kitchen/engine
WORKDIR /work
