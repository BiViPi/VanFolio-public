# Contributing to VanFolio

Thank you for your interest in contributing to VanFolio! This guide outlines the process for contributing code, bug reports, and feature requests.

## Code of Conduct

Treat all contributors with respect and maintain a professional, inclusive environment.

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/vanfolio/vanfolio/issues) to avoid duplicates
2. Create a detailed issue with:
   - OS and VanFolio version
   - Steps to reproduce
   - Expected vs. actual behavior
   - Screenshots if relevant

### Suggesting Features

1. Check [discussions](https://github.com/vanfolio/vanfolio/discussions) for existing ideas
2. Open an issue with the `enhancement` label
3. Describe the use case and how it benefits users

### Code Contributions

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create a branch** for your feature:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Develop** and test:
   ```bash
   npm run dev
   npm run typecheck
   ```
5. **Commit** with clear messages:
   ```
   feat: add spell-check integration
   
   - Implement spellcheck UI in settings
   - Add i18n for spell-check strings
   ```
6. **Push** to your fork
7. **Create a Pull Request** with:
   - Clear description of changes
   - Reference to related issues
   - Testing evidence (dev mode screenshots, etc.)

## Development Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Type check
npm run typecheck

# Build production
npm run build

# Package installer
npm run package
```

## Code Standards

- **TypeScript**: All code must be typed
- **Format**: Follow existing code style
- **Comments**: Only add comments for non-obvious logic
- **Tests**: Manual testing in dev mode is sufficient; automated tests are not yet required

## What We're Looking For

- Bug fixes
- Performance improvements
- UI/UX enhancements
- i18n translations
- Documentation improvements
- Feature additions aligned with the project vision

## What We Cannot Accept

- Features dependent on closed-source backends
- Hardcoded API keys or credentials
- Changes that break existing workflows without migration paths

## Questions?

Open a discussion on [GitHub Discussions](https://github.com/vanfolio/vanfolio/discussions) or contact the maintainers.

---

Happy coding! 🚀
