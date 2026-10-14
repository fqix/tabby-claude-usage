# tabby-claude-usage

A [Tabby](https://github.com/Eugeny/tabby) plugin that shows your Claude subscription usage (Claude Code / claude.ai plan limits) in a status bar at the bottom of the window. Approach borrowed from [CodexBar](https://github.com/steipete/CodexBar)'s Claude provider.

## How it works

- Reads Claude Code's OAuth login (read-only): `~/.claude/.credentials.json` (Linux / Windows, or `$CLAUDE_CONFIG_DIR`), and on macOS the Keychain item `Claude Code-credentials`.
- Calls `GET https://api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`).
- If the token has expired, runs `claude -p /status` (throttled to once per 5 min) so the CLI renews its own token. No model request is sent.
- Override the token with the `CLAUDE_USAGE_OAUTH_TOKEN` env var if needed.

## Settings

Settings → **Claude Usage** (stored under `claudeUsage` in Tabby's `config.yaml`):

| Key | Default | |
| --- | --- | --- |
| `enabled` | `true` | Show the status bar |
| `align` | `right` | `left` / `right` |
| `refreshInterval` | `5` | Minutes between refreshes |
| `warnThreshold` / `criticalThreshold` | `70` / `90` | Yellow / red at this % |
| `showBrand`, `showSession`, `showWeekly`, `showModelWeekly`, `showExtraUsage`, `showMeters`, `showResetTime`, `showLastUpdated` | `true` | Toggle individual items |
| `format` | `''` | Custom template; replaces the item toggles when set |

Format placeholders: `{session}` `{session_reset}` `{weekly}` `{weekly_reset}` `{model}` `{model_name}` `{model_reset}` `{extra}` `{plan}` `{updated}`.
Example: `✳ 5h {session} ↻{session_reset} · 7d {weekly}`

## Development

```bash
npm install
npm run build          # tsc -> dist/
npm run install-local  # build and copy into Tabby's plugins dir (macOS / Linux / Windows)
TABBY_PLUGINS=$(pwd) /Applications/Tabby.app/Contents/MacOS/Tabby   # run with this checkout
```
