import type { NavigationGroup, NavigationItem } from '../types/navigation'

const managers:NavigationItem['roles']=['admin','manager']
const all:NavigationItem['roles']=['admin','manager','employee']
const admins:NavigationItem['roles']=['admin']

export const navigationGroups:NavigationGroup[]=[
  {label:'ภาพรวมและควบคุมงาน',items:[
    {label:'Dashboard',path:'/dashboard',roles:managers},
    {label:'Flow Control Center',path:'/flow-control-center',roles:managers},
    {label:'Notifications',path:'/notifications',roles:all},
  ]},
  {label:'Intake และข้อมูลกลาง',items:[
    {label:'Intake / Document Flow',path:'/document-flows',roles:managers},
    {label:'Master Data',path:'/master-data',roles:managers},
    {label:'Review Queue',path:'/approvals',roles:managers},
    {label:'ตรวจรูปและหลักฐาน',path:'/image-review',roles:managers},
  ]},
  {label:'บุคคลและเวลา',items:[
    {label:'Employees',path:'/employees',roles:managers},
    {label:'Attendance',path:'/time-tracking',roles:all},
    {label:'งานบุคคลและการลา',path:'/workforce',roles:all},
    {label:'HR Confirmation',path:'/chat?room=hr_primary',roles:managers},
  ]},
  {label:'บัญชีและการเงิน',items:[
    {label:'Accounting Documents',path:'/accounting-documents',roles:managers},
    {label:'Financial Summary',path:'/financial-summary',roles:managers},
    {label:'Money Lineage',path:'/accounting-documents?view=money_lineage',roles:managers},
  ]},
  {label:'ค่าแรงและเงินสำรอง',items:[
    {label:'Wage / Payroll',path:'/reports',roles:managers},
    {label:'Advance Settlements',path:'/advance-settlements',roles:managers},
    {label:'Advance Report',path:'/advance-payment-report',roles:managers},
    {label:'Advance Holders',path:'/advance-holders',roles:managers},
    {label:'กำหนดเวลางานและรอบจ่าย',path:'/workforce-setup',roles:managers},
  ]},
  {label:'โครงการและวัสดุ',items:[
    {label:'Projects / Sites',path:'/projects',roles:managers},
    {label:'งานขายและต้นทุนโครงการ',path:'/project-controls',roles:managers},
    {label:'Stock / BOQ / Purchases',path:'/boq',roles:managers},
    {label:'เปรียบเทียบ BOQ',path:'/boq-compare',roles:managers},
    {label:'Drawing AI',path:'/drawing-ai',roles:managers},
    {label:'ผู้รับเหมา',path:'/contractors',roles:managers},
    {label:'Solar',path:'/solar',roles:managers},
  ]},
  {label:'การสื่อสาร',items:[
    {label:'Web Chat',path:'/chat',roles:all},
    {label:'LINE / Telegram',path:'/line-monitor',roles:managers},
    {label:'Program Development 00',path:'/chat?room=program_development_primary',roles:admins},
    {label:'สรุปงาน LINE',path:'/work-summary',roles:managers},
  ]},
  {label:'ระบบและตรวจสอบ',items:[
    {label:'Flow Registry',path:'/flow-registry',roles:admins},
    {label:'ตรวจสอบงานระบบ',path:'/system-inventory',roles:admins},
    {label:'Audit',path:'/system-health?tab=logs',roles:admins},
    {label:'System Errors',path:'/system-health?tab=issues',roles:admins},
    {label:'ศูนย์สั่งงาน',path:'/work-command-center',roles:admins},
    {label:'สถานะระบบ',path:'/system-health',roles:admins},
    {label:'Mutation Attempt Center',path:'/mutation-attempt-center',roles:admins},
    {label:'ศูนย์ควบคุม WisdomAI',path:'/wisdom-ai',roles:managers},
    {label:'Settings',path:'/settings',roles:admins},
    {label:'ข้อมูลส่วนตัว',path:'/my-profile',roles:all},
  ]},
]

export const navigationItems:NavigationItem[]=navigationGroups.flatMap(group=>group.items)
