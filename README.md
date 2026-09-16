# NexNote

[![PR checks](https://github.com/Aiden-FE/nexnote/actions/workflows/pr-check.yml/badge.svg)](https://github.com/Aiden-FE/nexnote/actions/workflows/pr-check.yml)

**NexNote is a local-first knowledge base desktop app for people who want their notes, links, Git history, and AI workflow in one place.**

Block editing × Markdown × Wikilinks × Git × controllable AI.

[简体中文](README.zh-CN.md) · [Download the latest release](https://github.com/Aiden-FE/nexnote/releases/latest) · [GitHub](https://github.com/Aiden-FE/nexnote)

## Why NexNote

NexNote keeps the knowledge base on your device as ordinary files in a Git-backed vault. You can edit structured blocks or preserve Markdown source, connect pages with `[[wikilinks]]`, inspect backlinks and graphs, and explicitly ask AI for help without turning every edit into a network request.

## Features

- **Two document formats** — structured block editing and byte-preserving Markdown source views.
- **Markdown views** — source, draggable split view with Live Preview, and a read-only Preview view.
- **Knowledge network** — Wikilinks, backlinks, aliases, tags, graph views, and Chinese-capable full-text search.
- **Git history** — automatic commits, version timelines, and confidence signals derived from revision history.
- **Controllable AI** — OpenAI-compatible providers, local embeddings, explicit AI intent, streaming responses, and permission modes.
- **Extensible desktop app** — sandboxed plugins with explicit capabilities.

## Download

NexNote currently ships desktop builds for:

- macOS — Apple Silicon and Intel
- Windows — x64
- Linux — x64

[Download from GitHub Releases](https://github.com/Aiden-FE/nexnote/releases/latest). See the [FAQ](docs/faq.md) for platform-specific installation notes. Release artifacts may require manual Gatekeeper or SmartScreen confirmation; this project does not claim signing or notarization unless a release explicitly documents it.

## Privacy and control

Your vault remains local and there is no NexNote account or hosted backend. Provider keys are stored in the system keychain. Normal editing, saving, navigation, and selection changes do not create AI requests; AI actions require explicit intent and follow the selected permission mode.

## Development

Prerequisites: Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm dev

pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The repository is a pnpm monorepo:

- `packages/kernel` — editor and Markdown kernel
- `packages/renderer` — Electron renderer and UI
- `packages/main` — Electron main process and IPC
- `packages/shared` — shared types and domain logic
- `packages/plugin-api` — plugin contracts
- `apps/website` — static product website and prototype gallery

Product vocabulary lives in [CONTEXT.md](CONTEXT.md). Architectural decisions live in [docs/adr](docs/adr). See the issue files under `.scratch/nexnote-build/issues/` for the current delivery tickets.

## Contributing

Please run the standard lint, typecheck, test, and build gates before submitting changes. Keep product terminology aligned with `CONTEXT.md`, and add or update an ADR when a decision is difficult to reverse or surprising without context.

## License

The application code is licensed under the [MIT License](LICENSE). The packaged desktop application also includes bundled Git components; their GPLv2 notices and source-offer materials are kept under [`licenses/`](licenses/).
