import type { NavigationGroup, NavigationItem } from '../types/navigation'

const managers:NavigationItem['roles']=['admin','manager']
const all:NavigationItem['roles']=['admin','manager','employee']

export const navigationGroups:NavigationGroup[]=[
  {label:'ภาพรวม',items:[
    {label:'Dashboard',path:'/dashboard',roles:managers},
  ]},
  {label:'โครงการและงานก่อสร้าง',items:[
    {label:'โครงการ',path:'/projects',roles:managers},
    {label:'งานขายและต้นทุนโครงการ',path:'/project-controls',roles:managers},
    {label:'BOQ',path:'/boq',roles:managers},
    {label:'เปรียบเทียบ BOQ',path:'/boq-compare',roles:managers},
    {label:'Drawing AI',path:'/drawing-ai',roles:managers},
    {label:'สรุปงาน LINE',path:'/work-summary',roles:managers},
  ]},
  {label:'พนักงานและค่าจ้าง',items:[
    {label:'พนักงาน',path:'/employees',roles:managers},
    {label:'ลงเวลาทำงาน',path:'/time-tracking',roles:all},
    {label:'ยื่นลาและงานบุคคล',path:'/workforce',roles:all},
    {label:'กำหนดเวลางานและรอบจ่าย',path:'/workforce-setup',roles:managers},
    {label:'ผู้รับเหมา',path:'/contractors',roles:managers},
    {label:'ศูนย์อนุมัติ',path:'/approvals',roles:managers},
    {label:'รายงานเวลาและการลา',path:'/reports',roles:managers},
  ]},
  {label:'WisdomAI และรูปภาพ',items:[
    {label:'ศูนย์ควบคุม WisdomAI',path:'/wisdom-ai',roles:managers},
    {label:'ศูนย์เส้นทางเอกสาร',path:'/document-flows',roles:managers},
    {label:'ตรวจรูปและสอน AI',path:'/image-review',roles:managers},
    {label:'ตรวจสอบ LINE / Telegram',path:'/line-monitor',roles:managers},
  ]},
  {label:'การเงินและบัญชี',items:[
    {label:'สรุปรายการเงิน',path:'/financial-summary',roles:managers},
    {label:'ศูนย์ข้อมูลกลาง',path:'/master-data',roles:managers},
    {label:'ทะเบียนผู้ถือเงินสำรองจ่าย',path:'/advance-holders',roles:managers},
    {label:'เอกสารบัญชี',path:'/accounting-documents',roles:managers},
    {label:'เงินทดรองและปิดยอด',path:'/advance-settlements',roles:managers},
    {label:'รายงานเงินสำรองจ่ายช่าง',path:'/advance-payment-report',roles:managers},
  ]},
  {label:'ระบบอื่น',items:[
    {label:'Solar',path:'/solar',roles:managers},
  ]},
  {label:'บัญชีและตั้งค่า',items:[
    {label:'ข้อมูลส่วนตัว',path:'/my-profile',roles:all},
    {label:'ตั้งค่าระบบ',path:'/settings',roles:['admin']},
    {label:'กู้คืนบัญชีผู้ใช้',path:'/admin-account-recovery',roles:['admin']},
  ]},
  {label:'การสื่อสาร',items:[
    {label:'ห้องแชต',path:'/chat',roles:all},
  ]},
  {label:'ระบบตรวจสอบ',items:[
    {label:'ทะเบียน Flow ระบบ',path:'/flow-registry',roles:['admin']},
    {label:'ตรวจสอบงานระบบ',path:'/system-inventory',roles:['admin']},
    {label:'ศูนย์สั่งงาน',path:'/work-command-center',roles:['admin']},
    {label:'สถานะระบบ',path:'/system-health',roles:['admin']},
    {label:'Mutation Attempt Center',path:'/mutation-attempt-center',roles:['admin']},
  ]},
]

export const navigationItems:NavigationItem[]=navigationGroups.flatMap((group)=>group.items)
