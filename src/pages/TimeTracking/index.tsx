import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Site = { id:string; name:string; latitude:number; longitude:number; radius_meters:number; projects:{name:string}|null }
type Attendance = { id:string; clock_in_at:string; clock_out_at:string|null; status:string; project_sites:Site|null }
type Project = { id:string; name:string }
type Employee = { id:string; full_name:string|null; email:string|null }
type LineGroup = { line_group_id:string; display_name:string|null }
type LocationCheck = { latitude:number; longitude:number; accuracy:number; distance:number; site:Site }

const distanceMeters = (lat1:number, lon1:number, lat2:number, lon2:number) => {
  const radius = 6_371_000
  const radians = Math.PI / 180
  const latitudeDelta = (lat2 - lat1) * radians
  const longitudeDelta = (lon2 - lon1) * radians
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

const getDeviceId = () => {
  const storageKey = 'wisdomai-device-id'
  const existing = window.localStorage.getItem(storageKey)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(storageKey, created)
  return created
}

const getDeviceInfo = () => {
  const userAgent = navigator.userAgent
  const operatingSystem = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iPhone/iPad'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'macOS'
          : navigator.platform || 'ไม่ทราบระบบ'
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Chrome\//i.test(userAgent)
      ? 'Chrome'
      : /Safari\//i.test(userAgent)
        ? 'Safari'
        : /Firefox\//i.test(userAgent)
          ? 'Firefox'
          : 'Browser'

  return {
    id: getDeviceId(),
    label: `${operatingSystem} · ${browser}`,
    platform: navigator.platform,
    userAgent,
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

export function TimeTrackingPage() {
  usePageTitle('ลงเวลาทำงาน')
  const { user, profile } = useAuth()
  const isManager = profile?.role === 'admin' || profile?.role === 'manager'
  const [sites, setSites] = useState<Site[]>([])
  const [sessions, setSessions] = useState<Attendance[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lineGroups, setLineGroups] = useState<LineGroup[]>([])
  const [assignment, setAssignment] = useState({ profileId:'', siteId:'' })
  const [siteId, setSiteId] = useState('')
  const [selfie, setSelfie] = useState<File | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [locationCheck, setLocationCheck] = useState<LocationCheck | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [form, setForm] = useState({ projectId:'', name:'', latitude:'', longitude:'', radius:'200', lineGroupId:'' })

  const loadData = useCallback(async () => {
    if (!user) return
    const attendanceQuery = supabase.from('attendance_sessions')
      .select('id,clock_in_at,clock_out_at,status,project_sites(id,name,latitude,longitude,radius_meters,projects(name))')
      .eq('profile_id', user.id).order('clock_in_at', { ascending:false }).limit(20)
    const projectsQuery = supabase.from('projects').select('id,name').eq('status', 'active').order('name')

    let availableSites: Site[]
    if (isManager) {
      const { data, error } = await supabase.from('project_sites')
        .select('id,name,latitude,longitude,radius_meters,projects(name)').eq('active', true).order('name')
      if (error) throw error
      availableSites = data as unknown as Site[]
    } else {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase.from('employee_site_assignments')
        .select('project_sites(id,name,latitude,longitude,radius_meters,projects(name))')
        .eq('profile_id', user.id).eq('active', true).lte('starts_on', today)
        .or(`ends_on.is.null,ends_on.gte.${today}`)
      if (error) throw error
      availableSites = (data ?? []).map((row) => row.project_sites).filter(Boolean) as unknown as Site[]
    }

    const [{ data: attendance, error: attendanceError }, { data: projectRows, error: projectsError }] = await Promise.all([attendanceQuery, projectsQuery])
    if (attendanceError) throw attendanceError
    if (projectsError) throw projectsError
    setSites(availableSites)
    setSessions(attendance as unknown as Attendance[])
    setProjects(projectRows ?? [])
    if (isManager) {
      const { data: employeeRows, error: employeeError } = await supabase.from('profiles').select('id,full_name,email').order('full_name')
      if (employeeError) throw employeeError
      setEmployees(employeeRows ?? [])
      const { data: groupRows, error: groupError } = await supabase.from('line_groups').select('line_group_id,display_name').eq('active', true).order('display_name')
      if (groupError) throw groupError
      setLineGroups(groupRows ?? [])
    }
    setLastUpdated(new Date())
  }, [isManager, user])

  useEffect(() => {
    if (!user) return

    const refresh = () => {
      void loadData().catch((error: Error) => setMessage(error.message))
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const timer = window.setTimeout(refresh, 0)
    const interval = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    const channel = supabase
      .channel(`attendance-session-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_sessions',
          filter: `profile_id=eq.${user.id}`,
        },
        refresh,
      )
      .subscribe()

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [loadData, user])
  const openSession = sessions.find((session) => !session.clock_out_at)

  const getLocation = () => new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('อุปกรณ์นี้ไม่รองรับ GPS'))
    else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, timeout:20_000, maximumAge:0 })
  })

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraReady(false)
    setCameraOpen(false)
  }, [])

  const startCamera = async () => {
    setMessage('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับกล้อง')
      setCameraOpen(true)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraReady(true)
      }
    } catch (error) {
      stopCamera()
      setMessage(error instanceof Error ? `เปิดกล้องไม่ได้: ${error.message}` : 'เปิดกล้องไม่ได้')
    }
  }

  const prepareAttendance = async () => {
    setBusy(true)
    setMessage('')
    setSelfie(null)
    setLocationCheck(null)
    try {
      const position = await getLocation()
      const accuracy = position.coords.accuracy
      if (accuracy > 1_000) {
        throw new Error(`ตำแหน่งไม่แม่นยำ (คลาดเคลื่อนประมาณ ${Math.round(accuracy).toLocaleString('th-TH')} เมตร) กรุณาเปิด GPS แบบแม่นยำและลองใหม่`)
      }

      const targetSites = openSession?.project_sites ? [openSession.project_sites] : sites
      if (targetSites.length === 0) throw new Error('ไม่พบไซต์ที่ได้รับมอบหมาย')

      const nearest = targetSites
        .map((site) => ({
          site,
          distance: distanceMeters(position.coords.latitude, position.coords.longitude, site.latitude, site.longitude),
        }))
        .sort((a, b) => a.distance - b.distance)[0]

      if (nearest.distance > nearest.site.radius_meters) {
        throw new Error(`อยู่นอกพื้นที่ไซต์ ${nearest.site.name} ประมาณ ${Math.round(nearest.distance).toLocaleString('th-TH')} เมตร (รัศมี ${nearest.site.radius_meters} เมตร)`)
      }

      setSiteId(nearest.site.id)
      setLocationCheck({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy,
        distance: nearest.distance,
        site: nearest.site,
      })
      await startCamera()
    } catch (error) {
      setMessage(error instanceof GeolocationPositionError
        ? `ไม่สามารถอ่าน GPS: ${error.message}`
        : error instanceof Error ? error.message : 'ไม่สามารถตรวจสอบตำแหน่งได้')
    } finally {
      setBusy(false)
    }
  }

  const captureSelfie = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('ไม่สามารถบันทึกภาพจากกล้องได้')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('ไม่สามารถบันทึกภาพจากกล้องได้')
    setSelfie(new File([blob], `selfie-${Date.now()}.jpg`, { type:'image/jpeg' }))
    stopCamera()
    setMessage('')
    setConfirmOpen(true)
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])

  const uploadSelfie = async (kind:'in'|'out') => {
    if (!selfie || !user) throw new Error('กรุณาถ่ายรูป Selfie ก่อนลงเวลา')
    const extension = selfie.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${user.id}/${Date.now()}-${kind}.${extension}`
    const { error } = await supabase.storage.from('attendance-selfies').upload(path, selfie, { contentType:selfie.type, upsert:false })
    if (error) throw error
    return path
  }

  const clock = async (action:'clock_in'|'clock_out') => {
    setBusy(true); setMessage('')
    try {
      if (action === 'clock_in' && !siteId) throw new Error('กรุณาเลือกไซต์งาน')
      if (!locationCheck) throw new Error('กรุณาตรวจสอบตำแหน่งและถ่ายรูปใหม่')
      const selfiePath = await uploadSelfie(action === 'clock_in' ? 'in' : 'out')
      const { data, error } = await supabase.functions.invoke('attendance-clock', { body:{
        action, siteId: action === 'clock_in' ? siteId : undefined,
        latitude:locationCheck.latitude, longitude:locationCheck.longitude,
        accuracy:locationCheck.accuracy, selfiePath, device:getDeviceInfo(),
      } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage(action === 'clock_in' ? 'ลงเวลาเข้าสำเร็จ และแจ้ง LINE แล้ว' : 'ลงเวลาออกสำเร็จ และแจ้ง LINE แล้ว')
      setSelfie(null); setLocationCheck(null); setConfirmOpen(false); await loadData()
    } catch (error) {
      setMessage(error instanceof GeolocationPositionError ? `ไม่สามารถอ่าน GPS: ${error.message}` : error instanceof Error ? error.message : 'ลงเวลาไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  const addSite = async () => {
    setBusy(true); setMessage('')
    try {
      const latitude = Number(form.latitude), longitude = Number(form.longitude), radius = Number(form.radius)
      if (!form.projectId || !form.name.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('กรุณากรอกข้อมูลไซต์และพิกัดให้ครบ')
      const { error } = await supabase.from('project_sites').insert({ project_id:form.projectId, name:form.name.trim(), latitude, longitude, radius_meters:radius, line_group_id:form.lineGroupId || null })
      if (error) throw error
      setMessage('เพิ่มไซต์สำเร็จ'); setForm({ projectId:'', name:'', latitude:'', longitude:'', radius:'200', lineGroupId:'' }); await loadData()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'เพิ่มไซต์ไม่สำเร็จ') }
    finally { setBusy(false) }
  }

  const assignSite = async () => {
    setBusy(true); setMessage('')
    try {
      if (!user || !assignment.profileId || !assignment.siteId) throw new Error('กรุณาเลือกพนักงานและไซต์')
      const { error } = await supabase.from('employee_site_assignments').upsert({
        profile_id:assignment.profileId, site_id:assignment.siteId, active:true, assigned_by:user.id,
      }, { onConflict:'profile_id,site_id' })
      if (error) throw error
      setMessage('มอบหมายไซต์ให้พนักงานสำเร็จ')
      setAssignment({ profileId:'', siteId:'' })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'มอบหมายไซต์ไม่สำเร็จ') }
    finally { setBusy(false) }
  }

  return <Stack spacing={3}>
    <Stack sx={{display:{xs:'none', md:'flex'}}}>
      <PageHeader title="ลงเวลาทำงาน" description="บันทึกเวลาเซิร์ฟเวอร์ พิกัด GPS รูป Selfie และแจ้งกลุ่ม LINE" />
    </Stack>
    {message && <Alert severity={message.includes('สำเร็จ') ? 'success' : 'warning'}>{message}</Alert>}
    {isManager && <Paper variant="outlined" sx={{p:2, display:{xs:'none', md:'block'}}}>
      <Typography variant="h6">เพิ่มไซต์งานจริง</Typography>
      <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{mt:2}}>
        <TextField select label="โครงการ" value={form.projectId} onChange={(event) => setForm({...form, projectId:event.target.value})}>{projects.map((project) => <MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField>
        <TextField label="ชื่อไซต์" value={form.name} onChange={(event) => setForm({...form, name:event.target.value})} />
        <TextField label="Latitude" inputMode="decimal" value={form.latitude} onChange={(event) => setForm({...form, latitude:event.target.value})} />
        <TextField label="Longitude" inputMode="decimal" value={form.longitude} onChange={(event) => setForm({...form, longitude:event.target.value})} />
        <TextField label="รัศมี (เมตร)" inputMode="numeric" value={form.radius} onChange={(event) => setForm({...form, radius:event.target.value})} />
        <TextField select label="กลุ่ม LINE" value={form.lineGroupId} onChange={(event) => setForm({...form, lineGroupId:event.target.value})} sx={{minWidth:180}}>
          <MenuItem value="">ไม่แจ้ง LINE</MenuItem>
          {lineGroups.map((group) => <MenuItem key={group.line_group_id} value={group.line_group_id}>{group.display_name || group.line_group_id}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={busy} onClick={() => void addSite()}>เพิ่มไซต์</Button>
      </Stack>
      <Typography variant="h6" sx={{mt:3}}>มอบหมายพนักงานให้ไซต์ (พนักงานหนึ่งคนเลือกได้หลายไซต์)</Typography>
      <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{mt:2}}>
        <TextField select fullWidth label="พนักงาน" value={assignment.profileId} onChange={(event) => setAssignment({...assignment, profileId:event.target.value})}>
          {employees.map((employee) => <MenuItem key={employee.id} value={employee.id}>{employee.full_name || employee.email || employee.id}</MenuItem>)}
        </TextField>
        <TextField select fullWidth label="ไซต์" value={assignment.siteId} onChange={(event) => setAssignment({...assignment, siteId:event.target.value})}>
          {sites.map((site) => <MenuItem key={site.id} value={site.id}>{site.projects?.name} · {site.name}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={busy} onClick={() => void assignSite()}>มอบหมาย</Button>
      </Stack>
    </Paper>}
    <Paper
      variant="outlined"
      sx={{
        p:{xs:0, md:3},
        minHeight:{xs:'62vh', md:'auto'},
        borderWidth:{xs:0, md:1},
        bgcolor:{xs:'transparent', md:'background.paper'},
        display:'flex',
        flexDirection:'column',
        justifyContent:{xs:'center', md:'flex-start'},
      }}
    >
      <Typography variant="h6" sx={{display:{xs:'none', md:'block'}}}>{openSession ? `กำลังทำงาน: ${openSession.project_sites?.name ?? ''}` : 'ลงเวลาเข้างาน'}</Typography>
      {!openSession && <TextField select fullWidth label="ไซต์ที่ได้รับมอบหมาย" value={siteId} onChange={(event) => setSiteId(event.target.value)} sx={{mt:2, display:{xs:'none', md:'block'}}}>
        {sites.map((site) => <MenuItem key={site.id} value={site.id}>{site.projects?.name} · {site.name}</MenuItem>)}
      </TextField>}
      {!openSession && sites.length === 0 && <Alert severity="info" sx={{mt:2}}>ยังไม่มีไซต์ที่ได้รับมอบหมาย กรุณาติดต่อผู้จัดการ</Alert>}
      <Typography color="text.secondary" sx={{mt:2, display:{xs:'none', md:'block'}}}>
        ระบบจะตรวจ GPS เลือกไซต์ให้อัตโนมัติ แล้วเปิดกล้องเพื่อยืนยันตัวตน
      </Typography>
      <Button
        fullWidth
        size="large"
        variant="contained"
        color={openSession ? 'error' : 'primary'}
        disabled={busy || (!openSession && sites.length === 0)}
        sx={{
          mt:{xs:0, md:2},
          minHeight:{xs:112, md:42},
          borderRadius:{xs:4, md:1},
          fontSize:{xs:'1.75rem', md:'0.9375rem'},
          fontWeight:800,
        }}
        onClick={() => void prepareAttendance()}
      >
        {busy
          ? <CircularProgress size={32} color="inherit" />
          : <>
              <Typography component="span" sx={{display:{xs:'inline', md:'none'}, fontSize:'inherit', fontWeight:'inherit'}}>
                {openSession ? 'ลงเวลาออก' : 'ลงเวลาเข้า'}
              </Typography>
              <Typography component="span" sx={{display:{xs:'none', md:'inline'}}}>
                {openSession ? 'ถ่ายรูปเพื่อลงเวลาออก' : 'ถ่ายรูปเพื่อลงเวลาเข้า'}
              </Typography>
            </>}
      </Button>
    </Paper>
    <Dialog open={cameraOpen} onClose={stopCamera} fullWidth maxWidth="sm">
      <DialogTitle>ถ่ายรูป Selfie สด</DialogTitle>
      <DialogContent>
        <video ref={videoRef} playsInline muted style={{width:'100%', borderRadius:12, background:'#111', transform:'scaleX(-1)'}} />
        {!cameraReady && <Stack sx={{py:2, alignItems:'center'}}><CircularProgress /><Typography sx={{mt:1}}>กำลังเปิดกล้อง...</Typography></Stack>}
      </DialogContent>
      <DialogActions>
        <Button onClick={stopCamera}>ยกเลิก</Button>
        <Button variant="contained" disabled={!cameraReady} onClick={() => void captureSelfie()}>ถ่ายภาพนี้</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} fullWidth maxWidth="xs">
      <DialogTitle>ยืนยันข้อมูลลงเวลา</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{pt:1}}>
          <Typography><strong>รายการ:</strong> {openSession ? 'ลงเวลาออก' : 'ลงเวลาเข้า'}</Typography>
          <Typography><strong>โครงการ:</strong> {locationCheck?.site.projects?.name ?? '-'}</Typography>
          <Typography><strong>ไซต์:</strong> {locationCheck?.site.name ?? '-'}</Typography>
          <Typography><strong>เวลา:</strong> {new Date().toLocaleString('th-TH')}</Typography>
          <Typography><strong>ห่างจากจุดไซต์:</strong> {locationCheck ? `${Math.round(locationCheck.distance).toLocaleString('th-TH')} เมตร` : '-'}</Typography>
          <Typography><strong>ความแม่นยำ GPS:</strong> {locationCheck ? `±${Math.round(locationCheck.accuracy).toLocaleString('th-TH')} เมตร` : '-'}</Typography>
          <Alert severity="success">ถ่ายรูป Selfie แล้ว กรุณาตรวจสอบข้อมูลก่อนยืนยัน</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => { setConfirmOpen(false); void startCamera() }}>ถ่ายใหม่</Button>
        <Button
          variant="contained"
          color={openSession ? 'error' : 'primary'}
          disabled={busy}
          onClick={() => void clock(openSession ? 'clock_out' : 'clock_in')}
        >
          {busy ? <CircularProgress size={22} color="inherit" /> : openSession ? 'ยืนยันลงเวลาออก' : 'ยืนยันลงเวลาเข้า'}
        </Button>
      </DialogActions>
    </Dialog>
    <Paper variant="outlined" sx={{p:2, display:{xs:'none', md:'block'}}}>
      <Stack direction={{xs:'column',sm:'row'}} spacing={1} sx={{alignItems:{sm:'center'}, justifyContent:'space-between'}}>
        <Stack>
          <Typography variant="h6">ประวัติล่าสุด</Typography>
          <Typography variant="caption" color="text.secondary">
            {lastUpdated ? `อัปเดตล่าสุด ${lastUpdated.toLocaleTimeString('th-TH')}` : 'กำลังโหลดข้อมูล...'}
          </Typography>
        </Stack>
        <Button variant="outlined" disabled={busy} onClick={() => void loadData().catch((error:Error) => setMessage(error.message))}>
          รีเฟรชข้อมูล
        </Button>
      </Stack>
      {sessions.length === 0 && <Typography color="text.secondary">ยังไม่มีประวัติลงเวลา</Typography>}
      {sessions.map((session) => <Typography key={session.id} sx={{py:.5}}>
        {session.project_sites?.name ?? '-'} · เข้า {new Date(session.clock_in_at).toLocaleString('th-TH')}
        {session.clock_out_at ? ` · ออก ${new Date(session.clock_out_at).toLocaleString('th-TH')}` : ' · กำลังทำงาน'}
        {session.status === 'needs_review' ? ' ⚠️ รอตรวจสอบ' : ''}
      </Typography>)}
    </Paper>
  </Stack>
}
