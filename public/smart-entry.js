export const SMART_ENTRY_TARGETS = [
  { id: 'vercel', label: 'ระบบหลัก', origin: 'https://wisdomai-react.vercel.app' },
  { id: 'cloudflare', label: 'ระบบสำรอง', origin: 'https://wisdomai.pages.dev' },
]

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
  const samples = []
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await probeOnce(target, timeoutMs)
    if (result.available) samples.push(result.latency)
  }
  return { ...target, available: samples.length > 0, latency: median(samples), samples }
}

const renderResult = (element, result) => {
  element.dataset.state = result.available ? 'ready' : 'failed'
  element.querySelector('[data-status]').textContent = result.available
    ? `พร้อมใช้งาน · ${result.latency} ms`
    : 'เชื่อมต่อไม่ได้'
}

export const runSmartEntry = async () => {
  const status = document.querySelector('[data-main-status]')
  const retry = document.querySelector('[data-retry]')
  const nextPath = sanitizeNextPath(new URLSearchParams(window.location.search).get('next'))
  retry.hidden = true
  status.textContent = 'กำลังทดสอบระบบหลักและระบบสำรอง…'

  const results = await Promise.all(SMART_ENTRY_TARGETS.map(async (target) => {
    const result = await probeTarget(target)
    renderResult(document.querySelector(`[data-target="${target.id}"]`), result)
    return result
  }))
  const best = selectBestTarget(results)
  sessionStorage.setItem('wisdomai.smart-entry.last-result', JSON.stringify({
    checkedAt: new Date().toISOString(),
    results: results.map(({ id, available, latency }) => ({ id, available, latency })),
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
