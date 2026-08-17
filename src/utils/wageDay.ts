export type WorkdayOverrideMode='auto'|'full_day'|'half_morning'|'half_afternoon'|'custom_period'|'wage_only'

export type EffectiveWorkdayInput={
  rawLateMinutes:number
  rawEarlyLeaveMinutes:number
  rawPostShiftMinutes:number
  dayUnits:number
  hasOverride:boolean
  overrideMode?:WorkdayOverrideMode|null
  scheduledStartAt:Date|null
  scheduledEndAt:Date|null
  clockInAt:Date|null
  clockOutAt:Date|null
  halfDayMinutes:number
  graceMinutes?:number
  halfMorningEndAt?:Date|null
  halfAfternoonStartAt?:Date|null
  customStartAt?:Date|null
  customEndAt?:Date|null
}

export type EffectiveWorkdayResult={
  effectiveStartAt:Date|null
  effectiveEndAt:Date|null
  lateMinutes:number
  earlyLeaveMinutes:number
  postShiftMinutes:number
  mode:WorkdayOverrideMode
  resolved:boolean
  reason:string|null
}

const minutesBetween=(later:Date|null,earlier:Date|null)=>later&&earlier?Math.max(0,Math.round((later.getTime()-earlier.getTime())/60000)):0

export function calculateEffectiveWorkday(input:EffectiveWorkdayInput):EffectiveWorkdayResult{
  const raw={
    lateMinutes:Math.max(0,Math.round(Number(input.rawLateMinutes??0))),
    earlyLeaveMinutes:Math.max(0,Math.round(Number(input.rawEarlyLeaveMinutes??0))),
    postShiftMinutes:Math.max(0,Math.round(Number(input.rawPostShiftMinutes??0))),
  }
  // A system-calculated half day must use the same effective boundary as an
  // Admin-approved half day. Only wage-only overrides intentionally preserve
  // the raw full-shift indicators.
  if(input.overrideMode==='wage_only')return {effectiveStartAt:input.scheduledStartAt,effectiveEndAt:input.scheduledEndAt,...raw,mode:'wage_only',resolved:true,reason:null}

  if(!input.scheduledStartAt||!input.scheduledEndAt)return {effectiveStartAt:null,effectiveEndAt:null,...raw,mode:input.overrideMode??'auto',resolved:false,reason:'ไม่พบกะที่ใช้ตรวจเวลา'}

  let mode=input.overrideMode??'auto'
  if(mode==='auto'){
    if(input.dayUnits===1)mode='full_day'
    else if(input.dayUnits===0.5){
      const midpoint=input.halfMorningEndAt??new Date(input.scheduledStartAt.getTime()+input.halfDayMinutes*60000)
      const afternoonStart=input.halfAfternoonStartAt??new Date(input.scheduledEndAt.getTime()-input.halfDayMinutes*60000)
      if(input.clockOutAt&&input.clockOutAt<=afternoonStart)mode='half_morning'
      else if(input.clockInAt&&input.clockInAt>=midpoint)mode='half_afternoon'
      else return {
        effectiveStartAt:input.scheduledStartAt,
        effectiveEndAt:input.scheduledEndAt,
        ...raw,
        mode:'auto',
        resolved:false,
        reason:'ผลคิดวันเป็นครึ่งวัน แต่เวลาเข้า–ออกครอบคลุมทั้งช่วงเช้าและบ่าย กรุณาเลือกช่วงครึ่งวันที่ใช้ตรวจ',
      }
    }
  }
  let effectiveStartAt:Date|null=input.scheduledStartAt,effectiveEndAt:Date|null=input.scheduledEndAt
  if(mode==='half_morning')effectiveEndAt=input.halfMorningEndAt??new Date(input.scheduledStartAt.getTime()+input.halfDayMinutes*60000)
  else if(mode==='half_afternoon')effectiveStartAt=input.halfAfternoonStartAt??new Date(input.scheduledEndAt.getTime()-input.halfDayMinutes*60000)
  else if(mode==='custom_period'){effectiveStartAt=input.customStartAt??null;effectiveEndAt=input.customEndAt??null}
  if(!effectiveStartAt||!effectiveEndAt)return {effectiveStartAt,effectiveEndAt,...raw,mode,resolved:false,reason:'ไม่พบขอบเขตเวลาที่ใช้คำนวณ'}
  return {
    effectiveStartAt,effectiveEndAt,mode,resolved:true,reason:null,
    lateMinutes:Math.max(0,minutesBetween(input.clockInAt,effectiveStartAt)-Math.max(0,Math.round(Number(input.graceMinutes??0)))),
    earlyLeaveMinutes:minutesBetween(effectiveEndAt,input.clockOutAt),
    postShiftMinutes:minutesBetween(input.clockOutAt,effectiveEndAt),
  }
}

// Backward-compatible wrapper used by older regression tests.
export function calculateEffectiveEarlyLeaveMinutes(input:{rawMinutes:number;dayUnits:number;hasOverride:boolean;halfDayBoundaryAt:Date|null;clockOutAt:Date|null}){
  if(!input.hasOverride||input.dayUnits!==0.5||!input.halfDayBoundaryAt||!input.clockOutAt)return Math.max(0,Math.round(Number(input.rawMinutes??0)))
  return Math.max(0,Math.round((input.halfDayBoundaryAt.getTime()-input.clockOutAt.getTime())/60000))
}
