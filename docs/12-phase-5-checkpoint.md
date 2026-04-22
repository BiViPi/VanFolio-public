# Phase 5: Runtime Verification — Checkpoint

**Status:** VERIFIED FOR BASIC RUNTIME SMOKE  
**Date:** 2026-04-22

## Scope

Phase 5 verifies that the extracted public app can boot with the real renderer graph enabled and that the retained public IPC/runtime contract is internally consistent.

This checkpoint is intentionally narrower than “full QA”.

## Fixes Required During Review

One real runtime bug was found and fixed during Phase 5 review:

- `src/renderer/titlebarMenu.ts` called `window.vanfolioAPI.checkForUpdates(...)`
- but `src/preload/preload.ts` did not expose `checkForUpdates`
- and `src/renderer/global.d.ts` did not declare it

This is now fixed.

## What Was Verified

### Build and Type Safety

Ran in `E:\Work\VanFolio-public`:

```bash
npm run typecheck
npm run build
```

Result:
- PASS

### Runtime Smoke

Ran:

```bash
npm run dev
```

Observed:
- Electron dev process no longer fails immediately during startup
- renderer/preload/main compile together with the real renderer entry enabled
- update-check contract is now wired through preload correctly

## What This Checkpoint Means

Phase 5 is good enough to say:
- the public app boots past immediate startup failure
- the renderer is no longer relying on a broken preload contract for update checking
- the extracted repo is in a usable state for continued runtime/manual QA

## What This Checkpoint Does Not Mean

This checkpoint does **not** claim:
- full manual UI coverage
- full export-path validation for every format
- full cleanup of residual wording in every locale pack
- installer/package QA

## Follow-up

Useful next work after this checkpoint:
- targeted manual UI smoke across settings, export, preview detach, docs modal
- optional copy cleanup for residual unused translation keys in non-English locale files
- packaging/install verification

## Phase 5.5 Cleanup Applied

After the basic Phase 5 smoke pass, the public repo was trimmed further to reduce legacy surface area:

- removed `backupOnExport` from the public settings contract and default settings
- removed export-time snapshot creation from `src/renderer/exportModal.ts`
- removed dead public constants for private license activation/purchase flows
- rewrote `src/shared/types.ts` to keep only the public runtime contract
- updated the English docs backup section to describe manual backup only

Verification after cleanup:

```bash
npm run typecheck
npm run build
```

Result:
- PASS
