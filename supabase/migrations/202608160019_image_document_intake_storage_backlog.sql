-- Persist the approved image/document intake recommendations in the authoritative work list.

insert into public.system_work_items(
  work_key,scope,title,category,status,progress,risk,detail,production_status,owner,evidence,current_step
) values
('DOC-INGEST-001','platform','ด่านตรวจความปลอดภัยไฟล์ภาพและ PDF','audit','ready',0,'critical',
 'เป้าหมาย: ป้องกันไฟล์ปลอม ไฟล์เสีย malware และ decompression bomb ก่อนประมวลผล\nขั้นตอน: ตรวจ magic bytes/signature, tenant, MIME, bytes/pixels/pages/frames; รองรับ JPEG/PNG/WebP/HEIC/HEIF/TIFF/GIF/PDF; scan malware; ตรวจ PDF password/JavaScript/attachment; quarantine พร้อมเหตุผลและ retry policy\nเกณฑ์ตรวจรับ: regression test ครบไฟล์ปกติ/ปลอม/เสีย/ใหญ่/bomb/PDF อันตราย และไม่มีไฟล์ไม่ผ่านเข้าถึง OCR หรือปลายทาง',
 'backlog_registered','Security/Platform','สรุปขอบเขต 16/8/2569; รายละเอียดสำรอง docs/IMAGE_DOCUMENT_INTAKE_BACKLOG.md','ออกแบบ validation contract และ threat test corpus'),
('DOC-INGEST-002','platform','ปรับคุณภาพ ความคมชัด และขนาดภาพก่อนเก็บ','line','doing',35,'high',
 'เป้าหมาย: ลดพื้นที่โดยไม่ทำลายข้อมูลสำคัญ\nขั้นตอน: auto-orient/strip EXIF GPS, deskew, white balance, shadow removal, denoise, text sharpening; ตรวจ blur/glare/crop/finger/missing page; เปรียบเทียบ OCR ก่อน-หลัง; ใช้ Profile บัญชี 2500px Q92-95, ลายมือ 2800px Q95, Error 2000px Q88-90, ทั่วไป 1600px Q78-82, thumbnail 480-640px Q70-80\nเกณฑ์ตรวจรับ: field จำนวนเงิน/วันที่/เลขภาษี/เลขเอกสารไม่แม่นยำน้อยลง และภาพต่ำกว่า quality gate เข้าคิวตรวจคน',
 'partially_deployed','Image Pipeline','มี resize/WebP 2500px Q95 และ thumbnail แล้ว; ยังขาด enhancement, quality gate และ OCR comparison','เพิ่ม enhancement pipeline และ quality score'),
('DOC-INGEST-003','platform','กักกันต้นฉบับและ Chain of Custody','audit','ready',0,'critical',
 'เป้าหมาย: ย้อนรอยและกู้ต้นฉบับได้\nขั้นตอน: เก็บ private quarantine แยกไฟล์ใช้งานพร้อม SHA-256/uploader/channel/tenant/time; การเงินเก็บต้นฉบับ 30 วัน ทั่วไป 7 วัน; ลบหลัง QA และไม่มี legal hold; signed PDF immutable\nเกณฑ์ตรวจรับ: trace เอกสารปลายทางกลับต้นฉบับ ผู้ส่ง และผู้ยืนยันได้ครบ พร้อม restore test',
 'backlog_registered','Storage/Compliance','สรุปขอบเขต 16/8/2569','ออกแบบ original lifecycle และ legal hold'),
('DOC-INGEST-004','platform','จำกัดสิทธิ์ไฟล์การเงินตามบทบาทและวัตถุประสงค์','tenant','ready',0,'critical',
 'เป้าหมาย: สมาชิกบริษัททั่วไปห้ามเปิดไฟล์การเงิน\nขั้นตอน: role/purpose policy สำหรับบัญชี การเงิน ผู้อนุมัติ ผู้ตรวจสอบ Admin; signed URL อายุสั้น; audit preview/download/export; ทดสอบ 2 บริษัทและ cross-tenant\nเกณฑ์ตรวจรับ: positive/negative RLS และ Storage tests ผ่านทั้งหมด ไม่มี URL ถาวรหรือการเข้าถึงข้ามบริษัท',
 'backlog_registered','Security/Tenant','พบช่องว่าง policy สมาชิกบริษัทดู LINE files ได้กว้างเกินไป','อุด Storage/RLS policy และเพิ่ม negative tests'),
('DOC-INGEST-005','platform','แยก Dedupe ไฟล์จริงออกจากเอกสารเชิงธุรกิจ','line','ready',0,'high',
 'เป้าหมาย: ประหยัดพื้นที่โดยไม่ทำเหตุการณ์ธุรกิจหาย\nขั้นตอน: SHA-256 blob dedupe แต่สร้าง logical attachment ทุก message/document; perceptual hash ใช้เตือน near-duplicate ไม่ลบอัตโนมัติ\nเกณฑ์ตรวจรับ: resend ไม่เก็บ blob ซ้ำ แต่ประวัติข้อความ การผูกชุด และการผูกคนละงานยังครบ',
 'backlog_registered','Storage/LINE','มี SHA-256 บางส่วน; ต้องแยก physical blob กับ logical reference ให้ชัด','ออกแบบ blob/reference model และ migration'),
