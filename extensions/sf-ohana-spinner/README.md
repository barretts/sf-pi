# SF Ohana Spinner

## What It Does

Displays a configurable working indicator while the LLM is thinking. Uses Pi's
built-in `ctx.ui.setWorkingIndicator()` API. Every mode starts with an explicit
`Thinking…` state so users can tell pi is still working before reading the
personality text.

Modes:

- **Ohana** — `Thinking…` plus Salesforce-themed rotating ecosystem messages.
- **Calm** — `Thinking…` with only the leading spinner glyph animated.

Ohana remains the default for existing users. Users can switch to Calm from the
`/sf-pi` extension manager settings panel.

## Key Architecture Decisions

### 1. Soft pastel rainbow colors

Muted tones that work on dark terminal backgrounds. Bright saturated rainbow
would be unreadable on many terminal themes.

### 2. 150ms animation interval

Fast enough for smooth rainbow flow, slow enough to not burn CPU on terminal
repaints.

### 3. 5s message rotation in Ohana mode only

Keeps Ohana mode entertaining without changing Calm mode's stable text. Too
fast and users can't read the jokes; too slow and it gets stale. The message
catalog is intentionally small and curated: short, public-safe,
product/platform-oriented lines only.

### 4. One mode setting

The only preference is `sfPi.ohanaSpinner.mode` with `ohana` as the default and
`calm` as the quieter option. More knobs would make the spinner harder to
understand than the problem requires. The Manager settings page saves in place,
then shows a reload-required hint because the active working indicator is
installed during `session_start`.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-ohana-spinner/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## Troubleshooting

**Spinner colors look dim, washed-out, or garbled:**
The palette is deliberately muted to stay readable on dark terminal
themes. If the colors look wrong, your terminal may be remapping ANSI
colors aggressively (some Powerlevel10k + terminal-theme combinations do
this). Switch to Calm mode from `/sf-pi`, or disable the extension with
`/sf-pi disable sf-ohana-spinner` if it's more distracting than helpful — Pi's
default spinner takes over.

**No spinner appears during LLM thinking:**
Pi only shows the working indicator while a turn is streaming. If the
turn never reaches the streaming phase (auth failure, model not
resolved, etc.), the spinner stays silent by design. When `NO_COLOR` is set,
Ohana keeps the same animated glyphs and messages without ANSI colors.
