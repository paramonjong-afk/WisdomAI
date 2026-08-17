import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StandardDataTable } from '../../components/StandardDataTable'
import { supabase } from '../../lib/supabase'

type ForecastRow={profile_id:string;employee_name:string;employment_type:string;attendance_policy:string;actual_normal_minutes:number;actual_overtime_minutes:number;future_planned_minutes:number;future_planned_overtime_minutes:number;accrued_cost:number;committed_cost:number;forecast_month_end:number;missing_data:string[];as_of:string}
const money=(value:number)=>Number(value||0).toLocaleString('th-TH',{style:'currency',currency:'THB'})
const minutes=(value:number)=>`${Math.floor(Number(value||0)/60)} ชม. ${Math.round(Number(value||0)%60)} นาที`
const missingLabel:Record<string,string>={work_policy:'ขาดนโยบายเวลา',monthly_salary:'ขาดเงินเดือน',daily_rate:'ขาดค่าแรงรายวัน',future_plan:'ยังไม่มีแผนงานช่วงที่เหลือ'}

export function RealtimePayrollForecast({month,employeeId,employmentTypes}:{month:string;employeeId:string;employmentTypes?:string[]}){
  const [rows,setRows]=useState<ForecastRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const load=useCallback(async()=>{setLoading(true);setError('');const {data,error:loadError}=await supabase.rpc('get_realtime_payroll_forecast',{target_month:`${month}-01`});if(loadError){const message=loadError.message||'';setError(message.includes('Permission denied')?'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลค่าแรงของบริษัทที่เลือก':message.includes('Could not find the function')?'ระบบประมาณการค่าแรงยังติดตั้งไม่ครบ กรุณาให้ผู้ดูแลติดตั้ง Migration ล่าสุด':`คำนวณประมาณการค่าแรงไม่สำเร็จ (${loadError.code||'RPC_ERROR'}) กรุณาแจ้งผู้ดูแลระบบ`);setRows([])}else setRows((data??[]) as ForecastRow[]);setLoading(false)},[month])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const channel=supabase.channel(`payroll-forecast-${month}`).on('postgres_changes',{event:'*',schema:'public',table:'attendance_sessions'},()=>void load()).on('postgres_changes',{event:'*',schema:'public',table:'workforce_daily_plans'},()=>void load()).on('postgres_changes',{event:'*',schema:'public',table:'employee_employment_records'},()=>void load()).subscribe();return()=>{window.clearTimeout(timer);void supabase.removeChannel(channel)}},[load,month])
  const visible=rows.filter(row=>(employeeId==='all'||row.profile_id===employeeId)&&(!employmentTypes?.length||employmentTypes.includes(row.employment_type)))
  const totals=useMemo(()=>visible.reduce((sum,row)=>({accrued:sum.accrued+Number(row.accrued_cost),committed:sum.committed+Number(row.committed_cost),forecast:sum.forecast+Number(row.forecast_month_end),issues:sum.issues+row.missing_data.length}),{accrued:0,committed:0,forecast:0,issues:0}),[visible])
  return <Stack spacing={2}>
    <Alert severity="info">ยอดนี้เป็น Preview แบบ Real-time ไม่แก้ Payroll/Payslip และไม่กระทบงวดที่อนุมัติหรือจ่ายแล้ว</Alert>
    {error&&<Alert severity="warning">{error}</Alert>}
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.25}}>{[
      ['เกิดขึ้นจริงถึงวันนี้',money(totals.accrued)],['รวมงานที่วางแผนแล้ว',money(totals.committed)],['ประมาณการสิ้นเดือน',money(totals.forecast)],['ข้อมูลต้องเติม',`${totals.issues} จุด`],
    ].map(([label,value])=><Paper key={label} variant="outlined" sx={{p:1.5}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h6" sx={{fontWeight:800}}>{value}</Typography></Paper>)}</Box>
    {loading&&<Typography color="text.secondary">กำลังคำนวณข้อมูลล่าสุด...</Typography>}
    <StandardDataTable rows={visible} getRowId={row=>row.profile_id} getSearchText={row=>`${row.employee_name} ${row.employment_type} ${row.missing_data.join(' ')}`} searchLabel="ค้นหาพนักงานหรือข้อมูลที่ขาด" emptyText="ยังไม่มีข้อมูลพนักงานสำหรับประมาณการ" exportFileName={`payroll-forecast-${month}`} columns={[
      {id:'employee',label:'พนักงาน',render:r=>r.employee_name},{id:'type',label:'ประเภท',render:r=>r.employment_type==='monthly'?'รายเดือน':'รายวัน/ชั่วคราว'},
      {id:'actualTime',label:'เวลาจริง',render:r=>minutes(r.actual_normal_minutes)},{id:'planTime',label:'แผนที่เหลือ',render:r=>minutes(r.future_planned_minutes)},
      {id:'accrued',label:'เกิดขึ้นจริง',render:r=><b>{money(r.accrued_cost)}</b>},{id:'committed',label:'รวมแผนแล้ว',render:r=>money(r.committed_cost)},{id:'forecast',label:'สิ้นเดือน',render:r=><b>{money(r.forecast_month_end)}</b>},
      {id:'quality',label:'ความพร้อม',render:r=>r.missing_data.length?<Stack direction="row" spacing={.5} useFlexGap sx={{flexWrap:'wrap'}}>{r.missing_data.map(item=><Chip key={item} size="small" color="warning" label={missingLabel[item]??item}/>)}</Stack>:<Chip size="small" color="success" label="พร้อม"/>},
      {id:'updated',label:'อัปเดต',render:r=>new Date(r.as_of).toLocaleString('th-TH')},
    ]}/>
  </Stack>
}
