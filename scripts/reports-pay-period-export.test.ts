import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateEffectiveEarlyLeaveMinutes } from '../src/utils/wageDay.ts'

const reports=readFileSync(new URL('../src/pages/Reports/index.tsx',import.meta.url),'utf8')
const table=readFileSync(new URL('../src/components/StandardDataTable.tsx',import.meta.url),'utf8')

assert.match(reports,/รอบรายงาน \/ รอบจ่าย/,'reports must expose a pay-period selector')
assert.match(reports,/reportStartDate/,'reports must filter attendance by the selected pay-period dates')
assert.match(reports,/payPeriodInitialized/,'reports must automatically choose the current or open pay period')
assert.match(reports,/period\.starts_on<=today&&period\.ends_on>=today/,'current pay period must be selected by its effective dates')
assert.doesNotMatch(reports,/\[canManage,companyId,employeeId,month,requestedSession,setSearchParams,siteId\]/,'client-side employee/site filters must not reload the full report')
assert.match(reports,/calculateEffectiveWorkday/,'payroll reports must use the central effective-workday calculation')
assert.match(reports,/rawEarlyLeaveMinutes/,'payroll reports must retain raw attendance evidence separately')
assert.match(reports,/override_mode/,'payroll reports must persist the effective workday override mode')
assert.match(reports,/timeDisplaySettings\.half_day_minutes/,'half-day early leave must use the configured half-day boundary')
assert.doesNotMatch(reports,/\$\{rowsHtml\}\$\{totalHtml\}/,'individual PDF must not repeat its summary below the table')
assert.match(reports,/postShiftMinutes/,'post-shift time must be calculated from shift end')
assert.match(reports,/sessions\.reduce/,'daily details must aggregate multiple sessions')
assert.doesNotMatch(reports,/id:'shift',label:'กะ'/,'shift should not be a primary daily-result column')
assert.match(table,/exportMeta/,'standard exports must support report metadata')
assert.match(table,/exportSummary/,'standard exports must support report summaries')
assert.match(table,/exportable\?: boolean/,'action columns must be excludable from exports')
assert.match(table,/document\.fonts\.ready/,'PDF print must wait for fonts')
assert.doesNotMatch(table,/setTimeout\(\(\)=>window\.close/,'print window must not auto-close before rendering')
assert.doesNotMatch(table,/#fabbf2/,'incorrect print header color must be removed')

const halfDayBoundary=new Date('2026-08-06T12:00:00+07:00')
assert.equal(calculateEffectiveEarlyLeaveMinutes({rawMinutes:299,dayUnits:0.5,hasOverride:true,halfDayBoundaryAt:halfDayBoundary,clockOutAt:new Date('2026-08-06T12:01:00+07:00')}),0,'approved half day ending after its boundary must not count as effective early leave')
assert.equal(calculateEffectiveEarlyLeaveMinutes({rawMinutes:330,dayUnits:0.5,hasOverride:true,halfDayBoundaryAt:halfDayBoundary,clockOutAt:new Date('2026-08-06T11:30:00+07:00')}),30,'approved half day ending before its boundary must count only the minutes before the half-day boundary')
assert.equal(calculateEffectiveEarlyLeaveMinutes({rawMinutes:299,dayUnits:1,hasOverride:false,halfDayBoundaryAt:halfDayBoundary,clockOutAt:new Date('2026-08-06T12:01:00+07:00')}),299,'unadjusted attendance must preserve raw early-leave evidence')

console.log('reports pay-period and export contract passed')
