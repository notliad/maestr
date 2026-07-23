<div align="center">
<img width="139" height="146" alt="maestr-logo" src="https://github.com/user-attachments/assets/9aa16bd7-f207-4f69-b4b0-b3484ea5f657" />
</div>

<div align="center">
<strong>Maestr</strong> is a lightweight desktop workspace for AI-assisted software development.<br><br>
Maestr is built for developers who want AI to accelerate their workflow, not take control of it. If you dislike agents making sweeping changes across your codebase without visibility, Maestr keeps you in the conductor's seat. Every edit is transparent, every changed line is reviewable, and every decision is yours to approve. Instead of endless AI chat sessions or blind trust, Maestr focuses on a deliberate workflow: assign a task, watch the agent work, inspect the diff, and decide what gets merged. AI writes the code; you maintain the standards.
</div>


## Features

- Use the AI Agent of your choice.
- Edit your files using Monaco editor.
- Local terminal support.
- Git actions straight from the UI.
- Review and approve your AI Agent code.
- Comment changes and send to your Agent to fix them.
- Customizable editor font, font size, line numbers, diff layout, and color theme.
<div align="center">
<img width="675" height="361" alt="screenshot-2026-07-22_22-58-38" src="https://github.com/user-attachments/assets/ce4583f5-d9ad-4984-8d06-d09d0bdb9ab9" />
<br>
<br>
<img width="675" height="361" alt="screenshot-2026-07-23_14-44-07" src="https://github.com/user-attachments/assets/b48fddfd-dcc0-4d3d-bb5a-0b3c05c965fb" />
<br>
<br>
<img width="675" height="361" alt="screenshot-2026-07-23_15-02-50" src="https://github.com/user-attachments/assets/bccf2315-a7f7-4fa8-8794-839a529dac04" />
</div>



## Tech Stack

- [Tauri v2](https://v2.tauri.app/) and Rust
- React, TypeScript, and Vite
- Monaco Editor and xterm.js
- Zustand for frontend state

## Requirements

- Node.js 20 or later
- pnpm 9 or later
- Rust stable toolchain
- System build dependencies required by Tauri for your platform
- Git, plus any agent CLI you like
## Getting Started

```bash
pnpm install
pnpm tauri dev
```

## Commands

```bash
# Type-check and build the frontend
pnpm build

# Run the desktop app in development
pnpm tauri dev

# Create a production bundle
pnpm tauri build

# Check the Rust backend
cargo check --manifest-path src-tauri/Cargo.toml
```

## Architecture

```text
React UI
  |- Workspace, editor, review, Git, terminal, and agent panels
  |- Tauri commands
Rust backend
  |- Filesystem and workspace state
  |- PTY terminal sessions
  |- Git CLI operations
  |- Agent process integration
System tools
  |- Git, shell, Claude Code, Codex, OpenCode, Pi
```

## Philosophy

Maestr is intentionally simple. It does not aim to replace VS Code, provide an extension marketplace, implement LSP, or connect directly to AI model APIs. The product focus is a fast local workflow: ask an agent, review changes or edit them, and commit.

## Contributing

Issues and pull requests are welcome. Keep changes scoped, use the existing Tauri and React patterns, and run the checks in the commands section before opening a pull request.

## License

Distributed under the [MIT License](LICENSE).
