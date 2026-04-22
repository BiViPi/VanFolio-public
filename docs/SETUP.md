# VanFolio — Setup & Build Guide

This guide covers building VanFolio from source on Windows, macOS, and Linux.

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **npm 9+** (installed with Node.js)
- **Git** (optional, for cloning)

### Platform-Specific

- **Windows 10+**: Intel/AMD x64
- **macOS 11+**: Intel or Apple Silicon (M1/M2/M3)
- **Linux**: Ubuntu 18.04+, Fedora 28+, Debian 10+ (x64 or ARM)

## Installation

### 1. Clone or Download

```bash
# Clone the repository
git clone https://github.com/your-org/VanFolio-public.git
cd VanFolio-public

# Or download and extract the zip file
cd VanFolio-public
```

### 2. Install Dependencies

```bash
npm install
```

This installs all required packages (Electron, CodeMirror, Mermaid, exporters, etc.).

## Development

### Start Dev Server

```bash
npm run dev
```

This launches VanFolio in development mode with:
- Live reload on file changes
- DevTools enabled (F12)
- Hot module replacement (HMR) for renderer

Open the app window and start editing. Changes are reflected instantly.

### Type Check

```bash
npm run typecheck
```

Verifies TypeScript types are correct. Run before committing.

### Build

```bash
npm run build
```

Compiles the app into production bundles in `out/`:
- `out/main/main.js` — Electron main process
- `out/preload/preload.js` — Preload script
- `out/renderer/` — React frontend

## Packaging

### Create Windows Installer

```bash
npm run package
```

Generates:
- `release/VanFolio Setup 1.0.0.exe` — NSIS installer
- `release/VanFolio 1.0.0.exe` — Portable executable
- `release/win-unpacked/` — Unpacked binaries

### Create macOS or Linux Package

Edit `electron.vite.config.ts` to add targets (currently Windows only):

```typescript
// For macOS DMG
"mac": {
  "target": ["dmg", "zip"]
}

// For Linux AppImage
"linux": {
  "target": ["AppImage"]
}
```

Then run:

```bash
npm run package
```

## AI Configuration (Bring Your Own Key)

VanFolio supports BYOK (Bring Your Own Key) integration. Users must provide their own API keys.

### Google Gemini

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikeys)
2. Create an API key
3. In VanFolio: **Settings** → **AI Settings** → Paste key
4. Select **Provider: Gemini**

### Anthropic Claude

1. Go to [Anthropic Console](https://console.anthropic.com/account/keys)
2. Create an API key
3. In VanFolio: **Settings** → **AI Settings** → Paste key
4. Select **Provider: Anthropic**

**Keys are stored locally in secure Electron Store and never sent to external servers.**

## Manual Backup

VanFolio stores documents in a vault folder. To backup:

1. **Settings** → **Backup**
2. Click **Backup Now** to create a snapshot
3. Choose backup destination on your computer

Backups are **manual only** — set your own schedule via OS backup tools if desired.

## Troubleshooting

### npm install fails

```bash
# Clear npm cache
npm cache clean --force

# Reinstall
npm install
```

### Build fails

```bash
# Check Node.js version
node --version  # Should be 18+

# Verify TypeScript
npm run typecheck

# Rebuild native modules
npm install --save-dev electron-rebuild
npx electron-rebuild
```

### App won't start

1. Check console for errors: `npm run dev` and read output
2. Verify `out/main/main.js` exists: `npm run build`
3. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`

### Packager errors

If `npm run package` fails:

```bash
# Ensure build is fresh
npm run build

# Try packaging again
npm run package
```

## Environment Variables

Optional build-time configuration:

```bash
# Set update feed URL (default: https://vanfolio.app/version.json)
set VANFOLIO_UPDATE_FEED_URL=https://example.com/version.json

# Set landing page URL
set VANFOLIO_LANDING_URL=https://example.com

# Set support URL
set VANFOLIO_SUPPORT_URL=https://example.com/support

npm run build
```

## File Structure

```
VanFolio-public/
├── src/
│   ├── main/             # Electron main process
│   │   ├── main.ts       # Entry point
│   │   ├── aiManager.ts  # AI integration (BYOK)
│   │   ├── fileManager.ts
│   │   ├── windowManager.ts
│   │   ├── backupManager.ts
│   │   ├── securityManager.ts
│   │   └── ...
│   ├── preload/
│   │   └── preload.ts    # IPC bridge (security boundary)
│   ├── renderer/         # React UI
│   │   ├── main.tsx      # React entry
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── styles/
│   ├── engine/           # Markdown & export
│   │   ├── MarkdownEngine.ts
│   │   ├── DocxExporter.ts
│   │   ├── PdfExporter.ts
│   │   └── ...
│   └── shared/           # Types, constants, i18n
│       ├── types.ts
│       ├── constants.ts
│       └── i18n/
├── out/                  # Build output (generated)
├── release/              # Package output (generated)
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
└── LICENSE
```

## Contributing

See `CONTRIBUTING.md` for development guidelines, code style, and pull request process.

## License

MIT — See `LICENSE` for details.

---

**Need help?** Open an issue on GitHub or check the troubleshooting section above.
