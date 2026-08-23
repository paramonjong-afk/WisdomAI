import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import WorkHistoryOutlinedIcon from '@mui/icons-material/WorkHistoryOutlined'
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined'
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { usePageTitle } from '../../hooks/usePageTitle'

const steps = [
  ['1. รับเข้า', 'LINE / Web Chat / Upload → Omni Source Registry', 'เก็บช่องทาง ห้อง ผู้ส่ง เวลา ไฟล์ และ fingerprint เพื่อกันซ้ำ'],
  ['2. วิเคราะห์บทสนทนา', 'Conversation Analyzer → Type / Intent / Summary', 'AI/Rule สรุปเบื้องต้น; ต่ำกว่า 90% ต้องเข้า Filter ตรวจซ้ำ'],
  ['3. Dedupe', 'LINE + Web Chat ซ้ำกัน → เลือก Primary Source', 'ตัวซ้ำเป็น context/duplicate ไม่ส่งปลายทางซ้ำ'],
  ['4. Filter', 'ผู้ดูแลยืนยันประเภท เอกสาร งาน และแผนกปลายทาง', 'บันทึกเหตุผลเมื่อเลือกปลายทางหรือส่งย้อนกลับ'],
  ['5. คิวปลายทาง', 'แผนกรับงาน ตรวจสิทธิ์ และดำเนินการตาม SLA', 'ข้อมูล HR จำกัดสิทธิ์; งานไม่ชัดให้ candidate department เห็นได้'],
  ['6. ปิดงาน', 'Posting / ระบบปลายทาง / Audit', 'ใช้ Intake ID เดิม, version เดียว และ Timeline ครบ'],
] as const

const workforceFlows = [
  {
    title: 'งานบุคคล Backbone',
    version: 'v1.7 · 21/8/2569',
    icon: <WorkHistoryOutlinedIcon color="primary" />,
    summary: 'แกนหลัง HR ตั้งแต่รับพนักงาน → ตั้งค่าการจ้าง/ไซต์ → ลงเวลา/ลา/OT → ค่าจ้าง → เอกสารและ Audit',
    bullets: ['อ่านจาก docs/WORKFORCE_BACKBONE_FLOW.md', 'ทุกการเปลี่ยนสถานะต้องผ่านสิทธิ์บริษัทและ Audit', 'ข้อมูลเอกสารพนักงานใหม่เข้าทาง Intake ก่อนส่ง HR ยืนยัน'],
    path: '/employees',
    action: 'ไปหน้าพนักงาน',
  },
  {
    title: 'ปิดรอบค่าแรง',
    version: 'Payroll v1.7',
    icon: <PaymentsOutlinedIcon color="primary" />,
    summary: 'คำนวณงวด → ตรวจรายการค้าง → ปิดรอบล็อกข้อมูล → ส่งรอจ่าย → ยืนยันจ่ายและออก Payslip',
    bullets: ['ใช้ RPC กลาง manage_pay_period_close_flow', 'ปิดรอบไม่ได้ถ้ามีเวลา/Payroll รอตรวจ', 'หลังจ่ายแล้วห้ามแก้ย้อนหลังตรง ให้ทำ Adjustment งวดถัดไป'],
    path: '/reports',
    action: 'ไปปิดรอบ / Payslip',
  },
] as const

