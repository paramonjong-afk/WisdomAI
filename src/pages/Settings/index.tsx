import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography
} from '@mui/material'
import {useCallback,useEffect,useMemo,useState} from 'react'
import {PageHeader} from '../../components/PageHeader'
import {useAuth} from '../../hooks/useAuth'
import { isPlatformAdmin as resolvePlatformAdmin } from '../../utils/permissions'
import {usePageTitle} from '../../hooks/usePageTitle'
import {supabase} from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { navigationGroups } from '../../utils/navigation'

type RouteAccess = 'employee'|'manager'|'admin'|'platform'
type Member={profile_id:string;company_role:keyof typeof roles;member_type:'admin_only'|'employee'|'admin_employee';profiles:{full_name:string|null;email:string|null}|null}
type PermissionRow={module:string;path:string;area:string;access:RouteAccess}
type SopStep={name:string;desc:string}
type DeleteCandidate={profile_id:string;created_at:string;email:string|null;full_name:string|null}

const roles={company_admin:'ผู้ดูแลบริษัท',executive:'ผู้บริหาร',manager:'ผู้จัดการ',site_supervisor:'ผู้ควบคุมไซต์',accounting_hr:'บัญชี/บุคคล',employee:'พนักงาน'}

const staticRoutes:PermissionRow[]=[
  {module:'ศูนย์ควบคุมงาน',path:'/work-command-center',area:'ระบบตรวจสอบ',access:'admin'},
  {module:'สถานะระบบ',path:'/system-health',area:'ระบบตรวจสอบ',access:'admin'},
  {module:'Mutation Attempt Center',path:'/mutation-attempt-center',area:'ระบบตรวจสอบ',access:'admin'},
  {module:'Platform Control Center',path:'/platform-control-center',area:'ระบบตรวจสอบ',access:'platform'},
]

  const sopSteps: SopStep[] = [
  { name: '1) สร้าง/เช็กบัญชี', desc: 'อีเมลต้องเป็นบัญชีที่มีอยู่แล้ว' },
  { name: '2) เปิดหน้า Settings', desc: 'เลือกเมนูตั้งค่าหรือ /settings' },
  { name: '3) เพิ่มสมาชิก', desc: 'ใส่อีเมล + บทบาทให้ตรงกับงาน' },
  { name: '4) เลือกเป็นพนักงาน', desc: 'ถ้าต้องลงเวลา/Payroll ให้เปิดนับเป็นพนักงาน' },
  { name: '5) ยืนยัน', desc: 'เช็กบริษัทและสิทธิ์ที่ได้อัปเดตเรียบร้อยแล้ว' },
]

const roleScopeLabel: Record<RouteAccess, string> = {
  employee: 'พนักงาน',
  manager: 'ผู้จัดการ+',
  admin: 'ผู้ดูแลระบบ',
  platform: 'Platform Admin',
}

const permissionRows: PermissionRow[] = [
  ...navigationGroups.flatMap((group)=>group.items.map((item) => {
    const access: RouteAccess = item.platformOnly ? 'platform'
      : item.roles?.includes('admin') && !item.roles?.includes('manager') && !item.roles?.includes('employee') ? 'admin'
        : item.roles?.includes('manager') && !item.roles?.includes('admin') && !item.roles?.includes('employee') ? 'manager'
          : item.roles?.length === 1 && item.roles[0] === 'employee' ? 'employee'
            : 'manager'
    return { module:item.label, path:item.path, area:group.label, access }
  })),
  ...staticRoutes,
]

type DeleteCommandMode = 'delete_latest' | 'delete_by_profile'
type CentralDeleteCommand = {
  command?: DeleteCommandMode
  action?: DeleteCommandMode
  count?: number
  profileIds?: string[]
  reason?: string
}

