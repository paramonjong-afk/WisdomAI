import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'

type Vendor={id:string;legal_name:string;contact_name:string|null;phone:string|null;tax_id:string|null;vendor_type:string;vat_registered:boolean;active:boolean}
type Site={id:string;name:string;projects:{name:string}|null}
type Contract={id:string;contractor_id:string;site_id:string;contract_number:string;title:string;pricing_model:string;unit_name:string|null;unit_rate:number|null;contract_amount:number;retention_percent:number;withholding_percent:number;vat_percent:number;starts_on:string;ends_on:string|null;status:string;contractor_vendors:{legal_name:string}|null;project_sites:{name:string;projects:{name:string}|null}|null}
type Claim={id:string;contract_id:string;claim_number:string;period_starts_on:string;period_ends_on:string;description:string;quantity:number|null;progress_percent:number|null;gross_amount:number;retention_amount:number;withholding_amount:number;vat_amount:number;advance_deduction:number;other_deduction:number;net_amount:number;status:string;payment_reference:string|null;contractor_contracts:{contract_number:string;title:string;contractor_vendors:{legal_name:string}|null}|null}
const money=(value:number)=>`฿${Number(value).toLocaleString('th-TH',{minimumFractionDigits:2})}`

export function ContractorsPage(){
  usePageTitle('ผู้รับเหมา')
  const {profile,user}=useAuth()
  const canManage=profile?.role==='admin'||profile?.role==='manager'
  const [tab,setTab]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [message,setMessage]=useState(''),[error,setError]=useState('')
  const [vendors,setVendors]=useState<Vendor[]>([]),[sites,setSites]=useState<Site[]>([])
  const [contracts,setContracts]=useState<Contract[]>([]),[claims,setClaims]=useState<Claim[]>([])
  const [vendor,setVendor]=useState({legal_name:'',contact_name:'',phone:'',tax_id:'',vendor_type:'individual',vat_registered:'false'})
  const [contract,setContract]=useState({contractor_id:'',site_id:'',contract_number:'',title:'',pricing_model:'daily',unit_name:'วัน',unit_rate:'0',contract_amount:'0',retention_percent:'5',withholding_percent:'3',vat_percent:'0',starts_on:'',ends_on:''})
  const [claim,setClaim]=useState({contract_id:'',claim_number:'',period_starts_on:'',period_ends_on:'',description:'',quantity:'',progress_percent:'',gross_amount:'0',retention_amount:'0',withholding_amount:'0',vat_amount:'0',advance_deduction:'0',other_deduction:'0'})
  const [paymentRefs,setPaymentRefs]=useState<Record<string,string>>({})

  const load=useCallback(async()=>{
    if(!canManage)return
    setLoading(true);setError('')
    const [v,s,c,cl]=await Promise.all([
      supabase.from('contractor_vendors').select('*').order('legal_name'),
      supabase.from('project_sites').select('id,name,projects(name)').eq('active',true).order('name'),
      supabase.from('contractor_contracts').select('*,contractor_vendors(legal_name),project_sites(name,projects(name))').order('created_at',{ascending:false}),
      supabase.from('contractor_payment_claims').select('*,contractor_contracts(contract_number,title,contractor_vendors(legal_name))').order('created_at',{ascending:false}),
    ])
    const first=[v,s,c,cl].find((item)=>item.error)?.error;if(first)setError(first.message)
    setVendors((v.data??[]) as Vendor[]);setSites((s.data??[]) as unknown as Site[])
    setContracts((c.data??[]) as unknown as Contract[]);setClaims((cl.data??[]) as unknown as Claim[])
    setLoading(false)
  },[canManage])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])
  const run=async(operation:()=>PromiseLike<{error:{message:string}|null}>,success:string)=>{
    setBusy(true);setMessage('');setError('');const result=await operation()
    if(result.error)setError(userError(result.error));else{setMessage(success);await load()}setBusy(false)
  }
  const addVendor=()=>run(()=>supabase.from('contractor_vendors').insert({
    ...vendor,vat_registered:vendor.vat_registered==='true',created_by:user?.id,
  }),'เพิ่มผู้รับเหมาแล้ว')
  const addContract=()=>run(()=>supabase.from('contractor_contracts').insert({
    ...contract,unit_rate:Number(contract.unit_rate)||null,contract_amount:Number(contract.contract_amount),
    retention_percent:Number(contract.retention_percent),withholding_percent:Number(contract.withholding_percent),
    vat_percent:Number(contract.vat_percent),ends_on:contract.ends_on||null,created_by:user?.id,status:'active',
  }),'สร้างสัญญาผู้รับเหมาแล้ว')
  const addClaim=()=>run(()=>supabase.from('contractor_payment_claims').insert({
    ...claim,quantity:claim.quantity?Number(claim.quantity):null,progress_percent:claim.progress_percent?Number(claim.progress_percent):null,
    gross_amount:Number(claim.gross_amount),retention_amount:Number(claim.retention_amount),
    withholding_amount:Number(claim.withholding_amount),vat_amount:Number(claim.vat_amount),
    advance_deduction:Number(claim.advance_deduction),other_deduction:Number(claim.other_deduction),created_by:user?.id,
  }),'ส่งงวดเบิกผู้รับเหมาแล้ว')
  const action=(row:Claim,target_action:string)=>run(()=>supabase.rpc('transition_contractor_claim',{
    target_claim_id:row.id,target_action,target_payment_reference:target_action==='mark_paid'?paymentRefs[row.id]||null:null,
    target_note:target_action==='reject'?'ไม่ผ่านการตรวจรับ':null,
  }),'ปรับสถานะงวดเบิกแล้ว')
  if(!canManage)return <Alert severity="error">เฉพาะผู้จัดการและผู้ดูแลระบบ</Alert>
  if(loading)return <Stack sx={{alignItems:'center',py:8}}><CircularProgress/></Stack>
  return <Stack spacing={3}>
    <PageHeader title="ผู้รับเหมา" description="ทะเบียนผู้รับเหมา · สัญญา · ตรวจรับงวดงาน · หักภาษี/Retention · จ่ายเงิน" />
    {message&&<Alert severity="success">{message}</Alert>}{error&&<Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{position:'sticky',top:64,zIndex:5}}><Tabs value={tab} onChange={(_e,v)=>setTab(v)} variant="scrollable" scrollButtons="auto"><Tab label="ทะเบียน"/><Tab label="สัญญา"/><Tab label="งวดงานและจ่ายเงิน"/></Tabs></Paper>
    {tab===0&&<>
      <Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}><Stack spacing={2}>
        <Typography variant="h6">เพิ่มผู้รับเหมา</Typography>
        <TextField label="ชื่อบุคคล/บริษัท" value={vendor.legal_name} onChange={(e)=>setVendor({...vendor,legal_name:e.target.value})}/>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth label="ผู้ติดต่อ" value={vendor.contact_name} onChange={(e)=>setVendor({...vendor,contact_name:e.target.value})}/>
          <TextField fullWidth label="โทรศัพท์" value={vendor.phone} onChange={(e)=>setVendor({...vendor,phone:e.target.value})}/>
          <TextField fullWidth label="เลขผู้เสียภาษี" value={vendor.tax_id} onChange={(e)=>setVendor({...vendor,tax_id:e.target.value})}/>
          <TextField fullWidth select label="ประเภท" value={vendor.vendor_type} onChange={(e)=>setVendor({...vendor,vendor_type:e.target.value})}><MenuItem value="individual">บุคคล</MenuItem><MenuItem value="company">บริษัท</MenuItem></TextField>
          <TextField fullWidth select label="VAT" value={vendor.vat_registered} onChange={(e)=>setVendor({...vendor,vat_registered:e.target.value})}><MenuItem value="false">ไม่จด VAT</MenuItem><MenuItem value="true">จด VAT</MenuItem></TextField>
        </Stack>
        <Stack direction="row" sx={{justifyContent:'flex-end'}}><Button variant="contained" disabled={busy||vendor.legal_name.trim().length<2} onClick={()=>void addVendor()}>บันทึกผู้รับเหมา</Button></Stack>
      </Stack></Paper>
      <StandardDataTable rows={vendors} getRowId={(r)=>r.id} getSearchText={(r)=>`${r.legal_name} ${r.tax_id}`} searchLabel="ค้นหาผู้รับเหมา" emptyText="ไม่มีผู้รับเหมา" columns={[
        {id:'name',label:'ผู้รับเหมา',render:(r)=>r.legal_name},{id:'contact',label:'ติดต่อ',render:(r)=>`${r.contact_name??'-'} ${r.phone??''}`},{id:'tax',label:'เลขภาษี',render:(r)=>r.tax_id??'-'},{id:'vat',label:'VAT',render:(r)=>r.vat_registered?'จด VAT':'ไม่จด VAT'},
      ]}/>
    </>}
    {tab===1&&<>
      <Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}><Stack spacing={2}>
        <Typography variant="h6">สร้างสัญญา/ใบสั่งจ้าง</Typography>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField select fullWidth label="ผู้รับเหมา" value={contract.contractor_id} onChange={(e)=>setContract({...contract,contractor_id:e.target.value})}>{vendors.map((v)=><MenuItem key={v.id} value={v.id}>{v.legal_name}</MenuItem>)}</TextField>
          <TextField select fullWidth label="ไซต์" value={contract.site_id} onChange={(e)=>setContract({...contract,site_id:e.target.value})}>{sites.map((s)=><MenuItem key={s.id} value={s.id}>{s.projects?.name} · {s.name}</MenuItem>)}</TextField>
          <TextField fullWidth label="เลขที่สัญญา" value={contract.contract_number} onChange={(e)=>setContract({...contract,contract_number:e.target.value})}/>
        </Stack>
        <TextField label="ชื่องาน" value={contract.title} onChange={(e)=>setContract({...contract,title:e.target.value})}/>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField select fullWidth label="วิธีคิดเงิน" value={contract.pricing_model} onChange={(e)=>setContract({...contract,pricing_model:e.target.value})}><MenuItem value="daily">รายวัน</MenuItem><MenuItem value="quantity">ตามปริมาณ</MenuItem><MenuItem value="lump_sum">เหมาจบ/งวดงาน</MenuItem></TextField>
          <TextField fullWidth label="หน่วย" value={contract.unit_name} onChange={(e)=>setContract({...contract,unit_name:e.target.value})}/>
          <TextField fullWidth type="number" label="ราคาต่อหน่วย" value={contract.unit_rate} onChange={(e)=>setContract({...contract,unit_rate:e.target.value})}/>
          <TextField fullWidth type="number" label="มูลค่าสัญญา" value={contract.contract_amount} onChange={(e)=>setContract({...contract,contract_amount:e.target.value})}/>
        </Stack>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth type="number" label="Retention %" value={contract.retention_percent} onChange={(e)=>setContract({...contract,retention_percent:e.target.value})}/>
          <TextField fullWidth type="number" label="หัก ณ ที่จ่าย %" value={contract.withholding_percent} onChange={(e)=>setContract({...contract,withholding_percent:e.target.value})}/>
          <TextField fullWidth type="number" label="VAT %" value={contract.vat_percent} onChange={(e)=>setContract({...contract,vat_percent:e.target.value})}/>
          <TextField fullWidth type="date" label="เริ่ม" value={contract.starts_on} onChange={(e)=>setContract({...contract,starts_on:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
          <TextField fullWidth type="date" label="สิ้นสุด" value={contract.ends_on} onChange={(e)=>setContract({...contract,ends_on:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
        </Stack>
        <Stack direction="row" sx={{justifyContent:'flex-end'}}><Button variant="contained" disabled={busy||!contract.contractor_id||!contract.site_id||!contract.contract_number||!contract.title||!contract.starts_on} onClick={()=>void addContract()}>สร้างสัญญา</Button></Stack>
      </Stack></Paper>
      <StandardDataTable rows={contracts} getRowId={(r)=>r.id} getSearchText={(r)=>`${r.contract_number} ${r.title} ${r.contractor_vendors?.legal_name}`} searchLabel="ค้นหาสัญญา" emptyText="ไม่มีสัญญา" columns={[
        {id:'no',label:'เลขที่',render:(r)=>r.contract_number},{id:'vendor',label:'ผู้รับเหมา',render:(r)=>r.contractor_vendors?.legal_name??'-'},{id:'job',label:'งาน/ไซต์',render:(r)=>`${r.title} · ${r.project_sites?.name??'-'}`},{id:'model',label:'วิธีคิด',render:(r)=>r.pricing_model},{id:'amount',label:'มูลค่า',render:(r)=>money(r.contract_amount)},{id:'status',label:'สถานะ',render:(r)=>r.status},
      ]}/>
    </>}
    {tab===2&&<>
      <Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}><Stack spacing={2}>
        <Typography variant="h6">บันทึกผลงาน/งวดเบิก</Typography>
        <Typography variant="subtitle2" color="text.secondary">ข้อมูลงวดงาน</Typography>
        <TextField select label="สัญญา" value={claim.contract_id} onChange={(e)=>setClaim({...claim,contract_id:e.target.value})}>{contracts.filter((c)=>c.status==='active').map((c)=><MenuItem key={c.id} value={c.id}>{c.contract_number} · {c.contractor_vendors?.legal_name} · {c.title}</MenuItem>)}</TextField>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth label="เลขงวด/เลขใบเบิก" value={claim.claim_number} onChange={(e)=>setClaim({...claim,claim_number:e.target.value})}/>
          <TextField fullWidth type="date" label="เริ่มรอบ" value={claim.period_starts_on} onChange={(e)=>setClaim({...claim,period_starts_on:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
          <TextField fullWidth type="date" label="สิ้นสุดรอบ" value={claim.period_ends_on} onChange={(e)=>setClaim({...claim,period_ends_on:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
        </Stack>
        <TextField label="รายละเอียดงานที่ส่งตรวจ" value={claim.description} onChange={(e)=>setClaim({...claim,description:e.target.value})}/>
        <Typography variant="subtitle2" color="text.secondary" sx={{pt:1}}>มูลค่าผลงาน</Typography>
        <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,1fr)',lg:'repeat(3,1fr)'},gap:2}}>
          {([['ปริมาณ','quantity'],['ความก้าวหน้า %','progress_percent'],['ยอดผลงาน','gross_amount']] as const).map(([label,key])=><TextField key={key} fullWidth type="number" label={label} value={claim[key]} onChange={(e)=>setClaim({...claim,[key]:e.target.value})}/>)}
        </Box>
        <Typography variant="subtitle2" color="text.secondary" sx={{pt:1}}>ภาษีและรายการหัก</Typography>
        <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,1fr)',lg:'repeat(3,1fr)'},gap:2}}>
          {([['Retention','retention_amount'],['หัก ณ ที่จ่าย','withholding_amount'],['VAT','vat_amount'],['หักเงินล่วงหน้า','advance_deduction'],['หักอื่น ๆ','other_deduction']] as const).map(([label,key])=><TextField key={key} fullWidth type="number" label={label} value={claim[key]} onChange={(e)=>setClaim({...claim,[key]:e.target.value})}/>)}
        </Box>
        <Stack direction="row" sx={{justifyContent:'flex-end',pt:1}}><Button variant="contained" disabled={busy||!claim.contract_id||!claim.claim_number||!claim.period_starts_on||!claim.period_ends_on||claim.description.trim().length<3} onClick={()=>void addClaim()}>ส่งตรวจงวดงาน</Button></Stack>
      </Stack></Paper>
      <StandardDataTable rows={claims} getRowId={(r)=>r.id} getSearchText={(r)=>`${r.claim_number} ${r.contractor_contracts?.contract_number} ${r.contractor_contracts?.contractor_vendors?.legal_name} ${r.status}`} searchLabel="ค้นหางวดงาน" emptyText="ไม่มีงวดงาน" columns={[
        {id:'claim',label:'งวด',render:(r)=>`${r.claim_number} · ${r.contractor_contracts?.contract_number}`},{id:'vendor',label:'ผู้รับเหมา',render:(r)=>r.contractor_contracts?.contractor_vendors?.legal_name??'-'},{id:'gross',label:'ผลงาน',render:(r)=>money(r.gross_amount)},{id:'net',label:'สุทธิ',render:(r)=>money(r.net_amount)},{id:'status',label:'สถานะ',render:(r)=>r.status},{id:'action',label:'ดำเนินการ',minWidth:260,render:(r)=><Stack spacing={1}>
          {r.status==='submitted'&&<Stack direction="row" spacing={1}><Button size="small" onClick={()=>void action(r,'approve')}>อนุมัติ</Button><Button size="small" color="error" onClick={()=>void action(r,'reject')}>ปฏิเสธ</Button></Stack>}
          {r.status==='approved'&&<Button size="small" onClick={()=>void action(r,'send_to_payment')}>ส่งรอจ่าย</Button>}
          {r.status==='pending_payment'&&<><TextField size="small" label="เลขอ้างอิงโอน" value={paymentRefs[r.id]??''} onChange={(e)=>setPaymentRefs({...paymentRefs,[r.id]:e.target.value})}/><Button size="small" variant="contained" disabled={!paymentRefs[r.id]?.trim()} onClick={()=>void action(r,'mark_paid')}>ยืนยันจ่ายแล้ว</Button></>}
        </Stack>},
      ]}/>
    </>}
  </Stack>
}
