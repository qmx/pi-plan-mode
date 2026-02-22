# pi-plan-mode

Plan mode extension for [pi](https://github.com/badlogic/pi) - a read-only exploration mode for safe code analysis and planning.

## Inspiration

This extension was inspired by [@juanibiapina/pi-plan](https://github.com/juanibiapina/pi-plan).

## Features

- **Plan mode toggle**: Use `/plan` command or `Ctrl+Alt+P` to toggle plan mode
- **Read-only exploration**: In plan mode, only read tools are available: `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`
- **Plan file editing**: `edit` and `write` tools work for the plan file only
- **Auto-created plan file**: Plans are automatically saved to `~/.pi/agent/plans/<session>/<name>.md`
- **User-controlled exit**: Only the user can exit plan mode (LLM cannot exit)
- **Session persistence**: Plan mode state survives session restarts

## Usage

1. Enter plan mode: `/plan` or press `Ctrl+Alt+P`
2. Explore the codebase using read-only tools
3. Edit the plan file using `edit`/`write` tools (only allowed for the plan file)
4. Exit plan mode: `/plan` again
5. Execute your plan with full tools available

## Installation

```bash
npm install pi-plan-mode
```

Or use pi's built-in package manager to install from npm or git.

## License

MIT
