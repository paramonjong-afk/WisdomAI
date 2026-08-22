import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography, Chip } from '@mui/material'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { isEmployeeResigned } from '../../utils/employeeLifecycle'
import { useNavigate } from 'react-router-dom'

type Site = { id:string; name:string; latitude:number; longitude:number; radius_meters:number; projects:{name:string}|null }
type Attendance = { id:string; clock_in_at:string; clock_out_at:string|null; status:string; project_sites:Site|null }
type Project = { id:string; name:string }
type Employee = { id:string; full_name:string|null; email:string|null; employment_status?:string|null; membership_active?:boolean|null }
type LineGroup = { line_group_id:string; display_name:string|null }
type GpsPolicy={id:string;error_code:string;action:'allow'|'review'|'reject';require_selfie:boolean;require_reason:boolean;notify_line:boolean}
type LocationCheck = { latitude:number|null; longitude:number|null; accuracy:number|null; distance:number|null; site:Site; gpsErrorCode?:string; gpsErrorMessage?:string }
type ResultDialog = { open:boolean; success:boolean; title:string; detail:string }
type AttendanceSettings = {
  max_gps_accuracy_meters:number
  allow_outside_site_for_review:boolean
  shared_devices_allowed:boolean
  stale_session_mode:'require_clock_out'|'manager_review'
}

