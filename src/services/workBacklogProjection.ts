export type WorkLane = 'Intake'|'Ready'|'Doing'|'QA'|'Release'|'Blocked'|'Done'
export function workLane(status:string, productionStatus:string, approvalStatus:string|null|undefined):WorkLane {
  if(status==='done') return 'Done'
  if(status==='blocked') return 'Blocked'
  if(status==='ready' && approvalStatus==='pending') return 'QA'
  if(status==='ready' && /release|pr|ci|smoke/i.test(productionStatus)) return 'Release'
  if(status==='doing') return 'Doing'
  if(status==='review') return /release|pr|ci|smoke/i.test(productionStatus) ? 'Release' : 'QA'
  return 'Intake'
}
export function displayProgress(status:string, progress:number){return status==='done'?Math.max(0,Math.min(100,progress)):Math.min(95,Math.max(0,progress))}
export function isInternalControl(workKey:string){return /^(CONTROL-|QA-|PUBLISH-|CLOSEOUT-)/i.test(workKey)}
