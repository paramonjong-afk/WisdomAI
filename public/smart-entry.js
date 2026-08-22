export const SMART_ENTRY_TARGETS = [
  { id: 'vercel', label: 'ระบบหลัก', origin: 'https://wisdomai-react.vercel.app' },
  { id: 'cloudflare', label: 'ระบบสำรอง', origin: 'https://wisdomai.pages.dev' },
]

const releaseScriptTimeoutMs = 1800

export const sanitizeNextPath = (value) => {
  if (!value || typeof value !== 'string') return '/login'
  if (!value.startsWith('/') || value.startsWith('//')) return '/login'
  const path = value.split('#')[0]
  if (path === '/start.html' || path.startsWith('/start.html?')) return '/login'
  return value
}

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return Number.POSITIVE_INFINITY
  return sorted[Math.floor(sorted.length / 2)]
}

export const selectBestTarget = (results) => {
  const available = results.filter((item) => item.available && Number.isFinite(item.latency))
  return available.sort((a, b) => a.latency - b.latency)[0] ?? null
}

export const isMatchingRelease = (primary, candidate) => Boolean(
  primary?.release?.revision
  && candidate?.release?.revision
  && primary.release.revision === candidate.release.revision,
)

const loadRelease = (target, timeoutMs = releaseScriptTimeoutMs) => new Promise((resolve) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') { resolve(null); return }
  const script = document.createElement('script')
  const timer = window.setTimeout(() => finish(null), timeoutMs)
  let settled = false
  const finish = (release) => {
    if (settled) return
    settled = true
    window.clearTimeout(timer)
    script.remove()
    resolve(release && typeof release.revision === 'string' ? release : null)
  }
  script.async = true
  script.onload = () => {
    const release = window.__WISDOMAI_RELEASE_MANIFEST__
    delete window.__WISDOMAI_RELEASE_MANIFEST__
    finish(release)
  }
  script.onerror = () => finish(null)
  script.src = `${target.origin}/release.js?probe=${Date.now()}-${Math.random()}`
  document.head.append(script)
})

const probeOnce = (target, timeoutMs) => new Promise((resolve) => {
  const startedAt = performance.now()
  const image = new Image()
  let settled = false
  const finish = (available) => {
    if (settled) return
    settled = true
    window.clearTimeout(timer)
    image.onload = null
    image.onerror = null
    resolve({ available, latency: available ? Math.round(performance.now() - startedAt) : Number.POSITIVE_INFINITY })
  }
  const timer = window.setTimeout(() => finish(false), timeoutMs)
  image.onload = () => finish(true)
  image.onerror = () => finish(false)
  image.src = `${target.origin}/health-check.svg?probe=${Date.now()}-${Math.random()}`
})

export const probeTarget = async (target, { attempts = 3, timeoutMs = 2500 } = {}) => {
  const attemptsResult = await Promise.all(
    Array.from({ length: attempts }, () => probeOnce(target, timeoutMs)),
  )
  const samples = attemptsResult.filter((result) => result.available).map((result) => result.latency)
  const release = await loadRelease(target)
  return { ...target, available: samples.length > 0, latency: median(samples), samples, release }
}

const renderResult = (element, result) => {
  const releaseLabel = result.release ? ` · ${result.release.revision}` : ''
  const isStale = result.releaseState === 'stale'
  element.dataset.state = isStale ? 'stale' : result.available ? 'ready' : 'failed'
  element.querySelector('[data-status]').textContent = isStale
    ? `รุ่นไม่ตรงกับระบบหลัก (${result.release?.revision ?? 'ไม่พบ revision'})`
    : result.available
      ? `พร้อมใช้งาน · ${result.latency} ms${releaseLabel}`
      : result.releaseState === 'unknown' ? 'ไม่พบ Release ID · ไม่นำไปใช้' : 'เชื่อมต่อไม่ได้'
}

const renderManualTarget = (result) => {
  const link = document.querySelector(`[data-manual-target="${result.id}"]`)
  if (!link) return
  const unusable = !result.available || result.releaseState === 'stale' || result.releaseState === 'unknown'
  if (unusable) {
    link.removeAttribute('href')
    link.setAttribute('aria-disabled', 'true')
    link.textContent = `${result.label} (ใช้ไม่ได้: รุ่นไม่ตรง/ไม่พบ Release ID)`
    return
  }
  link.href = link.dataset.href ?? ''
  link.removeAttribute('aria-disabled')
  link.textContent = result.id === 'vercel' ? 'เข้าระบบหลัก' : 'เข้าระบบสำรอง'
}

export const runSmartEntry = async () => {
  const status = document.querySelector('[data-main-status]')
  const retry = document.querySelector('[data-retry]')
  const nextPath = sanitizeNextPath(new URLSearchParams(window.location.search).get('next'))
  retry.hidden = true
  status.textContent = 'กำลังทดสอบระบบหลักและระบบสำรอง…'

  const results = await Promise.all(SMART_ENTRY_TARGETS.map((target) => probeTarget(target)))
  const primary = results.find((result) => result.id === 'vercel') ?? null
  const scopedResults = results.map((result) => {
    if (!result.release) return { ...result, available: false, releaseState: 'unknown' }
    if (result.id === 'vercel') return { ...result, releaseState: 'current' }
    return isMatchingRelease(primary, result)
      ? { ...result, releaseState: 'current' }
      : { ...result, available: false, releaseState: 'stale' }
  })
  scopedResults.forEach((result) => {
    renderResult(document.querySelector(`[data-target="${result.id}"]`), result)
    renderManualTarget(result)
  })
  const best = selectBestTarget(scopedResults)
  sessionStorage.setItem('wisdomai.smart-entry.last-result', JSON.stringify({
    checkedAt: new Date().toISOString(),
    results: scopedResults.map(({ id, available, latency, release, releaseState }) => ({ id, available, latency, revision: release?.revision ?? null, releaseState })),
    selected: best?.id ?? null,
  }))

  if (!best) {
    status.textContent = 'ยังเชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือเลือกปลายทางด้วยตนเอง'
    retry.hidden = false
    return
  }

  status.textContent = `เลือก ${best.label} (${best.latency} ms) กำลังนำเข้าสู่ระบบ…`
  window.setTimeout(() => window.location.replace(`${best.origin}${nextPath}`), 650)
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.querySelector('[data-retry]')?.addEventListener('click', () => runSmartEntry())
  runSmartEntry().catch((error) => {
    console.error('[smart-entry] probe failed', error)
    const status = document.querySelector('[data-main-status]')
    if (status) status.textContent = 'ตรวจระบบไม่สำเร็จ กรุณาลองใหม่หรือเลือกปลายทางด้วยตนเอง'
    const retry = document.querySelector('[data-retry]')
    if (retry) retry.hidden = false
  })
}
