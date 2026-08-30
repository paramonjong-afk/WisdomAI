import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined'
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined'
import CallEndOutlinedIcon from '@mui/icons-material/CallEndOutlined'
import CallOutlinedIcon from '@mui/icons-material/CallOutlined'
import CameraAltOutlinedIcon from '@mui/icons-material/CameraAltOutlined'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined'
import KeyboardVoiceOutlinedIcon from '@mui/icons-material/KeyboardVoiceOutlined'
import MicOffOutlinedIcon from '@mui/icons-material/MicOffOutlined'
import MicOutlinedIcon from '@mui/icons-material/MicOutlined'
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined'
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import ForwardToInboxOutlinedIcon from '@mui/icons-material/ForwardToInboxOutlined'
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { parseChatAttendanceCommand, type ChatAttendanceAction } from '../../utils/chatAttendanceCommand'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { userError } from '../../utils/userError'
import { ensureProgramDevelopmentRoom } from '../../services/programDevelopmentGateway'
import { ensureGeneralWorkRoom } from '../../services/generalWorkRoomGateway'
import { ensureEmployeePrivateChatRoom } from '../../services/employeePrivateChatRoomGateway'
import {
  applyOperationalAction as applyOperationalCoreAction,
  buildOperationalTaskCards,
  dailyOperationalSummary,
  type OperationalAction,
  type OperationalStatus,
  type OperationalTaskCard,
} from '../../services/webChatOperationalCore'
import { useNavigate } from 'react-router-dom'

type RoomMemberRole = 'owner' | 'member'

type RoomMemberProfile = {
  full_name: string | null
  email: string | null
}

type RoomMember = {
  room_id: string
  profile_id: string
  member_role: RoomMemberRole
  joined_at: string
  profiles: RoomMemberProfile | null
}

type ChatRoom = {
  id: string
  name: string
  company_id?: string
  room_key?: string | null
  employee_profile_id?: string | null
  is_private?: boolean
  room_purpose?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  chat_room_members: RoomMember[]
}

type CompanyMember = {
  profile_id: string
  profiles: RoomMemberProfile | null
}

type MessageType = 'text' | 'file'

type ChatMessage = {
  id: string
  room_id: string
  sender_profile_id: string | null
  message_type: MessageType
  message_class?: 'user_message' | 'system_confirmation' | 'system_result'
  text_content: string | null
  attachment_bucket: string | null
  attachment_path: string | null
  attachment_name: string | null
  attachment_content_type: string | null
  attachment_size: number | null
  created_at: string
}

type MessageAttachmentUrlMap = Record<string, string>
type UnreadCountMap = Record<string, number>
type OnlineProfileMap = Record<string, boolean>
type PresenceConnectionState = 'offline' | 'connecting' | 'online'
type CallSignalType = 'call_invite' | 'call_accept' | 'call_reject' | 'call_busy' | 'offer' | 'answer' | 'ice_candidate' | 'hangup'
type CallStatus = 'calling' | 'connecting' | 'connected'
type CallDirection = 'outgoing' | 'incoming'

