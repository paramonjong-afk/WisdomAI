import { Alert, Button, Stack } from '@mui/material'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { canManageCompany, isCompanyAdmin, isPlatformAdmin } from '../utils/permissions'

type Access='manager'|'admin'|'platform'

export function RoleRoute({access,children}:{access:Access;children:ReactNode}){
  const {profile,currentCompany}=useAuth()
  const navigate=useNavigate()
  const manager=canManageCompany(profile,currentCompany)
  const admin=isCompanyAdmin(profile,currentCompany)
  const platform=isPlatformAdmin(profile)
  const denied=(access==='manager'&&!manager)||(access==='admin'&&!admin)||(access==='platform'&&!platform)
  if(denied)return <Stack spacing={2} sx={{maxWidth:560,mx:'auto',mt:8}}><Alert severity="error">บัญชีนี้ไม่มีสิทธิ์เปิดหน้านี้</Alert><Button variant="contained" onClick={()=>navigate('/time-tracking',{replace:true})}>กลับหน้าลงเวลา</Button></Stack>
  return children
}
