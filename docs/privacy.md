---
title: Privacy & telemetry
description: SF Pi telemetry behavior, Pi runtime controls, and aggregate project metrics.
---

# Privacy & telemetry

SF Pi does **not** collect active runtime telemetry. Installed copies do not
send SF Pi usage events, and SF Pi has no telemetry endpoint.

## What SF Pi does not collect

SF Pi does not collect or transmit:

- prompts, assistant responses, tool calls, or tool results;
- file contents, filenames, local paths, Git remotes, or branch names;
- Salesforce org aliases, org IDs, instance URLs, usernames, or emails;
- Slack workspace, channel, user, or message information;
- provider keys, Salesforce tokens, Slack tokens, or environment variables;
- command-level usage from installed copies;
- persistent user, device, or installation identifiers.

## Pi runtime install telemetry

The upstream Pi runtime is separate from SF Pi. Pi can emit an anonymous
install/update version ping after a fresh install or detected update and can
perform a latest-version check.

SF Pi opts users out of Pi's install/update ping by default. On the first session,
it writes `enableInstallTelemetry: false` to Pi's global `settings.json` only
when that key is unset. An explicit user choice is always preserved.

Manage the setting through the normal SF Pi Manager surface:

```text
/sf-pi telemetry status
/sf-pi telemetry on
/sf-pi telemetry off
```

This default intentionally does not:

- disable Pi's latest-version check;
- edit shell profiles or environment variables;
- change which model provider receives user requests.

Pi's latest-version check can be disabled separately with
`PI_SKIP_VERSION_CHECK=1`, or all Pi network behavior can be constrained with
Pi's documented offline mode.

## Aggregate repository metrics

Repository automation archives aggregate GitHub metrics through
[`.github/workflows/metrics-archive.yml`](https://github.com/salesforce/sf-pi/blob/main/.github/workflows/metrics-archive.yml).
This runs on GitHub-hosted infrastructure, not on user machines.

Archived aggregate signals can include:

- repository views and unique visitors;
- repository clones and unique cloners;
- popular referrers and paths;
- release asset download counts.

These metrics measure project discovery and distribution without adding
client-side telemetry.

## Policy for any future active telemetry

If active SF Pi telemetry is ever proposed, it requires a separate
privacy-sensitive design and must be:

1. off by default;
2. documented before release;
3. previewable before an event is sent;
4. easy to disable;
5. free of prompts, responses, tool payloads, paths, org/workspace identifiers,
   customer details, emails, tokens, and credentials;
6. free of persistent identifiers unless users explicitly opt in and can reset
   them.

Until such a feature is explicitly reviewed, documented, and released, assume
SF Pi collects no active runtime telemetry.

## Related controls

- User-facing commands: [`/sf-pi`](./commands.md#manager)
- Security model: [Security model](./security-model.md)
- Public artifact rules: [Public sanitization](./public-sanitization.md)
