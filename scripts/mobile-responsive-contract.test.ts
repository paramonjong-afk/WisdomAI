import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')
const mainLayout = read('src/layouts/MainLayout.tsx')
const topBar = read('src/layouts/TopBar.tsx')
const sidebar = read('src/layouts/Sidebar.tsx')
const theme = read('src/theme.ts')
const table = read('src/components/StandardDataTable.tsx')

const checks: Array<[string, boolean]> = [
  ['MainLayout mounts a mobile sidebar without changing desktop Sidebar', mainLayout.includes('<MobileSidebar') && mainLayout.includes('<Sidebar />')],
  ['TopBar exposes a touch-sized mobile navigation action', topBar.includes('aria-label="เปิดเมนูนำทาง"') && topBar.includes('width: 44')],
  ['Mobile navigation reuses permission-filtered navigation content', sidebar.includes('NavigationContent onNavigate={onClose}')],
  ['Dialogs and Drawers become viewport-sized on small screens', theme.includes("width:'100vw'") && theme.includes("height:'100dvh'")],
  ['Tables preserve horizontal access on touch screens', theme.includes('WebkitOverflowScrolling') && table.includes('ปัดซ้ายหรือขวา')],
]

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label)
if (failures.length) throw new Error(`Mobile responsive contract failed:\n- ${failures.join('\n- ')}`)
console.log(`Mobile responsive contract passed (${checks.length} checks)`)
