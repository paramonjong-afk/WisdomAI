import assert from 'node:assert/strict'

const values = new Map<string,string>([
  ['LINE_MONTHLY_BUDGET','300'],
  ['LINE_PUSH_SOFT_LIMIT','180'],
  ['LINE_PUSH_HIGH_LIMIT','240'],
  ['LINE_PUSH_CRITICAL_LIMIT','270'],
  ['LINE_ESTIMATED_RECIPIENTS_PER_PUSH','6'],
])

Object.assign(globalThis,{Deno:{env:{get:(name:string)=>values.get(name)}}})

const {canUseLinePush}=await import('../supabase/functions/_shared/line-quota.ts')

assert.equal(canUseLinePush(179,'normal').allowed,true)
assert.equal(canUseLinePush(180,'normal').allowed,false)
assert.equal(canUseLinePush(180,'high').allowed,true)
assert.equal(canUseLinePush(240,'high').allowed,false)
assert.equal(canUseLinePush(240,'critical').allowed,true)
assert.equal(canUseLinePush(270,'normal').reason,'critical_only_reserve')
assert.equal(canUseLinePush(295,'critical').allowed,false)
assert.equal(canUseLinePush(295,'critical').reason,'monthly_budget_exhausted')

console.log('line quota policy tests passed')
