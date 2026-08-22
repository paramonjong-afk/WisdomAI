import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'

type Registry = { id:string; provider:string; model:string; role:string; availability:string; cost_tier:string; notes:string|null }
type ModuleState = {
  id:string; group:string; name:string; status:'working'|'partial'|'waiting'|'unavailable'
  processed:number; pending:number; detail:string; path:string
}
type Counts = Record<string, number>

const statusLabel={working:'ทำงานจริง',partial:'ทำงานบางส่วน',waiting:'รองาน/รอตรวจ',unavailable:'ยังไม่พร้อม'} as const
const statusColor={working:'success',partial:'warning',waiting:'info',unavailable:'error'} as const

export function WisdomAIControlPage(){
  usePageTitle('ศูนย์ควบคุม WisdomAI')
  const [models,setModels]=useState<Registry[]>([])
  const [counts,setCounts]=useState<Counts>({})
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [updatedAt,setUpdatedAt]=useState<Date|null>(null)

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    const count=async(table:string,filter?:{column:string;value:string})=>{
      let query=supabase.from(table).select('*',{count:'exact',head:true})
      if(filter)query=query.eq(filter.column,filter.value)
      const result=await query
      if(result.error)throw result.error
      return result.count??0
    }
    try{
      const [registry,lineProcessed,lineFailed,imagePending,imageConfirmed,ocrQueued,ocrDone,
        drawingTotal,drawingDone,learningReady,trainingQueued,accounting,healthOpen]=await Promise.all([
        supabase.from('drawing_ai_model_registry').select('id,provider,model,role,availability,cost_tier,notes').order('provider'),
        count('line_ingestion_events',{column:'processing_status',value:'processed'}),
        count('line_ingestion_events',{column:'processing_status',value:'failed'}),
        count('image_review_cases',{column:'review_status',value:'pending'}),
        count('image_review_cases',{column:'review_status',value:'confirmed'}),
        count('image_ai_observations',{column:'status',value:'queued'}),
        count('image_ai_observations',{column:'status',value:'completed'}),
        count('drawing_ai_jobs'),count('drawing_ai_jobs',{column:'status',value:'completed'}),
        count('wisdom_image_learning_samples',{column:'training_status',value:'ready'}),
        count('online_training_queue',{column:'status',value:'queued'}),
        count('accounting_documents'),count('health_monitor_incidents',{column:'status',value:'open'}),
      ])
      if(registry.error)throw registry.error
      setModels((registry.data??[]) as Registry[])
      setCounts({lineProcessed,lineFailed,imagePending,imageConfirmed,ocrQueued,ocrDone,drawingTotal,drawingDone,
        learningReady,trainingQueued,accounting,healthOpen})
      setUpdatedAt(new Date())
    }catch(reason){setError(reason instanceof Error?userError(reason):'โหลดสถานะ WisdomAI ไม่สำเร็จ')}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])

  const activeModels=models.filter(model=>model.availability==='active').length
  const blockedModels=models.filter(model=>['blocked_credit','needs_infrastructure','disabled'].includes(model.availability)).length
  const modules=useMemo<ModuleState[]>(()=>[
    {id:'line',group:'ข้อมูลเข้า',name:'ข้อความและรูปจาก LINE',status:counts.lineFailed?'partial':'working',processed:counts.lineProcessed??0,pending:counts.lineFailed??0,detail:'Gemini วิเคราะห์ และใช้กฎสำรองเมื่อโมเดลล้มเหลว',path:'/line-monitor'},
    {id:'image',group:'รูปภาพ',name:'จำแนกรูปและเอกสาร',status:(counts.imagePending??0)>0?'waiting':'working',processed:counts.imageConfirmed??0,pending:counts.imagePending??0,detail:'ผล AI ต้องผ่านผู้รับผิดชอบยืนยันก่อนเป็น Ground Truth',path:'/image-review'},
    {id:'ocr',group:'รูปภาพ',name:'Open Source OCR (Tesseract)',status:(counts.ocrQueued??0)>0?'partial':'working',processed:counts.ocrDone??0,pending:counts.ocrQueued??0,detail:'ทำงานได้จากหน้าตรวจรูป งาน queued ยังต้องสั่งประมวลผล',path:'/image-review'},
    {id:'drawing',group:'ก่อสร้าง',name:'Drawing AI / ถอดปริมาณ',status:(counts.drawingTotal??0)>(counts.drawingDone??0)?'partial':'working',processed:counts.drawingDone??0,pending:Math.max(0,(counts.drawingTotal??0)-(counts.drawingDone??0)),detail:'รวมผลโมเดลที่สำเร็จและแยกรายการรอคนตรวจ',path:'/drawing-ai'},
    {id:'boq',group:'ก่อสร้าง',name:'BOQ ราคาและเปรียบเทียบ',status:'partial',processed:0,pending:0,detail:'วิเคราะห์ด้วยสูตรที่ตรวจสอบย้อนหลังได้ ยังไม่ใช่โมเดลเรียนรู้',path:'/boq'},
    {id:'accounting',group:'การเงิน',name:'เอกสารบัญชีและการเงิน',status:'working',processed:counts.accounting??0,pending:0,detail:'จำแนกเอกสารจาก LINE และส่งผลให้คนตรวจ',path:'/accounting-documents'},
    {id:'work',group:'โครงการ',name:'ความก้าวหน้าและปัญหาโครงการ',status:'partial',processed:counts.lineProcessed??0,pending:counts.lineFailed??0,detail:'สรุปจาก LINE ได้ แต่การวิเคราะห์ข้ามรายงานยังไม่อัตโนมัติ',path:'/work-summary'},
    {id:'attendance',group:'บุคคล',name:'เวลา ขาด ลา มาสาย และ OT',status:'partial',processed:0,pending:0,detail:'คำนวณด้วยกฎธุรกิจ ยังไม่มี AI ตรวจความผิดปกติรายบุคคล',path:'/reports'},
    {id:'payroll',group:'บุคคล',name:'ค่าจ้าง เงินเดือน และ Payslip',status:'partial',processed:0,pending:0,detail:'คำนวณด้วยสูตรและรอบจ่าย ยังไม่มี AI อธิบายข้อผิดปกติ',path:'/reports'},
    {id:'cost',group:'การเงิน',name:'ต้นทุนและประสิทธิภาพรายไซต์',status:'partial',processed:0,pending:0,detail:'มี Dashboard และสูตรต้นทุน แต่ยังไม่มี AI เสนอแนวทางอัตโนมัติ',path:'/dashboard'},
    {id:'contractor',group:'การเงิน',name:'ผู้รับเหมา สัญญา และงวดจ่าย',status:'partial',processed:0,pending:0,detail:'มี Workflow และรายงาน ยังไม่เชื่อมการวิเคราะห์ความเสี่ยง',path:'/contractors'},
    {id:'employee',group:'บุคคล',name:'ความครบถ้วนข้อมูลพนักงาน',status:'working',processed:0,pending:0,detail:'ตรวจด้วยกฎเดียวกันก่อนอนุญาตลงเวลา',path:'/workforce-setup'},
    {id:'health',group:'ระบบ',name:'สุขภาพระบบและแจ้ง LINE',status:(counts.healthOpen??0)>0?'waiting':'working',processed:0,pending:counts.healthOpen??0,detail:'ตรวจตาม Config และบันทึก Incident',path:'/system-health'},
    {id:'learning',group:'การเรียนรู้',name:'ข้อมูลยืนยันเพื่อสอน WisdomAI',status:(counts.learningReady??0)>0?'waiting':'partial',processed:0,pending:counts.learningReady??0,detail:'เก็บ Ground Truth แล้ว แต่ยังไม่มี Training Worker ออกรุ่นอัตโนมัติ',path:'/image-review'},
    {id:'online',group:'การเรียนรู้',name:'ข้อมูลเรียนรู้ออนไลน์',status:(counts.trainingQueued??0)>0?'waiting':'unavailable',processed:0,pending:counts.trainingQueued??0,detail:'มี Queue แต่ยังไม่มี Worker ดึงและตรวจสิทธิ์แหล่งข้อมูล',path:'/image-review'},
  ],[counts])
  const working=modules.filter(item=>item.status==='working').length
  const completion=Math.round((working/modules.length)*100)

  return <Stack spacing={2.5}>
    <PageHeader title="ศูนย์ควบคุม WisdomAI" description="สถานะจริงของ AI งานวิเคราะห์ รายการรอตรวจ และความพร้อมของแต่ละโมดูล"
      action={<Button startIcon={<RefreshOutlinedIcon/>} onClick={()=>void load()} disabled={loading}>รีเฟรช</Button>}/>
    {error&&<Alert severity="error">{error}</Alert>}
    <Alert severity={blockedModels?'warning':'success'}>
      WisdomAI ทำงานจริง {working}/{modules.length} ส่วน · โมเดล Active {activeModels} · ติดข้อจำกัด {blockedModels}
      {updatedAt&&` · ตรวจล่าสุด ${updatedAt.toLocaleString('th-TH')}`}
    </Alert>
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr 1fr',lg:'repeat(4,1fr)'},gap:2}}>
      {[
        ['ความพร้อมรวม',`${completion}%`],['รอตรวจรูป',counts.imagePending??0],
        ['OCR รอทำงาน',counts.ocrQueued??0],['เหตุระบบค้าง',counts.healthOpen??0],
      ].map(([label,value])=><Paper key={label} variant="outlined" sx={{p:2.25}}>
        <Typography color="text.secondary" variant="body2">{label}</Typography>
        <Typography variant="h4" sx={{fontWeight:850,mt:.5}}>{value}</Typography>
        {label==='ความพร้อมรวม'&&<LinearProgress sx={{mt:1.2}} variant="determinate" value={completion}/>} 
      </Paper>)}
    </Box>
    <Paper variant="outlined" sx={{p:2}}>
      <Stack direction="row" spacing={1} sx={{alignItems:'center',mb:1.5}}><AutoAwesomeOutlinedIcon color="primary"/><Typography variant="h6" sx={{fontWeight:800}}>งานของ WisdomAI ทั้งระบบ</Typography></Stack>
      <StandardDataTable rows={modules} getRowId={row=>row.id} getSearchText={row=>`${row.group} ${row.name} ${row.detail}`}
        searchLabel="ค้นหาโมดูลหรือสถานะ" emptyText="ยังไม่มีโมดูล" exportFileName="wisdomai-control-center" columns={[
          {id:'group',label:'หมวด',render:row=>row.group},{id:'name',label:'งาน',minWidth:220,render:row=>row.name},
          {id:'status',label:'สถานะจริง',render:row=><Chip size="small" color={statusColor[row.status]} label={statusLabel[row.status]}/>},
          {id:'processed',label:'สำเร็จ',align:'right',render:row=>row.processed.toLocaleString()},
          {id:'pending',label:'รอดำเนินการ',align:'right',render:row=>row.pending.toLocaleString()},
          {id:'detail',label:'รายละเอียด',minWidth:320,render:row=>row.detail},
          {id:'open',label:'ตรวจสอบ',render:row=><Button component={Link} to={row.path} size="small">เปิด</Button>,exportValue:()=>''},
        ]}/>
    </Paper>
    <Paper variant="outlined" sx={{p:2}}>
      <Typography variant="h6" sx={{fontWeight:800,mb:1.5}}>โมเดลที่ลงทะเบียน</Typography>
      <StandardDataTable rows={models} getRowId={row=>row.id} getSearchText={row=>`${row.provider} ${row.model} ${row.availability}`}
        searchLabel="ค้นหาโมเดล" emptyText="ยังไม่มีโมเดล" exportFileName="wisdomai-model-registry" columns={[
          {id:'provider',label:'ผู้ให้บริการ',render:row=>row.provider},{id:'model',label:'โมเดล',minWidth:220,render:row=>row.model},
          {id:'role',label:'หน้าที่',render:row=>row.role},{id:'availability',label:'ความพร้อม',render:row=><Chip size="small" color={row.availability==='active'?'success':'default'} label={row.availability}/>},
          {id:'cost',label:'ค่าใช้จ่าย',render:row=>row.cost_tier},{id:'notes',label:'ข้อจำกัด',minWidth:300,render:row=>row.notes||'-'},
        ]}/>
    </Paper>
  </Stack>
}

