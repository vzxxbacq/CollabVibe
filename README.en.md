> This project is currently in the DEV stage. Features and documentation may change at any time, and the project remains unvalidated; use with caution.

<div align="center">
  <h1>CollabVibe</h1>
  <p>CollabVibe: Empowering teams to co-code with multi-agent AI via IM platforms.</p>
  <p>
    <a href="./README.md"><strong>中文</strong></a> |
    <a href="./README.en.md"><strong>English</strong></a>
  </p>
</div>

## Why CollabVibe

- Collaboration is the real productivity multiplier — participate in and read through the Vibe Coding process together, instead of thousands of lines of code and a single-line AI-generated PR.
- Multi-device support — keep agents running planned steps even from your phone. And no need to worry about the agent getting stuck on an Approve request.
- Unified multi-backend management — connect different API providers and let your team switch flexibly based on cost and performance.

## Supported Backends

| Backend | Transport | Status | Notes |
| --- | --- | --- | --- |
| **`codex`** | `codex` | ✅ Supported | Connected through the Codex protocol / stdio path |
| **`opencode`** | `acp` | ✅ Supported | Connected through ACP |
| **`claude-code`** | `acp` | ✅ Supported | Connected through ACP |
| **`gemini-cli`** | `TBD` | 🗺️ Planned | Not wired in the current codebase |
| **`trae-cli`** | `TBD` | 🗺️ Planned | Not wired in the current codebase |

## Supported IM Platforms

| Platform | Status | Current Capability | Notes |
| --- | --- | --- | --- |
| Feishu / Lark | ✅ Supported | Message events, cards, bot menu, streaming output | Current primary platform |
| Slack | 🚧 In progress | Output adapter and socket foundation exist | App-layer wiring is not complete yet |
| MS Teams | 🗺️ Planned | Not connected | Reserved as a future extension |

## Documentation

- 文档（中文）：https://collab.vzxxbacq.me/
- Documentation (English): https://collab.vzxxbacq.me/en/

## How It Works

1. **Create & Bind** — Create an IM group, invite the Bot, and bind a Git repo + Backend via the init card
2. **Chat to Code** — Send a task description in the group; the Bot creates an Agent Turn and starts coding
3. **Real-time Collaboration** — Agent progress, file changes, and Plan confirmations stream into the group as interactive cards
4. **Multi-thread** — Switch threads via commands to run multiple tasks in parallel
5. **Review & Merge** — Inspect diffs when a Turn finishes; Accept(via Git) or Revert with one click; Branch Merge Review supported

> See the [Quickstart Guide](https://collab.vzxxbacq.me/en/00-overview/quickstart) for full deployment and configuration steps.

## Showcase

<table>
  <tr>
    <td align="center"><img src="docs/public/showcase/agent.png" width="400" /><br/><b>Agent Turn Card</b></td>
    <td align="center"><img src="docs/public/showcase/plan-mode.png" width="400" /><br/><b>Plan Mode</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/public/showcase/multi-agent.png" width="400" /><br/><b>Multi-thread Management</b></td>
    <td align="center"><img src="docs/public/showcase/agent-merge.png" width="400" /><br/><b>Merge Review</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/public/showcase/merge-1.png" width="400" /><br/><b>Conflict Resolution</b></td>
    <td align="center"><img src="docs/public/showcase/backend-manager.png" width="400" /><br/><b>Backend Management</b></td>
  </tr>
</table>

## Quick Start

👉 [View the Quickstart Guide](https://collab.vzxxbacq.me/en/00-overview/quickstart)

## TODO

- [ ] Feishu platform code optimization & file input support
- [ ] Slack platform implementation and testing
- [ ] `gemini-cli` and `trae-cli` backend support
- [ ] Project pull feature (pull latest code from remote)

## Notes

- Runtime logs and local data are kept out of Git.
- If you are changing cross-layer data flow, read `AGENTS.md` first.

## License

Apache-2.0. See [LICENSE](./LICENSE).