const systemFlows = [
  {
    title: 'Smart Entry / Auto Route',
    version: 'Routing v1.1 · 23/8/2569',
    icon: <AppsOutlinedIcon color="primary" />,
    summary: 'ลิงก์กลางสำหรับมือถือและคอม ตรวจ health และ revision ของ Vercel/Cloudflare ก่อนเลือกปลายทางที่เร็วที่สุดโดยไม่พาไปหน้าเก่า',
    bullets: ['อ่านจาก docs/SMART_ENTRY_ROUTING_FLOW.md และ docs/RELEASE_PARITY_FLOW.md', 'Cloudflare ใช้ได้เฉพาะเมื่อ revision ตรง Vercel; ถ้าไม่ตรงจะปิด fallback ให้ชัดเจน', 'ถ้าไม่มีปลายทางที่ผ่านเงื่อนไข จะแสดงปุ่มลองใหม่โดยไม่ส่งข้อมูลบัญชี'],
    path: '/start.html',
    action: 'ทดสอบ Smart Entry',
  },
  {
    title: 'Supabase Migration Governance',
    version: 'Migration v1.0 · 22/8/2569',
    icon: <StorageOutlinedIcon color="primary" />,
    summary: 'ตรวจให้ประวัติ migration, schema และ policy บน Production ตรงกับโครงการก่อน apply การเปลี่ยนฐานข้อมูลใหม่',
    bullets: ['อ่านจาก docs/SUPABASE_MIGRATION_GOVERNANCE_FLOW.md', 'ห้าม repair ประวัติเพื่อให้ push ผ่านโดยไม่ตรวจ schema จริง', 'ต้อง dry-run, ตรวจ RLS/Audit และบันทึก rollback ทุกครั้ง'],
    path: '/system-health',
    action: 'ไปศูนย์สถานะระบบ',
  },
  {
    title: 'Application Launcher',
    version: 'Entry Routing v1.4 · 23/8/2569',
    icon: <AppsOutlinedIcon color="primary" />,
    summary: 'จุดตรวจอุปกรณ์และบทบาทหลัง Login: มือถือเข้า Time Tracking เดิม ส่วนคอมพิวเตอร์ไป Dashboard รวมหรือ My Profile ตามสิทธิ์',
    bullets: ['อ่านจาก docs/NAVIGATION_FLOW.md และ docs/TIME_TRACKING_FLOW.md', 'mobile → `/time-tracking`; admin/manager บน desktop → `/dashboard`; employee บน desktop → `/my-profile`', 'Web Chat ยังคงเปิดได้จาก Sidebar/ทางลัดตามสิทธิ์ และ `/` เป็น fallback เมื่อโปรไฟล์ยังโหลดไม่เสร็จ'],
    path: '/',
    action: 'ทดสอบจุดเข้าโปรแกรม',
  },
  {
    title: 'Omni Channel Intake / OutTake',
    version: 'Omni v1.0 · 22/8/2569',
    icon: <ChatBubbleOutlineOutlinedIcon color="primary" />,
    summary: 'LINE และ Web Chat เป็นได้ทั้งขาเข้าและขาออก โดยมี registry กลาง วิเคราะห์บทสนทนา ส่ง Filter และกันซ้ำข้ามช่องทาง',
    bullets: ['อ่านจาก docs/OMNI_CHANNEL_INTAKE_OUTTAKE_FLOW.md และ docs/INTAKE_CASE_FLOW.md', 'หน้า Intake ใช้ Subtab มุมมอง 2 แบบ และย้าย Source/วันที่ไป Filter Drawer เพื่อลดพื้นที่ซ้ำ', 'Drawer ล้าง preview/context และกันผลลัพธ์ async ของรายการเก่าก่อนแสดงรายการใหม่', 'ค่า default โหลดวันนี้/รายการรอ Filter เพื่อลดภาระหน้าใหญ่', 'งานภายในใช้ Web Chat/Queue เป็นหลัก ส่วน LINE ใช้คนนอกหรือแจ้งเตือนสั้นตาม Config'],
    path: '/document-flows',
    action: 'ไปศูนย์ Intake / Filter',
  },
  {
    title: 'Master Data Governance',
    version: 'Master Data v1.0 · 22/8/2569',
    icon: <AccountTreeOutlinedIcon color="primary" />,
    summary: 'ข้อมูลจากสลิปและเอกสารเข้า candidate inbox ก่อน Admin ยืนยันเป็นบัญชี/ข้อมูลหลัก ใช้ซ้ำข้ามระบบ และ archive แทนการลบเมื่อหมดอายุ',
    bullets: ['อ่านจาก docs/MASTER_DATA_GOVERNANCE_FLOW.md', 'ทะเบียนพนักงาน ผู้ขาย โครงการ และงานย่อยเดิมยังเป็น source-of-truth', 'เลขบัญชีที่แสดงเป็นข้อมูลธนาคารและเลขท้ายบัญชีเท่านั้น พร้อม audit และ retention 90 วันสำหรับ candidate'],
    path: '/master-data',
    action: 'ไปศูนย์ข้อมูลกลาง',
  },
  {
    title: 'Login / Reset Password',
    version: 'Auth v1.1 · 21/8/2569',
    icon: <LockResetOutlinedIcon color="primary" />,
    summary: 'ขอลิงก์ reset จาก Login → รับ recovery hash/code จาก Supabase → ตั้งรหัสใหม่เฉพาะเมื่อมี recovery session',
    bullets: ['อ่านจาก docs/AUTH_PASSWORD_RESET_FLOW.md', 'รองรับลิงก์กลับ /reset-password, / หรือ /login', 'ไม่บันทึก password/token ลง log และล้าง token จาก URL หลังตรวจสำเร็จ'],
    path: '/login',
    action: 'ไปหน้า Login',
  },
  {
    title: 'HR Attendance → ห้องแชต',
    version: 'HR Chat Stream v3.2 · 23/8/2569',
    icon: <ChatBubbleOutlineOutlinedIcon color="primary" />,
    summary: 'ห้อง HR กลางรับรายการแจ้งเวลา รายการแจ้งออก และงาน HR อื่น ๆ ทั้งลา แก้เวลา OT เอกสาร เคสพนักงาน และลาออก ในหน้าสนทนาแบบ compact พร้อม badge ข้อความค้างและโทรเสียง 1 ต่อ 1 ในห้อง',
    bullets: ['อ่านจาก docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md', 'ใช้ห้อง HR เดิมจาก Chat integration ไม่ต้องตั้งค่าปลายทางใหม่', 'มี delivery ledger/retry กันข้อความซ้ำและเก็บ error โดยไม่ทำให้รายการ HR ต้นทางล้ม', 'หน้า Chat ใช้พื้นที่ข้อความเป็นหลัก รายการห้องย่อ และบนมือถือเลือกห้องผ่านเมนูได้', 'รองรับรูปมือถือ HEIC/HEIF/AVIF/TIFF และไฟล์แนบตาม allow-list ของ Storage', 'รูปที่ส่งจะแสดงเป็นภาพตัวอย่างในข้อความ กดภาพหรือ “เปิดรูปเต็ม” ได้; เอกสารยังแสดงเป็นการ์ดไฟล์', 'เลือกไฟล์จากปุ่มแนบหรือลากไฟล์มาวางในพื้นที่แชตได้ โดยจะแสดง drop overlay และ pending card ก่อนกด “ส่งไฟล์”', 'แนบไฟล์บนมือถือจะแสดง pending card และปุ่ม “ส่งไฟล์” พร้อมเก็บไว้ให้ retry เมื่อ session/เครือข่ายมีปัญหา', 'ตรวจอายุ session และ refresh ก่อน upload; แยก session หมดอายุออกจากสิทธิ์ห้องเพื่อไม่แจ้งผู้ใช้ผิด', 'Vercel และ Cloudflare fallback ต้องใช้ frontend artifact รุ่นเดียวกัน เพื่อไม่ให้ผู้ใช้เห็น flow upload คนละรุ่น', 'แนบไฟล์บนมือถือใช้ fallback object id เมื่อ randomUUID ใช้ไม่ได้ และแจ้ง error เรื่องสิทธิ์/MIME/เครือข่าย', 'จำห้องล่าสุดและ restore ห้องเดิมหลัง refresh; Realtime ส่ง JWT ก่อน subscribe เพื่อลด websocket 401', 'แถบ Web Chat แสดง คุณออนไลน์/กำลังเชื่อมต่อ/ออฟไลน์ จาก Supabase Presence', 'สมาชิกออนไลน์กดโทรเสียง 1 ต่อ 1 ผ่าน WebRTC ได้ พร้อมรับสาย ปฏิเสธ ปิดไมค์ และวางสาย', 'LINE จะไม่ตีความข้อความกำกวม “ลงเวลา” เป็นคำสั่งอัตโนมัติ ต้องระบุ “ลงเวลาเข้า” หรือ “ลงเวลาออก”'],
    path: '/chat',
    action: 'ไปตั้งค่าห้อง HR',
  },
  {
    title: 'ลงเวลา → Web Chat',
    version: 'Time Tracking v1.2 · 22/8/2569',
    icon: <TimerOutlinedIcon color="primary" />,
    summary: 'หน้า ลงเวลาทำงานใช้ไอคอน Web Chat ทางลัดไปคุยงานหรือแจ้งลงเวลาผ่านข้อความ/เสียง โดยใช้ Login และ attendance_sessions เดิม',
    bullets: ['อ่านจาก docs/TIME_TRACKING_FLOW.md', 'จุดเข้าเริ่มต้นอยู่ที่ Application Launcher ซึ่งมีไอคอน Web Chat และลงเวลา', 'กดแล้วไป /chat ภายใน session เดิม ไม่ส่ง GPS/Selfie ผ่าน URL', 'ไม่เปลี่ยนวิธีตรวจ GPS, Selfie หรือบันทึก attendance เดิม'],
    path: '/time-tracking',
    action: 'กลับหน้าลงเวลา',
  },
] as const

