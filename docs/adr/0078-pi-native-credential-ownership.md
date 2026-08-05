# ADR 0078: Pi-Native Credential Ownership

Status: accepted; Gateway, Docs, and Slack use shared secure provider login with Pi-owned persistence/logout

SF Pi will use Pi provider authentication as the sole credential-mutation seam for SF Docs, SF Slack, and SF LLM Gateway. Pi-native `/login` owns orchestration and persistence, and `/logout` owns removal. A Provider may supply a behavior-proven extension UI for secret entry when the released Pi stock prompt is unsafe; that UI must return a canonical credential to Pi without writing `auth.json` or a second secret store. Integration panels retain non-secret setup, status, diagnostics, credential-source reporting, and native-command handoff. Environment variables remain the automation and headless fallback.

Gateway credentials are user-global Pi credentials. `/login` stores the masked API-key result and a default non-secret gateway URL in Pi's `ApiKeyCredential`; project configuration may override endpoint, model-scope, help, and certificate preferences but cannot accept secrets. ADR 0101's canonical identity is a hard cut: SF Pi does not read, copy, rewrite, or delete credentials and cache entries stored under prior provider identities, and users reconnect once through `/login sf-llm-gateway`.

This supersedes ADR 0007's panel-owned credential mutation because Pi 0.80.8 removed the extension-facing `ModelRegistry.authStorage` path and Pi 0.81 provides provider-owned authentication. [ADR 0087](./0087-secure-native-credential-prompt-prerequisite.md) supplies one shared fixed-mask provider UI for Gateway, Docs, and Slack while retaining Pi as the sole persistence/logout owner. Existing API-key and OAuth-compatible credential shapes plus environment automation remain usable; no extension accesses private auth storage.
