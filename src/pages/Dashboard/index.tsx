import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import { Alert, Box, Button, Chip, CircularProgress, LinearProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Project={id:string;name:string;code:string|null;status:string}
type BoqDocument={id:string;project_id:string;status:string;boq_document_totals:{direct_cost:number;item_selling_total:number}|null}
type BoqTotal={id:string;direct_cost:number;item_selling_total:number}
type Expense={id:string;project_id:string|null;total_amount:number|null;paid_amount:number|null;status:string;document_date:string|null;document_type:string}
type Payroll={id:string;net_pay:number;status:string;pay_periods:{starts_on:string;ends_on:string}|null}
type Contract={id:string;site_id:string;contract_amount:number;status:string;project_sites:{project_id:string;name:string}|null}
type Claim={id:string;contract_id:string;gross_amount:number;net_amount:number;status:string}
type Attendance={id:string;profile_id:string;site_id:string;worked_minutes:number|null;overtime_minutes:number|null;clock_out_at:string|null;status:string;project_sites:{project_id:string;name:string}|null}
type InventoryMovement={id:string;project_id:string|null;movement_type:string;quantity:number;unit_cost:number|null;occurred_at:string}
type SiteRow={id:string;name:string;budget:number;expense:number;contract:number;labour:number;progress:number;usage:number;status:string}

const money=(value:number)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0}).format(value)
const sum=(values:number[])=>values.reduce((total,value)=>total+Number(value||0),0)
const monthRange=(month:string)=>{const [year,value]=month.split('-').map(Number);const next=value===12?`${year+1}-01`:`${year}-${String(value+1).padStart(2,'0')}`;return{start:`${month}-01`,end:`${next}-01`}}
const riskColor=(status:string)=>status==='เสี่ยง'?'error':status==='เฝ้าระวัง'?'warning':'success'

function MetricCard({label,value,detail,color='primary'}:{label:string;value:string;detail:string;color?:'primary'|'success'|'warning'|'error'}){
  return <Paper variant="outlined" sx={{p:2,minWidth:0,borderTop:3,borderTopColor:`${color}.main`}}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h5" sx={{fontWeight:800,my:.5,overflow:'hidden',textOverflow:'ellipsis'}}>{value}</Typography><Typography variant="caption" color="text.secondary">{detail}</Typography></Paper>
}

function BarChart({items,valueLabel=money}:{items:{label:string;value:number;color?:string}[];valueLabel?:(value:number)=>string}){
  const maximum=Math.max(1,...items.map(item=>item.value))
  return <Stack spacing={1.5}>{items.length?items.map(item=><Box key={item.label}><Stack direction="row" sx={{justifyContent:'space-between',gap:1}}><Typography variant="body2" noWrap>{item.label}</Typography><Typography variant="body2" sx={{fontWeight:700}}>{valueLabel(item.value)}</Typography></Stack><Box sx={{height:12,bgcolor:'grey.100',borderRadius:8,overflow:'hidden',mt:.5}}><Box sx={{height:'100%',width:`${Math.max(item.value?3:0,item.value/maximum*100)}%`,bgcolor:item.color||'primary.main',borderRadius:8}}/></Box></Box>):<Typography color="text.secondary">ยังไม่มีข้อมูลในช่วงที่เลือก</Typography>}</Stack>
}

