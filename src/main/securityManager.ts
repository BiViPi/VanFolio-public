import { safeStorage } from 'electron'
import Store from 'electron-store'
import log from 'electron-log/main'
import { ALLOWED_AI_PROVIDERS } from '@shared/constants'

// ─────────────────────────────────────────────────────────────────────────────
// Security Manager — encrypted API key storage via Electron safeStorage
//
// safeStorage uses OS-level encryption:
//   - Windows: DPAPI (Data Protection API) — tied to user account
//   - macOS: Keychain
//   - Linux: libsecret / Keyring
//
// Keys are stored as base64-encoded ciphertext in a dedicated store file.
// NEVER log decrypted key values. NEVER store plaintext keys.
// ─────────────────────────────────────────────────────────────────────────────

interface KeyStore {
  keys: Record<string, string> // provider → base64(encrypted)
}

const keyStore = new Store<KeyStore>({
  name: 'vanfolio-keys', // separate file from settings store
  defaults: { keys: {} },
})

/** Guard: reject any provider string not in the explicit allowlist */
function isAllowedProvider(provider: string): boolean {
  return (ALLOWED_AI_PROVIDERS as readonly string[]).includes(provider)
}

/**
 * Encrypt and persist an API key for a given provider.
 * Returns false if OS encryption is unavailable or provider not in allowlist.
 */
export function saveKey(provider: string, plaintext: string): boolean {
  if (!provider || !plaintext) return false
  if (!isAllowedProvider(provider)) {
    log.warn(`[security] saveKey rejected unknown provider: ${provider}`)
    return false
  }
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[security] safeStorage not available on this system')
    return false
  }
  try {
    const encrypted = safeStorage.encryptString(plaintext)
    const stored = keyStore.get('keys')
    stored[provider] = encrypted.toString('base64')
    keyStore.set('keys', stored)
    log.info(`[security] API key saved for provider: ${provider}`)
    return true
  } catch (err) {
    log.error('[security] saveKey error:', err)
    return false
  }
}

/**
 * Decrypt and return the API key for a given provider.
 * Returns null if not found, provider not in allowlist, or decryption fails.
 */
export function getKey(provider: string): string | null {
  if (!provider || !isAllowedProvider(provider)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const stored = keyStore.get('keys')
    const b64 = stored[provider]
    if (!b64) return null
    const encrypted = Buffer.from(b64, 'base64')
    return safeStorage.decryptString(encrypted)
  } catch (err) {
    log.error('[security] getKey error:', err)
    return null
  }
}

/**
 * Check whether a key has been saved for a provider (without decrypting).
 */
export function hasKey(provider: string): boolean {
  if (!provider || !isAllowedProvider(provider)) return false
  const stored = keyStore.get('keys')
  return Boolean(stored[provider])
}

/**
 * Delete the stored key for a provider.
 */
export function deleteKey(provider: string): void {
  if (!provider || !isAllowedProvider(provider)) return
  const stored = keyStore.get('keys')
  delete stored[provider]
  keyStore.set('keys', stored)
  log.info(`[security] API key deleted for provider: ${provider}`)
}
