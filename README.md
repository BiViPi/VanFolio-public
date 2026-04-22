# VanFolio

Professional Markdown desktop app for writers, researchers, and content creators.

## Features

- **Rich Markdown Editor** with live preview
- **Multiple Export Formats** — HTML, PDF, PNG, DOCX
- **Document Versioning** — Automatic snapshots and history
- **AI Integration** — Bring your own Gemini or Anthropic API key
- **Custom Themes** — Botanical, Chronicle, Ivory, Obsidian
- **Advanced Typography** — Smart quotes, math, code highlighting
- **Backup & Recovery** — Manual backup with custom paths
- **Multi-tab Support** — Organize work across files
- **Focus Modes** — Zen mode, focus mode, clean prose view

## Requirements

- **Windows 10+** (Intel x64)
- **Node.js 18+** (for development)

## Quick Start

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

This opens VanFolio in development mode with hot reload.

### Build

```bash
npm run build
```

### Package for Distribution

```bash
npm run package
```

Creates a Windows installer in the `release/` folder.

### Type Check

```bash
npm run typecheck
```

## AI Integration (BYOK)

VanFolio supports **Bring Your Own Key** (BYOK) integration with:

- **Google Gemini** — Via `@google/generative-ai`
- **Anthropic Claude** — Via `@anthropic-ai/sdk`

To use AI features:

1. Open **Settings** (Ctrl+,)
2. Go to **AI Settings**
3. Enter your API key for Gemini or Anthropic
4. Use AI commands in the editor with `/` followed by a command

**Important**: Your API keys are stored locally and never sent to VanFolio servers.

## File Structure

```
VanFolio-public/
├── src/
│   ├── main/          # Electron main process (file I/O, backup, window lifecycle)
│   ├── preload/       # Preload scripts (IPC bridge to renderer)
│   ├── renderer/      # UI components and logic
│   ├── engine/        # Markdown engine, exporters
│   └── shared/        # Types, constants, i18n
├── scripts/           # Build and utility scripts
├── resources/         # App icons, fonts
├── electron.vite.config.ts
├── package.json
└── LICENSE
```

## Development Workflow

1. **Edit source** in `src/`
2. **Type check**: `npm run typecheck`
3. **Build**: `npm run build`
4. **Test**: `npm run dev` and use the app manually
5. **Package**: `npm run package` for distribution

## Localization

Translation files are in `src/shared/i18n/`.

Supported languages: Chinese (Simplified), English, French, German, Japanese, Korean, Portuguese (Brazil), Russian, Spanish, Vietnamese.

## Contributing

See `CONTRIBUTING.md` for guidelines on how to contribute to VanFolio.

## License

MIT License — See `LICENSE` for details.

---

**VanFolio** is an open-source project. Community contributions are welcome!
