// Public artifact: settings.ts trim template for Phase 4 extraction
//
// This file is intentionally a source template, not a finished replacement.
// It documents the required exported surface and the mandatory removals:
// - remove license tab and all activation/deactivation UI
// - remove upgrade prompts and premium-only overlays
// - disable scheduler and backup-on-export controls
// - keep manual backup and backup path picker
// - keep AI BYOK settings, with OpenAI visible but unsupported

export const PHASE_3_SETTINGS_TRIM_SPEC = {
  removeTabs: ['license'],
  removeFlows: [
    'activate license',
    'deactivate license',
    'purchase / upgrade CTA',
    'scheduler UI',
    'backup-on-export UI'
  ],
  keepTabs: ['general', 'editor', 'typography', 'ai', 'archive'],
  keepCapabilitiesAlwaysOn: [
    'preview.detach',
    'editor.typewriterMode',
    'editor.fadeContext',
    'editor.smartQuotes',
    'editor.highlightHeader',
    'editor.cleanProseMode',
    'font.import',
    'slash.all'
  ],
  aiPolicy: {
    supported: ['gemini', 'anthropic'],
    visibleButUnsupported: ['openai']
  }
} as const
