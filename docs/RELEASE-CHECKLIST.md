# VanFolio v1.0.0 Release Checklist

Use this checklist to prepare VanFolio for GitHub release.

## Pre-Release Code Quality

- [ ] `npm run typecheck` — all files type-safe
- [ ] `npm run build` — production build succeeds
- [ ] No hardcoded credentials in code
- [ ] No console.log statements in production code
- [ ] No unused imports
- [ ] All dependencies listed in package.json
- [ ] License headers on source files (optional but recommended)

## Documentation

- [ ] README.md — up-to-date with features
- [ ] SETUP.md — installation and build guide complete
- [ ] AI-CONFIG.md — BYOK setup guide complete
- [ ] BACKUP.md — backup and recovery guide complete
- [ ] CONTRIBUTING.md — contribution guidelines present
- [ ] LICENSE — MIT license file present
- [ ] RELEASE-NOTES.md — v1.0.0 release notes
- [ ] All docs are grammatically correct and reviewed
- [ ] All external links work (API consoles, GitHub, etc.)

## Code Review

- [ ] Main process (src/main/) — no license activation code
- [ ] Preload (src/preload/) — IPC surface trimmed to public API
- [ ] Renderer (src/renderer/) — no license gates
- [ ] No hardcoded backend URLs (only env-configurable)
- [ ] BYOK AI providers enforced (Gemini, Claude, OpenAI)
- [ ] Backup scheduler disabled (manual only)

## Build & Package Testing

- [ ] Build succeeds: `npm run build`
- [ ] Windows installer created: `npm run package`
- [ ] Installer location: `release/VanFolio Setup 1.0.0.exe`
- [ ] Portable EXE created: `release/VanFolio 1.0.0.exe`
- [ ] Unpacked binaries present: `release/win-unpacked/`

## Manual Testing (Windows)

### Installation
- [ ] Run installer (VanFolio Setup 1.0.0.exe)
- [ ] Select default installation path
- [ ] Complete installation without errors
- [ ] Desktop shortcut created
- [ ] Start menu entry created
- [ ] App launches from shortcut

### First Run
- [ ] App opens without errors
- [ ] Sample document available (or empty vault)
- [ ] All UI elements visible
- [ ] Settings panel opens (Ctrl+,)
- [ ] Help menu accessible

### Editor Features
- [ ] Create new document (Ctrl+N)
- [ ] Type markdown text
- [ ] Preview renders correctly
- [ ] Syntax highlighting works
- [ ] Export to HTML works
- [ ] Export to PDF works
- [ ] Export to PNG works
- [ ] Export to DOCX works

### AI Configuration (Optional)
- [ ] Settings → AI Settings accessible
- [ ] Can paste API key
- [ ] Provider selection works (Gemini, Claude, OpenAI)
- [ ] Save button works
- [ ] Key is stored (can reopen settings and verify)
- [ ] AI commands work in editor (e.g., `/improve`)

### Backup
- [ ] Settings → Backup accessible
- [ ] "Backup Now" button works
- [ ] Can choose backup destination
- [ ] ZIP file created successfully
- [ ] ZIP file can be unzipped manually
- [ ] Backup contains documents and metadata

### Exit & Reinstall
- [ ] Exit app cleanly
- [ ] Uninstall from Control Panel
- [ ] All files removed (except vault if user chose to keep)
- [ ] Reinstall cleanly
- [ ] Second install succeeds

## GitHub Repository Setup

- [ ] Repository created (public)
- [ ] Repository cloned locally
- [ ] .gitignore configured (node_modules, release/, out/, etc.)
- [ ] All source files committed
- [ ] Initial commit message: "Initial commit: VanFolio v1.0.0 public release"
- [ ] Git tags: `git tag v1.0.0 && git push --tags`
- [ ] Main branch protected (if applicable)

## GitHub Release

- [ ] Go to [Releases](https://github.com/your-org/VanFolio-public/releases)
- [ ] Click "Create a new release"
- [ ] **Tag:** v1.0.0
- [ ] **Title:** VanFolio v1.0.0 — Public Release
- [ ] **Description:** Use RELEASE-NOTES.md content
- [ ] **Upload files:**
  - [ ] `VanFolio Setup 1.0.0.exe` (installer)
  - [ ] `VanFolio 1.0.0.exe` (portable)
  - [ ] `RELEASE-NOTES.md` (optional, link instead)
- [ ] Set as "Latest release"
- [ ] **Publish release**

## Release Announcement

- [ ] Write announcement post (Twitter, Reddit, dev.to)
- [ ] Highlight: MIT license, BYOK AI, open-source
- [ ] Include: GitHub link, setup link, download link
- [ ] Share on relevant communities:
  - [ ] r/markdown (Reddit)
  - [ ] r/Windows (Reddit)
  - [ ] dev.to (Article)
  - [ ] Hacker News (if applicable)
  - [ ] Product Hunt (optional)

## Post-Release

- [ ] Monitor GitHub issues for bugs
- [ ] Respond to early feedback
- [ ] Create GitHub Discussions (optional)
- [ ] Enable GitHub Pages for docs (optional)
- [ ] Set up GitHub Actions for CI/CD (optional)

## Version Bumping (For Future Releases)

When ready for v1.0.1 or v1.1.0:

- [ ] Update version in package.json
- [ ] Update version in RELEASE-NOTES.md
- [ ] Commit: `git commit -m "chore: bump version to v1.0.1"`
- [ ] Tag: `git tag v1.0.1`
- [ ] Build and package
- [ ] Create GitHub release with new version

---

**Release Manager Notes:**

- All items should be completed before publishing to GitHub
- Manual testing is critical — test on clean Windows install if possible
- Verify installer UX (paths, shortcuts, uninstall)
- Check that documentation links are correct (update GitHub org/repo name)
- Consider having a beta tester group review before public release

**Estimated Time:** 2-3 hours (build + testing + GitHub setup)

**Questions?** See [SETUP.md](SETUP.md), [RELEASE-NOTES.md](RELEASE-NOTES.md), or GitHub Issues.
