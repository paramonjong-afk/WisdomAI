import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { readBoqFile } from '../../utils/boqImport'
import { readBoqPdf } from '../../utils/boqPdfCompare'

type Project={id:string;name:string;code:string|null}
type SourceRow={id:string;location:string;code:string;category:string;description:string;unit:string;quantity:number;unitPrice:number;total:number;raw:string}
type SourceData={fileName:string;kind:'excel'|'pdf';rows:SourceRow[];summary:string}
type ComparedRow={id:string;status:'matched'|'changed'|'only_a'|'only_b';a:SourceRow|null;b:SourceRow|null;differences:string[]}

const normalize=(value:string)=>value.toLowerCase().replaceAll(/\s+/g,'').replaceAll(/[.,()\-_/]/g,'')
const money=(value:number)=>Number(value||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})
const numberList=(value:string)=>(value.match(/\d[\d,]*(?:\.\d+)?/g)??[]).map(item=>Number(item.replaceAll(',',''))).filter(Number.isFinite)
async function readSource(file:File):Promise<SourceData>{
  if(file.name.toLowerCase().endsWith('.pdf')){
    const pdf=await readBoqPdf(file)
    const rows=pdf.lines.map((line,index)=>{const parts=line.text.trim().split(/\s+/),code=/^[\p{L}\d][\p{L}\d._/-]{1,20}$/u.test(parts[0]||'')?parts[0]:'';const values=numberList(line.text);const quantity=values[0]??0,unitPrice=values.length>1?values[values.length-1]:0;return{id:`pdf-${line.page}-${index}`,location:`หน้า ${line.page}`,code,category:`หน้า ${line.page}`,description:line.text,unit:'',quantity,unitPrice,total:quantity*unitPrice,raw:line.text}})
    return{fileName:file.name,kind:'pdf',rows,summary:`PDF ${pdf.pageCount} หน้า · อ่านได้ ${rows.length} บรรทัด`}
  }
  const result=await readBoqFile(file)
  const rows=result.rows.map(row=>({id:row.import_id,location:`${row.sheet_name} / แถว ${row.source_row}`,code:row.boq_code,category:row.category,description:row.description,unit:row.unit,quantity:row.quantity,unitPrice:row.selling_unit_price,total:row.quantity*row.selling_unit_price,raw:`${row.boq_code} ${row.description} ${row.unit} ${row.quantity} ${row.selling_unit_price}`}))
  return{fileName:file.name,kind:'excel',rows,summary:`${result.sheets.length} Sheet · ${rows.length} รายการ`}
}

function compareSources(a:SourceData|null,b:SourceData|null):ComparedRow[]{
  if(!a||!b)return[]
  const available=[...b.rows],results:ComparedRow[]=[]
  a.rows.forEach(left=>{
    let index=available.findIndex(right=>left.code&&normalize(left.code)===normalize(right.code)&&normalize(left.category)===normalize(right.category))
    if(index<0)index=available.findIndex(right=>left.code&&normalize(right.raw).includes(normalize(left.code)))
    if(index<0)index=available.findIndex(right=>normalize(right.description).includes(normalize(left.description))||normalize(left.description).includes(normalize(right.description)))
    if(index<0){results.push({id:`a-${left.id}`,status:'only_a',a:left,b:null,differences:['พบเฉพาะไฟล์ A']});return}
    const right=available.splice(index,1)[0],differences:string[]=[]
    if(left.unit&&right.unit&&normalize(left.unit)!==normalize(right.unit))differences.push(`หน่วย ${left.unit} → ${right.unit}`)
    if(left.quantity&&right.quantity&&Math.abs(left.quantity-right.quantity)>.001)differences.push(`ปริมาณ ${left.quantity} → ${right.quantity}`)
    if(left.unitPrice&&right.unitPrice&&Math.abs(left.unitPrice-right.unitPrice)>.01)differences.push(`ราคา ${money(left.unitPrice)} → ${money(right.unitPrice)}`)
    results.push({id:`pair-${left.id}-${right.id}`,status:differences.length?'changed':'matched',a:left,b:right,differences})
  })
  available.forEach(right=>results.push({id:`b-${right.id}`,status:'only_b',a:null,b:right,differences:['พบเฉพาะไฟล์ B']}))
  return results
}

