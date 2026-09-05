import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const files = [
  'scripts/sql/sales-expense-accounting-baseline.sql',
  'supabase/migrations/20260831040817_sales_expense_accounting_workflow.sql',
  'scripts/sql/sales-expense-accounting-runtime.test.sql',
]

const database = new PGlite()

try {
  for (const file of files) {
    let sql = readFileSync(file, 'utf8')
    // gen_random_uuid is built into this PostgreSQL runtime; its pgcrypto
    // extension package is intentionally not bundled in the WASM test image.
    if (file.endsWith('baseline.sql')) {
      sql = sql.replace('create extension if not exists pgcrypto;', '')
    }
    await database.exec(sql)
  }
  console.log('sales expense PostgreSQL runtime smoke passed')
} finally {
  await database.close()
}
