import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { loadFlowControlCenter, type ControlModule, type ControlProblemType, type FlowControlSnapshot } from '../../services/flowControlCenter'
import type { FlowRegistryStatusFilter } from '../../services/flowRegistryGateway'

const dateText=(date:Date)=>date.toISOString().slice(0,10)
const start=(value:string)=>new Date(`${value}T00:00:00+07:00`).toISOString()
const end=(value:string)=>new Date(`${value}T23:59:59.999+07:00`).toISOString()
const moduleOptions:[ControlModule|'all',string][]=[['all','ทุก Module'],['intake','รับเข้า'],['ai','AI แยกประเภท'],['master','Master Data'],['accounting','บัญชี'],['hr','HR'],['payroll','ค่าแรง'],['advance','เงินสำรองจ่าย'],['closed','ปิดรายการ']]
const problemOptions:[ControlProblemType|'all',string][]=[['all','ทุกปัญหา'],['unknown','Unknown'],['audit_missing','Audit missing'],['duplicate','Duplicate'],['source_missing','Source missing'],['amount_mismatch','Amount mismatch'],['name_account_mismatch','Name / account mismatch'],['waiting_approval','Waiting approval'],['msg_failed_retry','MSG failed / retry'],['sla_overdue','SLA overdue']]

const metricTone=(value:number,tone:'normal'|'pending'|'problem'|'overdue')=>value===0?'default':tone==='normal'?'success':tone==='pending'?'warning':'error'

