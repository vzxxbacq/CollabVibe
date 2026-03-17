<div align="center">
  <img src="docs/public/placeholders/guide-image-placeholder.svg" alt="CollabVibe logo placeholder" width="240" />
  <h1>CollabVibe</h1>
  <p>CollabVibe: Empowering teams to co-code with multi-agent AI via IM platforms.</p>
  <p>
    <a href="./README.md"><strong>English</strong></a> |
    <a href="./README.zh-CN.md"><strong>中文</strong></a>
  </p>
</div>

## Why CollabVibe

- Collaboration is the highest-leverage interface for getting real work done, and chat is where teams already coordinate.
- Human-in-the-loop turns agent execution from a risky automation toy into a compounding system where `1 + 1` can outperform `10`.
- It builds on the permissions, reach, notification loops, and habits your organization already has inside workplace collaboration platforms.
- It unifies multiple models behind one operational surface so teams can make full use of existing accounts, providers, and budget pools.
- It keeps agent orchestration available across devices, so you can direct work effectively even when you are away from your computer.

## Supported Backends

<table>
  <thead>
    <tr>
      <th>Backend</th>
      <th>Transport</th>
      <th>Access Method</th>
      <th>Status</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2"><strong><code>codex</code></strong></td>
      <td rowspan="2"><code>codex</code></td>
      <td>API</td>
      <td>✅ Supported</td>
      <td>Connected through the Codex protocol / stdio path</td>
    </tr>
    <tr>
      <td>RefreshToken</td>
      <td>🗺️ Planned</td>
      <td>RefreshToken-based platform integration is on the roadmap</td>
    </tr>
    <tr>
      <td><strong><code>opencode</code></strong></td>
      <td><code>acp</code></td>
      <td>API</td>
      <td>✅ Supported</td>
      <td>Connected through ACP</td>
    </tr>
    <tr>
      <td rowspan="2"><strong><code>claude-code</code></strong></td>
      <td rowspan="2"><code>acp</code></td>
      <td>API</td>
      <td>✅ Supported</td>
      <td>Connected through ACP</td>
    </tr>
    <tr>
      <td>RefreshToken</td>
      <td>🗺️ Planned</td>
      <td>RefreshToken-based platform integration is on the roadmap</td>
    </tr>
    <tr>
      <td><strong><code>github-copilot</code></strong></td>
      <td><code>TBD</code></td>
      <td>RefreshToken</td>
      <td>🗺️ Planned</td>
      <td>Not wired in the current codebase</td>
    </tr>
    <tr>
      <td><strong><code>gemini-cli</code></strong></td>
      <td><code>TBD</code></td>
      <td>RefreshToken</td>
      <td>🗺️ Planned</td>
      <td>Not wired in the current codebase</td>
    </tr>
    <tr>
      <td><strong><code>trae-cli</code></strong></td>
      <td><code>TBD</code></td>
      <td>RefreshToken</td>
      <td>🗺️ Planned</td>
      <td>Not wired in the current codebase</td>
    </tr>
  </tbody>
</table>

## Supported IM Platforms

| Platform | Status | Current Capability | Notes |
| --- | --- | --- | --- |
| Feishu / Lark | ✅ Supported | Message events, cards, bot menu, streaming output | Current primary platform |
| Slack | 🚧 In progress | Output adapter and socket foundation exist | App-layer wiring is not complete yet |
| MS Teams | 🗺️ Planned | Not connected | Reserved as a future extension |

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Recommended `.env` baseline:

```dotenv
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx

CODEX_APP_SERVER_CMD=codex app-server
CODEX_WORKSPACE_CWD=/path/to/workspace
SYS_ADMIN_USER_IDS=ou_xxxxxxxxxx

# UI language for project-level i18n
# supported: zh-CN | en-US
APP_LOCALE=zh-CN
```

Minimum commonly used settings:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `CODEX_APP_SERVER_CMD`
- `CODEX_WORKSPACE_CWD`
- `SYS_ADMIN_USER_IDS`
- `APP_LOCALE` (`zh-CN` or `en-US`, defaults to `zh-CN`)

### 3. Run

```bash
npm run start:dev
```

![Quickstart video placeholder](docs/public/placeholders/guide-video-placeholder.svg)

Placeholder: replace with a short walkthrough video cover that shows local boot, Feishu trigger, and streaming output.

## Notes

- Runtime logs and local data are kept out of Git.
- If you are changing cross-layer data flow, read `AGENTS.md` first.
- Full product, architecture, and operations docs live under `docs/`.
