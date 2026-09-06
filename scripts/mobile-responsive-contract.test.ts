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
  ['Mobile navigation provides a visible touch-sized close action', sidebar.includes('aria-label="ปิดเมนูนำทาง"') && sidebar.includes('onClick={onClose}') && sidebar.includes('width: 44')],
  ['Dialogs and Drawers become viewport-sized on small screens', theme.includes("width:'100vw'") && theme.includes("height:'100dvh'")],
  ['Responsive theme covers the full 320-768px mobile range', theme.includes('mobileMaxWidth: 768') && theme.includes("@media (max-width: 768px), (pointer: coarse)")],
  ['Clickable chips and tabs keep 44px touch targets', theme.includes("'.MuiChip-clickable':{minHeight:44}") && theme.includes('minWidth:110,minHeight:44')],
  ['Tables preserve horizontal access on touch screens', theme.includes('WebkitOverflowScrolling') && table.includes('ปัดซ้ายหรือขวา')],
]

const failures = checks.filter(([, passed]) => !passed).map(([label]) => label)
if (failures.length) throw new Error(`Mobile responsive contract failed:
- ${failures.join('
- ')}`)
console.log(`Mobile responsive contract passed (${checks.length} checks)`)
