// Public artifact: main.ts for Phase 4 extraction
//
// This is a TEMPLATE/SPEC file that describes how internal main.ts should be trimmed for public.
// Phase 4 will use this as guidance when copying the real internal main.ts.
//
// Key changes from internal main.ts:
// 1. Remove: licenseBackend import
// 2. Import licenseManager from ./licenseManager.ts (stub version)
// 3. Remove or stub these IPC handlers:
//    - ipcMain.handle(IPC.LICENSE_ACTIVATE)
//    - ipcMain.handle(IPC.LICENSE_DEACTIVATE)
//    - ipcMain.on(IPC.LICENSE_OPEN_PURCHASE)
// 4. Keep these license IPC handlers (stub versions):
//    - ipcMain.handle(IPC.LICENSE_GET_CAPABILITIES)
//    - ipcMain.handle(IPC.LICENSE_HAS_CAPABILITY)
//    - ipcMain.handle(IPC.LICENSE_GET_STATUS)
//    - ipcMain.on(IPC.LICENSE_STATUS_CHANGED) with no-op
// 5. In clampSettingsByLicense(), remove premium-only setting clamps or keep as-is if clamps are for disabled features
// 6. In startup, disable scheduler startup logic:
//    - Remove or stub: startScheduler() call if it depends on premium backup assumptions
//    - Keep: runBackup() for manual backup
// 7. Remove: validateLicenseInBackground() background calls on resume
// 8. Remove: any internal env var references (VF_BACKEND_URL, Lemon Squeezy IDs, etc.)
//
// IMPORTANT: This is not runnable code yet. Real main.ts copy happens in Phase 4 extraction.
// This file documents the SPEC for trimming, to be validated in Phase 3 checkpoint.

export const PHASE_3_MAIN_TRIM_SPEC = {
  removes: [
    'licenseBackend import',
    'ipcMain.handle(LICENSE_ACTIVATE)',
    'ipcMain.handle(LICENSE_DEACTIVATE)',
    'ipcMain.on(LICENSE_OPEN_PURCHASE)',
    'validateLicenseInBackground() calls',
  ],
  keeps: [
    'ipcMain.handle(LICENSE_GET_CAPABILITIES) -> getCapabilities() from stub',
    'ipcMain.handle(LICENSE_HAS_CAPABILITY) -> hasCapability() from stub',
    'ipcMain.handle(LICENSE_GET_STATUS) -> getLicenseStatus() from stub',
    'ipcMain.on(LICENSE_STATUS_CHANGED) -> no-op',
    'ipcMain.handle(APP_GET_LICENSE_TEXT)',
    'initLicenseManager() call (will be no-op in public)',
    'stopLicenseManager() call (will be no-op in public)',
    'runBackup() for manual backup',
    'All AI IPC handlers',
    'All file/export IPC handlers',
  ],
  disables: [
    'startScheduler() during startup for auto-backup (Phase 0: backup scheduler disabled in public)',
    'startScheduler() in FILE_OPEN_FOLDER vault change',
  ],
} as const
