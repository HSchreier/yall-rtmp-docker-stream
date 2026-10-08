# Multi-stage build — docs/TECHNICAL.md §RTMP relay, Build order step 1.
#
# Three stages: compile nginx + nginx-rtmp-module from source (stock nginx
# doesn't ship the module), compile the Bun sidecar to a standalone binary,
# then a minimal runtime image with only what both actually need at
# execution time — no compilers, no -dev headers, no Bun runtime/
# node_modules (the whole point of `bun build --compile`).
#
# Debian (glibc), not Alpine, in every stage — resolves the "glibc vs musl"
# open question in docs/TECHNICAL.md in favor of glibc: Bun's compiled
# output has historically been more mature there, and staying on one C
# library end-to-end avoids a second, separate compatibility question for
# the nginx build.

# ---- Stage 1: nginx + nginx-rtmp-module -------------------------------
FROM debian:bookworm-slim AS nginx-build

# Pinned, not "latest" — reproducible builds, and each version checked
# against a real source before pinning:
#   - nginx 1.30.5: current stable per nginx.org/en/download.html.
#   - nginx-rtmp-module v1.2.2: latest tag on arut/nginx-rtmp-module
#     (confirmed via `gh api repos/arut/nginx-rtmp-module/tags`), last
#     pushed Dec 2024 — unmaintained but not archived, still the
#     reference implementation.
ARG NGINX_VERSION=1.30.5
ARG NGINX_RTMP_MODULE_VERSION=1.2.2

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libpcre3-dev \
      zlib1g-dev \
      libssl-dev \
      ca-certificates \
      curl \
      git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" | tar xz \
    && git clone --branch "v${NGINX_RTMP_MODULE_VERSION}" --depth 1 \
       https://github.com/arut/nginx-rtmp-module.git

# --with-cc-opt="-Wno-error=implicit-fallthrough" — not a cosmetic flag.
# nginx-rtmp-module has a known, open, unfixed compile failure against
# recent nginx/GCC (arut/nginx-rtmp-module#1517, #1569, #1579): an
# implicit-fallthrough warning in ngx_rtmp_eval.c gets promoted to a hard
# error under nginx's own default -Werror. Scoped to that one warning, not
# a blanket -Werror disable — see docs/TECHNICAL.md §RTMP relay.
RUN cd "nginx-${NGINX_VERSION}" \
    && ./configure \
         --prefix=/usr/local/nginx \
         --with-cc-opt="-Wno-error=implicit-fallthrough" \
         --add-module=/build/nginx-rtmp-module \
    && make -j"$(nproc)" \
    && make install

# Build-time self-test, not deferred to a smoke test after the image
# exists: render the real template with dummy-but-valid values and ask
# nginx itself to validate it. Catches a broken module compile *or* a
# broken template in the same `docker build`, before either reaches a
# running container.
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY docker/nginx.conf.template /tmp/nginx.conf.template
RUN HTTP_PORT=8080 \
    OUT_QUEUE=256 \
    OUT_CORK=32 \
    RELAY_BUFFER_MS=5000 \
    MIXCLOUD_PUSH_LINE="" \
    YOUTUBE_PUSH_LINE="" \
    TWITCH_PUSH_LINE="" \
    envsubst < /tmp/nginx.conf.template > /tmp/nginx.conf.test \
    && /usr/local/nginx/sbin/nginx -t -c /tmp/nginx.conf.test

# ---- Stage 2: Bun sidecar ----------------------------------------------
FROM oven/bun:1 AS sidecar-build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets
# NginxConfigRenderer imports docker/nginx.conf.template as a build-time
# text asset (`with { type: "text" }`) — needed here too, not just in the
# nginx-build stage's own copy below: that one only feeds the build-time
# `nginx -t` self-test, this one is what actually gets embedded into the
# compiled sidecar binary NginxProcessManager runs at startup.
COPY docker ./docker

# Typecheck is a build gate, not a separate CI-only step — a broken build
# never produces an image to even smoke-test.
RUN bunx tsc --noEmit
RUN bun build ./src/index.ts --compile --outfile sidecar

# ---- Stage 3: runtime ----------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpcre3 \
      zlib1g \
      libssl3 \
      ca-certificates \
      gettext-base \
      curl \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# Install bun for runtime in /usr/local/bin (accessible to non-root user)
RUN curl -fsSL https://bun.sh/install | bash && \
    cp /root/.bun/bin/bun /usr/local/bin/bun && \
    chmod +x /usr/local/bin/bun

COPY --from=nginx-build /usr/local/nginx /usr/local/nginx
# COPY --from=sidecar-build /app/sidecar /app/sidecar  # Skip binary for now, use bun run for error visibility
COPY --from=sidecar-build /app/src /app/src
COPY --from=sidecar-build /app/package.json /app/bun.lock /app/
COPY --from=sidecar-build /app/node_modules /app/node_modules
COPY docker/nginx.conf.template /app/docker/nginx.conf.template
COPY docker/server.sh /app/server.sh

RUN chmod +x /app/server.sh

# Security: Create non-root user for sidecar (principle of least privilege)
# Also pre-create .logs directory so non-root user can write to it
RUN groupadd -r sidecar && useradd -r -g sidecar sidecar && \
    mkdir -p /app/.logs && \
    chown -R sidecar:sidecar /app

ENV PATH="/usr/local/nginx/sbin:${PATH}"
ENV HTTP_PORT=8080

EXPOSE 8080 1935

# Hits the sidecar's own /health, not nginx — matches docs/TECHNICAL.md's
# Memory discipline note that Docker's HEALTHCHECK is the only
# interval-driven thing touching this system from outside the process.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" || exit 1

WORKDIR /app

# Drop to non-root user for security
USER sidecar

CMD ["/app/server.sh"]
