# pi-plan-mode

Plan mode extension for [pi](https://github.com/badlogic/pi): a toggleable read-only mode that blocks write/edit tools.

## Features

- **Simple toggle**: `/plan` enables/disables plan mode
- **Blocks write/edit tools**: When active, `write` and `edit` tools are completely blocked
- **Smart bash filtering**: Safe commands allowed, mutating commands reviewed by AI
- **Git command protection**: Mutating git commands (`commit`, `push`, `pull`, `merge`, etc.) are blocked
- **Status indicator**: Shows "⚠️ planning" in the UI when active
- **Session persistence**: Plan mode state survives session resume
- **Bash override memory**: Approved commands are remembered within a session

## Quick Start

1. Enable plan mode: `/plan`
2. Explore the codebase with read-only tools
3. Disable plan mode: `/plan` again

## Command Reference

| Command | What it does |
|---|---|
| `/plan` | Toggle plan mode on/off |

## Keyboard Shortcut

Default shortcut: `Ctrl+Shift+P`

Customize in `~/.pi/agent/keybindings.json`:

```json
{
  "plan-mode.toggle": ["ctrl+shift+p"]
}
```

## Safety & Restrictions

In plan mode:
- `write` and `edit` tools are blocked
- Safe bash commands (ls, cat, grep, find, etc.) are allowed
- Potentially mutating bash commands are reviewed by an AI model
- Mutating git commands are blocked
- Commands can be approved manually and remembered for the session

## Installation

```bash
npm install pi-plan-mode
```

Then enable it in pi via your packages/extensions configuration.

## Development

- Type-check: `npm run typecheck`
- Releases: see `docs/releases.md`

## License

MIT
