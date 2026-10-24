# tabby-claude-usage

A [Tabby](https://github.com/Eugeny/tabby) plugin that shows your **Claude** (Claude Code / claude.ai plan) and **Codex** (ChatGPT plan) usage limits in a status bar at the bottom of the window. Approach borrowed from [CodexBar](https://github.com/steipete/CodexBar)'s Claude and Codex providers.

The status bar shows one provider at a time: click its label (e.g. `✳ Claude ▾`) to pick another provider, click anywhere else for details.

## Install

In Tabby: Settings → Plugins → search for `claude-usage` → Install, then restart Tabby.

## How it works

### Claude

- Reads Claude Code's OAuth login (read-only): `~/.claude/.credentials.json` (Linux / Windows, or `$CLAUDE_CONFIG_DIR`), and on macOS the Keychain item `Claude Code-credentials`.
- Calls `GET https://api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`).
- If the token has expired, runs `claude -p /status` (throttled to once per 5 min) so the CLI renews its own token. No model request is sent.
- Override the token with the `CLAUDE_USAGE_OAUTH_TOKEN` env var if needed.

### Codex

- Reads the ChatGPT login from `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`, read-only), written by the Codex CLI / app.
- Calls `GET https://chatgpt.com/backend-api/wham/usage` (honors `chatgpt_base_url` in `~/.codex/config.toml`).
- Shows the 5h and weekly windows, model-specific limits (e.g. Codex Spark) and the credits balance.
- Skipped automatically when there is no ChatGPT login. An expired login is not refreshed by the plugin; run `codex` to renew it.

## Settings

Settings → **AI Usage** (stored under `claudeUsage` in Tabby's `config.yaml`):

| Key | Default | |
| --- | --- | --- |
| `enabled` | `true` | Show the status bar |
| `showClaude` / `showCodex` | `true` | Enable each provider |
| `barProvider` | `claude` | Provider shown in the bar (`claude` / `codex`); picked from the label in the bar |
| `align` | `right` | `left` / `right` |
| `refreshInterval` | `5` | Minutes between refreshes |
| `warnThreshold` / `criticalThreshold` | `70` / `90` | Yellow / red at this % |
| `celebrateResets` | `true` | Fireworks when a usage limit resets (preview in Settings → AI Usage) |
| `celebrateMinPercent` | `50` | Only celebrate a reset when usage had reached this % |
| `showBrand`, `showSession`, `showWeekly`, `showModelWeekly`, `showExtraUsage`, `showMeters`, `showResetTime`, `showLastUpdated` | `true` | Toggle individual items |
| `format` | `''` | Custom template; replaces the item toggles when set |

Format placeholders: `{session}` `{session_reset}` `{weekly}` `{weekly_reset}` `{model}` `{model_name}` `{model_reset}` `{extra}` `{plan}` (Claude; also as `{claude_…}`), the same keys with a `codex_` prefix for Codex, and `{updated}`.
Example: `✳ {session} · {weekly} │ ◎ {codex_session} · {codex_weekly}`

## Development

```bash
npm install
npm run build          # tsc -> dist/
npm test               # build + unit tests (node:test)
npm run install-local  # build and copy into Tabby's plugins dir (macOS / Linux / Windows)
TABBY_PLUGINS=$(pwd) /Applications/Tabby.app/Contents/MacOS/Tabby   # run with this checkout
```

## Release

CI ([ci.yml](.github/workflows/ci.yml)) builds and runs the tests on every push to `main` and every pull request (Linux, macOS, Windows).

Releases are published from a local machine (logged in with `npm login`):

```bash
npm run release -- patch   # or minor / major / x.y.z
```

This bumps the version (`chore(release): x.y.z` commit + `vX.Y.Z` tag), runs the tests, publishes to npm (2FA is confirmed in the browser) and pushes the commit and tag.