const distanceMeters = (lat1:number, lon1:number, lat2:number, lon2:number) => {
  const radius = 6_371_000
  const radians = Math.PI / 180
  const latitudeDelta = (lat2 - lat1) * radians
  const longitudeDelta = (lon2 - lon1) * radians
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}
const bangkokDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',
}).format(date)
const pendingSelfieStorageKey='wisdomai-pending-attendance-selfies'
const pendingSelfies=()=>{
  try{
    const value=JSON.parse(window.localStorage.getItem(pendingSelfieStorageKey)??'[]')
    return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]
  }catch{return []}
}
const rememberPendingSelfie=(path:string)=>{
  const next=[...new Set([...pendingSelfies(),path])].slice(-20)
  window.localStorage.setItem(pendingSelfieStorageKey,JSON.stringify(next))
}
const forgetPendingSelfie=(path:string)=>{
  window.localStorage.setItem(pendingSelfieStorageKey,JSON.stringify(pendingSelfies().filter((item)=>item!==path)))
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
    ownerName: window.localStorage.getItem('wisdomai-device-owner')?.trim() || 'ยังไม่ระบุเจ้าของมือถือ',
    platform: navigator.platform,
    userAgent,
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

export function TimeTrackingPage() {
  usePageTitle('ลงเวลาทำงาน')
  const navigate = useNavigate()
  const { user, profile, currentCompany } = useAuth()
  const isManager = profile?.role === 'admin' || profile?.role === 'manager'
  const [sites, setSites] = useState<Site[]>([])
  const [sessions, setSessions] = useState<Attendance[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [resignedEmployees, setResignedEmployees] = useState<Employee[]>([])
  const [lineGroups, setLineGroups] = useState<LineGroup[]>([])
  const [gpsPolicies,setGpsPolicies]=useState<GpsPolicy[]>([])
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
  const [resultDialog, setResultDialog] = useState<ResultDialog>({ open:false, success:false, title:'', detail:'' })
  const [busy, setBusy] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [settings, setSettings] = useState<AttendanceSettings>({
    max_gps_accuracy_meters:200,
    allow_outside_site_for_review:true,
    shared_devices_allowed:true,
    stale_session_mode:'require_clock_out',
  })
  const [form, setForm] = useState({ projectId:'', name:'', latitude:'', longitude:'', radius:'200', lineGroupId:'' })

  const loadData = useCallback(async () => {
    if (!user) return
    const attendanceQuery = supabase.from('attendance_sessions')
      .select('id,clock_in_at,clock_out_at,status,project_sites(id,name,latitude,longitude,radius_meters,projects(name))')
      .eq('profile_id', user.id).neq('status', 'duplicate')
      .order('clock_in_at', { ascending:false }).limit(20)
    let availableSites: Site[]
    if (isManager) {
      const { data, error } = await supabase.from('project_sites')
        .select('id,name,latitude,longitude,radius_meters,projects(name)').eq('active', true).order('name')
      if (error) throw error
      availableSites = data as unknown as Site[]
    } else {
      const today = bangkokDate()
      const { data, error } = await supabase.from('employee_site_assignments')
        .select('project_sites(id,name,latitude,longitude,radius_meters,projects(name))')
        .eq('profile_id', user.id).eq('active', true).lte('starts_on', today)
        .or(`ends_on.is.null,ends_on.gte.${today}`)
      if (error) throw error
      availableSites = (data ?? []).map((row) => row.project_sites).filter(Boolean) as unknown as Site[]
    }

    const [
      { data: attendance, error: attendanceError },
      { data: openAttendance, error: openAttendanceError },
      { data: settingRows },
    ] = await Promise.all([
      attendanceQuery,
      supabase.from('attendance_sessions')
        .select('id,clock_in_at,clock_out_at,status,project_sites(id,name,latitude,longitude,radius_meters,projects(name))')
        .eq('profile_id', user.id)
        .is('clock_out_at', null)
        .not('status', 'in', '(rejected,duplicate)')
        .order('clock_in_at', { ascending:false }),
      supabase.from('attendance_system_settings')
        .select('max_gps_accuracy_meters,allow_outside_site_for_review,shared_devices_allowed,stale_session_mode')
        .eq('company_id', currentCompany?.company_id ?? '')
        .eq('singleton', true).single(),
    ])
    if (attendanceError || openAttendanceError) throw attendanceError ?? openAttendanceError
    const attendanceRows = (attendance ?? []) as unknown as Attendance[]
    const openRows = (openAttendance ?? []) as unknown as Attendance[]
    const mergedAttendance = [
      ...openRows,
      ...attendanceRows.filter((row) => !openRows.some((openRow) => openRow.id === row.id)),
    ]
    setSites(availableSites)
    setSessions(mergedAttendance)
    if (settingRows) setSettings(settingRows as AttendanceSettings)
      if (isManager) {
        const [
          { data: projectRows, error: projectsError },
          { data: employeeRows, error: employeeError },
          { data: groupRows, error: groupError },
          { data: policyRows, error: policyError },
          { data: membershipRows, error: membershipError },
          { data: employmentRows, error: employmentError },
        ] = await Promise.all([
          supabase.from('projects').select('id:project_id,name').eq('status', 'active').order('name'),
          supabase.from('profiles').select('id,full_name,email').order('full_name'),
          supabase.from('line_groups').select('line_group_id,display_name').eq('active', true).order('display_name'),
          supabase.from('attendance_gps_error_policies').select('id,error_code,action,require_selfie,require_reason,notify_line').eq('active',true).order('error_code'),
          supabase.from('company_members').select('profile_id,active').eq('company_id', currentCompany?.company_id ?? ''),
          supabase.from('employee_employment_records').select('profile_id,employment_status').eq('company_id', currentCompany?.company_id ?? ''),
        ])
        if (projectsError) throw projectsError
        if (employeeError) throw employeeError
        if (groupError) throw groupError
        if (policyError) throw policyError
        if (membershipError) throw membershipError
        if (employmentError) throw employmentError
      setProjects(projectRows ?? [])
      const employmentMap = new Map((employmentRows ?? []).map((row: { profile_id: string; employment_status: string | null }) => [row.profile_id, row.employment_status]))
      const fullEmployeeDirectory = ((employeeRows ?? []) as Employee[]).map((employee) => {
        const membership = (membershipRows ?? []).find((row: { profile_id: string; active: boolean }) => row.profile_id === employee.id)
        return { ...employee, membership_active: membership?.active ?? false, employment_status: employmentMap.get(employee.id) ?? employee.employment_status ?? null }
      })
      const activeEmployees = fullEmployeeDirectory.filter((employee) => !isEmployeeResigned({
        employment_status: employee.employment_status ?? null,
        membership_active: employee.membership_active ?? false,
      }))
      const resignedList = fullEmployeeDirectory.filter((employee) => isEmployeeResigned({
        employment_status: employee.employment_status ?? null,
        membership_active: employee.membership_active ?? false,
      }))
      setResignedEmployees(resignedList)
      setEmployees(activeEmployees)
      setLineGroups(groupRows ?? [])
      setGpsPolicies((policyRows??[]) as GpsPolicy[])
    }
    setLastUpdated(new Date())
  }, [currentCompany?.company_id,isManager,user])

  useEffect(() => {
    if (!user) return

    const refresh = () => {
      void loadData().catch((error: Error) => setMessage(userError(error)))
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const timer = window.setTimeout(refresh, 0)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadData, user])

  useEffect(()=>{
    if(!user)return
    const cleanup=async()=>{
      for(const path of pendingSelfies().filter((item)=>item.startsWith(`${user.id}/`))){
        const [clockIn,clockOut]=await Promise.all([
          supabase.from('attendance_sessions').select('id').eq('profile_id',user.id).eq('clock_in_selfie_path',path).limit(1),
          supabase.from('attendance_sessions').select('id').eq('profile_id',user.id).eq('clock_out_selfie_path',path).limit(1),
        ])
        if(clockIn.error||clockOut.error)continue
        if((clockIn.data?.length??0)>0||(clockOut.data?.length??0)>0){
          forgetPendingSelfie(path)
          continue
        }
        const {error:removeError}=await supabase.storage.from('attendance-selfies').remove([path])
        if(!removeError)forgetPendingSelfie(path)
      }
    }
    const timer=window.setTimeout(()=>void cleanup(),0)
    return()=>window.clearTimeout(timer)
  },[user])
  const todayInBangkok = bangkokDate()
  const allOpenSessions = sessions.filter((session) =>
    !session.clock_out_at && !['rejected','duplicate'].includes(session.status))
  const openSession = allOpenSessions.find((session) => {
    if (settings.stale_session_mode === 'require_clock_out') return true
    return new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',
    }).format(new Date(session.clock_in_at)) === todayInBangkok
  })
  const todaySession = sessions.find((session) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(session.clock_in_at)) === todayInBangkok
    && session.status !== 'rejected')
  const completedToday = Boolean(todaySession?.clock_out_at)
  const openSessionDay = openSession
    ? new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',
    }).format(new Date(openSession.clock_in_at))
    : null
  const isStaleOpenSession = Boolean(openSession && openSessionDay !== todayInBangkok)
  const staleOpenSessions = allOpenSessions.filter((session) => session !== openSession)

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
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:{ ideal:640 }, height:{ ideal:480 } }, audio:false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraReady(true)
      }
    } catch (error) {
      stopCamera()
      setMessage(error instanceof Error ? `เปิดกล้องไม่ได้: ${userError(error)}` : 'เปิดกล้องไม่ได้')
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

      const targetSites = openSession?.project_sites ? [openSession.project_sites] : sites
      if (targetSites.length === 0) throw new Error('ไม่พบไซต์ที่ได้รับมอบหมาย')

      const nearest = targetSites
        .map((site) => ({
          site,
          distance: distanceMeters(position.coords.latitude, position.coords.longitude, site.latitude, site.longitude),
        }))
        .sort((a, b) => a.distance - b.distance)[0]

      setSiteId(nearest.site.id)
      setLocationCheck({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy,
        distance: nearest.distance,
        site: nearest.site,
      })
      if (accuracy > settings.max_gps_accuracy_meters || nearest.distance > nearest.site.radius_meters) {
        setMessage('ระบบจะรับรายการไว้ก่อน และส่งให้ผู้มีสิทธิ์ตรวจสอบ GPS')
      }
      await startCamera()
    } catch (error) {
      const targetSites=openSession?.project_sites?[openSession.project_sites]:sites
      const selectedSite=targetSites.find(site=>site.id===siteId)??(targetSites.length===1?targetSites[0]:null)
      if(!selectedSite){setMessage('ไม่สามารถอ่าน GPS กรุณาเลือกไซต์ที่ต้องการลงเวลาก่อน');return}
      const code=error instanceof GeolocationPositionError
        ? error.code===1?'permission_denied':error.code===2?'position_unavailable':'location_timeout'
        : !navigator.geolocation?'gps_unsupported':'gps_unavailable'
      const detail=error instanceof Error?userError(error):String(error)
      setSiteId(selectedSite.id)
      setLocationCheck({latitude:null,longitude:null,accuracy:null,distance:null,site:selectedSite,gpsErrorCode:code,gpsErrorMessage:detail})
      setMessage(`รับเคส GPS: ${code} ไว้รอตรวจสอบ กรุณาถ่าย Selfie และยืนยันข้อมูล`)
      await startCamera()
    } finally {
      setBusy(false)
    }
  }

  const captureSelfie = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('ไม่สามารถบันทึกภาพจากกล้องได้')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
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
    rememberPendingSelfie(path)
    return path
  }

  const clock = async (action:'clock_in'|'clock_out') => {
    const request = { action, siteId, locationCheck, company_id: currentCompany?.company_id ?? null }
    setBusy(true); setMessage('')
    let selfiePath = ''
    let shouldCleanupSelfie = false
    try {
      if (action === 'clock_in' && !siteId) throw new Error('กรุณาเลือกไซต์งาน')
      if (!locationCheck) throw new Error('กรุณาตรวจสอบตำแหน่งและถ่ายรูปใหม่')
      const result = await runWithMutationAttempt<Record<string, unknown>, { message: string; selfiePath: string }>({
        module: 'time-tracking',
        action: action === 'clock_in' ? 'clock_in' : 'clock_out',
        actorProfileId: user?.id,
        companyId: currentCompany?.company_id,
        request,
        operation: async () => {
          const uploadedPath = await uploadSelfie(action === 'clock_in' ? 'in' : 'out')
          selfiePath = uploadedPath
          const { data, error } = await supabase.functions.invoke('attendance-clock', { body:{
            action, siteId: action === 'clock_in' ? siteId : undefined,
            latitude:locationCheck.latitude, longitude:locationCheck.longitude,
            accuracy:locationCheck.accuracy, gpsErrorCode:locationCheck.gpsErrorCode,
            gpsErrorMessage:locationCheck.gpsErrorMessage, selfiePath: uploadedPath, device:getDeviceInfo(),
          } })
          if (error) {
            let detail = userError(error)
            const context = (error as { context?: Response }).context
            if (context && typeof context.clone === 'function') {
              try {
                const payload = await context.clone().json() as { error?: string }
                if (payload.error) {
                  detail = payload.error
                  shouldCleanupSelfie = true
                }
              } catch {
                // Keep transport error when response body is not JSON.
              }
            }
            throw new Error(detail)
          }
          if (data?.error) {
            shouldCleanupSelfie = true
            throw new Error(data.error)
          }
          const responseMessage = typeof data === 'object' && data !== null && 'message' in data
            ? (data as { message?: string }).message
            : null
          return { message: responseMessage || (action === 'clock_in' ? 'ลงเวลาเข้าสำเร็จ' : 'ลงเวลาออกสำเร็จ'), selfiePath: uploadedPath }
        },
        errorAction: 'ลงเวลาไม่สำเร็จ',
      })
      const successText = result.message || (action === 'clock_in' ? 'ลงเวลาเข้าสำเร็จ' : 'ลงเวลาออกสำเร็จ')
      selfiePath = result?.selfiePath ?? selfiePath
      setSelfie(null); setLocationCheck(null); setConfirmOpen(false)
      forgetPendingSelfie(selfiePath)
      await loadData()
      setMessage(successText)
      setResultDialog({
        open:true, success:true,
        title: action === 'clock_in' ? 'ลงเวลาเข้าเรียบร้อย' : 'ลงเวลาออกเรียบร้อย',
        detail: successText,
      })
    } catch (error) {
      if (shouldCleanupSelfie && selfiePath) {
        const {error:removeError}=await supabase.storage.from('attendance-selfies').remove([selfiePath])
        if(!removeError)forgetPendingSelfie(selfiePath)
      }
      const detail = error instanceof GeolocationPositionError
        ? `ไม่สามารถอ่าน GPS: ${userError(error)}`
        : error instanceof Error ? userError(error) : 'ลงเวลาไม่สำเร็จ'
      setMessage(detail)
      setConfirmOpen(false)
      const duplicate = /วันนี้|ลงเวลาเข้าแล้ว|ลงเวลาออกแล้ว|รายการเดิม/.test(detail)
      setResultDialog({
        open:true, success:false, title:duplicate ? 'ไม่สามารถบันทึกซ้ำได้' : 'ลงเวลาไม่สำเร็จ', detail,
      })
    } finally { setBusy(false) }
  }

  const addSite = async () => {
    const request = { form, company_id: currentCompany?.company_id ?? null, type: 'add-site' }
    setBusy(true)
    setMessage('')
    try {
      await runWithMutationAttempt({
        module: 'time-tracking',
        action: 'เพิ่มไซต์สำเร็จ',
        actorProfileId: user?.id,
        companyId: currentCompany?.company_id,
        request,
        operation: async () => {
          const latitude = Number(form.latitude), longitude = Number(form.longitude), radius = Number(form.radius)
          if (!form.projectId || !form.name.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('กรุณากรอกข้อมูลไซต์และพิกัดให้ครบ')
          const { error } = await supabase.from('project_sites').insert({
            project_id: form.projectId,
            name: form.name.trim(),
            latitude,
            longitude,
            radius_meters: radius,
            line_group_id: form.lineGroupId || null,
          })
          if (error) throw error
          return error
        },
      })
      setForm({ projectId:'', name:'', latitude:'', longitude:'', radius:'200', lineGroupId:'' })
      await loadData()
      setMessage('เพิ่มไซต์สำเร็จ')
    } catch (error) {
      setMessage(error instanceof Error ? userError(error) : 'เพิ่มไซต์ไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  const assignSite = async () => {
    const request = { profile_id: assignment.profileId, site_id: assignment.siteId, company_id: currentCompany?.company_id ?? null, type: 'assign-site' }
    setBusy(true)
    setMessage('')
    try {
      await runWithMutationAttempt({
        module: 'time-tracking',
        action: 'มอบหมายไซต์ให้พนักงานสำเร็จ',
        actorProfileId: user?.id,
        companyId: currentCompany?.company_id,
        request,
        operation: async () => {
          if (!user || !assignment.profileId || !assignment.siteId) throw new Error('กรุณาเลือกพนักงานและไซต์')
          const { error } = await supabase.rpc('assign_employee_site',{
            target_profile_id:assignment.profileId,target_site_id:assignment.siteId,
            target_starts_on:new Date().toISOString().slice(0,10),target_ends_on:null,
            target_work_policy_id:null,target_is_primary:false,
          })
          if (error) throw error
          return error
        },
      })
      setMessage('มอบหมายไซต์ให้พนักงานสำเร็จ')
      setAssignment({ profileId:'', siteId:'' })
    } catch (error) {
      setMessage(error instanceof Error ? userError(error) : 'มอบหมายไซต์ไม่สำเร็จ')
    } finally { setBusy(false) }
  }

  const saveAttendanceSettings = async () => {
    if (!user || !currentCompany) return
    setBusy(true)
    setMessage('')
    try {
      await runWithMutationAttempt({
        module: 'TimeTracking',
        action: 'บันทึกตั้งค่าการลงเวลา',
        actorProfileId: user.id,
        companyId: currentCompany.company_id,
        request: {
          settings,
          company_id: currentCompany.company_id,
        },
        operation: async () => await supabase.from('attendance_system_settings').update({
          ...settings,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }).eq('company_id', currentCompany.company_id).eq('singleton', true),
      })
      setMessage('บันทึกตั้งค่าการลงเวลาแล้ว')
      await loadData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : userError(error))
    } finally {
      setBusy(false)
    }
  }
  const updateGpsPolicy=async(policy:GpsPolicy,action:GpsPolicy['action'])=>{
    if (!user || !currentCompany) return
    setBusy(true);setMessage('')
    try {
      await runWithMutationAttempt({
        module: 'TimeTracking',
        action: 'อัปเดตนโยบาย GPS',
        actorProfileId: user.id,
        companyId: currentCompany.company_id,
        request: { policy_id: policy.id, error_code: policy.error_code, action },
        operation: async () => await supabase.from('attendance_gps_error_policies').update({
          action,
          updated_by:user.id,
          updated_at:new Date().toISOString(),
        }).eq('id', policy.id),
      })
      setMessage(`บันทึกนโยบาย ${policy.error_code} แล้ว`)
      await loadData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : userError(error))
    } finally {
      setBusy(false)
    }
  }

  return <Stack spacing={3}>
    <PageHeader
      title="ลงเวลาทำงาน"
      description="บันทึกเวลาเซิร์ฟเวอร์ พิกัด GPS รูป Selfie และแจ้งกลุ่ม LINE หรือเปิด Web Chat เพื่อพูดคุย/แจ้งลงเวลา"
      action={
        <Tooltip title="เปิด Web Chat">
          <IconButton
            color="primary"
            onClick={() => navigate('/chat')}
            aria-label="เปิด Web Chat"
            sx={{ width: 48, height: 48, border: '1px solid', borderColor: 'primary.main' }}
          >
            <ChatBubbleOutlineOutlinedIcon />
          </IconButton>
        </Tooltip>
      }
    />
    {message && <Alert severity={message.includes('สำเร็จ') ? 'success' : 'warning'}>{message}</Alert>}
    <Alert severity="info" sx={{ display: { xs: 'flex', md: 'none' } }}>
      เวลาทำงานมาตรฐาน 08:00–17:00 น.
    </Alert>
    {staleOpenSessions.length > 0 && (
      <Alert severity="warning">
        พบ {staleOpenSessions.length} รายการจากวันก่อนที่ยังไม่มีเวลาออก ระบบแยกไว้รอตรวจสอบแล้ว
        คุณยังลงเวลาเข้าวันนี้ได้ตามปกติ และสามารถส่งคำขอแก้ไขจากหน้าข้อมูลส่วนตัว
      </Alert>
    )}
    {isStaleOpenSession && openSession && <Alert severity="warning">
      พบรายการวันที่ {new Date(openSession.clock_in_at).toLocaleDateString('th-TH')} ที่ยังไม่มีเวลาออก
      กรุณากดลงเวลาออกให้รายการนี้ก่อนเริ่มวันใหม่
    </Alert>}
    {isManager && <Paper variant="outlined" sx={{p:2, display:{xs:'none', md:'block'}}}>
      <Typography variant="h6">ตั้งค่าการลงเวลา</Typography>
      <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{mt:2}}>
        <TextField label="GPS คลาดเคลื่อนได้ไม่เกิน (เมตร)" type="number"
          value={settings.max_gps_accuracy_meters}
          onChange={(event)=>setSettings({...settings,max_gps_accuracy_meters:Number(event.target.value)})} />
        <TextField select label="ลงเวลานอกไซต์" value={String(settings.allow_outside_site_for_review)}
          onChange={(event)=>setSettings({...settings,allow_outside_site_for_review:event.target.value==='true'})}>
          <MenuItem value="true">อนุญาตและส่งตรวจ</MenuItem><MenuItem value="false">ไม่อนุญาต</MenuItem>
        </TextField>
        <TextField select label="ใช้มือถือร่วมกัน" value={String(settings.shared_devices_allowed)}
          onChange={(event)=>setSettings({...settings,shared_devices_allowed:event.target.value==='true'})}>
          <MenuItem value="true">อนุญาต</MenuItem><MenuItem value="false">ไม่อนุญาต</MenuItem>
        </TextField>
        <TextField select label="รายการค้างข้ามวัน" value={settings.stale_session_mode}
          onChange={(event)=>setSettings({...settings,stale_session_mode:event.target.value as AttendanceSettings['stale_session_mode']})}>
          <MenuItem value="require_clock_out">ให้พนักงานลงเวลาออก</MenuItem>
          <MenuItem value="manager_review">ส่งให้ผู้จัดการตรวจ</MenuItem>
        </TextField>
        <Button variant="outlined" disabled={busy} onClick={()=>void saveAttendanceSettings()}>บันทึกตั้งค่า</Button>
      </Stack>
      <Typography variant="h6" sx={{mt:3}}>นโยบายเมื่อ GPS มีปัญหา</Typography>
      <StandardDataTable rows={gpsPolicies} getRowId={row=>row.id} getSearchText={row=>row.error_code} searchLabel="ค้นหารหัสปัญหา GPS" emptyText="ยังไม่มีนโยบาย GPS" exportFileName="attendance-gps-policies" minWidth={720} columns={[
        {id:'error',label:'รหัสปัญหา',render:row=>row.error_code},{id:'action',label:'การรับรายการ',render:row=><TextField select size="small" value={row.action} disabled={busy} onChange={event=>void updateGpsPolicy(row,event.target.value as GpsPolicy['action'])}><MenuItem value="allow">ผ่านอัตโนมัติ</MenuItem><MenuItem value="review">รับไว้รอตรวจ</MenuItem><MenuItem value="reject">ไม่รับรายการ</MenuItem></TextField>},{id:'evidence',label:'หลักฐาน',render:row=>`${row.require_selfie?'Selfie ':''}${row.require_reason?'เหตุผล ':''}${row.notify_line?'แจ้ง LINE':''}`}
      ]}/>
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
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        {resignedEmployees.length > 0 && <Chip color="default" label={`พนักงานลาออกถูกซ่อน ${resignedEmployees.length} คน`} />}
      </Stack>
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
      <Typography variant="h6" sx={{display:{xs:'none', md:'block'}}}>{completedToday ? 'ลงเวลาวันนี้ครบแล้ว' : openSession ? `กำลังทำงาน: ${openSession.project_sites?.name ?? ''}` : 'ลงเวลาเข้างาน'}</Typography>
      {!openSession && !completedToday && <TextField select fullWidth label="ไซต์ที่ได้รับมอบหมาย" value={siteId} onChange={(event) => setSiteId(event.target.value)} sx={{mt:2}}>
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
        disabled={busy || completedToday || (!openSession && sites.length === 0)}
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
                {completedToday ? 'ลงเวลาครบแล้ว' : openSession ? 'ลงเวลาออก' : 'ลงเวลาเข้า'}
              </Typography>
              <Typography component="span" sx={{display:{xs:'none', md:'inline'}}}>
                {completedToday ? 'วันนี้ลงเวลาเข้า–ออกครบแล้ว' : openSession ? 'ถ่ายรูปเพื่อลงเวลาออก' : 'ถ่ายรูปเพื่อลงเวลาเข้า'}
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
          <Typography><strong>พนักงาน:</strong> {profile?.full_name || profile?.email || '-'}</Typography>
          <Typography><strong>เจ้าของมือถือ:</strong> {getDeviceInfo().ownerName}</Typography>
          <Typography><strong>โครงการ:</strong> {locationCheck?.site.projects?.name ?? '-'}</Typography>
          <Typography><strong>ไซต์:</strong> {locationCheck?.site.name ?? '-'}</Typography>
          <Typography><strong>เวลา:</strong> {new Date().toLocaleString('th-TH')}</Typography>
          <Typography><strong>ห่างจากจุดไซต์:</strong> {locationCheck?.distance===null ? 'ไม่มีข้อมูล GPS' : locationCheck ? `${Math.round(locationCheck.distance).toLocaleString('th-TH')} เมตร` : '-'}</Typography>
          <Typography><strong>ความแม่นยำ GPS:</strong> {locationCheck?.accuracy===null ? 'ไม่มีข้อมูล GPS' : locationCheck ? `±${Math.round(locationCheck.accuracy).toLocaleString('th-TH')} เมตร` : '-'}</Typography>
          {locationCheck?.gpsErrorCode&&<Alert severity="warning">รอตรวจสอบ: {locationCheck.gpsErrorCode} · {locationCheck.gpsErrorMessage}</Alert>}
          <Alert severity={locationCheck?.gpsErrorCode||locationCheck&&locationCheck.distance!==null&&locationCheck.distance>locationCheck.site.radius_meters ? 'warning' : 'success'}>
            {locationCheck?.gpsErrorCode?'ระบบจะรับรายการไว้ก่อน และแจ้ง Error เข้ากลุ่ม LINE เพื่อรอตรวจสอบ':locationCheck && locationCheck.distance!==null && locationCheck.distance > locationCheck.site.radius_meters
              ? 'อยู่นอกพื้นที่ไซต์ รายการจะถูกส่งให้ผู้จัดการตรวจสอบ'
              : 'ถ่ายรูป Selfie แล้ว กรุณาตรวจสอบข้อมูลก่อนยืนยัน'}
          </Alert>
          {settings.shared_devices_allowed && getDeviceInfo().ownerName !== (profile?.full_name || '') && <Alert severity="info">
            เครื่องนี้ใช้ร่วมกันได้ ระบบจะบันทึกเวลาให้บัญชี “{profile?.full_name || profile?.email}” ที่เข้าสู่ระบบอยู่
          </Alert>}
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
    <Dialog open={resultDialog.open} onClose={() => setResultDialog((current) => ({...current, open:false}))} fullWidth maxWidth="xs">
      <DialogTitle>{resultDialog.title}</DialogTitle>
      <DialogContent>
        <Alert severity={resultDialog.success ? 'success' : 'warning'} sx={{mt:1}}>
          {resultDialog.detail}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={() => setResultDialog((current) => ({...current, open:false}))}>
          รับทราบ
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
        <Button variant="outlined" disabled={busy} onClick={() => void loadData().catch((error:Error) => setMessage(userError(error)))}>
          รีเฟรชข้อมูล
        </Button>
      </Stack>
      <StandardDataTable
        rows={sessions}
        getRowId={(session) => session.id}
        getSearchText={(session) => [
          session.project_sites?.projects?.name,
          session.project_sites?.name,
          session.status,
        ].filter(Boolean).join(' ')}
        searchLabel="ค้นหาโครงการ ไซต์ หรือสถานะ"
        emptyText="ยังไม่มีประวัติลงเวลา"
        exportFileName="wisdomai-time-tracking"
        columns={[
          {
            id: 'project',
            label: 'โครงการ',
            minWidth: 180,
            render: (session) => session.project_sites?.projects?.name ?? '-',
            exportValue: (session) => session.project_sites?.projects?.name,
          },
          {
            id: 'site',
            label: 'ไซต์',
            minWidth: 160,
            render: (session) => session.project_sites?.name ?? '-',
            exportValue: (session) => session.project_sites?.name,
          },
          {
            id: 'clock-in',
            label: 'เวลาเข้า',
            minWidth: 180,
            render: (session) => new Date(session.clock_in_at).toLocaleString('th-TH'),
            exportValue: (session) => new Date(session.clock_in_at).toLocaleString('th-TH'),
          },
          {
            id: 'clock-out',
            label: 'เวลาออก',
            minWidth: 180,
            render: (session) => session.clock_out_at ? new Date(session.clock_out_at).toLocaleString('th-TH') : 'กำลังทำงาน',
            exportValue: (session) => session.clock_out_at ? new Date(session.clock_out_at).toLocaleString('th-TH') : '',
          },
          {
            id: 'status',
            label: 'สถานะ',
            render: (session) => session.status === 'needs_review' ? '⚠️ รอตรวจสอบ' : session.status,
            exportValue: (session) => session.status === 'needs_review' ? 'รอตรวจสอบ' : session.status,
          },
        ]}
      />
    </Paper>
  </Stack>
}

