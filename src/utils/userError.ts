export function userError(error:unknown,fallback='ดำเนินการไม่สำเร็จ กรุณาลองใหม่'){
  const message=error instanceof Error?error.message:
    typeof error==='object'&&error&&'message' in error?String(error.message):String(error??'')
  if(/more than one relationship|Could not embed/i.test(message))return 'โหลดข้อมูลที่เชื่อมโยงไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ'
  if(/duplicate key|23505|already exists/i.test(message))return 'มีรายการนี้อยู่แล้ว ระบบไม่สร้างข้อมูลซ้ำ'
  if(/permission|row-level security|403/i.test(message))return 'ไม่มีสิทธิ์ดำเนินการรายการนี้'
  if(/Failed to fetch|NetworkError|fetch/i.test(message))return 'เชื่อมต่อระบบไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'
  if(/locked|ปิดหรือจ่ายแล้ว/i.test(message))return 'รายการอยู่ในรอบที่ปิดหรือจ่ายแล้ว ต้องสร้างรายการปรับปรุง'
  return fallback
}