export function FlowControlCenterPage(){
  usePageTitle('Flow Control Center')
  const {currentCompany}=useAuth()
  const [params,setParams]=useSearchParams()
  const localFixture=import.meta.env.DEV&&params.get('local_test_data')==='1'
  const companyId=localFixture?'local-fixture-company':currentCompany?.company_id??''
  const [defaults]=useState(()=>{const now=new Date();return {from:dateText(new Date(now.getTime()-7*86400000)),to:dateText(now)}})
  const from=params.get('from')??defaults.from,to=params.get('to')??defaults.to
  const module=(params.get('module')??'all') as ControlModule|'all'
  const status=(params.get('status')??'all') as FlowRegistryStatusFilter
  const problem=(params.get('problem')??'all') as ControlProblemType|'all'
  const source=params.get('source')??'',owner=params.get('owner')??''
  const [snapshot,setSnapshot]=useState<FlowControlSnapshot|null>(null)
  const [loading,setLoading]=useState(false),[error,setError]=useState('')

  const update=(key:string,value:string)=>setParams(current=>{const next=new URLSearchParams(current);if(value&&value!=='all')next.set(key,value);else next.delete(key);return next},{replace:true})
  const load=useCallback(async()=>{
    if(!companyId)return
    setLoading(true);setError('');setSnapshot(null)
    try{setSnapshot(await loadFlowControlCenter({companyId,from:start(from),to:end(to),module,status,source,owner,problem},localFixture))}
    catch(reason){setError(reason instanceof Error?reason.message:'โหลด Flow Control Center ไม่สำเร็จ')}
    finally{setLoading(false)}
  },[companyId,from,localFixture,module,owner,problem,source,status,to])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])

  return <Stack spacing={2}>
    <PageHeader title="Flow Control Center" description="ศูนย์ควบคุมเส้นทางงานและปัญหาข้าม Module จาก Task / Source / Audit เดียวกับระบบจริง" action={<Button startIcon={<RefreshRoundedIcon/>} onClick={()=>void load()} disabled={loading}>รีเฟรช</Button>}/>
    <Paper sx={{p:{xs:2,md:3},borderRadius:3,color:'common.white',background:'radial-gradient(circle at 84% 18%,rgba(255,194,128,.35),transparent 28%),linear-gradient(135deg,#172f35,#315b5b 52%,#b66a43)'}}>
      <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{alignItems:{md:'center'},justifyContent:'space-between'}}><Box><Typography variant="overline" sx={{letterSpacing:2,opacity:.75}}>WISDOM POWER · ACTIVE OPERATIONS</Typography><Typography variant="h4" sx={{fontWeight:900}}>ทุกงาน ทุกปัญหา หน้ากลางเดียว</Typography><Typography sx={{opacity:.8,mt:.5}}>{localFixture?'Local fixture แยกจาก Production':'ตัวเลขจาก registry ตามบริษัทและสิทธิ์ปัจจุบัน'}</Typography></Box><Chip variant="outlined" label={localFixture?'LOCAL FIXTURE':currentCompany?.company_name??'ยังไม่เลือกบริษัท'} sx={{color:'white',borderColor:'rgba(255,255,255,.55)'}}/></Stack>
    </Paper>

    <Paper variant="outlined" sx={{p:1.5,borderRadius:2.5}}><Stack direction={{xs:'column',md:'row'}} spacing={1} useFlexGap sx={{flexWrap:'wrap'}}>
      <TextField size="small" type="date" label="ตั้งแต่" value={from} onChange={event=>update('from',event.target.value)} slotProps={{inputLabel:{shrink:true}}}/><TextField size="small" type="date" label="ถึง" value={to} onChange={event=>update('to',event.target.value)} slotProps={{inputLabel:{shrink:true}}}/>
      <FormControl size="small" sx={{minWidth:150}}><InputLabel>Module</InputLabel><Select label="Module" value={module} onChange={event=>update('module',event.target.value)}>{moduleOptions.map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
      <FormControl size="small" sx={{minWidth:145}}><InputLabel>สถานะ</InputLabel><Select label="สถานะ" value={status} onChange={event=>update('status',event.target.value)}>{['all','open','waiting','error','closed'].map(value=><MenuItem key={value} value={value}>{value==='all'?'ทุกสถานะ':value}</MenuItem>)}</Select></FormControl>
      <FormControl size="small" sx={{minWidth:190}}><InputLabel>ประเภทปัญหา</InputLabel><Select label="ประเภทปัญหา" value={problem} onChange={event=>update('problem',event.target.value)}>{problemOptions.map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
      <TextField size="small" label="Source / ID" value={source} onChange={event=>update('source',event.target.value)}/><TextField size="small" label="Owner" value={owner} onChange={event=>update('owner',event.target.value)}/>
      {(module!=='all'||status!=='all'||problem!=='all'||source||owner)&&<Button onClick={()=>setParams(localFixture?{local_test_data:'1'}:{},{replace:true})}>ล้างตัวกรอง</Button>}
    </Stack></Paper>

    {!companyId&&<Alert severity="warning">กรุณาเลือกบริษัทก่อนเปิด Flow Control Center</Alert>}{error&&<Alert severity="error" action={<Button color="inherit" onClick={()=>void load()}>ลองใหม่</Button>}>{error}</Alert>}{loading&&<Box sx={{minHeight:260,display:'grid',placeItems:'center'}}><CircularProgress/></Box>}
    {!loading&&snapshot&&<>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(5,1fr)'},gap:1}}>{[['งานทั้งหมด',snapshot.summary.total],['ปัญหาทั้งหมด',snapshot.summary.problems],['เกิน SLA',snapshot.summary.overdue],['รอข้อมูล',snapshot.summary.waitingInfo],['ปิดวันนี้',snapshot.summary.closedToday]].map(([label,value])=><Paper key={String(label)} variant="outlined" sx={{p:1.5,borderRadius:2.5}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h4" sx={{fontWeight:900}}>{Number(value).toLocaleString('th-TH')}</Typography></Paper>)}</Box>
      <Paper variant="outlined" sx={{p:{xs:1.25,md:2},borderRadius:3,overflow:'hidden'}}><Stack direction="row" sx={{alignItems:'center',justifyContent:'space-between'}}><Typography variant="h6" sx={{fontWeight:900}}>เส้นทางควบคุมงาน</Typography><Typography variant="caption" color="text.secondary">แตะ Node เพื่อกรอง Problem Queue</Typography></Stack><Stack direction={{xs:'column',md:'row'}} spacing={.75} sx={{mt:1.5,alignItems:'stretch'}}>{snapshot.nodes.map((node,index)=><Box key={node.key} sx={{display:'flex',alignItems:'center',flex:1,minWidth:0}}><Card component="button" type="button" variant="outlined" onClick={()=>update('module',node.key)} sx={{flex:1,width:'100%',textAlign:'left',font:'inherit',cursor:'pointer',borderRadius:2.5,borderColor:module===node.key?'primary.main':'divider','&:hover':{transform:'translateY(-2px)',boxShadow:3}}}><CardContent sx={{p:1.25,'&:last-child':{pb:1.25}}}><Typography sx={{fontWeight:900}}>{node.label}</Typography><Typography variant="h5" sx={{fontWeight:900,mt:.5}}>{node.total}</Typography><Stack direction="row" spacing={.5} useFlexGap sx={{flexWrap:'wrap',mt:1}}>{([['ปกติ',node.normal,'normal'],['รอ',node.pending,'pending'],['ปัญหา',node.problem,'problem'],['SLA',node.overdue,'overdue'],['ต้องทำ',node.actionable,'pending']] as const).map(([label,value,tone])=><Chip key={label} size="small" color={metricTone(value,tone)} label={`${label} ${value}`}/>)}</Stack></CardContent></Card>{index<snapshot.nodes.length-1&&<ArrowForwardRoundedIcon sx={{display:{xs:'none',md:'block'},color:'text.disabled',mx:.2}}/>}</Box>)}</Stack></Paper>
      <Paper variant="outlined" sx={{p:{xs:1.25,md:2},borderRadius:3}}><Stack direction={{xs:'column',sm:'row'}} spacing={1} sx={{justifyContent:'space-between'}}><Box><Typography variant="h6" sx={{fontWeight:900}}>Problem Queue</Typography><Typography variant="body2" color="text.secondary">Problem ID deterministic ไม่สร้าง Task หรือ Notification เพิ่ม</Typography></Box><Chip icon={<ErrorOutlineRoundedIcon/>} color={snapshot.problems.length?'error':'success'} label={`${snapshot.problems.length} ปัญหา`}/></Stack><Stack spacing={1} sx={{mt:1.5}}>{snapshot.problems.length===0?<Alert severity="success">ไม่พบปัญหาตามตัวกรอง</Alert>:snapshot.problems.map(item=><Card key={item.id} variant="outlined"><CardContent sx={{p:1.5,'&:last-child':{pb:1.5}}}><Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{justifyContent:'space-between'}}><Box sx={{minWidth:0}}><Stack direction="row" spacing={.75} useFlexGap sx={{alignItems:'center',flexWrap:'wrap'}}><Chip size="small" color="error" label={item.label}/><Chip size="small" variant="outlined" label={item.module}/><Typography sx={{fontWeight:900}}>{item.taskId}</Typography></Stack><Typography variant="body2" sx={{mt:.75}}>Problem ID: {item.id}</Typography><Typography variant="caption" color="text.secondary" sx={{display:'block'}}>Source: {item.source} · Owner: {item.owner}</Typography><Typography variant="caption" color="text.secondary" sx={{display:'block'}}>SLA: {item.slaDueAt?new Date(item.slaDueAt).toLocaleString('th-TH'):'ไม่กำหนด'} · Next: {item.nextAction}</Typography><Typography variant="caption" color="text.secondary" sx={{display:'block'}}>Audit: {item.auditRefs.join(', ')||'missing'}{item.blocker?` · Blocker: ${item.blocker}`:''}</Typography></Box><Button component={RouterLink} to={item.deepLink} variant="contained" sx={{alignSelf:{md:'center'}}}>เปิดงานจริง</Button></Stack></CardContent></Card>)}</Stack></Paper>
      {snapshot.sourceWarnings.length>0&&<Alert severity="warning">{snapshot.sourceWarnings.join(' · ')}</Alert>}<Alert severity={snapshot.reconciliation.consistent?'success':'error'}>Count reconciliation: {snapshot.reconciliation.rows} rows = เปิด {snapshot.reconciliation.open} + ปิด {snapshot.reconciliation.closed} · {snapshot.reconciliation.consistent?'ตรงกัน':'ไม่ตรงกัน'}</Alert><Typography variant="caption" color="text.secondary">Last updated: {new Date(snapshot.lastUpdated).toLocaleString('th-TH')}</Typography>
    </>}
  </Stack>
}
