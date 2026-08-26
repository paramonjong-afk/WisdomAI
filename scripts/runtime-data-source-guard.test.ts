import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = 'src'
const files: string[] = []
const walk = (directory: string) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(name)) files.push(path)
  }
}
walk(root)

const forbidden = [
  { label: 'runtime fixture file/import', pattern: /(?:LocalFixture|localFixture|fixture:|local_fixture|fixture-company|fixture-user)/i },
  { label: 'URL data-source switch', pattern: /(?:local_test_data|hr_fixture)/i },
  { label: 'business data in browser storage', pattern: /local-advance-reconciliation|saveLocalReconciliation|loadLocalReconciliation/i },
]

const violations: string[] = []
for (const path of files) {
  const source = readFileSync(path, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) violations.push(`${relative('.', path)}: ${rule.label}`)
  }
}

assert.deepEqual(violations, [], `Runtime must use authenticated canonical data only:\n${violations.join('\n')}`)
console.log(`runtime data-source guard passed: ${files.length} source files, fixtures isolated under scripts/fixtures`)
