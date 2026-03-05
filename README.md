# pi-plan-mode

Plan mode extension for [pi](https://github.com/badlogic/pi): a safer exploration/planning mode before execution.

## Inspiration

Inspired by [@juanibiapina/pi-plan](https://github.com/juanibiapina/pi-plan).

## Features

- **Plan mode toggle**: `/plan` (or `Ctrl+Alt+P` after integration)
- **Plan approval**: `/plan:approve` exits plan mode and starts execution with the approved plan
- **Plan cancellation**: `/plan:cancel` exits plan mode without approving
- **Plan resumption**: `/plan:resume <plan>` resumes planning from an existing plan file
- **Restricted tools in plan mode**: `read`, `bash`, `grep`, `find`, `ls`, `edit`, `write`
- **Write protection**: `edit`/`write` allowed for plan file and `/tmp` only
- **AI-assisted bash safety**: LLM evaluates whether commands are exploratory or mutating
- **Plan summary widget**: Shows 2-line summary in the UI during planning
- **Plan file creation**: plans are created under `~/.pi/agent/sessions/plans/`
- **Terraform-style filename strategy**: `<adjective>-<animal>-<rand>.md` (for example `fuzzy-otter-a7k2.md`)
- **Session persistence**: mode + active plan path survive session resume
- **Bash override memory**: approved commands are remembered within a session

## Quick Start

1. Enter plan mode: `/plan` (or `Ctrl+Alt+P`)
2. Explore with safe tools and write your plan
3. Approve and execute: `/plan:approve`

If you want to leave without approving, run `/plan` again.

## Command Reference

| Command | What it does |
|---|---|
| `/plan` | Enter plan mode (create new plan) or exit plan mode |
| `/plan:approve` | Approve plan, exit plan mode, and start execution |
| `/plan:cancel` | Exit plan mode without approving |
| `/plan:resume <plan>` | Resume planning from an existing plan file |

## Safety & Restrictions

In plan mode:
- Bash commands are evaluated by an AI model (exploratory vs. mutating)
- `edit` and `write` are only allowed for the current plan file and `/tmp/`
- Destructive bash commands require user confirmation
- Confirmed commands are remembered for the duration of the session

## Installation

```bash
npm install pi-plan-mode
```

Then enable it in pi via your packages/extensions configuration.

## Development

- Build: `npm run build`
- Clean: `npm run clean`
- Releases: see `docs/releases.md`

## License

MIT