('DOC-INGEST-006','platform','จัดชุดเอกสารหลายหน้าให้ครบและแก้ชุดได้','line','doing',60,'high',
 'เป้าหมาย: หน้าเอกสารไม่แตกชุด ไม่หาย และไม่ซ้ำ\nขั้นตอน: group/sender/company/time window, out-of-order/redelivery; expected page count; คำสั่งจบชุด; preview; merge/split/detach; แจ้ง LINE เมื่อชุดไม่ครบ\nเกณฑ์ตรวจรับ: ทดสอบส่งสลับลำดับ ส่งซ้ำ ขาดหน้า เกินเวลา รวม/แยก และยืนยันแล้วได้เอกสารเดียวถูกหน้า',
 'partially_deployed','LINE/Accounting','Deploy auto-group ภายใน 3 นาที, preview และ merge/split แล้ว; เหลือ expected count/end-set/feedback/UAT','เพิ่ม expected page count และคำสั่งจบชุด'),
('DOC-INGEST-007','platform','รองรับ PDF HEIC และ TIFF ใน Document Pipeline','operations','ready',0,'high',
 'เป้าหมาย: อ่านเอกสารหลายรูปแบบโดยรักษาคุณภาพ\nขั้นตอน: native text PDF เก็บเดิม+extract text; scanned PDF/TIFF render OCR และเก็บ WebP ต่อหน้า; HEIC รักษา color profile; signed PDF immutable; ห้าม lossy JBIG2 กับตัวเลข\nเกณฑ์ตรวจรับ: text/scan/multipage/signed/password PDF และ HEIC/TIFF test corpus ผ่าน พร้อม page mapping',
 'backlog_registered','Document Pipeline','เส้นทางบัญชีปัจจุบันเน้น image และยังไม่ครอบคลุม PDF เต็มรูปแบบ','กำหนด converter sandbox และ page model'),
('DOC-INGEST-008','platform','Retention Trash Restore และ Cleanup Worker','automation','ready',0,'high',
 'เป้าหมาย: ลดพื้นที่อย่างกู้คืนได้\nขั้นตอน: ตรวจ references/hold; ย้าย trash 7 วัน; restore; purge; dry-run, batch limit, idempotency, audit และ bytes reclaimed\nเกณฑ์ตรวจรับ: ไม่ลบไฟล์ที่ยังอ้างอิง กู้คืนได้ในช่วง trash และ rerun ไม่ลบ/นับซ้ำ',
 'backlog_registered','Automation/Storage','มี retention metadata แต่ยังไม่พบ cleanup worker ที่ทำ lifecycle ครบ','ออกแบบ safe cleanup RPC และ worker'),
('DOC-INGEST-009','platform','ตรวจและซ่อมความสอดคล้อง Storage กับฐานข้อมูล','automation','ready',0,'critical',
 'เป้าหมาย: ไม่มี orphan/dangling/corrupt object เงียบ ๆ\nขั้นตอน: scan orphan object, dangling DB, missing thumbnail/page, hash mismatch, wrong tenant namespace; auto-fix เฉพาะปลอดภัย; อื่น ๆ เปิด Incident ด้วย fingerprint และ evidence\nเกณฑ์ตรวจรับ: fault injection ทุกชนิดถูกพบ งานซ้ำไม่ถูกเปิด และมีรายงานก่อน/หลังซ่อม',
 'backlog_registered','Health Monitor/Storage','สรุปขอบเขต 16/8/2569','เพิ่ม integrity checks เข้า health-monitor'),
('DOC-INGEST-010','platform','Metadata OCR Confidence และ Audit รายช่อง','audit','ready',0,'high',
 'เป้าหมาย: อธิบายได้ว่าไฟล์และข้อมูลผ่านอะไรมา\nขั้นตอน: dimensions/DPI/orientation, original/optimized/perceptual hash, quality score, transform recipe/version, OCR engine/model/version/confidence ราย field/page และค่าก่อน-หลังผู้ใช้แก้\nเกณฑ์ตรวจรับ: ค้นย้อนด้วย intake/document/message/hash ได้ และ export audit ได้ครบ',
 'backlog_registered','AI Governance','สรุปขอบเขต 16/8/2569','ออกแบบ metadata schema และ field provenance'),
('DOC-INGEST-011','platform','Storage Quota Backup และ Restore Drill','operations','ready',0,'critical',
 'เป้าหมาย: รู้ก่อนพื้นที่เต็มและกู้ระบบได้จริง\nขั้นตอน: quota 70/85/95% แยกบริษัท/ประเภท/retention; backup metadata และ critical originals; restore drill พร้อม RPO/RTO/evidence\nเกณฑ์ตรวจรับ: alert ไม่ซ้ำผิดปกติ, restore sample ตรวจ hash ตรง และมีหลักฐานรอบล่าสุด',
 'backlog_registered','Platform Operations','สรุปขอบเขต 16/8/2569','กำหนด quota baseline, RPO และ RTO'),
