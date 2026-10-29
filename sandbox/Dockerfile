# Witness sandbox image for S41 pr-review-judgment (PLAN K18/K19, M2).
#
# NEVER BUILT. Written in Dirty Mode as source only. No digest exists yet: the image is built and its digest is
# recorded at activation (docs/DEFERRED-VALIDATION.md DV-12), and only the digest-pinned reference
# (name@sha256:<64 hex>) is ever passed to `docker run --pull never` (src/core/sandbox/argv.ts).
#
# Build context is this directory:   docker build -t s41-prj-witness:0.1.0 sandbox
#
# Network is used only while building (npm installs exact pinned versions). At run time the container has
# --network none and nothing in it fetches: vitest and typescript are already in /opt/witness/node_modules.
# At activation, also replace the base tag below with its digest (FROM node:22.12.0-bookworm-slim@sha256:<digest>).

FROM node:22.12.0-bookworm-slim

ENV NODE_ENV=test \
    CI=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /opt/witness

# Exact versions (match package.json: vitest ^4.0.8, typescript ~5.9.3, @types/node ^22.18.0). @types/node is
# only there so the type references inside vitest's own .d.ts files resolve during the in-image `tsc --noEmit`;
# the task tsconfig still sets `types: []`. No lockfile exists yet (DV-01); the resolved transitive tree is
# captured by the image digest, which is what the probe receipt pins.
RUN printf '{"name":"s41-witness","private":true,"type":"module"}\n' > package.json \
 && npm install --no-save --no-package-lock vitest@4.0.8 typescript@5.9.3 @types/node@22.18.0 \
 && npm cache clean --force

COPY entry.mjs /opt/witness/entry.mjs

# Non-root runtime user 10001:10001 (matches --user 10001:10001 in the docker argv). /opt/witness is read-only to it.
RUN groupadd --system --gid 10001 witness \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin witness \
 && chmod -R a-w /opt/witness \
 && mkdir -p /work \
 && chown 10001:10001 /work

USER 10001:10001
WORKDIR /work

# argv.ts always passes --entrypoint node and the entry arguments explicitly; these defaults only document them.
ENTRYPOINT ["node", "/opt/witness/entry.mjs"]
CMD ["/in/request.json", "/work"]
