import time
import os
import json
from datetime import datetime

# กำหนดไฟล์สำหรับเก็บบันทึกประวัติและ Buffer ในเครื่อง
LOG_FILE = "master_memory_log.txt"
BUFFER_FILE = "local_buffer.json"

def write_log(message):
    """ฟังก์ชันบันทึกประวัติการทำงานลงไฟล์อัตโนมัติ"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"[{timestamp}] {message}\n"
    print(log_entry.strip())
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(log_entry)

def load_buffer():
    """โหลดข้อมูล Buffer จากไฟล์ในเครื่อง"""
    if os.path.exists(BUFFER_FILE):
        with open(BUFFER_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass
    return {"urgent": [], "standard": [], "screening": []}

def save_buffer(buffer_data):
    """บันทึกข้อมูลลง Buffer ในเครื่อง"""
    with open(BUFFER_FILE, "w", encoding="utf-8") as f:
        json.dump(buffer_data, f, ensure_ascii=False, indent=4)

def run_master_memory_bot():
    """Bot ตัวหลัก ทำหน้าที่ตามสถาปัตยกรรม Master Memory"""
    write_log("🤖 [Master Mem - Bot] เริ่มรอบการทำงาน...")
    
    # จำลองการดึงข้อมูลจากเป้าหมาย
    new_task = {
        "id": int(time.time()),
        "source": "Local_Target",
        "content": "ข้อมูลอัตโนมัติจากบอทรันในเครื่อง",
        "timestamp": datetime.now().isoformat()
    }
    
    # จัดเก็บเข้า Buffer (เบื้องต้นเก็บไว้ที่ standard buffer)
    buffers = load_buffer()
    buffers["standard"].append(new_task)
    save_buffer(buffers)
    
    write_log(f"✅ ดึงข้อมูลสำเร็จ! ยอดสะสมใน Standard Buffer ตอนนี้: {len(buffers['standard'])} รายการ")

if __name__ == "__main__":
    write_log("🚀 [System] เริ่มต้นระบบ Master Memory Backend บนเครื่องสำเร็จ...")
    
    # ลูปทำงานอัตโนมัติ
    while True:
        try:
            run_master_memory_bot()
            write_log("⏳ พักการทำงาน 30 วินาที รอรอบถัดไป...\n")
            time.sleep(30)
        except Exception as e:
            write_log(f"❌ เกิดข้อผิดพลาด: {str(e)}")
            time.sleep(10)