const dashboardFlows = [
  {
    title: 'Dashboard ศูนย์บริหารโครงการ',
    version: 'Dashboard Payroll v1.0 · 21/8/2569',
    icon: <AccountTreeOutlinedIcon color="primary" />,
    summary: 'ภาพรวมงบ/ต้นทุน/ค่าแรงต้องใช้ค่าแรงจาก Payroll ที่สร้างแล้ว หรือ Forecast จาก Reports ถ้ายังไม่ปิดงวด',
    bullets: ['อ่านจาก docs/PROJECT_DASHBOARD_FLOW.md', 'ค่าแรงไม่หายจาก Dashboard แม้ยังไม่ได้ generate payroll', 'แสดงแหล่งที่มาว่าเป็น Payroll locked หรือ Forecast เกิดขึ้นจริง'],
    path: '/dashboard',
    action: 'ไปหน้า Dashboard',
  },
] as const

export function FlowRegistryPage() {
  usePageTitle('Flow Registry')
  return <Stack spacing={2.5}>
    <PageHeader title="ทะเบียน Flow ระบบ" description="แหล่งอ้างอิงกลางของขั้นตอน กติกา และมาตรฐานการแก้ไขระบบ" />
    <Alert severity="info"><b>กติกาบังคับ:</b> ก่อนแก้ทุก Module ต้องตรวจว่ามี Flow หรือไม่; หากไม่มีต้องสร้าง Flow ก่อนเริ่มแก้ และต้องอัปเดตทะเบียน/เอกสารทุกครั้งที่พฤติกรรมระบบเปลี่ยน พร้อม build/test และตรวจผลจริง</Alert>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}><AccountTreeOutlinedIcon color="primary" /><Typography variant="h6" sx={{ fontWeight: 800 }}>Intake Case → Document Flow</Typography><Chip size="small" color="success" label="v2.7 · 20/8/2569" /><Chip size="small" label="Project Work Package v1.4" /><Chip size="small" label="Transfer Slip Parties" /></Stack>
      <Typography color="text.secondary" sx={{ mt: 1 }}>ข้อความและไฟล์ต้นฉบับยังอยู่ที่ช่องทางเดิม แต่ทุกหน้าทำงานผ่าน Intake Case และ Document Flow Item กลางเดียว</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 2, alignItems: { md: 'stretch' } }}>
        {steps.map(([title, flow, rule], index) => <Box key={title} sx={{ flex: 1, minWidth: 145, p: 1.5, borderRadius: 1, bgcolor: index === 2 ? 'warning.50' : index === 3 ? 'info.50' : 'action.hover' }}>
          <Typography sx={{ fontWeight: 800 }}>{title}</Typography><Typography variant="body2" sx={{ mt: .5 }}>{flow}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{rule}</Typography>
        </Box>)}
      </Stack>
      <Alert severity="info" sx={{ mt: 2 }}>Filter เลือก “บิลเงินสด” ได้, ผูกเอกสารกับโครงการหลัก → งานย่อย → งานลูกหลายชั้น และแตกงานให้หลายแผนกจากเอกสารชุดเดียวได้ โดยทุก task มีสถานะและ Audit ของตัวเอง รวมถึงสถานะข้อมูลกลางและการตรวจซ้ำเฉพาะแผนกที่ได้รับผลกระทบ</Alert>
    </Paper>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <WorkHistoryOutlinedIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 800 }}>HR / Workforce Flow</Typography>
        <Chip size="small" color="success" label="อัปเดตล่าสุด 21/8/2569" />
        <Chip size="small" label="เอกสารหลัก: WORKFORCE_BACKBONE_FLOW" />
      </Stack>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        Flow งานบุคคลที่ผูกกับหน้าทำงานจริงในระบบ สำหรับ Admin ใช้ตรวจขั้นตอนก่อนกดทำรายการสำคัญ
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
        {workforceFlows.map((flow) => <Box key={flow.title} sx={{ flex: 1, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {flow.icon}
            <Typography sx={{ fontWeight: 900 }}>{flow.title}</Typography>
            <Chip size="small" label={flow.version} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{flow.summary}</Typography>
          <Stack spacing={.5} sx={{ mt: 1.25 }}>
            {flow.bullets.map((item) => <Typography key={item} variant="caption" sx={{ display: 'block' }}>• {item}</Typography>)}
          </Stack>
          <Button component={RouterLink} to={flow.path} variant="outlined" size="small" sx={{ mt: 1.5 }}>
            {flow.action}
          </Button>
        </Box>)}
      </Stack>
    </Paper>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <LockResetOutlinedIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 800 }}>System / Communication Flow</Typography>
        <Chip size="small" color="success" label="อัปเดตล่าสุด 21/8/2569" />
      </Stack>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        Flow ระบบ Login, reset password, การรับลิงก์จาก Supabase Auth และการส่ง Log ลงเวลาเข้า Chat
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
        {systemFlows.map((flow) => <Box key={flow.title} sx={{ flex: 1, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {flow.icon}
            <Typography sx={{ fontWeight: 900 }}>{flow.title}</Typography>
            <Chip size="small" label={flow.version} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{flow.summary}</Typography>
          <Stack spacing={.5} sx={{ mt: 1.25 }}>
            {flow.bullets.map((item) => <Typography key={item} variant="caption" sx={{ display: 'block' }}>• {item}</Typography>)}
          </Stack>
          <Button component={RouterLink} to={flow.path} variant="outlined" size="small" sx={{ mt: 1.5 }}>
            {flow.action}
          </Button>
        </Box>)}
      </Stack>
    </Paper>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <AccountTreeOutlinedIcon color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Project Dashboard / Cost Flow</Typography>
        <Chip size="small" color="success" label="อัปเดตล่าสุด 21/8/2569" />
      </Stack>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        Flow รายงานภาพรวมโครงการและค่าแรงรวม เพื่อให้ตัวเลข Dashboard ตรงกับ Reports และงวด Payroll
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
        {dashboardFlows.map((flow) => <Box key={flow.title} sx={{ flex: 1, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {flow.icon}
            <Typography sx={{ fontWeight: 900 }}>{flow.title}</Typography>
            <Chip size="small" label={flow.version} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{flow.summary}</Typography>
          <Stack spacing={.5} sx={{ mt: 1.25 }}>
            {flow.bullets.map((item) => <Typography key={item} variant="caption" sx={{ display: 'block' }}>• {item}</Typography>)}
          </Stack>
          <Button component={RouterLink} to={flow.path} variant="outlined" size="small" sx={{ mt: 1.5 }}>
            {flow.action}
          </Button>
        </Box>)}
      </Stack>
    </Paper>
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><RuleOutlinedIcon color="primary" /><Typography variant="h6" sx={{ fontWeight: 800 }}>คำสั่งปิดงานมาตรฐาน</Typography></Stack>
      <Divider sx={{ my: 1.5 }} />
      <Stack spacing={1}><Typography>1. ตรวจ Module ที่ได้รับผลกระทบและ Flow ที่เกี่ยวข้องทั้งหมดก่อนแก้</Typography><Typography>2. ถ้ายังไม่มี Flow ของ Module นั้น ต้องสร้าง Flow ก่อนเริ่มแก้โค้ด</Typography><Typography>3. แก้ Flow Registry และเอกสาร Flow พร้อมโค้ด/ฐานข้อมูลในงานเดียวกัน</Typography><Typography>4. รัน lint, build, test, migration และตรวจหน้าใช้งานจริง</Typography><Typography>5. บันทึก version, วันที่, ผลกระทบ และวิธีย้อนกลับใน Timeline/Audit</Typography></Stack>
    </Paper>
  </Stack>
}