export function SettingsPage(){
  usePageTitle('ตั้งค่าระบบ')
  const {companies,currentCompany,profile}=useAuth()
  const isPlatformAdmin=resolvePlatformAdmin(profile)
  const [company,setCompany]=useState({name:'',slug:''})
  const [member,setMember]=useState({email:'',role:'employee'})
  const [busy,setBusy]=useState(false)
  const [isCleanupBusy,setIsCleanupBusy]=useState(false)
  const [isCommandBusy,setIsCommandBusy]=useState(false)
  const [latestCandidates,setLatestCandidates]=useState<DeleteCandidate[]>([])
  const [commandRaw,setCommandRaw]=useState('{\n  "command": "delete_latest",\n  "count": 2,\n  "reason": "ลบข้อมูลทดสอบ"\n}')
  const [commandPreview,setCommandPreview]=useState<DeleteCandidate[]>([])
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [members,setMembers]=useState<Member[]>([])
  const [tabIndex,setTabIndex]=useState(0)

  const isManager = profile?.role==='admin'||profile?.role==='manager'||['company_admin','executive','manager','site_supervisor'].includes(currentCompany?.company_role ?? '')
  const isAdmin = profile?.role==='admin'||currentCompany?.company_role==='company_admin'
  const isEmployee = profile?.role==='employee'

  const canAccess=(access:RouteAccess)=>(
    access==='platform' ? isPlatformAdmin :
    access==='admin' ? isAdmin :
    access==='manager' ? isManager : true
  )

  const getRoleAccess = (companyRole: keyof typeof roles): RouteAccess => {
    if (companyRole === 'company_admin' || companyRole === 'executive') return 'admin'
    if (companyRole === 'manager' || companyRole === 'site_supervisor' || companyRole === 'accounting_hr') return 'manager'
    return 'employee'
  }

  const getPermissionSummary = (memberRole: keyof typeof roles) => {
    const roleAccess = getRoleAccess(memberRole)
    const canAccessBy = (access: RouteAccess) => (access === 'platform' ? false : (
      access === 'admin' ? ['admin','platform'].includes(roleAccess) :
      access === 'manager' ? ['manager','admin'].includes(roleAccess) :
      true
    ))
    const accessible = permissionRows.flatMap((row) => row.access === 'platform' ? [] : (canAccessBy(row.access) ? [{ path: row.path, module: row.module, area: row.area }] : []))
    return { roleLabel: roles[memberRole], roleAccess, accessibleCount: accessible.length, totalRoutes: permissionRows.filter((row)=>row.access!=='platform').length, accessible }
  }

  const groupedPermissionRows = useMemo(() => {
    const grouped = permissionRows.reduce<Record<string, PermissionRow[]>>((acc, row) => {
      if (!acc[row.area]) acc[row.area] = []
      acc[row.area].push(row)
      return acc
    }, {})
    return Object.entries(grouped).map(([area, rows]) => ({ area, rows }))
  }, [])

  const actionChecks = [
    {module:'ตั้งค่า/เพิ่มบริษัท', detail:'เพิ่ม/ลบบริษัทในระบบ', allow:isPlatformAdmin},
    {module:'เพิ่มสมาชิก', detail:'กำหนดบทบาทพนักงาน/ผู้ดูแล', allow:isAdmin},
    {module:'เอกสาร Payroll', detail:'แก้ข้อมูลบุคคล/เงินเดือน', allow:isManager},
    {module:'Work Command', detail:'ควบคุมระบบสำคัญ', allow:isAdmin},
  ]

  const loadMembers=useCallback(async()=>{
    if(!currentCompany)return
    const {data,error:loadError}=await supabase.from('company_members').select('profile_id,company_role,member_type,profiles(full_name,email)').eq('company_id',currentCompany.company_id).eq('active',true).order('created_at')
    if(loadError)setError(userError(loadError))
    else setMembers((data??[]) as unknown as Member[])
  },[currentCompany])

  const loadLatestCandidates=useCallback(async()=>{
    if(!currentCompany)return []
    const {data,error}=await supabase
      .from('company_members')
      .select('profile_id,created_at,profiles(full_name,email)')
      .eq('company_id',currentCompany.company_id)
      .eq('active',true)
      .order('created_at',{ascending:false})
      .limit(2)
    if(error){
      setError(userError(error))
      return []
    }
    return (data ?? []).map((row: {profile_id:string;created_at:string;profiles:{full_name:string|null;email:string|null}|{full_name:string|null;email:string|null}[]|null})=>{
      const profileData = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
      profile_id:row.profile_id,
      created_at:row.created_at,
      email:profileData?.email ?? null,
      full_name:profileData?.full_name ?? null,
      }
    })
  },[currentCompany])

  const deleteLatest2Employees=async()=> {
    setIsCleanupBusy(true)
    setError('')
    setSuccess('')
    const candidates=await loadLatestCandidates()
    if(candidates.length===0){
      setError('ไม่พบพนักงานล่าสุด 2 คนที่จะแสดง/ลบ')
      setIsCleanupBusy(false)
      return
    }
    setLatestCandidates(candidates)
    const profileNames=candidates.map((item,idx)=>`${idx+1}. ${item.full_name??item.email??item.profile_id}`).join('\n')
    const confirmMessage=`ยืนยันลบ ${candidates.length} รายการล่าสุด?\n${profileNames}`
    if(!window.confirm(confirmMessage)){
      setIsCleanupBusy(false)
      return
    }
    const failures:string[]=[]
    for(const candidate of candidates){
      const {error:invokeError}=await supabase.functions.invoke('manage-employee',{
        body:{profileId:candidate.profile_id,action:'delete',reason:'ลบข้อมูลทดสอบ'},
      })
      if(invokeError)failures.push(candidate.full_name||candidate.email||candidate.profile_id)
    }
    if(failures.length===0){
      setSuccess('ลบข้อมูล 2 คนล่าสุดเรียบร้อยแล้ว')
      await loadMembers()
    } else {
      setError(`ลบไม่ครบ ${failures.length} รายการ: ${failures.join(', ')}`)
    }
    setIsCleanupBusy(false)
  }

  const normalizeDeleteCommand = async (raw: string): Promise<{action:'delete'; reason:string; targets: DeleteCandidate[]; errors:string[]}> => {
    const result = {action:'delete' as const, reason:'', targets:[] as DeleteCandidate[], errors:[] as string[]}
    const trimmed = raw.trim()
    if (!trimmed) {
      result.errors.push('ยังไม่ใส่คำสั่ง')
      return result
    }

    let parsed: CentralDeleteCommand
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      result.errors.push('คำสั่งต้องเป็น JSON ที่ถูกต้อง เช่น {"command":"delete_latest","count":2,"reason":"ลบข้อมูลทดสอบ"}')
      return result
    }

    const command = (parsed.command ?? parsed.action) ?? ''
    if (command !== 'delete_latest' && command !== 'delete_by_profile') {
      result.errors.push('command/action ต้องเป็น "delete_latest" หรือ "delete_by_profile"')
      return result
    }

    result.reason = (parsed.reason ?? 'ลบข้อมูลตามคำสั่ง').trim() || 'ลบข้อมูลตามคำสั่ง'

    if (command === 'delete_latest') {
      const count = Number(parsed.count ?? 0)
      if (!Number.isInteger(count) || count <= 0) {
        result.errors.push('delete_latest ต้องมี count เป็นจำนวนเต็มมากกว่า 0')
        return result
      }
      const candidates = await loadLatestCandidates()
      if (candidates.length === 0) {
        result.errors.push('ไม่พบพนักงานล่าสุดในบริษัท')
        return result
      }
      if (count > candidates.length) {
        result.errors.push(`พนักงานล่าสุดไม่พอ: คำสั่งต้องลบ ${count} คน แต่มีเพียง ${candidates.length} คน`)
        return result
      }
      result.targets = candidates.slice(0, count)
      return result
    }

    const list = parsed.profileIds ?? []
    if (!Array.isArray(list) || list.length === 0) {
      result.errors.push('delete_by_profile ต้องมี profileIds เป็นอาเรย์ที่ไม่ว่าง')
      return result
    }

    const uniqueIds = Array.from(new Set(list.map((item) => String(item).trim()).filter(Boolean)))
    if (uniqueIds.length === 0) {
      result.errors.push('ไม่พบ profileId ที่ใช้งานได้จาก profileIds')
      return result
    }

    const {data, error} = await supabase
      .from('company_members')
      .select('profile_id,created_at,profiles(full_name,email)')
      .eq('company_id', currentCompany?.company_id ?? '')
      .eq('active', true)
      .in('profile_id', uniqueIds)
    if (error) {
      result.errors.push(userError(error))
      return result
    }

    const found = (data ?? []).map((row: { profile_id: string; created_at: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null }) => {
      const profileData = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        profile_id: row.profile_id,
        created_at: row.created_at,
        email: profileData?.email ?? null,
        full_name: profileData?.full_name ?? null,
      }
    })
    const foundMap = new Map(found.map((row) => [row.profile_id, row]))
    const missing = uniqueIds.filter((id) => !foundMap.has(id))
    if (missing.length) {
      result.errors.push(`ไม่พบโปรไฟล์ในบริษัทปัจจุบัน: ${missing.join(', ')}`)
    }
    result.targets = uniqueIds.map((id) => foundMap.get(id) ?? { profile_id: id, created_at: new Date().toISOString(), full_name: null, email: null })
    return result
  }

  const runCentralDeleteCommand=async()=>{
    setIsCommandBusy(true)
    setError('')
    setSuccess('')
    setCommandPreview([])
    try {
      const normalized = await runWithMutationAttempt<Record<string, unknown>, {
        targets: DeleteCandidate[]
        action: 'delete'
        reason: string
        errors: string[]
      }>({
        module:'settings.delete_command',
        action:'รันคำสั่งจัดการพนักงาน',
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id,
        request: { rawCommand: commandRaw },
        errorAction: 'รันคำสั่งจัดการพนักงานไม่สำเร็จ',
        operation: async () => {
          const normalized = await normalizeDeleteCommand(commandRaw)
          if (normalized.errors.length) {
            throw new Error(normalized.errors.join(' | '))
          }
          if (normalized.targets.length === 0) {
            throw new Error('ไม่พบข้อมูลเป้าหมายในการลบ')
          }

          const previewLines = normalized.targets.map((item, idx) => `${idx + 1}. ${item.full_name ?? item.email ?? item.profile_id}`)
          setCommandPreview(normalized.targets)
          const confirmed = window.confirm(`ยืนยันรันคำสั่งลบ ${normalized.targets.length} คน?\n${previewLines.join('\n')}`)
          if (!confirmed) {
            throw new Error('ยกเลิกคำสั่งโดยผู้ใช้')
          }

          const failures: string[] = []
          for (const target of normalized.targets) {
            const {error:invokeError}=await supabase.functions.invoke('manage-employee',{
              body:{
                profileId:target.profile_id,
                action:normalized.action,
                reason:normalized.reason,
              },
            })
            if (invokeError) {
              const message = userError(invokeError)
              failures.push(`${target.full_name ?? target.email ?? target.profile_id}: ${message}`)
            }
          }

          if (failures.length === 0) {
            return { ...normalized }
          }
          throw new Error(`ลบไม่ครบ ${failures.length} รายการ: ${failures.join(' | ')}`)
        },
      })
      setSuccess(`รันคำสั่งเรียบร้อย ลบครบ ${normalized.targets.length} คน`)
      await loadMembers()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'รันคำสั่งไม่สำเร็จ')
    } finally {
      setIsCommandBusy(false)
    }
  }

  useEffect(()=>{const timer=window.setTimeout(()=>void loadMembers(),0);return()=>window.clearTimeout(timer)},[loadMembers])

  const run=async(
    action:()=>Promise<{error:unknown}>,
    message:string,
    request: Record<string, unknown> = {},
  )=> {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await runWithMutationAttempt({
        module: 'settings',
        action: message,
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id,
        request,
        operation: action,
        errorAction: message,
      })
      setSuccess(message)
      if (message === 'เพิ่มสมาชิกบริษัทแล้ว' || message === 'สร้างบริษัทแล้ว') {
        window.setTimeout(() => window.location.reload(), 700)
      } else {
        await loadMembers()
      }
    } catch (error) {
      setError(userError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={1.5}>
      <PageHeader title="บริษัทและสิทธิ์ใช้งาน" description="จัดการสิทธิ์และสมาชิกต่อคนแบบอ่านเร็ว"/>

      <Paper variant="outlined" sx={{p:1.5}}>
        <Tabs value={tabIndex} onChange={(_,v)=>setTabIndex(v)} variant="scrollable" scrollButtons="auto" sx={{mb:1}}>
          <Tab label="สรุป" />
          <Tab label="สิทธิ์/คน" />
          <Tab label="สิทธิ์หน้าเมนู" />
          <Tab label="ปฏิบัติ" />
        </Tabs>

        {tabIndex===0&&(
          <Box>
            <Stack spacing={1}>
              <Typography variant="subtitle1" sx={{fontWeight:700}}>สิทธิ์ปัจจุบัน</Typography>
              <Typography>ระบบ: {profile?.role ?? '-'} / บริษัท: {currentCompany?.company_role ?? '-'}</Typography>
              <Stack direction="row" spacing={0.75} sx={{flexWrap:'wrap'}}>
                {!isEmployee && <Chip size="small" color="primary" label="manager+"/>}
                {isManager && <Chip size="small" color="success" label="manager"/>}
                {isAdmin && <Chip size="small" color="secondary" label="admin"/>}
                {isPlatformAdmin && <Chip size="small" color="warning" label="platform"/>}
              </Stack>

              <Typography variant="subtitle2" sx={{mt:1}}>SOP ตั้งสิทธิ์</Typography>
              <Stack spacing={0.6}>
                {sopSteps.map((item)=>(
                  <Stack key={item.name} direction="row" spacing={1} sx={{alignItems:'flex-start'}}>
                    <Typography sx={{minWidth: 130, color:'text.secondary'}}>{item.name}</Typography>
                    <Typography>{item.desc}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Box>
        )}

        {tabIndex===1&&(
          <Box>
            <Stack spacing={1}>
              {members.map((item) => {
                const isEmployeeItem=item.member_type!=='admin_only'
                const adminRole=['company_admin','executive','manager'].includes(item.company_role)
                const summary = getPermissionSummary(item.company_role)
                return (
                  <Paper key={`${item.profile_id}-perm`} variant="outlined" sx={{p:1}}>
                    <Stack spacing={0.75}>
                      <Stack direction={{xs:'column',md:'row'}} spacing={0.75} sx={{justifyContent:'space-between',alignItems:{md:'center'}}}>
                        <Stack>
                          <Typography sx={{fontWeight:700}}>{item.profiles?.full_name||item.profiles?.email||item.profile_id}</Typography>
                          <Stack direction="row" spacing={0.5} sx={{mt:0.25, flexWrap:'wrap'}}>
                            <Chip size="small" label={summary.roleLabel}/>
                            <Chip size="small" color={adminRole?'secondary':'default'} label={`สิทธิ์: ${roleScopeLabel[summary.roleAccess]}`}/>
                            <Chip size="small" color={isEmployeeItem?'success':'default'} label={isEmployeeItem?'พนักงาน':'ไม่ลงเวลา'}/>
                          </Stack>
                        </Stack>
                        <Stack direction="row" spacing={0.5}>
                          <Chip size="small" label={`Route: ${summary.accessibleCount}/${summary.totalRoutes}`}/>
                          <Chip size="small" color="info" label="Platform: -"/>
                        </Stack>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        ตัวอย่าง: {summary.accessible.slice(0, 4).map((row) => `${row.area}:${row.module}`).join(', ') || '-'}
                        {summary.accessible.length > 4 ? ` +อีก ${summary.accessible.length - 4} รายการ` : ''}
                      </Typography>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          </Box>
        )}

        {tabIndex===2&&(
          <Box>
            <Stack spacing={1}>
              {groupedPermissionRows.map((group) => {
                const canAll = group.rows.filter((row) => canAccess(row.access)).length
                return (
                  <Stack key={group.area} spacing={0.5}>
                    <Typography variant="subtitle2" sx={{color:'text.secondary'}}>{group.area}</Typography>
                    {group.rows.map((item) => {
                      const allowed = canAccess(item.access)
                      return (
                        <Stack
                          key={`${item.area}-${item.path}`}
                          direction={{xs:'column',md:'row'}}
                          spacing={0.5}
                          sx={{justifyContent:'space-between',alignItems:{md:'center'}}}
                        >
                          <Typography variant="body2">{item.module} ({item.path})</Typography>
                          <Chip color={allowed ? 'success' : 'default'} size="small" label={allowed ? 'ผ่าน' : 'ไม่ผ่าน'}/>
                        </Stack>
                      )
                    })}
                    <Typography variant="caption" color="text.secondary">
                      ผ่าน {canAll}/{group.rows.length}
                    </Typography>
                    <Divider />
                  </Stack>
                )
              })}

              <Typography variant="subtitle2" sx={{mt:1}}>สิทธิ์การกระทำ</Typography>
              <Stack spacing={0.75}>
                {actionChecks.map((item)=>(
                  <Stack key={item.module} direction="row" spacing={1} sx={{justifyContent:'space-between',alignItems:'center'}}>
                    <Typography variant="body2">{item.module}: {item.detail}</Typography>
                    <Chip color={item.allow ? 'success' : 'warning'} size="small" label={item.allow ? 'ทำได้' : 'ไม่ทำได้'}/>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Box>
        )}

        {tabIndex===3&&(
          <Box>
            <Stack spacing={1}>
              <Typography variant="subtitle1" sx={{fontWeight:700}}>บริษัท</Typography>
              <Stack spacing={0.75}>
                {companies.map((item)=><Stack key={item.company_id} direction="row" spacing={1} sx={{justifyContent:'space-between',alignItems:'center'}}><Typography>{item.company_name}{item.is_active?' · ใช้งานอยู่':''}</Typography><Typography color="text.secondary">{roles[item.company_role]??item.company_role}</Typography></Stack>)}
              </Stack>

              <Alert severity={isPlatformAdmin?'info':'warning'} sx={{my:0.75}}>
                {isPlatformAdmin?'เฉพาะ Platform Admin เท่านั้นที่สร้างบริษัทได้':'เฉพาะ Platform Admin เท่านั้น'}
              </Alert>
              <Stack spacing={1}>
                <TextField disabled={!isPlatformAdmin} label="ชื่อบริษัท" value={company.name} onChange={event=>setCompany({...company,name:event.target.value})}/>
                <TextField disabled={!isPlatformAdmin} label="รหัสบริษัท" helperText="a-z 0-9 - " value={company.slug} onChange={event=>setCompany({...company,slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')})}/>
                <Button variant="contained" disabled={busy||!isPlatformAdmin||!company.name.trim()||!company.slug.trim()} onClick={()=>void run(async()=>supabase.rpc('create_company',{company_name:company.name,company_slug:company.slug}),'สร้างบริษัทแล้ว')}>สร้างบริษัท</Button>
              </Stack>

              <Typography variant="subtitle1" sx={{mt:1,fontWeight:700}}>เพิ่มสมาชิก</Typography>
              <Stack direction={{xs:'column',md:'row'}} spacing={1}>
                <TextField type="email" label="อีเมล" value={member.email} onChange={event=>setMember({...member,email:event.target.value})}/>
                <TextField select label="บทบาท" value={member.role} onChange={event=>setMember({...member,role:event.target.value})}>
                  {Object.entries(roles).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}
                </TextField>
                <Button variant="contained" disabled={busy||!member.email.trim()} onClick={()=>void run(async()=>supabase.rpc('add_company_member',{member_email:member.email,member_role:member.role}),'เพิ่มสมาชิกบริษัทแล้ว')}>เพิ่มสมาชิก</Button>
              </Stack>

              <Typography variant="subtitle2" sx={{mt:1}}>สถานะพนักงาน</Typography>
              <Typography variant="body2" color="text.secondary">ผู้ดูแลบางคนไม่ต้องเป็นพนักงาน</Typography>
              <Stack spacing={1}>
                {members.map((item)=>{
                  const adminRole=['company_admin','executive','manager'].includes(item.company_role)
                  const isEmployeeItem=item.member_type!=='admin_only'
                  return (
                    <Paper key={item.profile_id} variant="outlined" sx={{p:1}}>
                      <Stack direction={{xs:'column',md:'row'}} spacing={0.75} sx={{alignItems:{md:'center'},justifyContent:'space-between'}}>
                        <Stack>
                          <Typography sx={{fontWeight:700}}>{item.profiles?.full_name||item.profiles?.email||item.profile_id}</Typography>
                          <Stack direction="row" spacing={0.5}>
                            <Chip size="small" label={roles[item.company_role]}/>
                            <Chip size="small" color={isEmployeeItem?'success':'default'} label={isEmployeeItem?'พนักงาน':'ผู้ดูแลเท่านั้น'}/>
                          </Stack>
                        </Stack>
                        <FormControlLabel control={<Switch checked={isEmployeeItem} disabled={busy||!adminRole} onChange={event=>{
                          const next=event.target.checked?'admin_employee':'admin_only'
                          void run(
                            async()=>supabase.rpc('update_company_member_type',{
                              target_profile_id:item.profile_id,
                              target_member_type:next,
                              target_reason:event.target.checked?'กำหนดผู้ดูแลให้เป็นพนักงานบริษัทผ่านหน้าตั้งค่า':'กำหนดเป็นผู้ดูแลระบบที่ไม่ใช่พนักงานบริษัทผ่านหน้าตั้งค่า',
                            }),
                            event.target.checked?'ตั้งเป็นพนักงานแล้ว':'ตั้งเป็นผู้ดูแลเท่านั้น',
                          )
                        }} />} label="นับเป็นพนักงานของบริษัท"/>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
              <Divider sx={{my:1.25}} />
              <Typography variant="subtitle2">คำสั่งจัดการพนักงาน (ผ่านกลาง + บันทึก Log)</Typography>
              <Stack spacing={1}>
                <TextField
                  multiline
                  minRows={7}
                  fullWidth
                  label="วางคำสั่งที่นี่"
                  value={commandRaw}
                  onChange={(event)=>setCommandRaw(event.target.value)}
                  disabled={isCommandBusy || !isAdmin}
                  helperText='ตัวอย่าง: {"command":"delete_latest","count":2,"reason":"ลบข้อมูลทดสอบ"} หรือ {"command":"delete_by_profile","profileIds":["uuid1","uuid2"],"reason":"ลบข้อมูลทดสอบ"}'
                />
                <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{alignItems:'stretch'}}>
                  <Button
                    variant="contained"
                    color="warning"
                    disabled={isCommandBusy || !isAdmin}
                    onClick={()=>void runCentralDeleteCommand()}
                  >
                    {isCommandBusy ? 'กำลังรันคำสั่ง...' : 'รันคำสั่งกลาง'}
                  </Button>
                  {commandPreview.map((candidate)=><Typography key={candidate.profile_id} variant="caption" color="text.secondary">{candidate.full_name ?? candidate.email ?? candidate.profile_id} · {candidate.created_at}</Typography>)}
                </Stack>
              </Stack>
              <Divider sx={{my:1.25}} />
              <Typography variant="subtitle2">ลบข้อมูลทดสอบ 2 คนล่าสุด</Typography>
              <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{alignItems:'stretch'}}>
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={!isAdmin||isCleanupBusy}
                  onClick={()=>void deleteLatest2Employees()}
                >
                  ตรวจ/ลบ 2 คนล่าสุด
                </Button>
                {latestCandidates.map((candidate)=>(
                  <Typography key={candidate.profile_id} variant="caption" color="text.secondary">
                    {candidate.full_name??candidate.email??candidate.profile_id} · {candidate.created_at}
                  </Typography>
                ))}
              </Stack>
            </Stack>
          </Box>
        )}
      </Paper>

      {error&&<Alert severity="error">{error}</Alert>}
      {success&&<Alert severity="success">{success}</Alert>}
    </Stack>
  )
}
