# ADR 0101: Canonical Gateway Identity Uses `sf-llm-gateway`

Status: accepted

The extension, Pi Provider, command, status key, configuration filename, package identity, and documentation use the single canonical id `sf-llm-gateway`. This is an intentional hard cut: Pi-owned credentials and cached catalogs stored under prior provider identities are not copied, read, or deleted, so existing users must run `/login sf-llm-gateway` once and refresh discovery. Startup repairs stale suffixed gateway references in `defaultProvider`, `defaultModel`, and `enabledModels` through a generic prefix rule without retaining an exact retired identifier; unrelated settings remain untouched.
