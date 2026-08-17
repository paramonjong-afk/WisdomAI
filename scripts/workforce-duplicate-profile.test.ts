import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source=readFileSync(new URL('../src/pages/WorkforceSetup/index.tsx',import.meta.url),'utf8')
const employeeSource=readFileSync(new URL('../src/pages/Employee/index.tsx',import.meta.url),'utf8')
assert.match(source,/from\('employee_onboarding_readiness'\)[\s\S]{0,120}\.eq\('company_id',currentCompany\?\.company_id\?\?''\)/,'workforce readiness must be filtered to the selected company')
assert.match(source,/employee_code:string\|null/)
assert.match(source,/duplicateNameCounts/)
assert.match(source,/ชื่อซ้ำ \$\{duplicateCount\(row\)\} ระเบียน/)
assert.match(source,/Profile \{row\.profile_id\.slice\(0,8\)\}/)
assert.match(source,/อาจเป็น Profile เก่าหรือข้อมูลซ้ำ/)
assert.match(source,/ตรวจข้อมูลซ้ำ/)
assert.match(employeeSource,/from\('employee_onboarding_readiness'\)[\s\S]{0,160}\.eq\('company_id',currentCompany\?\.company_id \?\? ''\)/,'employee readiness must use the same company-scoped source')
assert.match(employeeSource,/!employee\.has_work_policy/,'employee page must accept a schedule inherited from the assigned site')
console.log('workforce duplicate profile UI regression passed')
