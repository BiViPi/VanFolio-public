import { showToast } from './toast'

export function showUpgradePrompt(featureName: string): void {
  showToast(`${featureName} is included in the public build.`, 'info')
}
