# VanFolio v1.0.0 — Public Release

**Release Date:** 2026-04-22  
**License:** MIT (Open Source)

## Overview

VanFolio v1.0.0 is the first public release of VanFolio as an open-source markdown desktop application. This release includes all core features, BYOK AI integration, and comprehensive backup capabilities.

## ✨ New in v1.0.0

### Core Features

- **Rich Markdown Editor** — CodeMirror 6 with syntax highlighting, smart quotes, and smart punctuation
- **Live Preview** — Real-time Mermaid diagram rendering, LaTeX math (KaTeX)
- **Multiple Export Formats** — HTML, PDF, PNG, DOCX with professional styling
- **Document Versioning** — Automatic snapshots as you edit, restore any previous version
- **Manual Backup** — Export your entire vault to ZIP for external storage
- **AI Integration** — Bring Your Own Key (BYOK) for Gemini, Claude, or OpenAI
- **Custom Themes** — Botanical, Chronicle, Ivory, Obsidian visual themes
- **Multi-Tab Support** — Work on multiple documents simultaneously
- **Focus Modes** — Zen mode, focus mode, clean prose view for distraction-free writing
- **Vault System** — Organized document storage with automatic metadata tracking
- **Advanced Search** — Find across all documents in your vault
- **Settings Panel** — Customize theme, font, AI provider, backup location
- **10 Languages** — English, Vietnamese, Japanese, Korean, German, Chinese (Simplified), Portuguese (Brazil), French, Russian, Spanish

### AI Features (BYOK)

- Use your own API credentials for Google Gemini, Anthropic Claude, or OpenAI
- In-editor AI commands: `/improve`, `/expand`, `/simplify`, `/summary`, `/outline`
- Keys stored locally — never sent to VanFolio servers
- Streaming responses with real-time display

### Backup & Recovery

- **Document Versioning:** Automatic snapshots on every save
- **Manual Backup:** Export vault with all documents + versions to ZIP
- **Cloud Integration:** Save backups to OneDrive, Google Drive, Dropbox, etc.
- **Restore Workflow:** Unzip and point VanFolio to restored vault folder

## 🎯 What This Release Includes

- ✅ Complete markdown editor with live preview
- ✅ All export formats (HTML, PDF, PNG, DOCX)
- ✅ Document versioning and manual backup
- ✅ BYOK AI integration (Gemini, Claude, OpenAI)
- ✅ 10 language translations
- ✅ 4 custom themes
- ✅ macOS/Linux/Windows support (Windows tested)

## 🚀 Getting Started

### 1. Install

```bash
npm install
```

### 2. Develop

```bash
npm run dev
```

### 3. Build for Release

```bash
npm run build
npm run package
```

Creates:
- Windows: `release/VanFolio Setup 1.0.0.exe` (NSIS installer)
- macOS/Linux: Requires additional electron-builder configuration

### 4. Configure AI (Optional)

**Settings** → **AI Settings** → Enter your API key and select provider:
- Google Gemini ([free tier available](https://aistudio.google.com/app/apikeys))
- Anthropic Claude ([API key](https://console.anthropic.com/account/keys))
- OpenAI ([API key](https://platform.openai.com/account/api-keys))

### 5. Create Backups

**Settings** → **Backup** → **Backup Now** → Choose location

## 📋 Requirements

- **Windows 10+** (Intel/AMD x64)
- **macOS 11+** (Intel or Apple Silicon)
- **Linux:** Ubuntu 18.04+, Fedora 28+, Debian 10+
- **Node.js 18+** (for development/building)

## 📚 Documentation

- **[Setup Guide](docs/SETUP.md)** — Installation, build, packaging
- **[AI Configuration](docs/AI-CONFIG.md)** — BYOK provider setup
- **[Backup Guide](docs/BACKUP.md)** — Manual backup and recovery
- **[Contributing](CONTRIBUTING.md)** — How to contribute

## 🔒 Security & Privacy

- **API Keys:** Stored locally in Electron Store, never uploaded
- **Vault:** Stored on your computer, not synced to servers
- **Backups:** Manual only — you control where backups are saved
- **Open Source:** Source code is fully transparent for audit

## ⚙️ What's NOT Included

The public release intentionally excludes:

- ❌ Automated cloud sync
- ❌ License activation server
- ❌ Automatic scheduled backups (manual only)
- ❌ Built-in update checking (can be configured via env var)
- ❌ Telemetry or usage tracking

## 🐛 Known Limitations

- **Windows Only Installer:** Packager is configured for Windows NSIS installer. macOS (DMG) and Linux (AppImage) require additional setup in `electron.vite.config.ts`.
- **Backup Scheduler Disabled:** Only manual backups are available. Use OS-level backup tools or cloud sync for scheduling.
- **OpenAI Integration:** Code is present but may require additional setup for full integration.

## 📝 License

MIT License — See [LICENSE](LICENSE) for details.

Includes open-source dependencies:
- Electron
- CodeMirror
- Mermaid
- KaTeX
- electron-builder
- And many more (see package.json)

## 🙏 Contributing

Community contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Pull request process
- Reporting issues
- Suggesting features

## 📞 Support

- **Issues:** Open an issue on GitHub
- **Discussions:** GitHub Discussions (coming soon)
- **Docs:** See docs/ folder for detailed guides

## 🎉 Thank You

Thank you for using VanFolio! This is version 1.0.0 — the first public release. We're excited to see what you build with it.

---

**Download VanFolio:** [GitHub Releases](https://github.com/your-org/VanFolio-public/releases)

**Source Code:** [GitHub Repository](https://github.com/your-org/VanFolio-public)
