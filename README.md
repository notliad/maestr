<div align="center">
<img width="139" height="146" alt="maestr-logo" src="https://github.com/user-attachments/assets/9aa16bd7-f207-4f69-b4b0-b3484ea5f657" />
</div>

Maestr is a lightweight desktop workspace for AI-assisted software development.

The app runs locally with Tauri and uses tools already installed on the machine, including Git, Claude Code, Codex, OpenCode, and Pi. It does not call AI provider APIs directly.

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

<img width="675" height="361" alt="screenshot-2026-07-22_22-59-33" src="https://github.com/user-attachments/assets/271d930b-90cd-4593-9bc2-1a833eeed96d" />
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