export function DashboardPage(){
  usePageTitle('Dashboard ศูนย์บริหารโครงการ')
  const {profile}=useAuth(),canManage=profile?.role==='admin'||profile?.role==='manager'
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[tab,setTab]=useState(0)
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7)),[projectId,setProjectId]=useState('all'),[updatedAt,setUpdatedAt]=useState<Date|null>(null)
  const [projects,setProjects]=useState<Project[]>([]),[boqs,setBoqs]=useState<BoqDocument[]>([]),[expenses,setExpenses]=useState<Expense[]>([])
  const [payrolls,setPayrolls]=useState<Payroll[]>([]),[contracts,setContracts]=useState<Contract[]>([]),[claims,setClaims]=useState<Claim[]>([])
  const [attendance,setAttendance]=useState<Attendance[]>([]),[inventory,setInventory]=useState<InventoryMovement[]>([])
  const load=useCallback(async()=>{
    if(!canManage)return
    setLoading(true);setError('')
    const range=monthRange(month)
    const requests=await Promise.all([
      supabase.from('projects').select('id:project_id,name,code,status').order('name'),
      supabase.from('boq_documents').select('id,project_id,status').in('status',['approved','in_review']),
      supabase.from('boq_document_totals').select('id,direct_cost,item_selling_total'),
      supabase.from('accounting_documents').select('id,project_id,total_amount,paid_amount,status,document_date,document_type').gte('document_date',range.start).lt('document_date',range.end).neq('status','duplicate'),
      supabase.from('employee_payrolls').select('id,net_pay,status,pay_periods(starts_on,ends_on)').order('created_at',{ascending:false}).limit(1000),
      supabase.from('contractor_contracts').select('id,site_id,contract_amount,status,project_sites(project_id,name)'),
      supabase.from('contractor_payment_claims').select('id,contract_id,gross_amount,net_amount,status'),
      supabase.from('attendance_sessions').select('id,profile_id,site_id,worked_minutes,overtime_minutes,clock_out_at,status,project_sites(project_id,name)').gte('clock_in_at',`${range.start}T00:00:00+07:00`).lt('clock_in_at',`${range.end}T00:00:00+07:00`).neq('status','duplicate'),
      supabase.from('inventory_movements').select('id,project_id,movement_type,quantity,unit_cost,occurred_at').gte('occurred_at',`${range.start}T00:00:00+07:00`).lt('occurred_at',`${range.end}T00:00:00+07:00`),
    ])
    const first=requests.find(request=>request.error)?.error
    if(first)setError(`โหลดข้อมูลบางส่วนไม่สำเร็จ: ${first.message}`)
    const totals=new Map(((requests[2].data??[]) as BoqTotal[]).map(row=>[row.id,row]))
    setProjects((requests[0].data??[]) as unknown as Project[]);setBoqs(((requests[1].data??[]) as Omit<BoqDocument,'boq_document_totals'>[]).map(row=>({...row,boq_document_totals:totals.get(row.id)??null})))
    setExpenses((requests[3].data??[]) as Expense[]);setPayrolls((requests[4].data??[]) as unknown as Payroll[])
    setContracts((requests[5].data??[]) as unknown as Contract[]);setClaims((requests[6].data??[]) as Claim[])
    setAttendance((requests[7].data??[]) as unknown as Attendance[]);setInventory((requests[8].data??[]) as InventoryMovement[])
    setUpdatedAt(new Date());setLoading(false)
  },[canManage,month])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])
  useEffect(()=>{
    if(!canManage)return
    let refreshTimer=0
    const refresh=()=>{window.clearTimeout(refreshTimer);refreshTimer=window.setTimeout(()=>void load(),800)}
    const channel=supabase.channel('project-cost-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'attendance_sessions'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'employee_payrolls'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'accounting_documents'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'contractor_payment_claims'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'employee_site_cost_allocations'},refresh)
      .subscribe()
    return()=>{window.clearTimeout(refreshTimer);void supabase.removeChannel(channel)}
  },[canManage,load])

  const model=useMemo(()=>{
    const selectedProjects=projects.filter(project=>projectId==='all'||project.id===projectId)
    const selectedIds=new Set(selectedProjects.map(project=>project.id))
    const selectedBoqs=boqs.filter(row=>selectedIds.has(row.project_id)),selectedExpenses=expenses.filter(row=>row.project_id&&selectedIds.has(row.project_id))
    const selectedContracts=contracts.filter(row=>row.project_sites&&selectedIds.has(row.project_sites.project_id)),contractIds=new Set(selectedContracts.map(row=>row.id))
    const selectedClaims=claims.filter(row=>contractIds.has(row.contract_id)),selectedAttendance=attendance.filter(row=>row.project_sites&&selectedIds.has(row.project_sites.project_id))
    const selectedInventory=inventory.filter(row=>row.project_id&&selectedIds.has(row.project_id))
    const payrollMonth=payrolls.filter(row=>row.pay_periods&&(row.pay_periods.starts_on.startsWith(month)||row.pay_periods.ends_on.startsWith(month)))
    const budget=sum(selectedBoqs.map(row=>Number(row.boq_document_totals?.direct_cost||0))),revenuePlan=sum(selectedBoqs.map(row=>Number(row.boq_document_totals?.item_selling_total||0)))
    const documented=sum(selectedExpenses.filter(row=>['confirmed','pending','needs_correction'].includes(row.status)).map(row=>Number(row.total_amount||0)))
    const paid=sum(selectedExpenses.map(row=>Number(row.paid_amount||0)))+sum(selectedClaims.filter(row=>row.status==='paid').map(row=>Number(row.net_amount||0)))
    const committed=sum(selectedClaims.filter(row=>['approved','pending_payment'].includes(row.status)).map(row=>Number(row.net_amount||0)))
    const payroll=projectId==='all'?sum(payrollMonth.map(row=>Number(row.net_pay||0))):0,contractCost=sum(selectedClaims.filter(row=>!['rejected','void'].includes(row.status)).map(row=>Number(row.net_amount||0)))
    const actualCost=documented+contractCost+payroll,forecast=actualCost+committed,profit=revenuePlan-forecast
    const review=selectedAttendance.filter(row=>!row.clock_out_at||['pending','needs_review'].includes(row.status)).length+selectedExpenses.filter(row=>['pending','needs_correction'].includes(row.status)).length+selectedClaims.filter(row=>['submitted','needs_revision'].includes(row.status)).length
    const siteRows:SiteRow[]=selectedProjects.map(project=>{
      const projectBoq=selectedBoqs.filter(row=>row.project_id===project.id),projectExpenses=selectedExpenses.filter(row=>row.project_id===project.id)
      const projectContracts=selectedContracts.filter(row=>row.project_sites?.project_id===project.id),ids=new Set(projectContracts.map(row=>row.id)),projectClaims=selectedClaims.filter(row=>ids.has(row.contract_id))
      const projectAttendance=selectedAttendance.filter(row=>row.project_sites?.project_id===project.id),projectBudget=sum(projectBoq.map(row=>Number(row.boq_document_totals?.direct_cost||0)))
      const expense=sum(projectExpenses.map(row=>Number(row.total_amount||0))),contract=sum(projectClaims.map(row=>Number(row.net_amount||0))),labour=projectAttendance.reduce((total,row)=>total+Number(row.worked_minutes||0),0)/60
      const progress=projectBoq.length?Math.min(100,projectBoq.filter(row=>row.status==='approved').length/projectBoq.length*100):0,usage=projectBudget?((expense+contract)/projectBudget*100):0
      return{id:project.id,name:project.name,budget:projectBudget,expense,contract,labour,progress,usage,status:usage>100||usage-progress>25?'เสี่ยง':usage-progress>10?'เฝ้าระวัง':'ปกติ'}
    })
    const costMix=[{label:'เอกสารค่าใช้จ่าย',value:documented,color:'#a65940'},{label:'ผู้รับเหมา',value:contractCost,color:'#fabfb2'},{label:'ค่าจ้าง',value:payroll,color:'#333333'}]
    return{selectedProjects,selectedExpenses,selectedContracts,selectedClaims,selectedAttendance,selectedInventory,budget,revenuePlan,documented,paid,committed,payroll,contractCost,actualCost,forecast,profit,review,siteRows,costMix,payrollMonth}
  },[attendance,boqs,claims,contracts,expenses,inventory,month,payrolls,projectId,projects])

  if(!canManage)return <Alert severity="info">Dashboard นี้สำหรับผู้ดูแลระบบและผู้จัดการ</Alert>
  if(loading)return <Stack sx={{alignItems:'center',py:8}}><CircularProgress/></Stack>
  const completeness=Math.round((projects.length?1:0)+(boqs.length?1:0)+(expenses.length?1:0)+(attendance.length?1:0)+(contracts.length?1:0))/5*100
  const tabs=['ภาพรวม','โครงการและไซต์','ต้นทุนและ BOQ','ค่าแรงและกำลังคน','วัสดุและจัดซื้อ','ผู้รับเหมา','กระแสเงินสด','รอตรวจสอบ']
  const costTotal=sum(model.costMix.map(item=>item.value))
  return <Stack spacing={2.5}>
    <PageHeader title="Dashboard ศูนย์บริหารโครงการ" description={`ข้อมูลจริงตามสิทธิ์การเข้าถึง · อัปเดตล่าสุด ${updatedAt?.toLocaleString('th-TH')||'-'}`} action={<Button startIcon={<RefreshOutlinedIcon/>} onClick={()=>void load()}>รีเฟรช</Button>}/>
    {error&&<Alert severity="warning">{error}</Alert>}
    <Paper variant="outlined" sx={{p:2}}><Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{alignItems:{md:'center'}}}>
      <TextField type="month" label="เดือน" value={month} onChange={event=>setMonth(event.target.value)} slotProps={{inputLabel:{shrink:true}}}/>
      <TextField select label="โครงการ/ไซต์" value={projectId} onChange={event=>setProjectId(event.target.value)} sx={{minWidth:280}}><MenuItem value="all">ทุกโครงการ</MenuItem>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.code?`${project.code} · `:''}{project.name}</MenuItem>)}</TextField>
      <Box sx={{flex:1}}/><Box sx={{minWidth:210}}><Stack direction="row" sx={{justifyContent:'space-between'}}><Typography variant="caption">ความพร้อมของข้อมูล</Typography><Typography variant="caption" sx={{fontWeight:700}}>{completeness}%</Typography></Stack><LinearProgress variant="determinate" value={completeness}/></Box>
    </Stack></Paper>
    <Paper variant="outlined" sx={{position:'sticky',top:64,zIndex:4,overflow:'hidden'}}><Tabs value={tab} onChange={(_event,value)=>setTab(value)} variant="scrollable" scrollButtons="auto">{tabs.map(label=><Tab key={label} label={label} sx={{textTransform:'none'}}/>)}</Tabs></Paper>

    {tab===0&&<><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',lg:'repeat(4,1fr)'},gap:1.5}}>
      <MetricCard label="งบประมาณ BOQ" value={money(model.budget)} detail={`${model.selectedProjects.length} โครงการ`}/><MetricCard label="ค่าใช้จ่ายและภาระผูกพัน" value={money(model.forecast)} detail={`จ่ายแล้ว ${money(model.paid)}`} color="warning"/><MetricCard label="มูลค่างานตาม BOQ" value={money(model.revenuePlan)} detail="จาก BOQ ที่อนุมัติ/รอตรวจ" color="success"/><MetricCard label="กำไรคาดการณ์" value={money(model.profit)} detail="มูลค่างานหักต้นทุนและภาระผูกพัน" color={model.profit<0?'error':'success'}/>
    </Box><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',lg:'1.35fr 1fr'},gap:2}}>
      <Paper variant="outlined" sx={{p:2.5}}><Typography variant="h6" sx={{mb:2}}>งบประมาณเทียบต้นทุนรายโครงการ</Typography><BarChart items={model.siteRows.map(row=>({label:row.name,value:row.expense+row.contract,color:row.status==='เสี่ยง'?'#d32f2f':row.status==='เฝ้าระวัง'?'#ed6c02':'#a65940'}))}/></Paper>
      <Paper variant="outlined" sx={{p:2.5}}><Typography variant="h6">สัดส่วนต้นทุน</Typography><Box sx={{display:'grid',gridTemplateColumns:'140px 1fr',gap:2,alignItems:'center',mt:2}}><Box sx={{width:140,height:140,borderRadius:'50%',background:costTotal?`conic-gradient(#a65940 0 ${model.documented/costTotal*100}%,#fabfb2 0 ${(model.documented+model.contractCost)/costTotal*100}%,#333 0 100%)`:'#eee',position:'relative','&:after':{content:'""',position:'absolute',inset:28,borderRadius:'50%',bgcolor:'background.paper'}}}/><Stack spacing={1}>{model.costMix.map(item=><Stack key={item.label} direction="row" sx={{justifyContent:'space-between',gap:2}}><Typography variant="body2"><Box component="span" sx={{display:'inline-block',width:9,height:9,borderRadius:5,bgcolor:item.color,mr:1}}/>{item.label}</Typography><Typography variant="body2" sx={{fontWeight:700}}>{money(item.value)}</Typography></Stack>)}</Stack></Box></Paper>
    </Box></>}

    {tab===1&&<StandardDataTable rows={model.siteRows} getRowId={row=>row.id} getSearchText={row=>`${row.name} ${row.status}`} searchLabel="ค้นหาโครงการหรือสถานะ" emptyText="ยังไม่มีโครงการ" exportFileName={`project-health-${month}`} columns={[{id:'name',label:'โครงการ',render:r=>r.name},{id:'budget',label:'งบ BOQ',render:r=>money(r.budget)},{id:'cost',label:'ต้นทุนจริง',render:r=>money(r.expense+r.contract)},{id:'progress',label:'ความก้าวหน้า BOQ',render:r=><Box sx={{minWidth:140}}><LinearProgress variant="determinate" value={r.progress}/><Typography variant="caption">{r.progress.toFixed(0)}%</Typography></Box>},{id:'usage',label:'ใช้งบ',render:r=>`${r.usage.toFixed(1)}%`},{id:'hours',label:'ชม.แรงงาน',render:r=>r.labour.toFixed(1)},{id:'status',label:'สถานะ',render:r=><Chip size="small" color={riskColor(r.status)} label={r.status}/>}]}/>} 

    {tab===2&&<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',lg:'1fr 1fr'},gap:2}}><Paper variant="outlined" sx={{p:2.5}}><Typography variant="h6" sx={{mb:2}}>ต้นทุนตามหมวด</Typography><BarChart items={model.costMix}/></Paper><Paper variant="outlined" sx={{p:2.5}}><Typography variant="h6" sx={{mb:2}}>งบและประมาณการ</Typography><BarChart items={[{label:'งบ BOQ',value:model.budget,color:'#333'},{label:'ต้นทุนจริง',value:model.actualCost,color:'#a65940'},{label:'ภาระผูกพัน',value:model.committed,color:'#fabfb2'},{label:'ประมาณการรวม',value:model.forecast,color:model.forecast>model.budget?'#d32f2f':'#2e7d32'}]}/></Paper></Box>}

    {tab===3&&<><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.5}}><MetricCard label="พนักงานที่ลงเวลา" value={String(new Set(model.selectedAttendance.map(row=>row.profile_id)).size)} detail={`${model.selectedAttendance.length} รายการ`}/><MetricCard label="ชั่วโมงทำงาน" value={`${(sum(model.selectedAttendance.map(row=>Number(row.worked_minutes||0)))/60).toFixed(1)} ชม.`} detail="ตามเวลาที่ปิดรายการแล้ว"/><MetricCard label="OT บันทึกแล้ว" value={`${(sum(model.selectedAttendance.map(row=>Number(row.overtime_minutes||0)))/60).toFixed(1)} ชม.`} detail="ใช้ยอดอนุมัติจากระบบ" color="warning"/><MetricCard label="ค่าจ้างในรอบ" value={money(model.payroll)} detail={`${model.payrollMonth.length} รายการ Payroll`} color="success"/></Box><Alert severity="info">ค่าแรงรายไซต์จะแม่นยำเมื่อกำหนดสัดส่วนพนักงานประจำไซต์ครบ 100% ขณะนี้ Dashboard แสดงชั่วโมงตามไซต์ที่ลงเวลาจริง</Alert></>}

    {tab===4&&<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',lg:'1fr 1fr'},gap:2}}><Paper variant="outlined" sx={{p:2.5}}><Typography variant="h6" sx={{mb:2}}>มูลค่าการเคลื่อนไหววัสดุ</Typography><BarChart items={['receipt','issue','return','adjustment'].map(kind=>({label:{receipt:'รับเข้า',issue:'เบิกใช้',return:'คืน',adjustment:'ปรับยอด'}[kind]||kind,value:sum(model.selectedInventory.filter(row=>row.movement_type===kind).map(row=>Number(row.quantity||0)*Number(row.unit_cost||0)))}))}/></Paper><Alert severity="info" sx={{alignItems:'center'}}>กราฟใช้รายการคลังที่ระบุโครงการและราคาต่อหน่วย รายการไม่มีราคาจะนับปริมาณได้แต่ไม่รวมมูลค่า</Alert></Box>}

    {tab===5&&<><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.5}}><MetricCard label="มูลค่าสัญญา" value={money(sum(model.selectedContracts.map(row=>row.contract_amount)))} detail={`${model.selectedContracts.length} สัญญา`}/><MetricCard label="ขอเบิกสะสม" value={money(sum(model.selectedClaims.map(row=>row.gross_amount)))} detail={`${model.selectedClaims.length} งวด`}/><MetricCard label="ภาระผูกพัน" value={money(model.committed)} detail="อนุมัติ/รอจ่าย" color="warning"/><MetricCard label="จ่ายแล้ว" value={money(sum(model.selectedClaims.filter(row=>row.status==='paid').map(row=>row.net_amount)))} detail="ยอดสุทธิ" color="success"/></Box><Paper variant="outlined" sx={{p:2.5}}><Typography variant="h6" sx={{mb:2}}>ยอดสุทธิตามสถานะ</Typography><BarChart items={['submitted','approved','pending_payment','paid'].map(status=>({label:{submitted:'ส่งตรวจ',approved:'อนุมัติ',pending_payment:'รอจ่าย',paid:'จ่ายแล้ว'}[status]||status,value:sum(model.selectedClaims.filter(row=>row.status===status).map(row=>row.net_amount))}))}/></Paper></>}

    {tab===6&&<><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.5}}><MetricCard label="เอกสารค่าใช้จ่าย" value={money(model.documented)} detail="เดือนที่เลือก"/><MetricCard label="จ่ายแล้ว" value={money(model.paid)} detail="เอกสารและผู้รับเหมา" color="success"/><MetricCard label="ต้องเตรียมจ่าย" value={money(model.committed)} detail="รายการอนุมัติ/รอจ่าย" color="warning"/><MetricCard label="ส่วนต่างเงินสด" value={money(-model.paid-model.committed)} detail="ยังไม่รวมรายรับที่ไม่มีเอกสารรับเงิน" color="error"/></Box><Alert severity="warning">ระบบยังไม่มีทะเบียนรับเงินจากลูกค้าที่ครบถ้วน จึงยังไม่คำนวณกระแสเงินสดสุทธิหรือ Forecast 30/60/90 วัน เพื่อป้องกันตัวเลขคลาดเคลื่อน</Alert></>}

    {tab===7&&<><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.5}}><MetricCard label="ต้องตรวจทั้งหมด" value={String(model.review)} detail="เวลา เอกสาร และผู้รับเหมา" color="warning"/><MetricCard label="ลืมลงเวลาออก" value={String(model.selectedAttendance.filter(row=>!row.clock_out_at).length)} detail="เปิดรายงานเวลาเพื่อแก้ไข" color="error"/><MetricCard label="เอกสารรอตรวจ" value={String(model.selectedExpenses.filter(row=>['pending','needs_correction'].includes(row.status)).length)} detail="เอกสารบัญชี" color="warning"/><MetricCard label="งวดผู้รับเหมารอตรวจ" value={String(model.selectedClaims.filter(row=>['submitted','needs_revision'].includes(row.status)).length)} detail="เปิดศูนย์อนุมัติ" color="warning"/></Box><Paper variant="outlined" sx={{p:2.5}}><Stack direction={{xs:'column',sm:'row'}} spacing={1}><Button component={Link} to="/reports" startIcon={<WarningAmberOutlinedIcon/>}>ตรวจเวลาทำงาน</Button><Button component={Link} to="/approvals">เปิดศูนย์อนุมัติ</Button><Button component={Link} to="/contractors">ตรวจผู้รับเหมา</Button><Button component={Link} to="/boq">ตรวจ BOQ</Button></Stack></Paper></>}
  </Stack>
}