export function BoqComparePage(){
  usePageTitle('เปรียบเทียบ BOQ')
  const {profile}=useAuth(),canManage=profile?.role==='admin'||profile?.role==='manager'
  const [projects,setProjects]=useState<Project[]>([]),[projectId,setProjectId]=useState(''),[primary,setPrimary]=useState<'a'|'b'>('a'),[purpose,setPurpose]=useState('ตรวจฉบับเดิมกับฉบับแก้ไข')
  const [sourceA,setSourceA]=useState<SourceData|null>(null),[sourceB,setSourceB]=useState<SourceData|null>(null),[loading,setLoading]=useState<'a'|'b'|''>(''),[error,setError]=useState(''),[tab,setTab]=useState(0)
  useEffect(()=>{void supabase.from('projects').select('id:project_id,name,code').eq('status','active').order('name').then(({data,error:loadError})=>{if(loadError)setError(loadError.message);else setProjects((data??[]) as Project[])})},[])
  const results=useMemo(()=>compareSources(sourceA,sourceB),[sourceA,sourceB]),matched=results.filter(row=>row.status==='matched'),changed=results.filter(row=>row.status==='changed'),onlyA=results.filter(row=>row.status==='only_a'),onlyB=results.filter(row=>row.status==='only_b')
  const read=async(side:'a'|'b',file:File|null)=>{if(!file)return;setLoading(side);setError('');try{const data=await readSource(file);if(side==='a')setSourceA(data);else setSourceB(data)}catch(readError){setError(readError instanceof Error?readError.message:'อ่านไฟล์ไม่สำเร็จ')}finally{setLoading('')}}
  if(!canManage)return <Alert severity="error">เฉพาะผู้ดูแลระบบและผู้จัดการ</Alert>
  const shown=tab===1?changed:tab===2?[...onlyA,...onlyB]:tab===3?matched:results
  return <Stack spacing={2.5}>
    <PageHeader title="เปรียบเทียบ BOQ" description="เลือกโครงการและเปรียบเทียบ Excel, CSV หรือ PDF สองไฟล์ก่อนตัดสินใจสร้าง Revision"/>
    {error&&<Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{p:2.5}}><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'1fr 1fr'},gap:2}}>
      <TextField select label="โครงการ" value={projectId} onChange={event=>setProjectId(event.target.value)}><MenuItem value="">เลือกโครงการ</MenuItem>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.code?`${project.code} · `:''}{project.name}</MenuItem>)}</TextField>
      <TextField select label="วัตถุประสงค์" value={purpose} onChange={event=>setPurpose(event.target.value)}>{['ตรวจฉบับเดิมกับฉบับแก้ไข','ตรวจ Excel กับ PDF ฉบับอนุมัติ','ตรวจผู้เสนอราคาสองราย','เทียบงานเก่ากับงานใหม่'].map(item=><MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField>
    </Box></Paper>
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',lg:'1fr 1fr'},gap:2}}>{(['a','b'] as const).map(side=>{const source=side==='a'?sourceA:sourceB;return <Paper key={side} variant="outlined" sx={{p:2.5,borderTop:4,borderTopColor:primary===side?'primary.main':'grey.300'}}><Stack spacing={1.5}><Stack direction="row" sx={{justifyContent:'space-between',alignItems:'center'}}><Typography variant="h6">ไฟล์ {side.toUpperCase()}</Typography><Chip clickable color={primary===side?'primary':'default'} label={primary===side?'ไฟล์หลัก':'กำหนดเป็นไฟล์หลัก'} onClick={()=>setPrimary(side)}/></Stack><Button component="label" variant="outlined" startIcon={<UploadFileOutlinedIcon/>} disabled={Boolean(loading)}>{source?source.fileName:`เลือก Excel, CSV หรือ PDF`}<input hidden type="file" accept=".xlsx,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event=>void read(side,event.target.files?.[0]??null)}/></Button>{loading===side&&<CircularProgress size={24}/>} {source&&<><Alert severity="success">{source.summary}</Alert><Typography variant="body2">ประเภท: {source.kind==='pdf'?'PDF':'Excel/CSV'}</Typography></>}</Stack></Paper>})}</Box>
    {sourceA&&sourceB&&<><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.5}}>{[["ตรงกัน",matched.length,'success'],['เปลี่ยนแปลง',changed.length,'warning'],['เฉพาะ A',onlyA.length,'info'],['เฉพาะ B',onlyB.length,'info']].map(([label,value,color])=><Paper key={String(label)} variant="outlined" sx={{p:2}}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h4" sx={{fontWeight:800}}>{value}</Typography><Chip size="small" color={color as 'success'|'warning'|'info'} label={`${Math.round(Number(value)/Math.max(1,results.length)*100)}%`}/></Paper>)}</Box>
      <Paper variant="outlined"><Tabs value={tab} onChange={(_event,value)=>setTab(value)} variant="scrollable" scrollButtons="auto"><Tab label={`ทั้งหมด (${results.length})`}/><Tab label={`ไม่ตรง (${changed.length})`}/><Tab label={`เพิ่ม/หาย (${onlyA.length+onlyB.length})`}/><Tab label={`ตรงกัน (${matched.length})`}/></Tabs></Paper>
      <StandardDataTable rows={shown} getRowId={row=>row.id} getSearchText={row=>`${row.a?.raw} ${row.b?.raw} ${row.differences.join(' ')}`} searchLabel="ค้นหารหัส รายการ หรือผลต่าง" emptyText="ไม่มีรายการในกลุ่มนี้" exportFileName={`boq-compare-${projectId||'project'}`} minWidth={1350} columns={[
        {id:'status',label:'สถานะ',render:row=><Chip size="small" color={row.status==='matched'?'success':row.status==='changed'?'warning':'info'} label={row.status==='matched'?'ตรงกัน':row.status==='changed'?'เปลี่ยนแปลง':row.status==='only_a'?'เฉพาะ A':'เฉพาะ B'}/>},
        {id:'locationA',label:'ตำแหน่ง A',render:row=>row.a?.location||'-'},{id:'itemA',label:'ไฟล์ A',minWidth:260,render:row=>row.a?<><Typography sx={{fontWeight:700}}>{row.a.code} {row.a.description}</Typography><Typography variant="caption">{row.a.unit} · {row.a.quantity} × {money(row.a.unitPrice)}</Typography></>:'-'},
        {id:'locationB',label:'ตำแหน่ง B',render:row=>row.b?.location||'-'},{id:'itemB',label:'ไฟล์ B',minWidth:260,render:row=>row.b?<><Typography sx={{fontWeight:700}}>{row.b.code} {row.b.description}</Typography><Typography variant="caption">{row.b.unit} · {row.b.quantity} × {money(row.b.unitPrice)}</Typography></>:'-'},
        {id:'difference',label:'ผลต่าง',minWidth:260,render:row=>row.differences.length?row.differences.map(item=><Typography key={item} variant="body2" color="warning.main">{item}</Typography>):'ข้อมูลตรงกัน'},
      ]}/>
      <Alert severity="info" icon={<CompareArrowsOutlinedIcon/>}>ผลเปรียบเทียบนี้ยังไม่แก้ BOQ จริง ไฟล์หลักคือ {primary.toUpperCase()} · วัตถุประสงค์: {purpose} · ตรวจและ Export ได้ก่อนดำเนินการสร้าง Revision</Alert>
    </>}
  </Stack>
}