('DOC-INGEST-012','platform','AI Router ภาษาไทย ลายมือ PDF และตารางแบบ Local-first','automation','ready',0,'high',
 'เป้าหมาย: เพิ่มความแม่นยำโดยควบคุมค่าใช้จ่าย\nขั้นตอน: OpenCV/ImageMagick, PaddleOCR PP-OCRv5 Thai, PDF.js/Poppler, PP-Structure; rules ตรวจเลขภาษี/วันที่/ยอด/VAT/สมการ; cloud fallback เฉพาะ low confidence ตาม budget/consent พร้อมบันทึกเหตุผลและต้นทุน\nเกณฑ์ตรวจรับ: benchmark แยก printed Thai/handwriting/table/PDF และ cloud usage ไม่เกิน policy',
 'backlog_registered','AI Platform','วางเป็นขั้นหลังมีเครื่อง Local; cloud ใช้เฉพาะ fallback','เตรียม benchmark dataset และ routing thresholds'),
('DOC-INGEST-013','platform','ส่งต่อภาพที่ยืนยันแล้วสู่บัญชี Stock และจัดซื้อ','operations','ready',0,'critical',
 'เป้าหมาย: ยืนยันครั้งเดียวและไม่สร้างเอกสารซ้ำ\nขั้นตอน: update accounting_document เดิม; แยก classification จาก posting; route ใบรับสินค้า→stock review, ใบวางบิล→matching, ใบเสนอราคา→price/PO, invoice/receipt→accounting/AP, other→reference; re-route/rollback ก่อน post และ reversal หลัง post พร้อม audit\nเกณฑ์ตรวจรับ: แต่ละชนิดสร้างปลายทางหนึ่งครั้งแบบ idempotent และ trace กลับภาพ/ชุดได้',
 'backlog_registered','Accounting Workflow','ยืนยันภาพมี learning record แล้ว แต่ต้องทำ routing contract และ transaction boundary ให้ครบ','ออกแบบ route state machine และ idempotency key'),
('DOC-INGEST-014','platform','กลยุทธ์จัดเก็บ PDF ขนาดเล็กโดยไม่เสียหลักฐาน','operations','ready',0,'high',
 'เป้าหมาย: ใช้พื้นที่ต่ำสุดโดยรักษาหลักฐาน\nขั้นตอน: native text PDF เก็บเดิม+lossless; scan เก็บ optimized WebP pages และสร้าง PDF on demand; thumbnail/text/index แยก; signed/official PDF ห้ามเปลี่ยน bytes; ไม่แปลงภาพเป็น PDF เพียงเพื่อหวังลดขนาด\nเกณฑ์ตรวจรับ: เปรียบเทียบ bytes/อ่านได้/OCR/hash ของชุดตัวอย่าง และ signed PDF verify ผ่าน',
 'backlog_registered','Document Storage','สรุปขอบเขต 16/8/2569','ทำ storage benchmark และกำหนด profile ต่อชนิด'),
('DOC-INGEST-015','platform','สถานะ Intake Retry Dead-letter และข้อความผู้ใช้','report','ready',0,'high',
 'เป้าหมาย: ผู้ใช้รู้ว่าไฟล์อยู่ขั้นไหนและต้องทำอะไร\nขั้นตอน: received→security_checked→optimized→grouped→OCR→needs_review→confirmed→routed→posted/completed; actionable error; exponential/idempotent retry; dead-letter ส่งใหม่/เปิด Incident; dashboard stage age fingerprint attempts destination\nเกณฑ์ตรวจรับ: fault injection ทุก stage แสดงสาเหตุถูกต้อง retry ไม่สร้างซ้ำ และงานค้างเกิน SLA แจ้งเตือน',
 'backlog_registered','Platform UX/Automation','สรุปขอบเขต 16/8/2569','กำหนด canonical states, SLA และ error mapping')
on conflict(work_key) do update set
  title=excluded.title,
  category=excluded.category,
  risk=excluded.risk,
  detail=excluded.detail,
  owner=excluded.owner,
  evidence=case
    when public.system_work_items.evidence is null or public.system_work_items.evidence='' then excluded.evidence
    when position(excluded.evidence in public.system_work_items.evidence)>0 then public.system_work_items.evidence
    else left(public.system_work_items.evidence||E'\n'||excluded.evidence,4000)
  end,
  current_step=coalesce(public.system_work_items.current_step,excluded.current_step),
  updated_at=now();

comment on table public.system_work_items is
  'Authoritative work status source consumed by Web, LINE and automation. DOC-INGEST details are backed up in docs/IMAGE_DOCUMENT_INTAKE_BACKLOG.md.';
