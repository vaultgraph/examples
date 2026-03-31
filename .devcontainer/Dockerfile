FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

USER root

ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH=$PATH:/home/node/.local/share/pnpm
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gh \
    gnupg \
  && rm -rf /var/lib/apt/lists/*

# Stripe CLI (apt install per https://docs.stripe.com/stripe-cli/install?install-method=apt)
RUN curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public \
    | gpg --dearmor \
    | tee /usr/share/keyrings/stripe.gpg >/dev/null \
  && echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" \
    | tee /etc/apt/sources.list.d/stripe.list >/dev/null \
  && apt-get update \
  && apt-get install -y --no-install-recommends stripe \
  && rm -rf /var/lib/apt/lists/*

# Playwright browser + OS deps (must run as root). Install browsers into a shared path
# so the non-root `node` user can run tests.
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
  && chown -R node:node "$PLAYWRIGHT_BROWSERS_PATH" \
  && npx -y @playwright/test@1.57.0 install --with-deps chromium

USER node

# Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Tooling pinned for this repo
RUN mkdir -p "$PNPM_HOME" \
  && pnpm config set global-bin-dir "$PNPM_HOME" \
  && pnpm add -g turbo@latest \
  && pnpm add -g mint@latest

