import { app, net } from 'electron'
import { DEFAULTS, APP_URLS } from '../shared/constants'
import { UpdateCheckResult, UpdateInfo } from '../shared/types'
import { getInternalStore } from './storeManager'
import semver from 'semver'

// Internal state keys for electron-store
const STORE_KEYS = {
    LAST_CHECK_AT: 'update.lastCheckAt' as const,
    LAST_NOTIFIED_VERSION: 'update.lastNotifiedVersion' as const,
}

class UpdateManager {
    private checkPromise: Promise<UpdateCheckResult> | null = null

    /**
     * Performs an update check. Deduplicates concurrent requests.
     * @param force If true, returns update-available even if already notified.
     */
    public async checkForUpdates(force = false): Promise<UpdateCheckResult> {
        if (this.checkPromise) return this.checkPromise

        this.checkPromise = this._doCheck(force)
        try {
            return await this.checkPromise
        } finally {
            this.checkPromise = null
        }
    }

    private async _doCheck(force: boolean): Promise<UpdateCheckResult> {
        try {
            const currentVersion = app.getVersion()
            const store = getInternalStore()

            // 1. Fetch remote version.json
            const remoteInfo = await this._fetchRemoteInfo()
            if (!remoteInfo) {
                return { status: 'check-failed', error: 'Invalid response from server' }
            }

            const latestVersion = remoteInfo.version

            // 2. Persist check time
            store.set(STORE_KEYS.LAST_CHECK_AT, Date.now())

            // 3. Downgrade reset rule:
            // If user manually downgraded, reset last notified version so they see the reminder again
            const lastNotified = store.get(STORE_KEYS.LAST_NOTIFIED_VERSION)
            if (lastNotified && semver.lt(currentVersion, lastNotified)) {
                store.delete(STORE_KEYS.LAST_NOTIFIED_VERSION)
            }

            // 4. Compare versions
            if (semver.gt(latestVersion, currentVersion)) {
                // Suppression rule: only notify if it's a new version or forced
                const nextLastNotified = store.get(STORE_KEYS.LAST_NOTIFIED_VERSION)
                if (!force && nextLastNotified === latestVersion) {
                    return { status: 'up-to-date', latestVersion }
                }

                return {
                    status: 'update-available',
                    latestVersion,
                    updateInfo: remoteInfo
                }
            }

            return { status: 'up-to-date', latestVersion }
        } catch (err) {
            console.error('[UpdateManager] Check failed:', err)
            return { status: 'check-failed', error: String(err) }
        }
    }

    private _fetchRemoteInfo(): Promise<UpdateInfo | null> {
        return new Promise((resolve) => {
            let settled = false
            const finish = (value: UpdateInfo | null): void => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                resolve(value)
            }

            const request = net.request({
                method: 'GET',
                url: APP_URLS.UPDATE_FEED,
                redirect: 'follow'
            })

            const timeout = setTimeout(() => {
                request.abort()
                finish(null)
            }, DEFAULTS.UPDATE_CHECK_TIMEOUT_MS)

            request.on('response', (response) => {
                if (response.statusCode !== 200) {
                    finish(null)
                    return
                }

                let data = ''
                response.on('data', (chunk) => {
                    data += chunk.toString()
                })

                response.on('end', () => {
                    try {
                        const parsed: unknown = JSON.parse(data)
                        if (this._validateUpdateInfo(parsed)) {
                            finish(parsed)
                        } else {
                            finish(null)
                        }
                    } catch {
                        finish(null)
                    }
                })
            })

            request.on('error', () => {
                finish(null)
            })

            request.end()
        })
    }

    private _validateUpdateInfo(info: unknown): info is UpdateInfo {
        if (!info || typeof info !== 'object') return false
        const candidate = info as Record<string, unknown>

        // Required fields
        if (typeof candidate.version !== 'string' || !candidate.version.trim()) return false
        if (!semver.valid(candidate.version)) return false
        if (typeof candidate.downloadUrl !== 'string' || !candidate.downloadUrl.trim()) return false

        // Basic URL validation
        try {
            // eslint-disable-next-line no-new
            new URL(candidate.downloadUrl)
        } catch {
            return false
        }

        // Optional fields validation
        if (candidate.releaseNotesUrl !== undefined) {
            if (typeof candidate.releaseNotesUrl !== 'string' || !candidate.releaseNotesUrl.trim()) return false
            try {
                // eslint-disable-next-line no-new
                new URL(candidate.releaseNotesUrl)
            } catch {
                return false
            }
        }
        if (candidate.publishedAt !== undefined && (typeof candidate.publishedAt !== 'string' || !candidate.publishedAt.trim())) {
            return false
        }

        return true
    }

    /**
     * Marks a specific version as "notified" to suppress repeated startup reminders.
     */
    public markAsNotified(version: string): void {
        getInternalStore().set(STORE_KEYS.LAST_NOTIFIED_VERSION, version)
    }

    /**
     * Returns whether a notification should be shown for this version.
     */
    public shouldNotify(version: string): boolean {
        const lastNotified = getInternalStore().get(STORE_KEYS.LAST_NOTIFIED_VERSION)
        return lastNotified !== version
    }
}

export const updateManager = new UpdateManager()
