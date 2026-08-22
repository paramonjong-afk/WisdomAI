type ReleaseInfo = {
  version: string
  revision: string
  builtAt: string
  deploymentId: string | null
  host: 'vercel' | 'cloudflare' | 'local'
}

declare const __WISDOMAI_RELEASE__: ReleaseInfo

export const releaseInfo = __WISDOMAI_RELEASE__
export const releaseLabel = `v${releaseInfo.version} · ${releaseInfo.revision}`
export const releaseHostLabel = releaseInfo.host === 'vercel' ? 'Vercel' : releaseInfo.host === 'cloudflare' ? 'Cloudflare' : 'Local'
