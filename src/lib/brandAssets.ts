import { releaseInfo } from './releaseInfo'

const versioned = (path: string) => `${path}?v=${encodeURIComponent(releaseInfo.revision)}`

export const brandAssets = {
  appIcon192: versioned('/branding/wisdom-power-system-app-icon-192.png'),
  transparentMark: versioned('/branding/wisdom-power-system-mark-transparent.png'),
} as const
