import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = (path: string) => readFileSync(path, 'utf8')
const pngSize = (path: string) => {
  const png = readFileSync(path)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${path} must be a PNG`)
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
  }
}

const manifest = JSON.parse(text('public/manifest.webmanifest')) as {
  name: string
  short_name: string
  icons: Array<{ src: string; sizes: string }>
}
assert.equal(manifest.name, 'Wisdom Power')
assert.equal(manifest.short_name, 'Wisdom Power')
for (const size of [192, 512]) {
  assert.ok(manifest.icons.some((icon) => icon.src === `/branding/wisdom-power-system-app-icon-${size}.png` && icon.sizes === `${size}x${size}`))
}

for (const size of [32, 180, 192, 512]) {
  const icon = pngSize(`public/branding/wisdom-power-system-app-icon-${size}.png`)
  assert.deepEqual([icon.width, icon.height], [size, size])
}
const transparentMark = pngSize('public/branding/wisdom-power-system-mark-transparent.png')
assert.equal(transparentMark.colorType, 6, 'web mark must use RGBA PNG for real transparency')

assert.match(text('index.html'), /apple-mobile-web-app-title" content="Wisdom Power"/)
assert.match(text('public/start.html'), /Wisdom Power Smart Entry/)
assert.match(text('src/hooks/usePageTitle.ts'), /Wisdom Power/)
assert.match(text('src/layouts/Sidebar.tsx'), />\s*Wisdom Power\s*</)
assert.match(text('src/layouts/TopBar.tsx'), /brandAssets\.transparentMark/)
assert.match(text('src/pages/Login/index.tsx'), /brandAssets\.appIcon192/)
assert.match(text('src/pages/AppLauncher/index.tsx'), /brandAssets\.appIcon192/)
assert.match(text('src/lib/brandAssets.ts'), /releaseInfo\.revision/)
assert.match(text('vite.config.ts'), /transformIndexHtml/)
assert.match(text('vite.config.ts'), /manifest\.icons = manifest\.icons\?\.map/)
assert.match(text('public/_headers'), /\/manifest\.webmanifest[\s\S]*no-store, no-cache, must-revalidate/)
assert.match(text('public/_headers'), /\/branding\/\*[\s\S]*no-cache, must-revalidate/)

const migration = text('supabase/migrations/20260831074502_rename_default_company_to_wisdom_power.sql')
assert.match(migration, /where company\.slug = 'wisdomai-default'/)
assert.match(migration, /target_company\.name not in \('WisdomAI Construction', 'Wisdom Power'\)/)
assert.match(migration, /set name = 'Wisdom Power'/)
assert.match(migration, /master_data_audit/)
assert.doesNotMatch(migration, /set\s+slug\s*=/i)
assert.doesNotMatch(migration, /insert\s+into\s+public\.companies/i)

console.log('company branding tests passed')
