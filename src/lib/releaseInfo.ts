type ReleaseInfo = {
  version: string
  revision: string
  builtAt: string
  deploymentId: string | null
}

declare const __WISDOMAI_RELEASE__: ReleaseInfo

export const releaseInfo = __WISDOMAI_RELEASE__
export const releaseLabel = `v${releaseInfo.version} · ${releaseInfo.revision}`