type CallSignal = {
  type: CallSignalType
  callId: string
  roomId: string
  fromProfileId: string
  toProfileId: string
  fromName: string
  roomName: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

type CallTarget = {
  profileId: string
  profileName: string
  roomId: string
  roomName: string
}

type ActiveCall = CallTarget & {
  callId: string
  direction: CallDirection
  status: CallStatus
}

type SupabaseRealtimeChannel = ReturnType<typeof supabase.channel>

type AttendanceSite = {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  projects: { name: string } | null
}

type AttendanceLocation = {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  distance: number | null
  site: AttendanceSite | null
  gpsErrorCode?: string
  gpsErrorMessage?: string
}

type SpeechRecognitionResultLike = { [index: number]: { transcript: string }; length: number }
type SpeechRecognitionEventLike = { results: { [index: number]: SpeechRecognitionResultLike } }
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const radius = 6_371_000
  const radians = Math.PI / 180
  const latitudeDelta = (lat2 - lat1) * radians
  const longitudeDelta = (lon2 - lon1) * radians
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

const getDeviceId = () => {
  const key = 'wisdomai-device-id'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(key, created)
  return created
}

const getDeviceInfo = () => ({
  id: getDeviceId(),
  label: `${navigator.platform || 'Browser'} · ${navigator.userAgent.split(' ').slice(-1)[0] || 'Browser'}`,
  ownerName: window.localStorage.getItem('wisdomai-device-owner')?.trim() || 'ยังไม่ระบุเจ้าของมือถือ',
  platform: navigator.platform,
  userAgent: navigator.userAgent,
  screen: `${window.screen.width}x${window.screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})

const normalizeAttendanceSite = (value: unknown): AttendanceSite | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  const radius = Number(row.radius_meters)
  if (![latitude, longitude, radius].every(Number.isFinite)) return null
  const projectValue = Array.isArray(row.projects) ? row.projects[0] : row.projects
  const project = projectValue && typeof projectValue === 'object' && typeof (projectValue as { name?: unknown }).name === 'string'
    ? { name: (projectValue as { name: string }).name }
    : null
  return { id: row.id, name: row.name, latitude, longitude, radius_meters: radius, projects: project }
}

const formatTime = (value: string) => new Date(value).toLocaleTimeString('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
})

const formatCallDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

const chatAttachmentMimeByExtension: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const getChatAttachmentContentType = (file: File) => {
  const declared = file.type.trim().toLowerCase()
  if (declared && declared !== 'application/octet-stream') {
    return declared === 'image/jpg' || declared === 'image/pjpeg' ? 'image/jpeg' : declared
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return chatAttachmentMimeByExtension[extension] ?? 'application/octet-stream'
}

const createChatAttachmentId = () => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch {
    // Some mobile browsers expose crypto but block randomUUID on non-secure origins.
  }
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

const supportedChatAttachmentTypes = new Set(Object.values(chatAttachmentMimeByExtension))
const maxChatAttachmentBytes = 50 * 1024 * 1024

const isChatImageAttachment = (contentType: string | null | undefined) => {
  return Boolean(contentType?.trim().toLowerCase().startsWith('image/'))
}

type DevelopmentTaskStatus = 'received' | 'in_progress' | 'waiting_review' | 'completed' | 'blocked'
type DevelopmentTaskDispatch = {
  id: string
  task_id: string
  target: 'codex' | 'developer_queue'
  status: 'queued' | 'sent' | 'failed'
  retry_count: number
  last_error: string | null
  updated_at: string
}
type DevelopmentTask = {
  id: string
  company_id: string
  room_id: string
  source_message_id: string
  task_code: string
  request_text: string
  intent: string
  status: DevelopmentTaskStatus
  owner_profile_id: string
  result_summary: string | null
  files: unknown
  commit_ref: string | null
  test_result: string | null
  build_result: string | null
  deploy_result: string | null
  blocker: string | null
  created_at: string
  updated_at: string
  dispatches: DevelopmentTaskDispatch[]
}

type AttendanceApprovalStatus = 'detected' | 'prechecked' | 'pending_approval' | 'approved' | 'recorded' | 'needs_more_info' | 'rejected' | 'closed'

type AttendanceApprovalJob = {
  id: string
  request_code: string
  requester_profile_id: string
  responsible_profile_id: string | null
  site_id: string | null
  action: ChatAttendanceAction
  requested_at: string
  status: AttendanceApprovalStatus
  validation_result: { employee_name?: string; missing_fields?: string[]; duplicate_checked?: boolean }
  duplicate_of_job_id: string | null
  attendance_session_id: string | null
  decision_note: string | null
  message_status?: 'pending_send' | 'sent' | 'send_failed'
  recipient_profile_id?: string | null
  message_sent_at?: string | null
  claimed_by?: string | null
  claimed_at?: string | null
  message_error?: string | null
  created_at: string
}

type HrIntakeStatus = 'pending' | 'context' | 'duplicate' | 'already_confirmed' | 'not_hr' | 'low_confidence' | 'candidate' | 'needs_more_info' | 'rejected' | 'confirmed'
type HrIntakeRawItem = {
  id: string
  source_channel: string
  source_ref: string
  room_id: string | null
  status: HrIntakeStatus
  content_snapshot: string | null
  confidence: number | null
  classification_reason: string | null
  duplicate_of_id: string | null
  bundle_id: string | null
  created_at: string
}
type HrIntakeCounts = Record<HrIntakeStatus, number> & { raw_total: number }
type HrConfirmationStatus = 'received' | 'under_review' | 'needs_more_info' | 'pending_approval' | 'approved' | 'recorded' | 'closed' | 'cancelled'
type HrConfirmationBundle = {
  id: string
  employee_profile_id: string
  work_date: string
  project_id: string | null
  status: HrConfirmationStatus
  validation_summary: { employee_name?: string; item_count?: number; clock_in_at?: string; clock_out_at?: string; missing_fields?: string[]; conflicts?: string[] }
  confirmation_status: string
  owner_profile_id: string | null
  next_action: 'review' | 'request_information' | 'approve' | 'record_attendance' | 'close_job' | 'none'
  sla_due_at: string | null
  escalation_level: number
  decision_note: string | null
  last_error: string | null
  updated_at: string
}
type HrConfirmationEvidence = {
  id: string
  bundle_id: string
  source_kind: 'message' | 'attachment' | 'document' | 'attendance_job' | 'attendance_session' | 'hr_summary'
  source_ref: string
  source_message_id: string | null
  document_flow_item_id: string | null
  attendance_job_id: string | null
  attendance_session_id: string | null
  attachment_name: string | null
}
type HrDailySummary = { date: string; total: number; pending_review: number; needs_more_info: number; pending_approval: number; recorded: number; closed: number; overdue: number; escalated: number }

const hrIntakeStatusLabel: Record<HrIntakeStatus, string> = {
  pending: 'รอคัดกรอง', context: 'บริบท', duplicate: 'ข้อมูลซ้ำ', already_confirmed: 'ยืนยันแล้ว', not_hr: 'ไม่ใช่งาน HR',
  low_confidence: 'ความมั่นใจต่ำ', candidate: 'รอยืนยันเข้า Bundle', needs_more_info: 'รอข้อมูลเพิ่ม', rejected: 'ปฏิเสธ', confirmed: 'เข้า Bundle แล้ว',
}
const hrBundleStatusLabel: Record<HrConfirmationStatus, string> = {
  received: 'รับเข้า', under_review: 'รอตรวจ', needs_more_info: 'รอข้อมูลเพิ่ม', pending_approval: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว', recorded: 'บันทึกเวลาแล้ว', closed: 'ปิดงาน', cancelled: 'ยกเลิก',
}

const attendanceApprovalStatusLabel: Record<AttendanceApprovalStatus, string> = {
  detected: 'ตรวจพบข้อมูล',
  prechecked: 'ตรวจสอบเบื้องต้นแล้ว',
  pending_approval: 'รอผู้รับผิดชอบอนุมัติ',
  approved: 'อนุมัติแล้ว',
  recorded: 'บันทึกเวลาสำเร็จ',
  needs_more_info: 'รอข้อมูลเพิ่ม',
  rejected: 'Reject — Job ยังเปิด',
  closed: 'ปิด Job 100%',
}

const developmentTaskStatusLabel: Record<DevelopmentTaskStatus, string> = {
  received: 'รับคำสั่ง',
  in_progress: 'กำลังทำ',
  waiting_review: 'รอตรวจ/รอข้อมูล',
  completed: 'เสร็จ',
  blocked: 'ติด Blocker',
}

const developmentTaskStatusColor: Record<DevelopmentTaskStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  received: 'info',
  in_progress: 'warning',
  waiting_review: 'warning',
  completed: 'success',
  blocked: 'error',
}

const operationalStatusLabel: Record<OperationalStatus, string> = {
  received: 'รับเข้า',
  in_progress: 'กำลังทำ',
  waiting_review: 'รอข้อมูล/รอตรวจ',
  completed: 'ปิดแล้ว',
  blocked: 'ติดข้อยกเว้น',
  duplicate: 'ซ้ำ',
  failed: 'ส่งไม่สำเร็จ',
}

const operationalStatusColor: Record<OperationalStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  received: 'info',
  in_progress: 'warning',
  waiting_review: 'warning',
  completed: 'success',
  blocked: 'error',
  duplicate: 'default',
  failed: 'error',
}

const operationalActionLabels: Array<{ action: OperationalAction; label: string }> = [
  { action: 'claim', label: 'รับงาน' },
  { action: 'start', label: 'เริ่มทำ' },
  { action: 'confirm', label: 'ยืนยัน' },
  { action: 'request_info', label: 'ขอข้อมูล' },
  { action: 'return', label: 'ส่งกลับ' },
  { action: 'dispatch', label: 'ส่งต่อ' },
  { action: 'match', label: 'จับคู่' },
  { action: 'close', label: 'ปิดงาน' },
  { action: 'view_result', label: 'ดูผลลัพธ์' },
]

const labelFromProfile = (profile: RoomMemberProfile | null | undefined, fallbackId = '-') => {
  return profile?.full_name?.trim() || profile?.email?.trim() || fallbackId
}

export function ChatPage() {
  usePageTitle('ห้องแชต')
  const navigate = useNavigate()
  const { user, profile, currentCompany } = useAuth()
  const companyId = currentCompany?.company_id
  const activeProfileId = user?.id ?? profile?.id ?? ''
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const selectedRoomIdRef = useRef('')
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) || null
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messageText, setMessageText] = useState('')
  const [companyMembers, setCompanyMembers] = useState<CompanyMember[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [roomNameDraft, setRoomNameDraft] = useState('')
  const [inviteProfileId, setInviteProfileId] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [note, setNote] = useState('')
  const [attachmentUrls, setAttachmentUrls] = useState<MessageAttachmentUrlMap>({})
  const [failedAttachmentPreviews, setFailedAttachmentPreviews] = useState<Record<string, boolean>>({})
  const [unreadCounts, setUnreadCounts] = useState<UnreadCountMap>({})
  const [onlineProfileMap, setOnlineProfileMap] = useState<OnlineProfileMap>({})
  const [presenceConnection, setPresenceConnection] = useState<PresenceConnectionState>('offline')
  const [callSignalingReadyMap, setCallSignalingReadyMap] = useState<Record<string, boolean>>({})
  const [callDirectoryOpen, setCallDirectoryOpen] = useState(false)
  const [roomPickerOpen, setRoomPickerOpen] = useState(false)
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null)
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  const [callMuted, setCallMuted] = useState(false)
  const [callDuration, setCallDuration] = useState(0)
  const [callError, setCallError] = useState('')
  const [realtimeAuthReady, setRealtimeAuthReady] = useState(false)
  const [attendanceIntegrationRoomId, setAttendanceIntegrationRoomId] = useState<string | null>(null)
  const [attendanceDialogOpen, setAttendanceDialogOpen] = useState(false)
  const [attendanceAction, setAttendanceAction] = useState<ChatAttendanceAction | null>(null)
  const [attendanceSites, setAttendanceSites] = useState<AttendanceSite[]>([])
  const [attendanceSiteId, setAttendanceSiteId] = useState('')
  const [attendanceLocation, setAttendanceLocation] = useState<AttendanceLocation | null>(null)
  const [attendanceSelfie, setAttendanceSelfie] = useState<File | null>(null)
  const [attendanceCameraOpen, setAttendanceCameraOpen] = useState(false)
  const [attendanceCameraReady, setAttendanceCameraReady] = useState(false)
  const [attendanceBusy, setAttendanceBusy] = useState(false)
  const [attendanceRequestCode, setAttendanceRequestCode] = useState('')
  const [attendanceApprovalJobs, setAttendanceApprovalJobs] = useState<AttendanceApprovalJob[]>([])
  const [attendanceApprovalCheckedAt, setAttendanceApprovalCheckedAt] = useState(0)
  const [attendanceApprovalBusyId, setAttendanceApprovalBusyId] = useState('')
  const [hrIntakeItems, setHrIntakeItems] = useState<HrIntakeRawItem[]>([])
  const [hrIntakeCounts, setHrIntakeCounts] = useState<HrIntakeCounts | null>(null)
  const [hrConfirmationBundles, setHrConfirmationBundles] = useState<HrConfirmationBundle[]>([])
  const [hrConfirmationEvidence, setHrConfirmationEvidence] = useState<HrConfirmationEvidence[]>([])
  const [hrDailySummary, setHrDailySummary] = useState<HrDailySummary | null>(null)
  const [hrGateBusyId, setHrGateBusyId] = useState('')
  const [developmentTasks, setDevelopmentTasks] = useState<DevelopmentTask[]>([])
  const [developmentTasksCheckedAt, setDevelopmentTasksCheckedAt] = useState(0)
  const [developmentTaskBusyId, setDevelopmentTaskBusyId] = useState('')
  const [developmentResultTask, setDevelopmentResultTask] = useState<DevelopmentTask | null>(null)
  const [operationalTaskOverrides, setOperationalTaskOverrides] = useState<Record<string, OperationalTaskCard>>({})
  const [operationalSelectedTaskId, setOperationalSelectedTaskId] = useState('')
  const [operationalTaskBusyId, setOperationalTaskBusyId] = useState('')
  const [operationalCheckedAt] = useState(() => Date.now())
  const [voiceListening, setVoiceListening] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const messageBottomRef = useRef<HTMLDivElement | null>(null)
  const attendanceVideoRef = useRef<HTMLVideoElement | null>(null)
  const attendanceStreamRef = useRef<MediaStream | null>(null)
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const callChannelsRef = useRef<Map<string, SupabaseRealtimeChannel>>(new Map())
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localCallStreamRef = useRef<MediaStream | null>(null)
  const remoteCallStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const activeCallRef = useRef<ActiveCall | null>(null)
  const incomingCallRef = useRef<CallSignal | null>(null)
  const roomsRef = useRef<ChatRoom[]>([])

  const canManageCompany = useMemo(
    () =>
      profile?.role === 'admin'
      || ['company_admin', 'executive', 'manager', 'site_supervisor'].includes(currentCompany?.company_role ?? ''),
    [profile?.role, currentCompany?.company_role],
  )
  const canProvisionProgramDevelopmentRoom = profile?.role === 'admin' && currentCompany?.company_role === 'company_admin'
  const isProgramDevelopmentRoom = selectedRoom?.room_key === 'program_development_primary'
  const isHrRoom = selectedRoom?.room_key === 'hr_primary' || attendanceIntegrationRoomId === selectedRoom?.id
  const isProgramDevelopmentOwner = Boolean(
    isProgramDevelopmentRoom
      && canProvisionProgramDevelopmentRoom
      && selectedRoom?.created_by === activeProfileId,
  )

  const canManageThisRoom = useMemo(() => {
    if (!selectedRoom) return false
    if (selectedRoom.room_key === 'program_development_primary') return isProgramDevelopmentOwner
    if (selectedRoom.employee_profile_id) return ['company_admin', 'executive', 'manager'].includes(currentCompany?.company_role ?? '')
    if (canManageCompany) return true
    return roomMembers.some((member) => member.profile_id === activeProfileId && member.member_role === 'owner')
  }, [activeProfileId, canManageCompany, currentCompany?.company_role, isProgramDevelopmentOwner, roomMembers, selectedRoom])

  const profileNameMap = useMemo(() => {
    const map = new Map<string, RoomMemberProfile>()
    companyMembers.forEach((member) => {
      if (!member.profiles) return
      map.set(member.profile_id, member.profiles)
    })
    roomMembers.forEach((member) => {
      if (member.profiles) map.set(member.profile_id, member.profiles)
    })
    return map
  }, [companyMembers, roomMembers])

  const canOpenCreate = !!currentCompany?.company_id
  const roomSelectionStorageKey = companyId && activeProfileId
    ? `wisdomai-chat-room:${companyId}:${activeProfileId}`
    : ''
  const selectRoom = useCallback((roomId: string) => {
    selectedRoomIdRef.current = roomId
    setSelectedRoomId(roomId)
    if (!roomSelectionStorageKey || typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(roomSelectionStorageKey, roomId)
    } catch {
      // Some private/mobile browser modes block sessionStorage; in-memory selection still works.
    }
  }, [roomSelectionStorageKey])
  const canSend = !!selectedRoomId && !!selectedRoom && !!companyId && !!activeProfileId && !busy
    && (!isProgramDevelopmentRoom || isProgramDevelopmentOwner)
  const presenceLabel = presenceConnection === 'online'
    ? 'คุณออนไลน์'
    : presenceConnection === 'connecting' ? 'กำลังเชื่อมต่อ' : 'ออฟไลน์'
  const presenceColor: 'success' | 'warning' | 'default' = presenceConnection === 'online'
    ? 'success'
    : presenceConnection === 'connecting' ? 'warning' : 'default'
  const activeProfileName = profile?.full_name?.trim() || profile?.email?.trim() || activeProfileId
  const callSignalingReady = Boolean(selectedRoomId && callSignalingReadyMap[selectedRoomId])
  const activeCallId = activeCall?.callId
  const activeCallStatus = activeCall?.status
  const incomingCallId = incomingCall?.callId
  const operationalLocalMode = import.meta.env.DEV
  const operationalBaseCards = useMemo(
    () => buildOperationalTaskCards(messages, selectedRoom?.room_key, new Date()),
    [messages, selectedRoom?.room_key],
  )
  const operationalTaskCards = useMemo(
    () => operationalBaseCards.map((card) => operationalTaskOverrides[card.taskId] ?? card),
    [operationalBaseCards, operationalTaskOverrides],
  )
  const operationalSummary = useMemo(
    () => dailyOperationalSummary(operationalTaskCards, new Date()),
    [operationalTaskCards],
  )
  const operationalSelectedTask = operationalTaskCards.find((card) => card.taskId === operationalSelectedTaskId) ?? null

  useEffect(() => {
    roomsRef.current = rooms
  }, [rooms])

  useEffect(() => {
    if (!roomSelectionStorageKey) {
      selectedRoomIdRef.current = ''
      return
    }
    try {
      const persistedRoomId = window.sessionStorage.getItem(roomSelectionStorageKey)
      if (persistedRoomId) {
        selectedRoomIdRef.current = persistedRoomId
      }
    } catch {
      // Ignore storage restrictions and keep the in-memory room selection.
    }
  }, [roomSelectionStorageKey])

  useEffect(() => {
    let cancelled = false
    if (!activeProfileId) {
      const timer = window.setTimeout(() => {
        if (!cancelled) setRealtimeAuthReady(false)
      }, 0)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
      }
    }
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      if (!accessToken) {
        if (!cancelled) setRealtimeAuthReady(false)
        return
      }
      try {
        await supabase.realtime.setAuth(accessToken)
        if (!cancelled) setRealtimeAuthReady(true)
      } catch {
        if (!cancelled) setRealtimeAuthReady(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeProfileId])

  useEffect(() => {
    activeCallRef.current = activeCall
  }, [activeCall])

  useEffect(() => {
    const activeCallId = activeCall?.callId
    const activeCallStatus = activeCall?.status
    if (!activeCallId || activeCallStatus !== 'connected') {
      return undefined
    }
    const timer = window.setInterval(() => setCallDuration((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [activeCall?.callId, activeCall?.status])

  useEffect(() => {
    if (remoteAudioRef.current && remoteCallStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteCallStreamRef.current
      void remoteAudioRef.current.play().catch(() => undefined)
    }
  }, [activeCall?.callId])
  const companyMembersSorted = useMemo(
    () =>
      [...companyMembers].sort((a, b) =>
        labelFromProfile(a.profiles, a.profile_id).localeCompare(labelFromProfile(b.profiles, b.profile_id)),
      ),
    [companyMembers],
  )

  const addableMembers = useMemo(
    () => companyMembersSorted.filter((member) => !roomMembers.some((existing) => existing.profile_id === member.profile_id)),
    [companyMembersSorted, roomMembers],
  )

  const totalUnreadCount = useMemo(
    () => Object.entries(unreadCounts).reduce(
      (sum, [roomId, count]) => sum + (roomId === selectedRoomId ? 0 : count),
      0,
    ),
    [selectedRoomId, unreadCounts],
  )

  const setToast = useCallback((message: string, reset = false) => {
    setNote(message)
    if (reset) setTimeout(() => setNote(''), 2400)
  }, [])

  const actOperationalTask = useCallback((card: OperationalTaskCard, action: OperationalAction) => {
    if (!operationalLocalMode) {
      setToast('Operational Core อยู่ใน Local-first mode: ยังไม่เขียนข้อมูลจริง', true)
      return
    }
    if (operationalTaskBusyId) return
    setOperationalTaskBusyId(card.taskId)
    const result = applyOperationalCoreAction(
      card,
      action,
      { id: activeProfileId, role: profile?.role ?? currentCompany?.company_role ?? null },
      new Date(),
      `${card.taskId}:${action}`,
    )
    if (!result.accepted) {
      setToast(result.error || 'ดำเนินการไม่สำเร็จ', true)
    } else {
      setOperationalTaskOverrides((current) => ({ ...current, [card.taskId]: result.card }))
      setOperationalSelectedTaskId(card.taskId)
      setToast(result.duplicate ? 'คำสั่งซ้ำ: ใช้ผลเดิม ไม่สร้าง Audit ซ้ำ' : `อัปเดต ${card.taskId} แล้ว`, true)
    }
    setOperationalTaskBusyId('')
  }, [activeProfileId, currentCompany?.company_role, operationalLocalMode, operationalTaskBusyId, profile?.role, setToast])

  const sendCallSignal = useCallback(async (signal: CallSignal) => {
    const channel = callChannelsRef.current.get(signal.roomId)
    if (!channel) return false
    try {
      return (await channel.send({ type: 'broadcast', event: 'call_signal', payload: signal })) === 'ok'
    } catch {
      return false
    }
  }, [])

  const disposeCallMedia = useCallback(() => {
    peerConnectionRef.current?.close()
    peerConnectionRef.current = null
    localCallStreamRef.current?.getTracks().forEach((track) => track.stop())
    localCallStreamRef.current = null
    remoteCallStreamRef.current = null
    pendingIceCandidatesRef.current = []
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
  }, [])

  const finishCall = useCallback(async (notifyPeer: boolean, expectedCallId?: string) => {
    const call = activeCallRef.current
    if (!call || (expectedCallId && call.callId !== expectedCallId)) return
    if (notifyPeer) {
      await sendCallSignal({
        type: 'hangup',
        callId: call.callId,
        roomId: call.roomId,
        fromProfileId: activeProfileId,
        toProfileId: call.profileId,
        fromName: activeProfileName,
        roomName: call.roomName,
      })
    }
    disposeCallMedia()
    activeCallRef.current = null
    setActiveCall(null)
    setCallMuted(false)
    setCallDuration(0)
    setCallError('')
  }, [activeProfileId, activeProfileName, disposeCallMedia, sendCallSignal])

  const requestCallAudio = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับการโทรเสียง')
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    localCallStreamRef.current = stream
    return stream
  }, [])

  const createPeerConnection = useCallback((call: ActiveCall) => {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })
    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      void sendCallSignal({
        type: 'ice_candidate',
        callId: call.callId,
        roomId: call.roomId,
        fromProfileId: activeProfileId,
        toProfileId: call.profileId,
        fromName: activeProfileName,
        roomName: call.roomName,
        candidate: event.candidate.toJSON(),
      })
    }
    peer.ontrack = (event) => {
      const stream = event.streams[0]
      if (!stream) return
      remoteCallStreamRef.current = stream
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream
        void remoteAudioRef.current.play().catch(() => undefined)
      }
    }
    peer.onconnectionstatechange = () => {
      if (activeCallRef.current?.callId !== call.callId) return
      if (peer.connectionState === 'connected') {
        setActiveCall((current) => current?.callId === call.callId ? { ...current, status: 'connected' } : current)
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        void finishCall(false, call.callId)
        setToast('การโทรขาดการเชื่อมต่อ', true)
      }
    }
    peerConnectionRef.current = peer
    return peer
  }, [activeProfileId, activeProfileName, finishCall, sendCallSignal, setToast])

  const startCall = useCallback(async (target: CallTarget) => {
    if (!callSignalingReady) {
      setToast('ระบบโทรยังเชื่อมต่อไม่สำเร็จ กรุณารอสักครู่', true)
      return
    }
    if (activeCallRef.current || incomingCallRef.current) {
      setToast('มีสายที่กำลังใช้งานอยู่', true)
      return
    }
    if (!onlineProfileMap[target.profileId]) {
      setToast('สมาชิกคนนี้ออฟไลน์ จึงยังรับสายไม่ได้', true)
      return
    }

    const call: ActiveCall = {
      ...target,
      callId: crypto.randomUUID(),
      direction: 'outgoing',
      status: 'calling',
    }
    activeCallRef.current = call
    setActiveCall(call)
    setCallDirectoryOpen(false)
    setCallError('')
    try {
      const stream = await requestCallAudio()
      const peer = createPeerConnection(call)
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      const sent = await sendCallSignal({
        type: 'call_invite',
        callId: call.callId,
        roomId: call.roomId,
        fromProfileId: activeProfileId,
        toProfileId: call.profileId,
        fromName: activeProfileName,
        roomName: call.roomName,
      })
      if (!sent) throw new Error('ไม่สามารถส่งสัญญาณเรียกเข้าได้')
    } catch (error) {
      await finishCall(false, call.callId)
      setToast(error instanceof Error ? error.message : 'ไม่สามารถเริ่มโทรได้', true)
    }
  }, [activeProfileId, activeProfileName, callSignalingReady, createPeerConnection, finishCall, onlineProfileMap, requestCallAudio, sendCallSignal, setToast])

  const acceptIncomingCall = useCallback(async () => {
    const invite = incomingCallRef.current
    if (!invite || activeCallRef.current) return
    incomingCallRef.current = null
    setIncomingCall(null)
    const call: ActiveCall = {
      profileId: invite.fromProfileId,
      profileName: invite.fromName,
      roomId: invite.roomId,
      roomName: invite.roomName,
      callId: invite.callId,
      direction: 'incoming',
      status: 'connecting',
    }
    activeCallRef.current = call
    setActiveCall(call)
    setCallError('')
    try {
      const stream = await requestCallAudio()
      const peer = createPeerConnection(call)
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      const sent = await sendCallSignal({
        type: 'call_accept',
        callId: call.callId,
        roomId: call.roomId,
        fromProfileId: activeProfileId,
        toProfileId: call.profileId,
        fromName: activeProfileName,
        roomName: call.roomName,
      })
      if (!sent) throw new Error('ไม่สามารถตอบรับสายได้')
    } catch (error) {
      await finishCall(false, call.callId)
      setToast(error instanceof Error ? error.message : 'ไม่สามารถรับสายได้', true)
    }
  }, [activeProfileId, activeProfileName, createPeerConnection, finishCall, requestCallAudio, sendCallSignal, setToast])

  const rejectIncomingCall = useCallback(async () => {
    const invite = incomingCallRef.current
    if (!invite) return
    await sendCallSignal({
      type: 'call_reject',
      callId: invite.callId,
      roomId: invite.roomId,
      fromProfileId: activeProfileId,
      toProfileId: invite.fromProfileId,
      fromName: activeProfileName,
      roomName: invite.roomName,
    })
    incomingCallRef.current = null
    setIncomingCall(null)
  }, [activeProfileId, activeProfileName, sendCallSignal])

  const toggleCallMute = useCallback(() => {
    const track = localCallStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setCallMuted(!track.enabled)
  }, [])

  const handleCallSignal = useCallback(async (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const signal = value as Partial<CallSignal>
    if (
      typeof signal.type !== 'string'
      || typeof signal.callId !== 'string'
      || typeof signal.roomId !== 'string'
      || typeof signal.fromProfileId !== 'string'
      || typeof signal.toProfileId !== 'string'
      || typeof signal.fromName !== 'string'
      || typeof signal.roomName !== 'string'
      || signal.toProfileId !== activeProfileId
      || signal.fromProfileId === activeProfileId
    ) return

    if (signal.type === 'call_invite') {
      const room = roomsRef.current.find((item) => item.id === signal.roomId)
      if (!room || !room.chat_room_members.some((member) => member.profile_id === activeProfileId)) return
      if (activeCallRef.current || incomingCallRef.current) {
        await sendCallSignal({
          ...signal,
          type: 'call_busy',
          fromProfileId: activeProfileId,
          toProfileId: signal.fromProfileId,
          fromName: activeProfileName,
        } as CallSignal)
        return
      }
      incomingCallRef.current = signal as CallSignal
      setIncomingCall(signal as CallSignal)
      return
    }

    const call = activeCallRef.current
    if (!call || call.callId !== signal.callId || call.profileId !== signal.fromProfileId) return
    const peer = peerConnectionRef.current
    if (signal.type === 'call_accept' && call.direction === 'outgoing' && peer) {
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await sendCallSignal({
        ...signal,
        type: 'offer',
        fromProfileId: activeProfileId,
        toProfileId: call.profileId,
        fromName: activeProfileName,
        roomName: call.roomName,
        sdp: offer,
      } as CallSignal)
      setActiveCall((current) => current?.callId === call.callId ? { ...current, status: 'connecting' } : current)
      return
    }
    if (signal.type === 'offer' && call.direction === 'incoming' && peer && signal.sdp) {
      await peer.setRemoteDescription(signal.sdp)
      const pending = pendingIceCandidatesRef.current.splice(0)
      await Promise.all(pending.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)))
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await sendCallSignal({
        ...signal,
        type: 'answer',
        fromProfileId: activeProfileId,
        toProfileId: call.profileId,
        fromName: activeProfileName,
        roomName: call.roomName,
        sdp: answer,
      } as CallSignal)
      return
    }
    if (signal.type === 'answer' && call.direction === 'outgoing' && peer && signal.sdp) {
      await peer.setRemoteDescription(signal.sdp)
      const pending = pendingIceCandidatesRef.current.splice(0)
      await Promise.all(pending.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)))
      return
    }
    if (signal.type === 'ice_candidate' && peer && signal.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate).catch(() => undefined)
      else pendingIceCandidatesRef.current.push(signal.candidate)
      return
    }
    if (signal.type === 'call_reject' || signal.type === 'call_busy') {
      await finishCall(false, call.callId)
      setToast(signal.type === 'call_busy' ? 'สมาชิกกำลังคุยสายอื่นอยู่' : 'สมาชิกปฏิเสธสาย', true)
      return
    }
    if (signal.type === 'hangup') {
      await finishCall(false, call.callId)
      setToast('อีกฝ่ายวางสายแล้ว', true)
    }
  }, [activeProfileId, activeProfileName, finishCall, sendCallSignal, setToast])

  useEffect(() => {
    if (!activeCallId || activeCallStatus !== 'calling') return undefined
    const timer = window.setTimeout(() => {
      void finishCall(true, activeCallId)
      setToast('ไม่มีผู้รับสายภายในเวลาที่กำหนด', true)
    }, 30_000)
    return () => window.clearTimeout(timer)
  }, [activeCallId, activeCallStatus, finishCall, setToast])

  useEffect(() => {
    if (!incomingCallId) return undefined
    const timer = window.setTimeout(() => {
      void rejectIncomingCall()
    }, 30_000)
    return () => window.clearTimeout(timer)
  }, [incomingCallId, rejectIncomingCall])

  useEffect(() => {
    if (!companyId || !activeProfileId || !realtimeAuthReady || rooms.length === 0) {
      return undefined
    }
    let cancelled = false
    const activeChannels = callChannelsRef.current
    const channels = rooms.map((room) => {
      const channel = supabase.channel(`chat-calls:${companyId}:${room.id}`, { config: { private: true } })
        .on('broadcast', { event: 'call_signal' }, ({ payload }) => {
          void handleCallSignal(payload)
        })
      activeChannels.set(room.id, channel)
      return { room, channel }
    })
    if (!cancelled) {
      channels.forEach(({ room, channel }) => {
        channel.subscribe((status) => {
          setCallSignalingReadyMap((current) => ({ ...current, [room.id]: status === 'SUBSCRIBED' }))
        })
      })
    }
    return () => {
      cancelled = true
      setCallSignalingReadyMap({})
      channels.forEach(({ room, channel }) => {
        if (activeChannels.get(room.id) === channel) activeChannels.delete(room.id)
        void supabase.removeChannel(channel)
      })
      void finishCall(false)
    }
  }, [activeProfileId, companyId, finishCall, handleCallSignal, realtimeAuthReady, rooms])

  const normalizeProfile = (value: unknown): RoomMemberProfile | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const profile = value as Record<string, unknown>
    return {
      full_name: typeof profile.full_name === 'string' ? profile.full_name : null,
      email: typeof profile.email === 'string' ? profile.email : null,
    }
  }

  const scrollToBottom = () => {
    window.setTimeout(() => {
      messageBottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }, 0)
  }

  const loadCompanyMembers = useCallback(async () => {
    if (!currentCompany?.company_id) {
      setCompanyMembers([])
      return
    }

    const { data, error } = await supabase
      .from('company_members')
      .select('profile_id,profiles(full_name,email)')
      .eq('company_id', currentCompany.company_id)
      .eq('active', true)
      .order('profile_id')

    if (error) {
      setToast(userError(error), true)
      return
    }

    const rows = (data ?? []).map((row) => {
      const raw = row as { profile_id?: string | null; profiles?: unknown }
      return {
        profile_id: raw.profile_id ?? '',
        profiles: normalizeProfile(raw.profiles),
      } as CompanyMember
    })
    setCompanyMembers(rows.filter((row) => Boolean(row.profile_id)))
  }, [currentCompany?.company_id, setToast])

  const loadUnreadCounts = useCallback(async (roomsToCount: ChatRoom[]) => {
    if (!activeProfileId || roomsToCount.length === 0) {
      setUnreadCounts({})
      return
    }
    const roomIds = roomsToCount.map((room) => room.id)
    const { data: readRows, error: readError } = await supabase
      .from('chat_room_read_states')
      .select('room_id,last_read_at')
      .eq('profile_id', activeProfileId)
      .in('room_id', roomIds)
    if (readError) {
      setToast(userError(readError), true)
      return
    }
    const readMap = new Map<string, string>()
    ;(readRows ?? []).forEach((row) => {
      const item = row as { room_id?: unknown; last_read_at?: unknown }
      if (typeof item.room_id === 'string' && typeof item.last_read_at === 'string') readMap.set(item.room_id, item.last_read_at)
    })
    const next: UnreadCountMap = {}
    await Promise.all(roomsToCount.map(async (room) => {
      let query = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', room.id)
        .is('deleted_at', null)
      const lastReadAt = readMap.get(room.id)
      if (lastReadAt) query = query.gt('created_at', lastReadAt)
      const { count, error } = await query
      if (!error) next[room.id] = count ?? 0
    }))
    setUnreadCounts(next)
  }, [activeProfileId, setToast])

  const markRoomRead = useCallback(async (roomId: string) => {
    if (!roomId || !activeProfileId) return
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('chat_room_read_states')
      .upsert({ room_id: roomId, profile_id: activeProfileId, last_read_at: now, updated_at: now }, { onConflict: 'room_id,profile_id' })
    if (error) {
      setToast(userError(error), true)
      return
    }
    setUnreadCounts((current) => ({ ...current, [roomId]: 0 }))
  }, [activeProfileId, setToast])

  const loadAttendanceIntegration = useCallback(async () => {
    if (!companyId) {
      setAttendanceIntegrationRoomId(null)
      return
    }

    const { data, error } = await supabase
      .from('chat_room_integrations')
      .select('room_id,enabled')
      .eq('company_id', companyId)
      .eq('integration_key', 'attendance')
      .maybeSingle()

    if (error) {
      setToast(userError(error), true)
      return
    }

    const row = data as { room_id?: string | null; enabled?: boolean | null } | null
    setAttendanceIntegrationRoomId(row?.enabled && row.room_id ? row.room_id : null)
  }, [companyId, setToast])

  const loadRooms = useCallback(async () => {
    if (!currentCompany?.company_id) return

    setLoadingRooms(true)
    if (currentCompany.company_role === 'employee' && activeProfileId) {
      try {
        await ensureEmployeePrivateChatRoom(currentCompany.company_id, activeProfileId)
      } catch (error) {
        // Keep older deployments usable until the employee-room migration is applied.
        const code = (error as { code?: string } | null)?.code
        if (code !== '42883' && code !== '42704' && code !== 'PGRST202') setToast(userError(error), true)
      }
    }
    if (canProvisionProgramDevelopmentRoom) {
      try {
        await ensureProgramDevelopmentRoom(currentCompany.company_id)
      } catch (error) {
        // Keep older deployments usable until the provisioning migration is applied.
        const code = (error as { code?: string } | null)?.code
        if (code !== '42883' && code !== '42704') setToast(userError(error), true)
      }
    }
    if (canManageCompany) {
      try {
        await ensureGeneralWorkRoom(currentCompany.company_id)
      } catch (error) {
        const code = (error as { code?: string } | null)?.code
        if (code !== '42883' && code !== '42704') setToast(userError(error), true)
      }
    }

    const metadataQuery = await supabase
      .from('chat_rooms')
      .select('id,name,company_id,room_key,employee_profile_id,is_private,room_purpose,created_by,created_at,updated_at,chat_room_members(profile_id,member_role,joined_at,profiles(full_name,email))')
      .eq('company_id', currentCompany.company_id)
      .order('updated_at', { ascending: false })
    let data: unknown[] | null = metadataQuery.data as unknown[] | null
    let error = metadataQuery.error

    if (error) {
      // Metadata columns are absent before the migration. Fall back to the
      // legacy projection so the existing chat remains available.
      const legacy = await supabase
        .from('chat_rooms')
        .select('id,name,created_by,created_at,updated_at,chat_room_members(profile_id,member_role,joined_at,profiles(full_name,email))')
        .eq('company_id', currentCompany.company_id)
        .order('updated_at', { ascending: false })
      data = legacy.data as unknown[] | null
      error = legacy.error
    }

    if (error) {
      setToast(userError(error), true)
      setLoadingRooms(false)
      return
    }

    const next = (data ?? []).map((row) => {
      const raw = row as Record<string, unknown>
      const members = Array.isArray(raw.chat_room_members) ? raw.chat_room_members : []
      const mappedMembers = members
        .map((member) => {
          if (!member || typeof member !== 'object') return null
          const memberRow = member as Record<string, unknown>
          return {
            room_id: (raw.id as string) ?? '',
            profile_id: typeof memberRow.profile_id === 'string' ? memberRow.profile_id : '',
            member_role: memberRow.member_role === 'owner' ? 'owner' : 'member',
            joined_at: typeof memberRow.joined_at === 'string' ? memberRow.joined_at : '',
            profiles: normalizeProfile(memberRow.profiles),
          } as RoomMember
        })
        .filter((item): item is RoomMember => item !== null)

      return {
        id: typeof raw.id === 'string' ? raw.id : '',
        name: typeof raw.name === 'string' ? raw.name : '',
        company_id: typeof raw.company_id === 'string' ? raw.company_id : undefined,
        room_key: typeof raw.room_key === 'string' ? raw.room_key : null,
        employee_profile_id: typeof raw.employee_profile_id === 'string' ? raw.employee_profile_id : null,
        is_private: raw.is_private === true,
        room_purpose: typeof raw.room_purpose === 'string' ? raw.room_purpose : null,
        created_by: typeof raw.created_by === 'string' ? raw.created_by : null,
        created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
        updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
        chat_room_members: mappedMembers,
      } as ChatRoom
    })
    setRooms((current) => {
      if (
        current.length === next.length &&
        current.every((room, index) => room.id === next[index]?.id && room.updated_at === next[index]?.updated_at)
      ) return current
      return next
    })
    void loadUnreadCounts(next)
    setSelectedRoomId((current) => {
      const preferred = selectedRoomIdRef.current || current
      if (preferred && next.some((room) => room.id === preferred)) {
        selectedRoomIdRef.current = preferred
        return preferred
      }
      const fallback = next.find((room) => room.employee_profile_id === activeProfileId)?.id ?? next[0]?.id ?? ''
      selectedRoomIdRef.current = fallback
      if (roomSelectionStorageKey && typeof window !== 'undefined') {
        try {
          if (fallback) window.sessionStorage.setItem(roomSelectionStorageKey, fallback)
          else window.sessionStorage.removeItem(roomSelectionStorageKey)
        } catch {
          // Ignore storage restrictions and keep the in-memory fallback.
        }
      }
      return fallback
    })
    setLoadingRooms(false)
  }, [activeProfileId, canManageCompany, canProvisionProgramDevelopmentRoom, currentCompany?.company_id, currentCompany?.company_role, loadUnreadCounts, roomSelectionStorageKey, setToast])

  const loadRoomMembers = useCallback(async (roomId: string) => {
    setLoadingMembers(true)
    const { data, error } = await supabase
      .from('chat_room_members')
      .select('room_id,profile_id,member_role,joined_at,profiles(full_name,email)')
      .eq('room_id', roomId)

    if (error) {
      setToast(userError(error), true)
      setRoomMembers([])
      setLoadingMembers(false)
      return
    }

    setRoomMembers((data ?? []).map((row) => {
      const raw = row as Record<string, unknown>
      const joinedAt = typeof raw.joined_at === 'string' ? raw.joined_at : ''
      const role = raw.member_role === 'owner' || raw.member_role === 'member' ? raw.member_role : 'member'
      return {
        room_id: typeof raw.room_id === 'string' ? raw.room_id : '',
        profile_id: typeof raw.profile_id === 'string' ? raw.profile_id : '',
        member_role: role,
        joined_at: joinedAt,
        profiles: normalizeProfile(raw.profiles),
      } as RoomMember
    }))
    setLoadingMembers(false)
  }, [setToast])

  const hydrateAttachment = useCallback(async (messagesToLoad: ChatMessage[]) => {
    const fileMessages = messagesToLoad.filter(
      (message) => message.message_type === 'file' && message.attachment_bucket && message.attachment_path,
    )
    if (fileMessages.length === 0) return
    const next: MessageAttachmentUrlMap = {}
    await Promise.all(
      fileMessages.map(async (message) => {
        if (!message.attachment_path || attachmentUrls[message.id]) return
        const { data, error } = await supabase.storage
          .from(message.attachment_bucket || 'chat-attachments')
          .createSignedUrl(message.attachment_path, 60 * 60)
        if (!error && data?.signedUrl) next[message.id] = data.signedUrl
      }),
    )
    if (Object.keys(next).length) {
      setAttachmentUrls((current) => ({ ...current, ...next }))
    }
  }, [attachmentUrls])

  const loadMessages = useCallback(
    async (roomId: string) => {
      setLoadingMessages(true)
      const { data, error } = await supabase
        .from('chat_messages')
        .select(
          'id,room_id,sender_profile_id,message_type,message_class,text_content,attachment_bucket,attachment_path,attachment_name,attachment_content_type,attachment_size,created_at',
        )
        .eq('room_id', roomId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })

      if (error) {
        setToast(userError(error), true)
        setLoadingMessages(false)
        setMessages([])
        return false
      }

      const next = ((data ?? []) as ChatMessage[]).map((message) => ({
        ...message,
        attachment_name: message.attachment_name || null,
      }))
      setMessages(next)
      await hydrateAttachment(next)
      setLoadingMessages(false)
      scrollToBottom()
      return true
    },
    [hydrateAttachment, setToast],
  )

  const softDeleteMessage = useCallback(async (message: ChatMessage) => {
    if (!canManageCompany && message.sender_profile_id !== activeProfileId) return
    if (!window.confirm('ลบรูปนี้ออกจากห้องแชตหรือไม่? ไฟล์ต้นฉบับจะยังเก็บไว้')) return
    const { error } = await supabase.from('chat_messages').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', message.id).is('deleted_at', null)
    if (error) { setToast(userError(error), true); return }
    setMessages((current) => current.filter((item) => item.id !== message.id))
    setToast('ลบรูปออกจากห้องแล้ว (ไฟล์ต้นฉบับยังอยู่)', false)
  }, [activeProfileId, canManageCompany, setToast])

  const loadAttendanceApprovalJobs = useCallback(async (roomId: string) => {
    const { data, error } = await supabase
      .from('chat_attendance_approval_jobs')
      .select('id,request_code,requester_profile_id,responsible_profile_id,site_id,action,requested_at,status,validation_result,duplicate_of_job_id,attendance_session_id,decision_note,message_status,recipient_profile_id,message_sent_at,claimed_by,claimed_at,message_error,created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) {
      setAttendanceApprovalJobs([])
      if (error.code !== '42P01') setToast(userError(error), true)
      return
    }
    setAttendanceApprovalJobs((data ?? []) as AttendanceApprovalJob[])
    setAttendanceApprovalCheckedAt(Date.now())
  }, [setToast])

  const loadHrIntakeGate = useCallback(async (roomId: string) => {
    const room = roomsRef.current.find((item) => item.id === roomId)
    if (room?.room_key !== 'hr_primary' && attendanceIntegrationRoomId !== roomId) {
      setHrIntakeItems([])
      setHrIntakeCounts(null)
      setHrConfirmationBundles([])
      return
    }
    const [countsResult, intakeResult, bundleResult, summaryResult] = await Promise.all([
      supabase.rpc('hr_intake_gate_counts'),
      supabase.from('hr_intake_raw_items')
        .select('id,source_channel,source_ref,room_id,status,content_snapshot,confidence,classification_reason,duplicate_of_id,bundle_id,created_at')
        .in('status', ['pending', 'candidate', 'low_confidence', 'needs_more_info', 'duplicate', 'already_confirmed'])
        .order('created_at', { ascending: false }).limit(80),
      supabase.from('hr_confirmation_bundles')
        .select('id,employee_profile_id,work_date,project_id,status,validation_summary,confirmation_status,owner_profile_id,next_action,sla_due_at,escalation_level,decision_note,last_error,updated_at')
        .in('status', ['received', 'under_review', 'needs_more_info', 'pending_approval', 'approved', 'recorded'])
        .order('updated_at', { ascending: false }).limit(40),
      supabase.rpc('get_hr_confirmation_daily_summary', { target_date: new Date().toLocaleDateString('en-CA') }),
    ])
    const schemaMissing = [countsResult.error, intakeResult.error, bundleResult.error, summaryResult.error].find((error) => error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST202')
    if (schemaMissing) {
      setHrIntakeItems([]); setHrIntakeCounts(null); setHrConfirmationBundles([]); setHrConfirmationEvidence([]); setHrDailySummary(null)
      return
    }
    const error = countsResult.error || intakeResult.error || bundleResult.error || summaryResult.error
    if (error) {
      setToast(userError(error), true)
      return
    }
    setHrIntakeCounts((countsResult.data ?? null) as HrIntakeCounts | null)
    setHrIntakeItems((intakeResult.data ?? []) as HrIntakeRawItem[])
    const bundles = (bundleResult.data ?? []) as HrConfirmationBundle[]
    setHrConfirmationBundles(bundles)
    setHrDailySummary((summaryResult.data ?? null) as HrDailySummary | null)
    if (bundles.length === 0) { setHrConfirmationEvidence([]); return }
    const evidenceResult = await supabase.from('hr_confirmation_evidence')
      .select('id,bundle_id,source_kind,source_ref,source_message_id,document_flow_item_id,attendance_job_id,attendance_session_id,attachment_name')
      .in('bundle_id', bundles.map((bundle) => bundle.id)).order('created_at', { ascending: true })
    if (evidenceResult.error) setToast(userError(evidenceResult.error), true)
    else setHrConfirmationEvidence((evidenceResult.data ?? []) as HrConfirmationEvidence[])
  }, [attendanceIntegrationRoomId, setToast])

  const actHrIntakeItem = async (item: HrIntakeRawItem, action: 'confirm' | 'request_more' | 'reject') => {
    if (!canManageCompany || !selectedRoom || hrGateBusyId) return
    const reason = action === 'confirm' ? 'HR ยืนยัน Candidate เข้า Confirmation Bundle'
      : window.prompt(action === 'request_more' ? 'ระบุข้อมูลที่ต้องการเพิ่ม' : 'ระบุเหตุผลที่ปฏิเสธ')
    if (!reason?.trim()) return
    setHrGateBusyId(item.id)
    try {
      const { error } = await supabase.rpc('act_hr_intake_item', {
        target_raw_item_id: item.id, target_action: action, target_reason: reason.trim(), target_action_key: crypto.randomUUID(),
      })
      if (error) throw error
      setToast(action === 'confirm' ? 'ยืนยัน Candidate เข้า Bundle แล้ว' : action === 'request_more' ? 'ส่งกลับเพื่อขอข้อมูลเพิ่มแล้ว' : 'ปฏิเสธรายการแล้ว', true)
      await loadHrIntakeGate(selectedRoom.id)
    } catch (error) { setToast(userError(error), true) } finally { setHrGateBusyId('') }
  }

  const actHrConfirmationBundle = async (bundle: HrConfirmationBundle, action: 'confirm' | 'request_more' | 'reject' | 'close') => {
    if (!canManageCompany || !selectedRoom || hrGateBusyId) return
    const reason = action === 'request_more' || action === 'reject'
      ? window.prompt(action === 'request_more' ? 'ระบุข้อมูลที่ต้องการเพิ่ม' : 'ระบุเหตุผลที่ปฏิเสธ') : null
    if ((action === 'request_more' || action === 'reject') && !reason?.trim()) return
    setHrGateBusyId(bundle.id)
    try {
      const { data, error } = await supabase.rpc('act_hr_confirmation_bundle', {
        target_bundle_id: bundle.id, target_action: action, target_reason: reason?.trim() || null, target_action_key: crypto.randomUUID(),
      })
      if (error) throw error
      const updated = data as HrConfirmationBundle
      if (updated.last_error) throw new Error(updated.last_error)
      setToast(action === 'close' ? 'ตรวจครบและปิด Bundle 100% แล้ว' : hrBundleStatusLabel[updated.status], true)
      await Promise.all([loadHrIntakeGate(selectedRoom.id), loadMessages(selectedRoom.id)])
    } catch (error) { setToast(userError(error), true) } finally { setHrGateBusyId('') }
  }

  const claimHrConfirmationBundle = async (bundle: HrConfirmationBundle) => {
    if (!canManageCompany || !selectedRoom || !activeProfileId || hrGateBusyId) return
    setHrGateBusyId(bundle.id)
    try {
      const { error } = await supabase.rpc('assign_hr_confirmation_bundle', {
        target_bundle_id: bundle.id, target_owner_profile_id: activeProfileId, target_action_key: crypto.randomUUID(),
      })
      if (error) throw error
      setToast('รับผิดชอบ Task Card แล้ว', true)
      await loadHrIntakeGate(selectedRoom.id)
    } catch (error) { setToast(userError(error), true) } finally { setHrGateBusyId('') }
  }

  const loadDevelopmentTasks = useCallback(async (roomId: string) => {
    const room = roomsRef.current.find((item) => item.id === roomId)
    if (room?.room_key !== 'program_development_primary') {
      setDevelopmentTasks([])
      setDevelopmentTasksCheckedAt(0)
      return
    }
    const { data, error } = await supabase
      .from('development_tasks')
      .select('id,company_id,room_id,source_message_id,task_code,request_text,intent,status,owner_profile_id,result_summary,files,commit_ref,test_result,build_result,deploy_result,blocker,created_at,updated_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      setDevelopmentTasks([])
      if (error.code !== '42P01') setToast(userError(error), true)
      return
    }
    const rows = (data ?? []) as DevelopmentTask[]
    const ids = rows.map((task) => task.id)
    let dispatches: DevelopmentTaskDispatch[] = []
    if (ids.length > 0) {
      const dispatchResult = await supabase
        .from('development_task_dispatches')
        .select('id,task_id,target,status,retry_count,last_error,updated_at')
        .in('task_id', ids)
        .order('updated_at', { ascending: false })
      if (!dispatchResult.error) dispatches = (dispatchResult.data ?? []) as DevelopmentTaskDispatch[]
    }
    const dispatchMap = new Map<string, DevelopmentTaskDispatch[]>()
    dispatches.forEach((dispatch) => {
      const current = dispatchMap.get(dispatch.task_id) ?? []
      current.push(dispatch)
      dispatchMap.set(dispatch.task_id, current)
    })
    setDevelopmentTasks(rows.map((task) => ({ ...task, dispatches: dispatchMap.get(task.id) ?? [] })))
    setDevelopmentTasksCheckedAt(Date.now())
  }, [setToast])

  const transitionDevelopmentTask = async (task: DevelopmentTask, targetStatus: DevelopmentTaskStatus) => {
    if (!isProgramDevelopmentOwner || !selectedRoom || developmentTaskBusyId) return
    let resultSummary: string | null = null
    if (targetStatus === 'waiting_review') {
      resultSummary = window.prompt('ระบุข้อมูลที่ต้องการเพิ่ม (ถ้ามี)')
      if (resultSummary === null) return
    } else if (targetStatus === 'completed') {
      resultSummary = window.prompt('สรุปผลการปิดงาน (ถ้ามี)')
      if (resultSummary === null) return
    }
    setDevelopmentTaskBusyId(task.id)
    try {
      const { error } = await supabase.rpc('transition_program_development_task', {
        target_task_id: task.id,
        target_status: targetStatus,
        target_result_summary: resultSummary || null,
      })
      if (error) throw error
      setToast(`อัปเดต ${task.task_code} เป็น ${developmentTaskStatusLabel[targetStatus]} แล้ว`, true)
      await loadDevelopmentTasks(selectedRoom.id)
    } catch (error) {
      setToast(userError(error), true)
    } finally {
      setDevelopmentTaskBusyId('')
    }
  }

  const dispatchDevelopmentTask = async (task: DevelopmentTask, target: 'codex' | 'developer_queue') => {
    if (!isProgramDevelopmentOwner || !selectedRoom || developmentTaskBusyId) return
    setDevelopmentTaskBusyId(task.id)
    try {
      const { error } = await supabase.rpc('dispatch_program_development_task', {
        target_task_id: task.id,
        target_target: target,
      })
      if (error) throw error
      setToast(`ส่งต่อ ${task.task_code} ไปยัง ${target === 'codex' ? 'Codex' : 'Module'} แล้ว`, true)
      await loadDevelopmentTasks(selectedRoom.id)
    } catch (error) {
      setToast(userError(error), true)
    } finally {
      setDevelopmentTaskBusyId('')
    }
  }

  const reviewAttendanceApprovalJob = async (job: AttendanceApprovalJob, action: 'approve' | 'reject' | 'request_more' | 'close') => {
    if (!canManageCompany || !selectedRoom) return
    const note = action === 'approve' || action === 'close'
      ? null
      : window.prompt(action === 'reject' ? 'ระบุเหตุผล Reject' : 'ระบุข้อมูลที่ต้องการเพิ่ม')
    if ((action === 'reject' || action === 'request_more') && !note?.trim()) return
    setAttendanceApprovalBusyId(job.id)
    try {
      const functionName = action === 'close' ? 'close_web_chat_attendance_job' : 'review_web_chat_attendance_job'
      const args = action === 'close'
        ? { target_job_id: job.id }
        : { target_job_id: job.id, review_action: action, review_note: note }
      const { data, error } = await supabase.rpc(functionName, args)
      if (error) throw error
      const updated = data as AttendanceApprovalJob
      setToast(action === 'close' ? 'ปิด Job 100% แล้ว' : attendanceApprovalStatusLabel[updated.status], true)
      await loadAttendanceApprovalJobs(selectedRoom.id)
      await loadMessages(selectedRoom.id)
    } catch (error) {
      setToast(userError(error), true)
    } finally {
      setAttendanceApprovalBusyId('')
    }
  }

  const openCreate = () => {
    if (!canOpenCreate) return
    setNewRoomName('')
    setInviteProfileId('')
    setCreateOpen(true)
  }

  const openManageMembers = () => {
    if (!selectedRoom) return
    setRoomNameDraft(selectedRoom.name)
    setInviteProfileId('')
    setManageOpen(true)
  }

  const createRoom = async () => {
    if (!currentCompany?.company_id || !activeProfileId || !newRoomName.trim()) {
      setToast('กรุณากรอกชื่อห้องก่อน')
      return
    }
    setBusy(true)
    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: 'create-room',
        actorProfileId: activeProfileId,
        companyId: currentCompany.company_id,
        request: { room_name: newRoomName.trim(), invited_profile_id: inviteProfileId.trim() || null },
        operation: async () => {
          const { data: roomRows, error: roomError } = await supabase
            .from('chat_rooms')
            .insert({
              company_id: currentCompany.company_id,
              name: newRoomName.trim(),
              created_by: activeProfileId,
            })
            .select('id')
            .single()
          if (roomError || !roomRows?.id) throw roomError || new Error('ไม่สามารถสร้างห้องได้')

          const { error: ownerError } = await supabase
            .from('chat_room_members')
            .insert({ room_id: roomRows.id, profile_id: activeProfileId, member_role: 'owner' as RoomMemberRole })
          if (ownerError) throw ownerError

          if (inviteProfileId.trim()) {
            const { error: inviteError } = await supabase
              .from('chat_room_members')
              .insert({ room_id: roomRows.id, profile_id: inviteProfileId, member_role: 'member' as RoomMemberRole })
            if (inviteError) throw inviteError
          }

          setCreateOpen(false)
          setInviteProfileId('')
          setNewRoomName('')
          selectRoom(roomRows.id)
          await loadRooms()
          setToast('สร้างห้องเรียบร้อยแล้ว', true)
          return roomRows
        },
      })
    } catch (error) {
      setToast(userError(error))
    }
    setBusy(false)
  }

  const stopAttendanceCamera = useCallback(() => {
    attendanceStreamRef.current?.getTracks().forEach((track) => track.stop())
    attendanceStreamRef.current = null
    if (attendanceVideoRef.current) attendanceVideoRef.current.srcObject = null
    setAttendanceCameraReady(false)
    setAttendanceCameraOpen(false)
  }, [])

  const openAttendanceCommand = async (action: ChatAttendanceAction) => {
    if (!selectedRoom || !activeProfileId || !companyId) {
      setToast('กรุณาเลือกบริษัทและห้องก่อนลงเวลา')
      return
    }
    setAttendanceAction(action)
    setAttendanceRequestCode(createChatAttachmentId())
    setAttendanceSiteId('')
    setAttendanceLocation(null)
    setAttendanceSelfie(null)
    setAttendanceCameraOpen(false)
    setAttendanceDialogOpen(true)
    if (action !== 'clock_in') return

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const { data, error } = await supabase
      .from('employee_site_assignments')
      .select('project_sites(id,name,latitude,longitude,radius_meters,projects(name))')
      .eq('profile_id', activeProfileId)
      .eq('active', true)
      .lte('starts_on', today)
      .or(`ends_on.is.null,ends_on.gte.${today}`)
    if (error) {
      setAttendanceDialogOpen(false)
      setToast(userError(error), true)
      return
    }
    const sites = (data ?? [])
      .map((row) => normalizeAttendanceSite((row as { project_sites?: unknown }).project_sites))
      .filter((site): site is AttendanceSite => Boolean(site))
    setAttendanceSites(sites)
    if (sites.length === 1) setAttendanceSiteId(sites[0].id)
    if (sites.length === 0) setToast('ไม่พบไซต์ที่ได้รับมอบหมาย กรุณาตรวจสอบกับ HR', true)
  }

  const handleVoiceInput = () => {
    if (voiceListening) {
      speechRecognitionRef.current?.stop()
      return
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor
      webkitSpeechRecognition?: SpeechRecognitionConstructor
    }
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setToast('เบราว์เซอร์นี้ไม่รองรับการพูด กรุณาพิมพ์คำสั่งแทน', true)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'th-TH'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || ''
      const command = parseChatAttendanceCommand(transcript)
      if (command) {
        setMessageText('')
        void openAttendanceCommand(command.action)
      } else {
        setMessageText(transcript)
        if (transcript) setToast('ได้ยินข้อความแล้ว กรุณาตรวจสอบก่อนกดส่ง', true)
      }
    }
    recognition.onerror = () => {
      setVoiceListening(false)
      setToast('ไม่สามารถรับเสียงได้ กรุณาลองใหม่หรือพิมพ์คำสั่ง', true)
    }
    recognition.onend = () => setVoiceListening(false)
    speechRecognitionRef.current = recognition
    setVoiceListening(true)
    try {
      recognition.start()
    } catch {
      setVoiceListening(false)
      speechRecognitionRef.current = null
      setToast('ไม่สามารถเริ่มรับเสียงได้ กรุณาลองใหม่หรือพิมพ์คำสั่ง', true)
    }
  }

  const getAttendanceLocation = () => new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('อุปกรณ์นี้ไม่รองรับ GPS'))
    else navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 20_000, maximumAge: 0,
    })
  })

  const startAttendanceCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับกล้อง')
      setAttendanceCameraOpen(true)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false,
      })
      attendanceStreamRef.current = stream
      if (attendanceVideoRef.current) {
        attendanceVideoRef.current.srcObject = stream
        await attendanceVideoRef.current.play()
        setAttendanceCameraReady(true)
      }
    } catch (error) {
      stopAttendanceCamera()
      setToast(error instanceof Error ? `เปิดกล้องไม่ได้: ${userError(error)}` : 'เปิดกล้องไม่ได้', true)
    }
  }

  const verifyAttendance = async () => {
    if (!attendanceAction) return
    if (attendanceAction === 'clock_in' && !attendanceSiteId) {
      setToast('กรุณาเลือกไซต์งานก่อนตรวจตำแหน่ง')
      return
    }
    const selectedSite = attendanceSites.find((site) => site.id === attendanceSiteId) ?? null
    setAttendanceBusy(true)
    try {
      const position = await getAttendanceLocation()
      const { latitude, longitude, accuracy } = position.coords
      const distance = selectedSite ? distanceMeters(latitude, longitude, selectedSite.latitude, selectedSite.longitude) : null
      setAttendanceLocation({ latitude, longitude, accuracy, distance, site: selectedSite })
    } catch (error) {
      const geoError = error as GeolocationPositionError
      const code = typeof geoError?.code === 'number'
        ? geoError.code === 1 ? 'permission_denied' : geoError.code === 2 ? 'position_unavailable' : 'location_timeout'
        : !navigator.geolocation ? 'gps_unsupported' : 'gps_unavailable'
      const detail = error instanceof Error ? userError(error) : 'ไม่สามารถอ่านตำแหน่งได้'
      setAttendanceLocation({
        latitude: null, longitude: null, accuracy: null, distance: null, site: selectedSite,
        gpsErrorCode: code, gpsErrorMessage: detail,
      })
    } finally {
      setAttendanceBusy(false)
    }
    await startAttendanceCamera()
  }

  const captureAttendanceSelfie = async () => {
    const video = attendanceVideoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setToast('กล้องยังไม่พร้อม กรุณารอสักครู่', true)
      return
    }
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) {
      setToast('ไม่สามารถบันทึกภาพจากกล้องได้', true)
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
    if (!blob) {
      setToast('ไม่สามารถบันทึกภาพจากกล้องได้', true)
      return
    }
    setAttendanceSelfie(new File([blob], `chat-selfie-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    stopAttendanceCamera()
  }

  const submitAttendance = async () => {
    if (!attendanceAction || !activeProfileId || !companyId || !selectedRoom || !attendanceLocation || !attendanceSelfie) {
      setToast('กรุณาตรวจตำแหน่งและถ่าย Selfie ก่อนยืนยัน')
      return
    }
    const action = attendanceAction
    const roomId = selectedRoom.id
    const requestCode = attendanceRequestCode || createChatAttachmentId()
    let selfiePath = ''
    let cleanupSelfie = false
    setAttendanceBusy(true)
    try {
      const result = await runWithMutationAttempt<Record<string, unknown>, { message: string; status?: string; selfiePath: string }>({
        module: 'chat',
        action: `chat-attendance-${action}`,
        actorProfileId: activeProfileId,
        companyId,
        request: { room_id: roomId, action, site_id: attendanceSiteId || null, gps_error_code: attendanceLocation.gpsErrorCode ?? null },
        operation: async () => {
          const extension = attendanceSelfie.name.split('.').pop()?.toLowerCase() || 'jpg'
          const path = `${activeProfileId}/${requestCode}-${action === 'clock_in' ? 'in' : 'out'}-chat.${extension}`
          const { data: existingJob } = await supabase
            .from('chat_attendance_approval_jobs')
            .select('status,selfie_path')
            .eq('company_id', companyId)
            .eq('request_code', requestCode)
            .maybeSingle()
          if (existingJob) {
            return {
              message: 'พบรหัสรายการเดิม ระบบไม่สร้าง Job ซ้ำ',
              status: existingJob.status as string,
              selfiePath: existingJob.selfie_path as string,
            }
          }
          const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, attendanceSelfie, {
            contentType: attendanceSelfie.type, upsert: false,
          })
          if (uploadError) throw uploadError
          selfiePath = path
          const { data, error } = await supabase.rpc('create_web_chat_attendance_job', {
            target_room_id: roomId,
            target_request_code: requestCode,
            target_action: action,
            target_site_id: action === 'clock_in' ? attendanceSiteId : null,
            target_requested_at: new Date().toISOString(),
            target_latitude: attendanceLocation.latitude,
            target_longitude: attendanceLocation.longitude,
            target_accuracy_meters: attendanceLocation.accuracy,
            target_selfie_path: path,
            target_device_info: getDeviceInfo(),
          })
          if (error) {
            const detail = userError(error)
            const { data: recoveredJob } = await supabase
              .from('chat_attendance_approval_jobs')
              .select('status')
              .eq('company_id', companyId)
              .eq('request_code', requestCode)
              .maybeSingle()
            if (recoveredJob) {
              return {
                message: 'บันทึก Job สำเร็จแล้วจากรหัสรายการเดิม',
                status: recoveredJob.status as string,
                selfiePath: path,
              }
            }
            cleanupSelfie = true
            throw new Error(detail)
          }
          if (data?.error) {
            cleanupSelfie = true
            throw new Error(data.error)
          }
          return {
            message: 'รับข้อมูลแล้วและส่งให้ผู้รับผิดชอบอนุมัติ',
            status: typeof data?.status === 'string' ? data.status : 'pending_approval',
            selfiePath: path,
          }
        },
        errorAction: 'ลงเวลาจากห้องแชตไม่สำเร็จ',
      })
      setAttendanceDialogOpen(false)
      setAttendanceAction(null)
      setAttendanceLocation(null)
      setAttendanceSelfie(null)
      setAttendanceSiteId('')
      setAttendanceRequestCode('')
      await loadAttendanceApprovalJobs(roomId)
      await loadMessages(roomId)
      const statusText = result.status === 'needs_more_info' ? 'ข้อมูลยังไม่ครบ ระบบเปิด Job รอข้อมูลเพิ่ม' : result.message
      setToast(statusText, true)
    } catch (error) {
      if (cleanupSelfie && selfiePath) await supabase.storage.from('attendance-selfies').remove([selfiePath])
      setToast(userError(error), true)
    } finally {
      setAttendanceBusy(false)
    }
  }

  useEffect(() => () => {
    attendanceStreamRef.current?.getTracks().forEach((track) => track.stop())
    speechRecognitionRef.current?.stop()
  }, [])

  const sendTextMessage = async () => {
    const content = messageText.trim()
    if (!selectedRoom || !activeProfileId || !content) return
    const attendanceCommand = parseChatAttendanceCommand(content)
    if (attendanceCommand) {
      setMessageText('')
      await openAttendanceCommand(attendanceCommand.action)
      return
    }
    setBusy(true)
    const payload = {
      company_id: currentCompany?.company_id,
      room_id: selectedRoom.id,
      sender_profile_id: activeProfileId,
      message_type: 'text' as MessageType,
      text_content: content,
    }
    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: 'send-text-message',
        actorProfileId: activeProfileId,
        companyId: currentCompany?.company_id ?? null,
        request: { room_id: selectedRoom.id },
        operation: async () => {
          const { error } = await supabase.from('chat_messages').insert(payload)
          if (error) throw error
          return { data: true }
        },
      })
      setMessageText('')
      await loadMessages(selectedRoom.id)
    } catch (error) {
      setToast(userError(error))
    }
    setBusy(false)
  }

  const toggleAttendanceIntegration = async () => {
    if (!selectedRoom || !currentCompany?.company_id || !canManageThisRoom || !activeProfileId) return
    const isCurrentTarget = attendanceIntegrationRoomId === selectedRoom.id
    setBusy(true)
    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: isCurrentTarget ? 'disable-attendance-room' : 'enable-attendance-room',
        actorProfileId: activeProfileId,
        companyId: currentCompany.company_id,
        request: { room_id: selectedRoom.id, integration_key: 'attendance', enabled: !isCurrentTarget },
        operation: async () => {
          const { error } = await supabase
            .from('chat_room_integrations')
            .upsert({
              company_id: currentCompany.company_id,
              integration_key: 'attendance',
              room_id: selectedRoom.id,
              enabled: !isCurrentTarget,
              created_by: activeProfileId,
            }, { onConflict: 'company_id,integration_key' })
          if (error) throw error
          return { data: true }
        },
      })
      setAttendanceIntegrationRoomId(isCurrentTarget ? null : selectedRoom.id)
      setToast(isCurrentTarget ? 'ปิดการส่ง log ลงเวลาเข้าห้องนี้แล้ว' : 'ตั้งห้องนี้เป็นห้องรับ log HR แล้ว', true)
    } catch (error) {
      setToast(userError(error))
    }
    setBusy(false)
  }

  const renameRoom = async () => {
    if (!selectedRoom || !currentCompany?.company_id || !canManageThisRoom || !activeProfileId) return
    const nextName = roomNameDraft.trim()
    if (!nextName) {
      setToast('กรุณากรอกชื่อห้อง')
      return
    }
    if (nextName === selectedRoom.name) {
      setToast('ชื่อห้องยังเหมือนเดิม')
      return
    }
    setBusy(true)
    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: 'rename-room',
        actorProfileId: activeProfileId,
        companyId: currentCompany.company_id,
        request: { room_id: selectedRoom.id, room_name: nextName },
        operation: async () => {
          const { error } = await supabase
            .from('chat_rooms')
            .update({ name: nextName })
            .eq('id', selectedRoom.id)
            .eq('company_id', currentCompany.company_id)
          if (error) throw error
          return { data: true }
        },
      })
      await loadRooms()
      setRoomNameDraft(nextName)
      setToast('เปลี่ยนชื่อห้องเรียบร้อยแล้ว', true)
    } catch (error) {
      setToast(userError(error))
    }
    setBusy(false)
  }

  const sendFileMessage = async (file: File | null) => {
    if (!file) return
    if (!selectedRoom || !currentCompany?.company_id || !activeProfileId) {
      setToast('ยังไม่พร้อมส่งไฟล์ กรุณาเลือกห้องและเข้าสู่ระบบใหม่อีกครั้ง')
      setPendingAttachment(file)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > maxChatAttachmentBytes) {
      setToast('ไฟล์ใหญ่เกิน 50 MB กรุณาเลือกรูปหรือไฟล์ที่เล็กลง')
      setPendingAttachment(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const contentType = getChatAttachmentContentType(file)
    if (!supportedChatAttachmentTypes.has(contentType)) {
      setToast('ไฟล์ชนิดนี้ยังไม่รองรับ กรุณาใช้รูป JPG, PNG, WebP, HEIC หรือ PDF')
      setPendingAttachment(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    let session = sessionData.session
    const sessionExpiresSoon = typeof session?.expires_at === 'number'
      && session.expires_at <= Math.floor(Date.now() / 1000) + 30
    let refreshError = sessionError
    if (!session?.access_token || sessionExpiresSoon) {
      const { data: refreshedSession, error: nextRefreshError } = await supabase.auth.refreshSession()
      session = refreshedSession.session
      refreshError = nextRefreshError
    }
    if (refreshError || !session?.access_token) {
      setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนแนบไฟล์')
      setPendingAttachment(file)
      setBusy(false)
      return
    }
    selectRoom(selectedRoom.id)
    setBusy(true)
    setToast('กำลังส่งไฟล์…')
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    const objectPath = `${currentCompany.company_id}/${selectedRoom.id}/${Date.now()}-${createChatAttachmentId()}-${sanitized}`
    // Some mobile browsers report a generic or stale MIME on File objects.
    // Re-wrap the body so Storage receives the same content type used by the
    // bucket allow-list while retaining the original bytes and filename.
    const uploadBody = file.type.trim().toLowerCase() === contentType || typeof File === 'undefined'
      ? file
      : new File([file], sanitized || 'attachment', { type: contentType, lastModified: file.lastModified })

    try {
      const upload = () => supabase.storage.from('chat-attachments').upload(objectPath, uploadBody, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })
      let { error: uploadError } = await upload()
      if (uploadError && /401|jwt|token|session|expired|row-level|permission|unauthorized/i.test(uploadError.message)) {
        const { data: refreshedSession, error: uploadRefreshError } = await supabase.auth.refreshSession()
        if (uploadRefreshError || !refreshedSession.session?.access_token) {
          setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนแนบไฟล์')
          setPendingAttachment(file)
          setBusy(false)
          return
        }
        ({ error: uploadError } = await upload())
      }
      if (uploadError) {
        const lowerMessage = uploadError.message.toLowerCase()
        const message = lowerMessage.includes('mime') || lowerMessage.includes('content type')
          ? 'รูปแบบรูปนี้ยังไม่รองรับบน Storage กรุณาลอง JPG/PNG หรืออัปเดตแอปก่อน'
          : lowerMessage.includes('401') || lowerMessage.includes('jwt') || lowerMessage.includes('token')
            || lowerMessage.includes('session') || lowerMessage.includes('expired')
            ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนแนบไฟล์'
            : lowerMessage.includes('403') || lowerMessage.includes('42501') || lowerMessage.includes('row-level')
              || lowerMessage.includes('permission') || lowerMessage.includes('unauthorized') || lowerMessage.includes('forbidden')
            ? 'คุณไม่มีสิทธิ์แนบไฟล์ในห้องนี้ กรุณาตรวจว่ายังเป็นสมาชิกห้องอยู่'
            : lowerMessage.includes('invalid input syntax for type uuid') || lowerMessage.includes('invalid uuid')
              ? 'ข้อมูลห้องไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วเลือกห้องใหม่'
              : userError(uploadError, 'อัปโหลดไฟล์ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่')
        setToast(message)
        setPendingAttachment(file)
        setBusy(false)
        return
      }
    } catch (error) {
      setToast(userError(error))
      setPendingAttachment(file)
      setBusy(false)
      return
    }

    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: 'send-file-message',
        actorProfileId: activeProfileId,
        companyId: currentCompany?.company_id ?? null,
        request: { room_id: selectedRoom.id, file_name: sanitized, file_size: file.size || 0 },
        operation: async () => {
          const { error: messageError } = await supabase.from('chat_messages').insert({
            company_id: currentCompany.company_id,
            room_id: selectedRoom.id,
            sender_profile_id: activeProfileId,
            message_type: 'file',
            text_content: null,
            attachment_bucket: 'chat-attachments',
            attachment_path: objectPath,
            attachment_name: sanitized,
            attachment_content_type: contentType,
            attachment_size: file.size || 0,
          })
          if (messageError) throw messageError
          return { data: objectPath }
        },
      })
      setBusy(false)
      setMessageText('')
      setPendingAttachment(null)
      await loadMessages(selectedRoom.id)
      setToast('ส่งไฟล์เรียบร้อยแล้ว', true)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error) {
      await supabase.storage.from('chat-attachments').remove([objectPath])
      setToast(userError(error))
      setBusy(false)
      return
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAttachmentSelected = (file: File | null) => {
    if (!file) return
    if (!canSend) {
      setToast('กรุณาเลือกห้องและรอการเชื่อมต่อก่อนแนบไฟล์')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > maxChatAttachmentBytes) {
      setToast('ไฟล์ใหญ่เกิน 50 MB กรุณาเลือกรูปหรือไฟล์ที่เล็กลง')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const contentType = getChatAttachmentContentType(file)
    if (!supportedChatAttachmentTypes.has(contentType)) {
      setToast('ไฟล์ชนิดนี้ยังไม่รองรับ กรุณาใช้รูป JPG, PNG, WebP, HEIC หรือ PDF')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setPendingAttachment(file)
    setToast(`เลือกไฟล์ ${file.name} แล้ว กดปุ่มส่งเพื่อแนบในห้องนี้`)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const resetDragState = () => {
    dragDepthRef.current = 0
    setIsDragActive(false)
  }

  const hasDraggedFiles = (event: DragEvent<HTMLDivElement>) => event.dataTransfer.types.includes('Files')

  const handleChatDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (!selectedRoom || !canSend) return
    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleChatDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = canSend ? 'copy' : 'none'
    if (selectedRoom && canSend) setIsDragActive(true)
  }

  const handleChatDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragActive(false)
  }

  const handleChatDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    resetDragState()
    const file = event.dataTransfer.files?.[0] ?? null
    if (!file) return
    if ((event.dataTransfer.files?.length ?? 0) > 1) setToast('แนบได้ครั้งละ 1 ไฟล์ ระบบจะใช้ไฟล์แรกที่เลือก')
    handleAttachmentSelected(file)
  }

  const sendCurrentMessage = () => {
    if (pendingAttachment) {
      void sendFileMessage(pendingAttachment)
      return
    }
    void sendTextMessage()
  }

  const addMember = async () => {
    if (!selectedRoom || !inviteProfileId) return
    if (roomMembers.some((member) => member.profile_id === inviteProfileId)) {
      setToast('ผู้ใช้นี้อยู่ในห้องแล้ว')
      return
    }
    setBusy(true)
    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: 'add-room-member',
        actorProfileId: activeProfileId,
        companyId: currentCompany?.company_id ?? null,
        request: { room_id: selectedRoom.id, profile_id: inviteProfileId },
        operation: async () => {
          const { error } = await supabase
            .from('chat_room_members')
            .insert({ room_id: selectedRoom.id, profile_id: inviteProfileId, member_role: 'member' as RoomMemberRole })
          if (error) throw error
          return { data: true }
        },
      })
      await loadRoomMembers(selectedRoom.id)
      await loadRooms()
      await loadMessages(selectedRoom.id)
      setInviteProfileId('')
      setToast('เพิ่มสมาชิกเรียบร้อยแล้ว')
    } catch (error) {
      setToast(userError(error))
    }
    setBusy(false)
  }

  const removeMember = async (memberProfileId: string) => {
    if (!selectedRoom) return
    if (memberProfileId === activeProfileId && roomMembers.some((member) => member.member_role === 'owner' && member.profile_id === activeProfileId)) {
      setToast('หากต้องการยกเลิกสิทธิ์เจ้าของ โปรดให้ผู้จัดการบริษัทจัดการแทน')
      return
    }
    if (!window.confirm('ลบสมาชิกนี้จากห้องใช่หรือไม่')) return
    setRemoveLoading(true)
    try {
      await runWithMutationAttempt({
        module: 'chat',
        action: 'remove-room-member',
        actorProfileId: activeProfileId,
        companyId: currentCompany?.company_id ?? null,
        request: { room_id: selectedRoom.id, profile_id: memberProfileId },
        operation: async () => {
          const { error } = await supabase
            .from('chat_room_members')
            .delete()
            .eq('room_id', selectedRoom.id)
            .eq('profile_id', memberProfileId)
          if (error) throw error
          return { data: true }
        },
      })
      await loadRoomMembers(selectedRoom.id)
      await loadRooms()
      setToast('ลบสมาชิกเรียบร้อยแล้ว')
    } catch (error) {
      setToast(userError(error))
    }
    setRemoveLoading(false)
  }

  const resetSelection = useCallback(() => {
    setRooms([])
    selectedRoomIdRef.current = ''
    setSelectedRoomId('')
    setRoomMembers([])
    setMessages([])
    setAttendanceIntegrationRoomId(null)
    setHrIntakeItems([])
    setHrIntakeCounts(null)
    setHrConfirmationBundles([])
    setHrConfirmationEvidence([])
    setHrDailySummary(null)
    setDevelopmentTasks([])
    setDevelopmentTasksCheckedAt(0)
    setDevelopmentResultTask(null)
    setOperationalTaskOverrides({})
    setOperationalSelectedTaskId('')
    setOperationalTaskBusyId('')
    setUnreadCounts({})
    setOnlineProfileMap({})
  }, [])

  useEffect(() => {
    if (!currentCompany?.company_id) {
      const timer = window.setTimeout(resetSelection, 0)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      void loadRooms()
      void loadCompanyMembers()
      void loadAttendanceIntegration()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [currentCompany?.company_id, loadAttendanceIntegration, loadCompanyMembers, loadRooms, resetSelection])

  useEffect(() => {
    if (!selectedRoomId) return
    const timer = window.setTimeout(() => {
      void loadRoomMembers(selectedRoomId)
      void loadAttendanceApprovalJobs(selectedRoomId)
      void loadHrIntakeGate(selectedRoomId)
      void loadDevelopmentTasks(selectedRoomId)
      void loadMessages(selectedRoomId).then((loaded) => {
        if (loaded) void markRoomRead(selectedRoomId)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAttendanceApprovalJobs, loadDevelopmentTasks, loadHrIntakeGate, loadMessages, loadRoomMembers, markRoomRead, selectedRoomId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (!selectedRoomId || !currentCompany?.company_id || !realtimeAuthReady) return
    const messageChannel = supabase
      .channel(`chat-room-messages-${selectedRoomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
        filter: `room_id=eq.${selectedRoomId}`,
        },
        () => {
          void loadDevelopmentTasks(selectedRoomId)
          void loadMessages(selectedRoomId).then((loaded) => {
            if (loaded) void markRoomRead(selectedRoomId)
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(messageChannel)
    }
  }, [currentCompany?.company_id, loadDevelopmentTasks, loadMessages, markRoomRead, realtimeAuthReady, selectedRoomId])

  useEffect(() => {
    if (!currentCompany?.company_id || !realtimeAuthReady) return
    const roomChannel = supabase
      .channel(`chat-rooms-${currentCompany.company_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_rooms',
          filter: `company_id=eq.${currentCompany.company_id}`,
        },
        () => {
          void loadRooms()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        () => {
          void loadRooms()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(roomChannel)
    }
  }, [currentCompany?.company_id, loadRooms, realtimeAuthReady])

  useEffect(() => {
    if (!companyId || !activeProfileId || !realtimeAuthReady) {
      const timer = window.setTimeout(() => {
        setOnlineProfileMap({})
        setPresenceConnection('offline')
      }, 0)
      return () => window.clearTimeout(timer)
    }

    const connectingTimer = window.setTimeout(() => setPresenceConnection('connecting'), 0)
    const presenceChannel = supabase.channel(`chat-presence-${companyId}`, {
      config: { presence: { key: activeProfileId } },
    })
    const syncPresence = () => {
      const state = presenceChannel.presenceState() as Record<string, Array<{ profile_id?: unknown }>>
      const next: OnlineProfileMap = {}
      Object.values(state).forEach((metas) => {
        metas.forEach((meta) => {
          if (typeof meta?.profile_id === 'string') next[meta.profile_id] = true
        })
      })
      setOnlineProfileMap(next)
    }

    presenceChannel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const trackStatus = await presenceChannel.track({ profile_id: activeProfileId })
          if (trackStatus === 'ok') {
            setPresenceConnection('online')
            syncPresence()
            setOnlineProfileMap((current) => ({ ...current, [activeProfileId]: true }))
          } else {
            setPresenceConnection('offline')
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setPresenceConnection('offline')
        } else {
          setPresenceConnection('connecting')
        }
      })

    return () => {
      window.clearTimeout(connectingTimer)
      void supabase.removeChannel(presenceChannel)
    }
  }, [activeProfileId, companyId, realtimeAuthReady])

  const roomListContent = rooms.map((room) => {
    const role = room.chat_room_members?.find((member) => member.profile_id === activeProfileId)?.member_role
    const roomUnread = room.id === selectedRoomId ? 0 : unreadCounts[room.id] ?? 0
    const roomOnlineCount = room.chat_room_members?.filter((member) => onlineProfileMap[member.profile_id]).length ?? 0
    return (
      <ListItemButton
        key={room.id}
        selected={room.id === selectedRoomId}
        onClick={() => {
          selectRoom(room.id)
          setRoomPickerOpen(false)
        }}
        sx={{
          borderRadius: 1.5,
          mb: 0.5,
          alignItems: 'center',
          px: { xs: 1, sm: 1.25 },
          py: 0.8,
          '&.Mui-selected': { bgcolor: 'primary.50' },
        }}
      >
        <ListItemText
          disableTypography
          primary={<Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}><Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>{room.name}</Typography>{room.employee_profile_id && <Chip size="small" label="พนักงาน" color="info" sx={{ height: 18, fontSize: 10 }} />}{room.room_key === 'general_work_primary' && <Chip size="small" label="งานทั่วไป" sx={{ height: 18, fontSize: 10 }} />}{room.room_key === 'program_development_primary' && <Chip size="small" label="ส่วนตัว" color="secondary" sx={{ height: 18, fontSize: 10 }} />}</Stack>}
          secondary={(
            <Typography component="span" variant="caption" color="text.secondary" noWrap>
              {room.chat_room_members?.length ?? 0} คน · {roomOnlineCount} ออนไลน์
            </Typography>
          )}
        />
        {roomUnread > 0 && (
          <Chip
            size="small"
            color="primary"
            label={roomUnread > 99 ? '99+' : roomUnread}
            sx={{ ml: 0.75, minWidth: 28, height: 24, fontWeight: 800 }}
          />
        )}
        {role === 'owner' && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
            เจ้าของ
          </Typography>
        )}
      </ListItemButton>
    )
  })

  return (
    <Stack spacing={1} sx={{ width: '100%', minWidth: 0 }}>
      <Paper variant="outlined" sx={{ p: { xs: 0.9, sm: 1.15 }, borderRadius: 2.5, bgcolor: 'background.paper' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h6" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>Web Chat</Typography>
              <Chip
                size="small"
                color={presenceColor}
                variant={presenceConnection === 'online' ? 'filled' : 'outlined'}
                icon={<FiberManualRecordIcon sx={{ fontSize: 11 }} />}
                label={presenceLabel}
                sx={{ fontWeight: 700 }}
              />
            </Stack>
          </Stack>
          {selectedRoom && (
            <Tooltip title="เปลี่ยนห้อง">
              <IconButton
                color="primary"
                onClick={() => setRoomPickerOpen(true)}
                aria-label="เปลี่ยนห้อง"
                sx={{ display: { xs: 'inline-flex', md: 'none' }, width: 44, height: 44, border: '1px solid', borderColor: 'divider' }}
              >
                <MenuOutlinedIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="กลับไปหน้าลงเวลา">
            <IconButton
              color="primary"
              size="large"
              onClick={() => navigate('/time-tracking')}
              aria-label="กลับไปหน้าลงเวลา"
              sx={{ flexShrink: 0, width: 44, height: 44, bgcolor: 'background.paper', border: '1px solid', borderColor: 'primary.main', '&:hover': { bgcolor: 'action.selected' } }}
            >
              <ArrowBackOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      {!currentCompany?.company_id && (
        <Alert severity="warning">กรุณาเลือกบริษัทก่อนใช้งานห้องแชต</Alert>
      )}

      {note && <Alert severity={note.includes('เรียบร้อย') ? 'success' : 'info'} onClose={() => setNote('')}>{note}</Alert>}

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '260px minmax(0, 1fr)' },
        gap: 1,
        minWidth: 0,
        height: { xs: 'calc(100dvh - 175px)', md: 'calc(100dvh - 190px)' },
        minHeight: { xs: 460, md: 560 },
      }}>
        <Paper
          variant="outlined"
          sx={{ p: { xs: 0.8, sm: 1 }, minWidth: 0, minHeight: 0, overflow: 'hidden', display: { xs: selectedRoom ? 'none' : 'block', md: 'block' } }}
        >
          <Stack spacing={0.8} sx={{ height: '100%', minHeight: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="subtitle1" sx={{ px: 0.5, fontWeight: 800 }}>ห้อง</Typography>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                {totalUnreadCount > 0 && (
                  <Chip
                    size="small"
                    color="primary"
                    label={`ใหม่ ${Math.min(99, totalUnreadCount)}${totalUnreadCount > 99 ? '+' : ''}`}
                    sx={{ fontWeight: 700 }}
                  />
                )}
                <Tooltip title="สร้างห้องใหม่">
                  <span>
                    <IconButton
                      color="primary"
                      onClick={() => void openCreate()}
                      disabled={!canOpenCreate}
                      aria-label="สร้างห้องใหม่"
                      sx={{ minWidth: 40, minHeight: 40, border: '1px solid', borderColor: 'divider' }}
                    >
                      <AddOutlinedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
            {loadingRooms ? (
              <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
                <CircularProgress size={28} />
              </Box>
            ) : rooms.length === 0 ? (
              <Alert severity="info">ยังไม่มีห้องที่คุณเข้าถึงได้ สร้างห้องใหม่ได้เลย</Alert>
            ) : (
              <List disablePadding sx={{ borderRadius: 1, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {roomListContent}
              </List>
            )}
          </Stack>
        </Paper>

        <Paper
          variant="outlined"
          onDragEnter={handleChatDragEnter}
          onDragOver={handleChatDragOver}
          onDragLeave={handleChatDragLeave}
          onDrop={handleChatDrop}
          aria-label="พื้นที่วางไฟล์แนบในห้องแชต"
          sx={{ height: '100%', minHeight: 0, p: { xs: 0.8, sm: 1 }, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}
        >
          {isDragActive && (
            <Box
              aria-hidden="true"
              sx={{
                position: 'absolute',
                inset: 4,
                zIndex: 3,
                display: 'grid',
                placeItems: 'center',
                border: '2px dashed',
                borderColor: 'primary.main',
                borderRadius: 2,
                bgcolor: 'rgba(25, 118, 210, 0.10)',
                pointerEvents: 'none',
              }}
            >
              <Stack spacing={0.5} sx={{ alignItems: 'center', textAlign: 'center', px: 2 }}>
                <AttachFileOutlinedIcon color="primary" sx={{ fontSize: 42 }} />
                <Typography variant="h6" color="primary" sx={{ fontWeight: 800 }}>วางไฟล์ที่นี่</Typography>
                <Typography variant="body2" color="text.secondary">ระบบจะตรวจชนิดไฟล์และขนาดก่อนให้กดส่ง</Typography>
              </Stack>
            </Box>
          )}
          {!selectedRoom ? (
            <Box sx={{ p: 4, display: 'grid', placeItems: 'center', minHeight: 420 }}>
              <Alert severity="info" sx={{ maxWidth: 420 }}>
                {loadingRooms ? 'กำลังโหลดห้อง...' : 'ยังไม่เลือกห้อง'}
              </Alert>
            </Box>
          ) : (
            <>
              <Box sx={{ px: { xs: 0.25, sm: 0.5 }, py: 0.25, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 0.75, mb: 0.5, minWidth: 0 }}>
                <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, maxWidth: { xs: '45vw', sm: 'none' } }}>{selectedRoom.name}</Typography>
                    {attendanceIntegrationRoomId === selectedRoom.id && (
                      <Chip
                        size="small"
                        color="success"
                        icon={<AccessTimeOutlinedIcon />}
                        label="รับ Log HR"
                      />
                    )}
                  </Stack>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary">
                      {roomMembers.length} คน · {roomMembers.filter((member) => onlineProfileMap[member.profile_id]).length} ออนไลน์
                    </Typography>
                  </Stack>
                </Stack>
                <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  <Tooltip title="โทรสมาชิก">
                    <span>
                      <IconButton
                        color="primary"
                        onClick={() => {
                          setCallError('')
                          setCallDirectoryOpen(true)
                        }}
                        disabled={!callSignalingReady || roomMembers.length < 2}
                        aria-label="โทรสมาชิก"
                        sx={{ width: 40, height: 40 }}
                      >
                        <CallOutlinedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {canManageThisRoom && (
                    <>
                      <Tooltip title={attendanceIntegrationRoomId === selectedRoom.id ? 'หยุดรับ Log HR' : 'ตั้งเป็นห้อง HR'}>
                        <span>
                          <IconButton
                            color={attendanceIntegrationRoomId === selectedRoom.id ? 'success' : 'primary'}
                            onClick={() => void toggleAttendanceIntegration()}
                            disabled={busy}
                            aria-label={attendanceIntegrationRoomId === selectedRoom.id ? 'หยุดรับ Log HR' : 'ตั้งเป็นห้อง HR'}
                            sx={{ width: 40, height: 40 }}
                          >
                            <AccessTimeOutlinedIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="จัดสมาชิก">
                        <IconButton color="primary" onClick={openManageMembers} aria-label="จัดสมาชิก" sx={{ width: 40, height: 40 }}>
                          <GroupAddOutlinedIcon />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              </Box>
              <Divider sx={{ mb: 1 }} />

              <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', px: { xs: 0.25, sm: 0.75 }, py: 0.75, borderRadius: 1.5, bgcolor: 'action.hover', scrollbarGutter: 'stable' }}>
                {!isProgramDevelopmentRoom && (
                  <Card variant="outlined" sx={{ mb: 1, borderColor: 'primary.main', bgcolor: 'background.paper' }}>
                    <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
                    <Stack spacing={0.8}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <TaskAltOutlinedIcon color="primary" fontSize="small" />
                          <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Operational Core</Typography>
                          <Chip size="small" color={operationalLocalMode ? 'warning' : 'default'} label={operationalLocalMode ? 'Local-first preview' : 'อ่านอย่างเดียว'} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">Thread แยกตามข้อความต้นทาง · ไม่สร้างงานจาก System Result</Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                        <Chip size="small" label={`รับเข้า ${operationalSummary.received}`} />
                        <Chip size="small" color="warning" label={`กำลังทำ/ส่งต่อ ${operationalSummary.forwarded}`} />
                        <Chip size="small" color={operationalSummary.pending > 0 ? 'warning' : 'default'} label={`ค้าง ${operationalSummary.pending}`} />
                        <Chip size="small" color="success" label={`ปิดแล้ว ${operationalSummary.closed}`} />
                        <Chip size="small" label={`ซ้ำ ${operationalSummary.duplicate}`} />
                        <Chip size="small" color={operationalSummary.failed > 0 ? 'error' : 'default'} label={`Failed ${operationalSummary.failed}`} />
                        {operationalSummary.slaBreached > 0 && <Chip size="small" color="error" label={`เกิน SLA ${operationalSummary.slaBreached}`} />}
                      </Stack>
                      {!operationalLocalMode && <Alert severity="info" sx={{ py: 0 }}>ปุ่ม Action จะเปิดหลังผ่าน Local-first gate และเชื่อม RPC ของ Module ที่รับผิดชอบ</Alert>}
                      {operationalTaskCards.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">ยังไม่มีข้อความสำคัญที่ต้องสร้าง Task Card · ข้อความทั่วไปยังคงแสดงใน Chat ตามปกติ</Typography>
                      ) : (
                        <Stack spacing={0.7}>
                          {operationalTaskCards.map((card) => {
                            const slaBreached = operationalCheckedAt > 0
                              && ['received', 'waiting_review', 'blocked'].includes(card.status)
                              && new Date(card.dueAt).getTime() < operationalCheckedAt
                            const terminal = card.status === 'completed'
                            return (
                              <Card
                                key={card.taskId}
                                variant="outlined"
                                onClick={() => setOperationalSelectedTaskId(card.taskId)}
                                sx={{ bgcolor: card.taskId === operationalSelectedTaskId ? 'primary.50' : 'action.hover', cursor: 'pointer' }}
                              >
                                <CardContent sx={{ py: 0.9, px: 1, '&:last-child': { pb: 0.9 } }}>
                                  <Stack spacing={0.6}>
                                    <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{card.taskId}</Typography>
                                      <Chip size="small" color={operationalStatusColor[card.status]} label={operationalStatusLabel[card.status]} />
                                      <Chip size="small" variant="outlined" label={card.module} />
                                      {card.unread && <Chip size="small" color="info" label="ยังไม่อ่าน" />}
                                      {slaBreached && <Chip size="small" color="error" label="เกิน SLA" />}
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary">
                                      Thread: {card.threadKey} · Owner: {card.ownerName} · Next: {card.nextAction} · Due: {formatTime(card.dueAt)} ({card.slaMinutes} นาที)
                                    </Typography>
                                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                      {card.documentId && <Chip size="small" variant="outlined" label={`Document ${card.documentId}`} />}
                                      {card.advanceId && <Chip size="small" variant="outlined" label={`Advance ${card.advanceId}`} />}
                                      {card.attendanceId && <Chip size="small" variant="outlined" label={`Attendance ${card.attendanceId}`} />}
                                    </Stack>
                                    {card.exception && <Alert severity={card.failed ? 'error' : 'warning'} sx={{ py: 0 }}>{card.exception}</Alert>}
                                    <Stack direction="row" spacing={0.45} sx={{ flexWrap: 'wrap' }}>
                                      {operationalActionLabels.map(({ action, label }) => (
                                        <Button
                                          key={action}
                                          size="small"
                                          variant={action === 'close' ? 'contained' : 'outlined'}
                                          color={action === 'close' ? 'success' : 'primary'}
                                          disabled={!operationalLocalMode || operationalTaskBusyId === card.taskId || (terminal && action !== 'view_result')}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            actOperationalTask(card, action)
                                          }}
                                        >
                                          {label}
                                        </Button>
                                      ))}
                                    </Stack>
                                  </Stack>
                                </CardContent>
                              </Card>
                            )
                          })}
                        </Stack>
                      )}
                      {operationalSelectedTask && (
                        <Card variant="outlined" sx={{ borderColor: 'secondary.main', bgcolor: 'background.default' }}>
                          <CardContent sx={{ py: 0.9, px: 1, '&:last-child': { pb: 0.9 } }}>
                            <Stack spacing={0.6}>
                              <Typography variant="body2" sx={{ fontWeight: 900 }}>Evidence Panel · {operationalSelectedTask.taskId}</Typography>
                              <Typography variant="caption" color="text.secondary">Source Message: {operationalSelectedTask.sourceMessageId} · Thread: {operationalSelectedTask.threadKey}</Typography>
                              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                {operationalSelectedTask.evidence.map((item) => <Chip key={`${item.kind}-${item.value}`} size="small" variant="outlined" label={`${item.label}: ${item.value}`} />)}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                Audit: {operationalSelectedTask.audit.map((event) => `${event.event} (${event.actorId})`).join(' → ')}
                              </Typography>
                            </Stack>
                          </CardContent>
                        </Card>
                      )}
                    </Stack>
                    </CardContent>
                  </Card>
                )}
                {isProgramDevelopmentRoom && (
                  <Card variant="outlined" sx={{ mb: 1, borderColor: 'secondary.main', bgcolor: 'background.paper' }}>
                    <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
                      <Stack spacing={0.75}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                            <TaskAltOutlinedIcon color="secondary" fontSize="small" />
                            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Command Inbox</Typography>
                            <Chip size="small" color="secondary" label="รับเฉพาะงานพัฒนา" />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {developmentTasksCheckedAt ? `อัปเดต ${formatTime(new Date(developmentTasksCheckedAt).toISOString())}` : 'กำลังตรวจคำสั่ง'}
                          </Typography>
                        </Stack>
                        {!isProgramDevelopmentOwner && <Alert severity="warning">ห้องนี้เป็น Private Room เจ้าของระบบเท่านั้น</Alert>}
                        {isProgramDevelopmentOwner && developmentTasks.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            ยังไม่มี Task · ตัวอย่างคำสั่ง: Requirement: เพิ่มปุ่มค้นหา หรือ Bug: แนบรูปไม่ได้
                          </Typography>
                        ) : isProgramDevelopmentOwner ? (
                          <Stack spacing={0.75}>
                            {developmentTasks.map((task) => {
                              const ownerLabel = labelFromProfile(profileNameMap.get(task.owner_profile_id), task.owner_profile_id)
                              const dispatchLabel = task.dispatches.length === 0
                                ? 'ยังไม่ส่งต่อ'
                                : task.dispatches.map((dispatch) => `${dispatch.target === 'codex' ? 'Codex' : 'Module'}: ${dispatch.status}`).join(' · ')
                              const terminal = task.status === 'completed' || task.status === 'blocked'
                              const actionBusy = developmentTaskBusyId === task.id
                              return (
                                <Card key={task.id} variant="outlined" sx={{ bgcolor: 'action.hover' }}>
                                  <CardContent sx={{ py: 1, px: 1.1, '&:last-child': { pb: 1 } }}>
                                    <Stack spacing={0.65}>
                                      <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                        <Typography variant="body2" sx={{ fontWeight: 900 }}>{task.task_code}</Typography>
                                        <Chip size="small" color={developmentTaskStatusColor[task.status]} label={developmentTaskStatusLabel[task.status]} />
                                        <Chip size="small" variant="outlined" label={task.intent.toUpperCase()} />
                                      </Stack>
                                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.request_text}</Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        ผู้รับผิดชอบ: {ownerLabel} · สร้าง {formatTime(task.created_at)} · แก้ไข {formatTime(task.updated_at)}
                                      </Typography>
                                      <Typography variant="caption" color={task.dispatches.some((dispatch) => dispatch.status === 'failed') ? 'error' : 'text.secondary'}>
                                        ปลายทาง: {dispatchLabel}
                                      </Typography>
                                      {(task.commit_ref || task.test_result || task.build_result || task.deploy_result || task.blocker) && (
                                        <Typography variant="caption" color="text.secondary">
                                          ผลล่าสุด: {task.commit_ref ? `Commit ${task.commit_ref}` : ''}{task.test_result ? ` · Test ${task.test_result}` : ''}{task.build_result ? ` · Build ${task.build_result}` : ''}{task.deploy_result ? ` · Deploy ${task.deploy_result}` : ''}{task.blocker ? ` · Blocker ${task.blocker}` : ''}
                                        </Typography>
                                      )}
                                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                        <Button size="small" variant="outlined" startIcon={<CheckCircleOutlineOutlinedIcon />} disabled={actionBusy || terminal} onClick={() => void transitionDevelopmentTask(task, 'received')}>รับงาน</Button>
                                        <Button size="small" variant="contained" startIcon={<PlayArrowOutlinedIcon />} disabled={actionBusy || terminal} onClick={() => void transitionDevelopmentTask(task, 'in_progress')}>เริ่มทำ</Button>
                                        <Button size="small" variant="outlined" startIcon={<HelpOutlineOutlinedIcon />} disabled={actionBusy || terminal} onClick={() => void transitionDevelopmentTask(task, 'waiting_review')}>ขอข้อมูล</Button>
                                        <Button size="small" variant="outlined" startIcon={<ForwardToInboxOutlinedIcon />} disabled={actionBusy} onClick={() => void dispatchDevelopmentTask(task, 'codex')}>ส่งต่อ Codex</Button>
                                        <Button size="small" variant="outlined" startIcon={<ForwardToInboxOutlinedIcon />} disabled={actionBusy} onClick={() => void dispatchDevelopmentTask(task, 'developer_queue')}>ส่งต่อ Module</Button>
                                        <Button size="small" color="success" variant="contained" startIcon={<CheckCircleOutlineOutlinedIcon />} disabled={actionBusy || terminal} onClick={() => void transitionDevelopmentTask(task, 'completed')}>ปิดงาน</Button>
                                        <Button size="small" variant="text" onClick={() => setDevelopmentResultTask(task)}>ดูผลลัพธ์</Button>
                                      </Stack>
                                    </Stack>
                                  </CardContent>
                                </Card>
                              )
                            })}
                          </Stack>
                        ) : null}
                      </Stack>
                    </CardContent>
                  </Card>
                )}
                {isHrRoom && (hrIntakeCounts || hrIntakeItems.length > 0 || hrConfirmationBundles.length > 0) && (
                  <Card variant="outlined" sx={{ mb: 1, borderColor: 'info.main' }}>
                    <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>HR Intake Gate</Typography>
                          {hrIntakeCounts && <Chip size="small" label={`ข้อมูลเข้าทั้งหมด ${hrIntakeCounts.raw_total}`} />}
                          {hrIntakeCounts && <Chip size="small" color="warning" label={`รอคัด ${hrIntakeCounts.pending + hrIntakeCounts.low_confidence}`} />}
                          {hrIntakeCounts && <Chip size="small" color="success" label={`ต้องยืนยัน ${hrIntakeCounts.candidate}`} />}
                          {hrIntakeCounts && <Chip size="small" variant="outlined" label={`บริบท/ซ้ำ/ยืนยันแล้ว ${hrIntakeCounts.context + hrIntakeCounts.duplicate + hrIntakeCounts.already_confirmed}`} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">Raw ไม่ถูกลบ · System/Daily Summary เป็นบริบท · รายการซ้ำไม่สร้าง Job ใหม่</Typography>
                        {hrDailySummary && <Alert severity={hrDailySummary.overdue > 0 ? 'warning' : 'info'}>
                          สรุป HR วันนี้: ทั้งหมด {hrDailySummary.total} · รอตรวจ {hrDailySummary.pending_review} · รอข้อมูล {hrDailySummary.needs_more_info} · รออนุมัติ {hrDailySummary.pending_approval} · บันทึกแล้ว {hrDailySummary.recorded} · ปิดแล้ว {hrDailySummary.closed} · เกิน SLA {hrDailySummary.overdue}
                        </Alert>}
                        {hrIntakeItems.map((item) => (
                          <Paper key={item.id} variant="outlined" sx={{ p: 1, bgcolor: 'action.hover' }}>
                            <Stack spacing={0.55}>
                              <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                <Chip size="small" color={item.status === 'candidate' ? 'success' : item.status === 'low_confidence' ? 'warning' : 'default'} label={hrIntakeStatusLabel[item.status]} />
                                <Typography variant="caption">{item.source_channel} · Ref {item.source_ref}</Typography>
                                {item.confidence != null && <Chip size="small" variant="outlined" label={`มั่นใจ ${Math.round(item.confidence * 100)}%`} />}
                              </Stack>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content_snapshot || '(ไม่มีข้อความ)'}</Typography>
                              <Typography variant="caption" color="text.secondary">เหตุผล: {item.classification_reason || 'รอระบบคัดกรอง'}{item.duplicate_of_id ? ` · ซ้ำกับ ${item.duplicate_of_id}` : ''}{item.bundle_id ? ` · Bundle ${item.bundle_id}` : ''}</Typography>
                              {canManageCompany && ['candidate', 'low_confidence', 'needs_more_info'].includes(item.status) && (
                                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                  {item.status === 'candidate' && <Button size="small" variant="contained" disabled={hrGateBusyId === item.id} onClick={() => void actHrIntakeItem(item, 'confirm')}>ยืนยันเข้า Bundle</Button>}
                                  <Button size="small" variant="outlined" disabled={hrGateBusyId === item.id} onClick={() => void actHrIntakeItem(item, 'request_more')}>ขอข้อมูลเพิ่ม</Button>
                                  <Button size="small" color="error" disabled={hrGateBusyId === item.id} onClick={() => void actHrIntakeItem(item, 'reject')}>ปฏิเสธ</Button>
                                </Stack>
                              )}
                            </Stack>
                          </Paper>
                        ))}
                        {hrConfirmationBundles.length > 0 && <Divider><Chip size="small" label={`Confirmation Bundle ${hrConfirmationBundles.length}`} /></Divider>}
                        {hrConfirmationBundles.map((bundle) => {
                          const missing = bundle.validation_summary?.missing_fields ?? []
                          const conflicts = bundle.validation_summary?.conflicts ?? []
                          const employeeName = bundle.validation_summary?.employee_name || labelFromProfile(profileNameMap.get(bundle.employee_profile_id), bundle.employee_profile_id)
                          const ownerName = bundle.owner_profile_id ? labelFromProfile(profileNameMap.get(bundle.owner_profile_id), bundle.owner_profile_id) : 'ยังไม่มีผู้รับผิดชอบ'
                          const evidence = hrConfirmationEvidence.filter((item) => item.bundle_id === bundle.id)
                          const slaMinutes = bundle.sla_due_at && operationalCheckedAt > 0
                            ? Math.ceil((new Date(bundle.sla_due_at).getTime() - operationalCheckedAt) / 60000)
                            : null
                          return <Paper key={bundle.id} variant="outlined" sx={{ p: 1 }}>
                            <Stack spacing={0.6}>
                              <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                <Typography variant="body2" sx={{ fontWeight: 900 }}>{employeeName} · {bundle.work_date}</Typography>
                                <Chip size="small" color={bundle.status === 'pending_approval' ? 'warning' : bundle.status === 'recorded' ? 'success' : 'default'} label={hrBundleStatusLabel[bundle.status]} />
                                <Chip size="small" variant="outlined" label={`${bundle.validation_summary?.item_count ?? 0} รายการ`} />
                                {bundle.escalation_level > 0 && <Chip size="small" color="error" label={`Escalation L${bundle.escalation_level}`} />}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">เข้า {bundle.validation_summary?.clock_in_at || '-'} · ออก {bundle.validation_summary?.clock_out_at || '-'} · อัปเดต {formatTime(bundle.updated_at)}</Typography>
                              <Typography variant="caption" color={slaMinutes != null && slaMinutes <= 0 ? 'error' : 'text.secondary'}>
                                Owner: {ownerName} · Next: {bundle.next_action} · SLA: {slaMinutes == null ? '-' : slaMinutes > 0 ? `เหลือ ${slaMinutes} นาที` : `เกิน ${Math.abs(slaMinutes)} นาที`}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Evidence {evidence.length}: {evidence.length === 0 ? 'ยังไม่มี' : evidence.map((item) => `${item.source_kind}:${item.attachment_name || item.source_ref}${item.attendance_session_id ? ` → Attendance ${item.attendance_session_id}` : ''}`).join(' · ')}
                              </Typography>
                              {(missing.length > 0 || conflicts.length > 0) && <Alert severity="warning">ข้อมูลขาด: {missing.join(', ') || '-'} · ขัดแย้ง: {conflicts.join(', ') || '-'}</Alert>}
                              {bundle.last_error && <Alert severity="error">{bundle.last_error}</Alert>}
                              {canManageCompany && bundle.owner_profile_id !== activeProfileId && bundle.status !== 'closed' && bundle.status !== 'cancelled' && <Button size="small" variant="outlined" disabled={hrGateBusyId === bundle.id} onClick={() => void claimHrConfirmationBundle(bundle)}>รับงานนี้</Button>}
                              {canManageCompany && bundle.status === 'pending_approval' && <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                <Button size="small" variant="contained" disabled={hrGateBusyId === bundle.id} onClick={() => void actHrConfirmationBundle(bundle, 'confirm')}>ยืนยันและบันทึกเวลา</Button>
                                <Button size="small" variant="outlined" disabled={hrGateBusyId === bundle.id} onClick={() => void actHrConfirmationBundle(bundle, 'request_more')}>ขอข้อมูลเพิ่ม</Button>
                                <Button size="small" color="error" disabled={hrGateBusyId === bundle.id} onClick={() => void actHrConfirmationBundle(bundle, 'reject')}>ปฏิเสธ</Button>
                              </Stack>}
                              {canManageCompany && bundle.status === 'recorded' && <Button size="small" color="success" variant="contained" disabled={hrGateBusyId === bundle.id} onClick={() => void actHrConfirmationBundle(bundle, 'close')}>ตรวจครบและปิด Job 100%</Button>}
                            </Stack>
                          </Paper>
                        })}
                      </Stack>
                    </CardContent>
                  </Card>
                )}
                {attendanceIntegrationRoomId === selectedRoom.id && !hrIntakeCounts && hrConfirmationBundles.length === 0 && attendanceApprovalJobs.length > 0 && (
                  <Stack spacing={0.75} sx={{ mb: 1 }}>
                    {attendanceApprovalJobs.map((job) => {
                      const missing = job.validation_result?.missing_fields ?? []
                      const requesterName = job.validation_result?.employee_name
                        || labelFromProfile(profileNameMap.get(job.requester_profile_id), job.requester_profile_id)
                      const waitingMinutes = Math.max(0, Math.floor((attendanceApprovalCheckedAt - new Date(job.created_at).getTime()) / 60000))
                      return (
                        <Card key={job.id} variant="outlined" sx={{ borderColor: job.status === 'pending_approval' && waitingMinutes >= 30 ? 'warning.main' : 'divider' }}>
                          <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
                            <Stack spacing={0.65}>
                              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                <Typography variant="body2" sx={{ fontWeight: 800 }}>{job.action === 'clock_in' ? 'ลงเวลาเข้า' : 'ลงเวลาออก'} · {requesterName}</Typography>
                                <Chip size="small" label={attendanceApprovalStatusLabel[job.status]} color={job.status === 'closed' ? 'success' : job.status === 'pending_approval' ? 'warning' : 'default'} />
                                {job.status === 'pending_approval' && waitingMinutes >= 30 && <Chip size="small" color="warning" label={`ไม่มีผู้ตอบ ${waitingMinutes} นาที`} />}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                เวลา {formatTime(job.requested_at)} · รหัส {job.request_code} · ตรวจซ้ำแล้ว {job.validation_result?.duplicate_checked ? 'ใช่' : 'ไม่ครบ'}
                              </Typography>
                              <Typography variant="caption" color={job.message_status === 'send_failed' ? 'error' : 'text.secondary'}>
                                MSG: {job.message_status === 'sent' ? `ส่งแล้ว ${job.message_sent_at ? formatTime(job.message_sent_at) : ''}` : job.message_status === 'send_failed' ? `ส่งไม่สำเร็จ ${job.message_error ?? ''}` : 'รอส่ง'} · ผู้รับ {job.recipient_profile_id ? labelFromProfile(profileNameMap.get(job.recipient_profile_id), job.recipient_profile_id) : 'ยังไม่พบ'} · {job.claimed_by ? `รับงานแล้ว ${job.claimed_at ? formatTime(job.claimed_at) : ''}` : 'ยังไม่รับงาน'}
                              </Typography>
                              {missing.length > 0 && <Alert severity="warning">ข้อมูลที่ต้องเพิ่ม: {missing.join(', ')}</Alert>}
                              {job.decision_note && <Typography variant="caption">หมายเหตุ: {job.decision_note}</Typography>}
                              {canManageCompany && job.status === 'pending_approval' && (
                                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                  <Button size="small" variant="contained" disabled={attendanceApprovalBusyId === job.id} onClick={() => void reviewAttendanceApprovalJob(job, 'approve')}>อนุมัติและบันทึกจริง</Button>
                                  <Button size="small" variant="outlined" disabled={attendanceApprovalBusyId === job.id} onClick={() => void reviewAttendanceApprovalJob(job, 'request_more')}>ขอข้อมูลเพิ่ม</Button>
                                  <Button size="small" color="error" disabled={attendanceApprovalBusyId === job.id} onClick={() => void reviewAttendanceApprovalJob(job, 'reject')}>Reject</Button>
                                </Stack>
                              )}
                              {canManageCompany && job.status === 'recorded' && (
                                <Button size="small" color="success" variant="contained" disabled={attendanceApprovalBusyId === job.id} onClick={() => void reviewAttendanceApprovalJob(job, 'close')}>
                                  ตรวจครบและปิด Job 100%
                                </Button>
                              )}
                            </Stack>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </Stack>
                )}
                {loadingMessages ? (
                  <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : messages.length === 0 ? (
                  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 180, color: 'text.secondary' }}>
                    <Typography variant="body2">ยังไม่มีข้อความ</Typography>
                  </Box>
                ) : (
                  <Stack spacing={0.75}>
                    {messages.map((message) => {
                      const isMine = message.sender_profile_id === activeProfileId
                      const senderLabel = labelFromProfile(profileNameMap.get(message.sender_profile_id ?? ''), message.sender_profile_id ?? 'ระบบ')
                      return (
                        <Box
                          key={message.id}
                          sx={{
                            display: 'flex',
                            justifyContent: isMine ? 'flex-end' : 'flex-start',
                          }}
                        >
                          <Box
                            sx={{
                              maxWidth: { xs: '88%', sm: '76%' },
                              minWidth: 0,
                              minHeight: 40,
                              borderRadius: 2.5,
                              px: 1.1,
                              py: 0.65,
                              bgcolor: isMine ? 'primary.main' : 'background.paper',
                              color: isMine ? 'common.white' : 'text.primary',
                              boxShadow: isMine ? 1 : undefined,
                              border: isMine ? undefined : '1px solid',
                              borderColor: isMine ? undefined : 'divider',
                            }}
                          >
                            <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                                <Avatar sx={{ width: 20, height: 20, fontSize: 11, bgcolor: isMine ? 'primary.dark' : 'secondary.main' }}>
                                  {senderLabel?.slice(0, 1).toUpperCase()}
                                </Avatar>
                                <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.9, overflowWrap: 'anywhere' }}>
                                  {senderLabel}
                                </Typography>
                                <Typography variant="caption" sx={{ opacity: 0.75, whiteSpace: 'nowrap' }}>
                                  · {formatTime(message.created_at)}
                                </Typography>
                                {message.message_class === 'system_confirmation' && <Chip size="small" label="System Confirmation" color="info" sx={{ height: 20 }} />}
                                {message.message_class === 'system_result' && <Chip size="small" label="System Result" color="success" sx={{ height: 20 }} />}
                              </Stack>

                              {message.message_type === 'text' ? (
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                                  {message.text_content}
                                </Typography>
                              ) : (
                                  <Card variant="outlined" sx={{ bgcolor: isMine ? 'rgba(255,255,255,0.15)' : undefined, minWidth: 0, maxWidth: '100%' }}>
                                  <CardContent sx={{ py: 1, px: 1.5 }}>
                                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {message.attachment_name || 'ไฟล์แนบ'}
                                      </Typography>
                                      {(canManageCompany || message.sender_profile_id === activeProfileId) && (
                                        <Button size="small" color="error" onClick={() => void softDeleteMessage(message)} sx={{ minWidth: 0, px: 0.75, minHeight: 28 }}>
                                          ลบรูป
                                        </Button>
                                      )}
                                    </Stack>
                                    {message.attachment_content_type && (
                                      <Typography variant="caption" color="text.secondary">
                                        {message.attachment_content_type}
                                      </Typography>
                                    )}
                                    {attachmentUrls[message.id] && isChatImageAttachment(message.attachment_content_type) && !failedAttachmentPreviews[message.id] ? (
                                      <Stack spacing={0.5} sx={{ mt: 0.75, alignItems: 'flex-start' }}>
                                        <Box
                                          component="a"
                                          href={attachmentUrls[message.id]}
                                          target="_blank"
                                          rel="noreferrer"
                                          aria-label={`เปิดรูป ${message.attachment_name || 'ไฟล์แนบ'}`}
                                          sx={{
                                            display: 'block',
                                            width: 'min(100%, 320px)',
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            borderRadius: 1.5,
                                            overflow: 'hidden',
                                            bgcolor: 'action.hover',
                                          }}
                                        >
                                          <Box
                                            component="img"
                                            src={attachmentUrls[message.id]}
                                            alt={message.attachment_name || 'รูปภาพแนบ'}
                                            loading="lazy"
                                            onError={() => setFailedAttachmentPreviews((current) => ({ ...current, [message.id]: true }))}
                                            sx={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'contain' }}
                                          />
                                        </Box>
                                        <Button
                                          size="small"
                                          startIcon={<AttachFileOutlinedIcon />}
                                          href={attachmentUrls[message.id]}
                                          target="_blank"
                                          rel="noreferrer"
                                          sx={{ minHeight: 30, px: 0.5 }}
                                        >
                                          เปิดรูปเต็ม
                                        </Button>
                                      </Stack>
                                    ) : attachmentUrls[message.id] ? (
                                      <Button
                                        size="small"
                                        startIcon={<AttachFileOutlinedIcon />}
                                        href={attachmentUrls[message.id]}
                                        target="_blank"
                                        rel="noreferrer"
                                        sx={{ mt: 0.5 }}
                                      >
                                        เปิดไฟล์
                                      </Button>
                                    ) : (
                                      <Typography variant="caption" color="text.secondary">
                                        กำลังเตรียมลิงก์ไฟล์...
                                      </Typography>
                                    )}
                                    {message.attachment_size != null && (
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        {Math.ceil(Number(message.attachment_size) / 1024).toLocaleString('th-TH')} KB
                                      </Typography>
                                    )}
                                  </CardContent>
                                </Card>
                              )}
                            </Stack>
                          </Box>
                        </Box>
                      )
                    })}
                    <div ref={messageBottomRef} />
                  </Stack>
                )}
              </Box>

              <Divider />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, alignItems: { xs: 'stretch', sm: 'center' }, minWidth: 0 }}>
                {pendingAttachment && (
                  <Card variant="outlined" sx={{ mb: 0.75, bgcolor: 'action.hover' }}>
                    <CardContent sx={{ py: 0.75, px: 1, '&:last-child': { pb: 0.75 } }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <AttachFileOutlinedIcon color="primary" fontSize="small" />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                            {pendingAttachment.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            พร้อมส่ง · {Math.ceil(pendingAttachment.size / 1024).toLocaleString('th-TH')} KB
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          onClick={() => setPendingAttachment(null)}
                          aria-label="ยกเลิกไฟล์ที่เลือก"
                        >
                          <CloseOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </CardContent>
                  </Card>
                )}
                <TextField
                  fullWidth
                  multiline
                  minRows={1}
                  maxRows={3}
                  size="small"
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendTextMessage()
                    }
                  }}
                  placeholder="พิมพ์ข้อความ…"
                  disabled={!canSend}
                  sx={{ minWidth: 0 }}
                />
                <Stack direction="row" spacing={0.5} sx={{ justifyContent: { xs: 'flex-end', sm: 'initial' }, alignItems: 'center' }}>
                  <IconButton
                    color={voiceListening ? 'error' : 'primary'}
                    onClick={handleVoiceInput}
                    disabled={!canSend}
                    aria-label={voiceListening ? 'หยุดรับเสียง' : 'พูดคำสั่ง'}
                    sx={{ minWidth: 44, minHeight: 44 }}
                  >
                    <KeyboardVoiceOutlinedIcon />
                  </IconButton>
                  <Tooltip title="เลือกไฟล์ หรือ ลากไฟล์มาวางในพื้นที่แชต">
                    <span>
                      <IconButton color="primary" onClick={() => fileInputRef.current?.click()} disabled={!canSend} aria-label="เลือกไฟล์ หรือ ลากไฟล์มาวางในพื้นที่แชต" sx={{ minWidth: 44, minHeight: 44 }}>
                        <AttachFileOutlinedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Button
                    size="medium"
                    variant="contained"
                    endIcon={<SendOutlinedIcon />}
                    onClick={sendCurrentMessage}
                    disabled={(!messageText.trim() && !pendingAttachment) || !canSend}
                    sx={{ minHeight: 44, minWidth: { xs: 92, sm: 84 } }}
                  >
                    {pendingAttachment ? 'ส่งไฟล์' : 'ส่ง'}
                  </Button>
                </Stack>
                <input
                  type="file"
                  ref={fileInputRef}
                  aria-label="เลือกไฟล์แนบ"
                  style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
                  accept="image/*,.heic,.heif,.avif,.tif,.tiff,application/pdf,text/plain,.doc,.docx,.xls,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    handleAttachmentSelected(file)
                  }}
                />
              </Stack>
            </>
          )}
        </Paper>
      </Box>

      <Dialog open={Boolean(developmentResultTask)} onClose={() => setDevelopmentResultTask(null)} fullWidth maxWidth="sm">
        <DialogTitle>ผลลัพธ์งานพัฒนา {developmentResultTask?.task_code ?? ''}</DialogTitle>
        <DialogContent dividers sx={{ px: { xs: 2, sm: 3 } }}>
          {developmentResultTask && (
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{developmentResultTask.result_summary || 'ยังไม่มีสรุปผล'}</Typography>
              <Typography variant="caption" color="text.secondary">Files: {Array.isArray(developmentResultTask.files) ? developmentResultTask.files.map(String).join(', ') || '-' : String(developmentResultTask.files || '-')}</Typography>
              <Typography variant="caption" color="text.secondary">Commit: {developmentResultTask.commit_ref || '-'}</Typography>
              <Typography variant="caption" color="text.secondary">Test: {developmentResultTask.test_result || '-'} · Build: {developmentResultTask.build_result || '-'} · Deploy: {developmentResultTask.deploy_result || '-'}</Typography>
              {developmentResultTask.blocker && <Alert severity="error">Blocker: {developmentResultTask.blocker}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 } }}>
          <Button onClick={() => setDevelopmentResultTask(null)}>ปิด</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={roomPickerOpen} onClose={() => setRoomPickerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>เลือกห้อง</DialogTitle>
        <DialogContent dividers sx={{ px: 1, py: 0.75 }}>
          {rooms.length ? (
            <List disablePadding>{roomListContent}</List>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              ยังไม่มีห้อง
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={callDirectoryOpen} onClose={() => setCallDirectoryOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>โทรสมาชิกในห้อง</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {!callSignalingReady && (
              <Alert severity="warning">กำลังเชื่อมต่อระบบโทร กรุณารอสักครู่</Alert>
            )}
            {roomMembers.filter((member) => member.profile_id !== activeProfileId).map((member) => {
              const online = Boolean(onlineProfileMap[member.profile_id])
              const name = labelFromProfile(member.profiles, member.profile_id)
              return (
                <Stack
                  key={member.profile_id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Avatar sx={{ width: 34, height: 34 }}>{name.slice(0, 1).toUpperCase()}</Avatar>
                    <Stack sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{name}</Typography>
                      <Typography variant="caption" color={online ? 'success.main' : 'text.secondary'}>
                        {online ? 'ออนไลน์ พร้อมรับสาย' : 'ออฟไลน์'}
                      </Typography>
                    </Stack>
                  </Stack>
                  <Tooltip title={online ? `โทรหา ${name}` : 'สมาชิกออฟไลน์'}>
                    <span>
                      <IconButton
                        color="primary"
                        onClick={() => void startCall({
                          profileId: member.profile_id,
                          profileName: name,
                          roomId: selectedRoom?.id ?? member.room_id,
                          roomName: selectedRoom?.name ?? 'ห้องแชต',
                        })}
                        disabled={!online || !callSignalingReady || Boolean(activeCall) || Boolean(incomingCall)}
                        aria-label={`โทรหา ${name}`}
                        sx={{ minWidth: 44, minHeight: 44 }}
                      >
                        <CallOutlinedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              )
            })}
            {roomMembers.filter((member) => member.profile_id !== activeProfileId).length === 0 && (
              <Alert severity="info">ยังไม่มีสมาชิกคนอื่นในห้องนี้</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 } }}>
          <Button onClick={() => setCallDirectoryOpen(false)} sx={{ minHeight: 44 }}>ปิด</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(incomingCall)} onClose={() => void rejectIncomingCall()} fullWidth maxWidth="xs">
        <DialogTitle>สายเข้า</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={1.25} sx={{ alignItems: 'center', py: 1.5, textAlign: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'success.main', fontSize: '1.5rem' }}>
              {incomingCall?.fromName?.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{incomingCall?.fromName}</Typography>
            <Typography variant="body2" color="text.secondary">โทรเข้าจากห้อง {incomingCall?.roomName}</Typography>
            <Chip size="small" color="success" label="โทรเสียง" icon={<CallOutlinedIcon />} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 }, justifyContent: 'center', gap: 1 }}>
          <Button color="error" variant="outlined" startIcon={<CallEndOutlinedIcon />} onClick={() => void rejectIncomingCall()} sx={{ minHeight: 44 }}>
            ปฏิเสธ
          </Button>
          <Button color="success" variant="contained" startIcon={<CallOutlinedIcon />} onClick={() => void acceptIncomingCall()} sx={{ minHeight: 44 }}>
            รับสาย
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(activeCall)} onClose={() => void finishCall(true)} fullWidth maxWidth="xs">
        <DialogTitle>{activeCall?.direction === 'outgoing' ? 'กำลังโทร' : 'กำลังสนทนา'}</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={1.25} sx={{ alignItems: 'center', py: 1.5, textAlign: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: '1.5rem' }}>
              {activeCall?.profileName?.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{activeCall?.profileName}</Typography>
            <Typography variant="body2" color="text.secondary">ห้อง {activeCall?.roomName}</Typography>
            <Chip
              size="small"
              color={activeCall?.status === 'connected' ? 'success' : 'warning'}
              label={activeCall?.status === 'connected' ? formatCallDuration(callDuration) : activeCall?.status === 'calling' ? 'กำลังเรียกเข้า...' : 'กำลังเชื่อมต่อ...'}
              icon={<CallOutlinedIcon />}
            />
            {callError && <Alert severity="error" sx={{ width: '100%', textAlign: 'left' }}>{callError}</Alert>}
            <audio ref={remoteAudioRef} autoPlay playsInline />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 }, justifyContent: 'center', gap: 1 }}>
          <Tooltip title={callMuted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน'}>
            <IconButton color={callMuted ? 'error' : 'primary'} onClick={toggleCallMute} aria-label={callMuted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน'} sx={{ minWidth: 48, minHeight: 48, border: '1px solid', borderColor: 'divider' }}>
              {callMuted ? <MicOffOutlinedIcon /> : <MicOutlinedIcon />}
            </IconButton>
          </Tooltip>
          <Button color="error" variant="contained" startIcon={<CallEndOutlinedIcon />} onClick={() => void finishCall(true)} sx={{ minHeight: 44 }}>
            วางสาย
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>สร้างห้องใหม่</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={2} sx={{ width: '100%', minWidth: 0 }}>
            <TextField
              label="ชื่อห้อง"
              value={newRoomName}
              onChange={(event) => setNewRoomName(event.target.value)}
              fullWidth
            />
            <TextField
              select
              label="เชิญสมาชิกตอนสร้างห้อง (ไม่บังคับ)"
              value={inviteProfileId}
              onChange={(event) => setInviteProfileId(event.target.value)}
              disabled={companyMembersSorted.length === 0}
            >
              <MenuItem value="">ไม่เชิญตอนนี้</MenuItem>
              {companyMembersSorted
                .filter((member) => member.profile_id !== activeProfileId)
                .map((member) => (
                  <MenuItem key={member.profile_id} value={member.profile_id}>
                    {labelFromProfile(member.profiles, member.profile_id)}
                  </MenuItem>
                ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 }, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setCreateOpen(false)} sx={{ minHeight: 44 }}>ยกเลิก</Button>
          <Button onClick={() => void createRoom()} variant="contained" disabled={!newRoomName.trim() || !canOpenCreate || busy} sx={{ minHeight: 44 }}>
            สร้าง
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={manageOpen} onClose={() => setManageOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>จัดการสมาชิกห้อง {selectedRoom?.name ?? ''}</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={1.75} sx={{ width: '100%', minWidth: 0, mt: 0.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'stretch' }}>
              <TextField
                fullWidth
                size="small"
                label="ชื่อห้อง"
                value={roomNameDraft}
                onChange={(event) => setRoomNameDraft(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 140 } }}
                disabled={!canManageThisRoom || busy}
              />
              <Button
                variant="outlined"
                onClick={() => void renameRoom()}
                disabled={!canManageThisRoom || busy || !roomNameDraft.trim()}
                sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
              >
                บันทึกชื่อห้อง
              </Button>
            </Stack>
            <Typography variant="subtitle2">เพิ่มสมาชิก</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'stretch' }}>
              <TextField
                select
                fullWidth
                size="small"
                label="เลือกผู้ใช้ที่ต้องการเพิ่ม"
                value={inviteProfileId}
                onChange={(event) => setInviteProfileId(event.target.value)}
              >
                <MenuItem value="">เลือกผู้ใช้</MenuItem>
                {addableMembers.map((member) => (
                  <MenuItem key={member.profile_id} value={member.profile_id}>
                    {labelFromProfile(member.profiles, member.profile_id)}
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="contained" onClick={() => void addMember()} disabled={!inviteProfileId || !canManageThisRoom} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
                <AddOutlinedIcon fontSize="small" /> เพิ่ม
              </Button>
            </Stack>

            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              รายชื่อสมาชิกปัจจุบัน
            </Typography>
            <Box>
              {loadingMembers ? (
                <CircularProgress size={20} />
              ) : (
                roomMembers.map((member) => {
                  const isCurrent = member.profile_id === activeProfileId
                  return (
                    <Box
                      key={member.profile_id}
                      sx={{
                        display: 'flex',
                        gap: 1,
                        alignItems: 'center',
                        py: 0.8,
                        px: 0.8,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Stack>
                        <Typography variant="body2">{labelFromProfile(member.profiles, member.profile_id)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {member.member_role === 'owner' ? 'เจ้าของ' : 'สมาชิก'} {isCurrent ? '· ของฉัน' : ''}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                        <Chip
                          size="small"
                          variant={onlineProfileMap[member.profile_id] ? 'filled' : 'outlined'}
                          color={onlineProfileMap[member.profile_id] ? 'success' : 'default'}
                          icon={<FiberManualRecordIcon sx={{ fontSize: 11 }} />}
                          label={onlineProfileMap[member.profile_id] ? 'ออนไลน์' : 'ออฟไลน์'}
                        />
                        {canManageThisRoom && (!isCurrent || member.member_role === 'member') && (
                          <Button
                            size="small"
                            color="error"
                            variant="text"
                            startIcon={<PersonRemoveOutlinedIcon fontSize="small" />}
                            onClick={() => void removeMember(member.profile_id)}
                            disabled={removeLoading}
                          >
                            ลบ
                          </Button>
                        )}
                      </Stack>
                    </Box>
                  )
                })
              )}
            </Box>
          </Stack>
        </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 } }}>
        <Button onClick={() => setManageOpen(false)} sx={{ minHeight: 44 }}>ปิด</Button>
      </DialogActions>
      </Dialog>

      <Dialog
        open={attendanceDialogOpen}
        onClose={() => {
          if (!attendanceBusy) {
            stopAttendanceCamera()
            setAttendanceDialogOpen(false)
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ px: { xs: 2, sm: 3 }, fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>{attendanceAction === 'clock_out' ? 'แจ้งออกงานจากห้องแชต' : 'แจ้งเข้างานจากห้องแชต'}</DialogTitle>
        <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
          <Stack spacing={1.5} sx={{ mt: 0.5, minWidth: 0 }}>
            <Alert severity="info" sx={{ overflowWrap: 'anywhere' }}>
              ขั้นตอน: 1) ตรวจตำแหน่ง 2) ถ่าย Selfie 3) ตรวจข้อมูลแล้วกดยืนยัน
            </Alert>
            {attendanceAction === 'clock_in' && (
              <TextField
                select
                fullWidth
                label="ไซต์งาน"
                value={attendanceSiteId}
                onChange={(event) => setAttendanceSiteId(event.target.value)}
                disabled={attendanceBusy || attendanceSites.length === 0 || Boolean(attendanceLocation)}
              >
                <MenuItem value="">เลือกไซต์งาน</MenuItem>
                {attendanceSites.map((site) => (
                  <MenuItem key={site.id} value={site.id}>
                    {site.name}{site.projects?.name ? ` · ${site.projects.name}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {!attendanceLocation ? (
              <Button
                variant="outlined"
                startIcon={<MyLocationOutlinedIcon />}
                onClick={() => void verifyAttendance()}
                disabled={attendanceBusy || (attendanceAction === 'clock_in' && !attendanceSiteId)}
              >
                {attendanceBusy ? 'กำลังตรวจตำแหน่ง...' : 'ตรวจตำแหน่ง GPS'}
              </Button>
            ) : (
              <Alert severity={attendanceLocation.gpsErrorCode ? 'warning' : 'success'}>
                {attendanceLocation.gpsErrorCode
                  ? `GPS: ${attendanceLocation.gpsErrorMessage || 'อ่านตำแหน่งไม่ได้'} — ระบบจะส่งให้ตรวจสอบ`
                  : `อ่านตำแหน่งแล้ว${attendanceLocation.distance != null ? ` ห่างไซต์ ${Math.round(attendanceLocation.distance).toLocaleString('th-TH')} ม.` : ''}`}
              </Alert>
            )}
            {attendanceCameraOpen && (
              <Stack spacing={1}>
                <Box sx={{ borderRadius: 2, overflow: 'hidden', bgcolor: 'common.black', minHeight: { xs: 180, sm: 220 }, aspectRatio: { xs: '4 / 3', sm: '16 / 10' } }}>
                  <video
                    ref={attendanceVideoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'cover' }}
                  />
                </Box>
                <Button
                  variant="contained"
                  startIcon={<CameraAltOutlinedIcon />}
                  onClick={() => void captureAttendanceSelfie()}
                  disabled={!attendanceCameraReady || attendanceBusy}
                >
                  ถ่าย Selfie
                </Button>
              </Stack>
            )}
            {attendanceSelfie && !attendanceCameraOpen && (
              <Alert severity="success">ถ่าย Selfie แล้ว: {attendanceSelfie.name}</Alert>
            )}
            {attendanceLocation && attendanceSelfie && (
              <Alert severity="warning">
                ตรวจข้อมูลให้เรียบร้อยก่อนกดยืนยัน ระบบจะบันทึกลงเวลาและส่งผลเข้า HR อัตโนมัติ
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 1.5 }, flexDirection: { xs: 'column-reverse', sm: 'row' }, alignItems: 'stretch', gap: 1, '& > button': { width: { xs: '100%', sm: 'auto' }, minHeight: 44 } }}>
          <Button
            onClick={() => {
              stopAttendanceCamera()
              setAttendanceDialogOpen(false)
            }}
            disabled={attendanceBusy}
          >
            ยกเลิก
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitAttendance()}
            disabled={attendanceBusy || !attendanceLocation || !attendanceSelfie}
          >
            {attendanceBusy ? 'กำลังบันทึก...' : 'ยืนยันลงเวลา'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
