import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/DrawingAI/index.tsx', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../supabase/functions/drawing-ai-benchmark/index.ts', import.meta.url), 'utf8')

for (const table of ['projects', 'drawing_ai_jobs', 'drawing_ai_runs', 'drawing_ai_module_runs', 'drawing_sheets', 'drawing_sheet_items']) {
  assert.match(page, new RegExp(`from\\('${table}'\\)[\\s\\S]{0,300}?eq\\('company_id', companyId\\)`), `${table} read must use active company`)
}
for (const table of ['drawing_ai_ground_truth', 'drawing_takeoff_scopes']) {
  assert.match(page, new RegExp(`from\\('${table}'\\)[\\s\\S]{0,180}?company_id: currentCompany\\.company_id`), `${table} write must retain company`)
}
assert.match(page, /const scores = jobRuns\.map\(\(run\) => \(\{ company_id: currentCompany\.company_id/)
assert.doesNotMatch(page, /from\('drawing_ai_leaderboard'\)/, 'cross-company leaderboard view must not be queried')
assert.doesNotMatch(page, /from\('wisdom_ai_learning_coverage'\)/, 'cross-company learning coverage view must not be queried')
assert.match(page, /drawing_sheet_dependencies'\)\.delete\(\)\.eq\('company_id', currentCompany\.company_id\)\.eq\('job_id'/)
assert.match(page, /dependencies\.map\(\(dependency\) => \(\{ \.\.\.dependency, company_id: currentCompany\.company_id \}\)\)/)
assert.match(edge, /drawing_ai_jobs'\)\.select\('\*'\)[\s\S]{0,100}?\.eq\('id', jobId\)\.eq\('company_id', companyId\)/)
assert.match(edge, /drawing_sheet_items'\)\.delete\(\)\.eq\('company_id', job\.company_id\)\.eq\('job_id', job\.id\)/)

console.log('Drawing AI tenant boundary checks passed')
