import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined'
import { Alert, Avatar, Box, Button, CircularProgress, Container, Paper, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'

export function LineAccountLinkPage(){
  usePageTitle('ผูกบัญชี LINE')
  const {profile,currentCompany}=useAuth()
  const [params]=useSearchParams()
  const navigate=useNavigate()
  const token=useMemo(()=>params.get('token')?.trim()??'',[params])
  const [busy,setBusy]=useState(false)
  const [success,setSuccess]=useState('')
  const [error,setError]=useState('')
  const confirm=async()=>{
    setBusy(true);setError('')
    try {
      const data = await runWithMutationAttempt({
        module: 'LineAccountLink',
        action: 'ผูกบัญชี LINE',
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id ?? null,
        request: { one_time_token: token },
        operation: async () => await supabase.rpc('claim_line_account',{one_time_token:token}),
      })
      const result=data as {employee_name?:string}|null
      setSuccess(`ผูก LINE กับ ${result?.employee_name||profile?.full_name||profile?.email||'บัญชีพนักงาน'} เรียบร้อยแล้ว`)
    } catch (claimError) {
      setError(userError(claimError))
    }
    setBusy(false)
  }
  return <Box sx={{minHeight:{xs:'calc(100vh - 72px)',md:'auto'},display:'grid',placeItems:'center',py:3}}>
    <Container maxWidth={false} sx={{ maxWidth: 560, width: '100%' }}><Paper variant="outlined" sx={{p:{xs:3,sm:4},borderRadius:3}}>
      <Stack spacing={2.5} sx={{alignItems:'center'}}>
        <Avatar sx={{width:54,height:54,bgcolor:'primary.main'}}><LinkOutlinedIcon/></Avatar>
        <Box sx={{textAlign:'center'}}><Typography variant="h5" sx={{fontWeight:850}}>ยืนยันการผูกบัญชี LINE</Typography>
          <Typography color="text.secondary" sx={{mt:.75}}>ตรวจชื่อบัญชีก่อนยืนยัน ลิงก์นี้ใช้ได้ครั้งเดียวภายใน 10 นาที</Typography></Box>
        {error&&<Alert severity="error" sx={{width:'100%'}}>{error}</Alert>}
        {success&&<Alert severity="success" sx={{width:'100%'}}>{success}</Alert>}
        <Paper variant="outlined" sx={{p:2,width:'100%',bgcolor:'background.default'}}>
          <Typography variant="body2" color="text.secondary">พนักงาน</Typography>
          <Typography sx={{fontWeight:750}}>{profile?.full_name||profile?.email||'-'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{mt:1}}>บริษัท</Typography>
          <Typography sx={{fontWeight:750}}>{currentCompany?.company_name||'-'}</Typography>
        </Paper>
        {!token&&<Alert severity="warning" sx={{width:'100%'}}>ไม่พบ Token กรุณากลับไปส่งคำว่า “ผูกบัญชี” ในกลุ่ม LINE ใหม่</Alert>}
        {!success?<Button fullWidth size="large" variant="contained" disabled={busy||!token} onClick={()=>void confirm()}>
          {busy?<CircularProgress size={22} color="inherit"/>:'ยืนยันว่าเป็น LINE ของฉัน'}
        </Button>:<Button fullWidth variant="outlined" onClick={()=>navigate('/time-tracking',{replace:true})}>ไปหน้าลงเวลา</Button>}
        <Typography variant="caption" color="text.secondary" sx={{textAlign:'center'}}>ห้ามส่งต่อลิงก์นี้ให้บุคคลอื่น หากชื่อไม่ถูกต้องให้ปิดหน้าโดยไม่กดยืนยัน</Typography>
      </Stack>
    </Paper></Container>
  </Box>
}

