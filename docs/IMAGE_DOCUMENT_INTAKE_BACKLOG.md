# แผนงานรับภาพและเอกสารเข้า WisdomAI

เอกสารนี้เป็นข้อมูลสำรองของรายการงาน `DOC-INGEST-001` ถึง `DOC-INGEST-015` ในหน้า **ระบบตรวจสอบ > ศูนย์สั่งงาน** (`/work-command-center`) และเป็นขอบเขตอ้างอิงสำหรับการพัฒนา ทดสอบ และตรวจรับงาน

## เป้าหมายของกระบวนการ

รับภาพ/PDF จาก LINE, Telegram, Web หรือ API อย่างปลอดภัย ปรับคุณภาพและขนาดก่อนเก็บ อ่านข้อมูลให้แม่นยำ จัดชุดเอกสารไม่ให้หน้าแตกหรือซ้ำ ส่งต่อไปบัญชี/Stock/จัดซื้ออย่างถูกเส้นทาง และสามารถตรวจสอบย้อนหลัง กู้คืน และลบตามอายุได้

## Flow มาตรฐาน

1. รับไฟล์และสร้าง `intake_id`/สถานะ `received` โดยยังไม่สร้างรายการบัญชีหรือ Stock
2. ตรวจชนิดไฟล์จาก magic bytes, ขนาด, จำนวนหน้า/พิกเซล, malware, PDF password/JavaScript/attachment และ decompression bomb
3. เก็บต้นฉบับในพื้นที่กักกันแบบ private พร้อม SHA-256, tenant, ผู้ส่ง, ช่องทาง และเวลารับ
4. หมุนภาพตาม EXIF แล้วลบ GPS/device metadata; ตรวจ blur, glare, crop, shadow, นิ้วบัง และหน้าขาด
5. ปรับ deskew, white balance, shadow, denoise และ sharpen ตัวอักษร จากนั้นสร้างไฟล์ตาม Storage Profile และ thumbnail
6. รวมภาพเป็นชุดเอกสารด้วยกลุ่ม/ผู้ส่ง/ช่วงเวลา พร้อมรองรับจำนวนหน้าที่คาดหวัง คำสั่ง “จบชุด” และ merge/split
7. Router เลือก OCR/PDF/table/Thai handwriting engine; เก็บ confidence รายช่องและส่งให้คนตรวจเมื่อไม่ถึงเกณฑ์
8. ผู้ใช้ยืนยันชนิดเอกสาร ผู้ขาย โครงการ และข้อมูลสำคัญเพียงครั้งเดียว
9. ส่งต่อรายการเดิมตามชนิด: ใบรับสินค้าไป Stock, ใบวางบิลไป matching, ใบเสนอราคาไป Price/PO, invoice/receipt ไปบัญชี/AP, เอกสารอื่นไปคลังอ้างอิง
10. Worker ตรวจความสมบูรณ์ ความเชื่อมโยง retention/quota/backup และแสดงสถานะตั้งแต่รับจนบันทึกปลายทาง

## รายการงานและเกณฑ์ตรวจรับ

### DOC-INGEST-001 — ด่านตรวจความปลอดภัยไฟล์

- รองรับ JPEG/PNG/WebP/HEIC/HEIF/TIFF/GIF/PDF โดยตรวจ signature และ magic bytes ไม่เชื่อ extension
- จำกัด bytes, pixels, pages, frame และ decompression ratio; ตรวจ malware และ PDF password/JavaScript/embedded files
- ไฟล์ไม่ผ่านต้องถูก quarantine พร้อมเหตุผลที่อ่านเข้าใจได้และ retry ได้เฉพาะกรณีชั่วคราว
- ผ่านเมื่อ regression test มีไฟล์ปกติ ไฟล์ปลอมชนิด ไฟล์เสีย ไฟล์ใหญ่ bomb และ PDF อันตราย

### DOC-INGEST-002 — ปรับคุณภาพภาพและ Quality Gate

- Auto-orient, deskew, white balance, shadow removal, denoise, text sharpening
- ตรวจ blur/glare/crop/finger/missing page และเปรียบเทียบ OCR ก่อน-หลัง โดยเน้นเลขจำนวนเงิน วันที่ เลขภาษี และเลขเอกสาร
- Profile: บัญชี 2500px/Q92–95, ลายมือ 2800px/Q95, Error 2000px/Q88–90, ทั่วไป 1600px/Q78–82, thumbnail 480–640px/Q70–80
- ผ่านเมื่อภาพที่ปรับแล้วไม่ทำให้ field สำคัญแม่นยำน้อยลง และภาพไม่ผ่าน gate ถูกส่งตรวจคน
- Evidence 16/8/2569: เพิ่ม policy contract ที่ `src/utils/imageQualityPolicy.ts` และ regression test ที่ `scripts/image-quality-policy.test.ts`; ครบ profile บัญชี/ลายมือ/Error/ทั่วไป/thumbnail, recipe auto-orient และ strip EXIF/GPS ถึง text sharpening, gate blur/glare/crop/finger/missing page และบังคับ human review เมื่อ OCR จำนวนเงิน/วันที่/เลขภาษี/เลขเอกสารถดถอย. ยังเป็น review จนกว่าจะผูก native image processor และผ่าน benchmark corpus ภาพจริงก่อน-หลัง

### DOC-INGEST-003 — ต้นฉบับกักกันและ Chain of Custody

- เก็บต้นฉบับ private แยกจากไฟล์ใช้งาน พร้อม hash, uploader, channel, tenant, received_at และ immutable audit
- เอกสารการเงินเก็บต้นฉบับอย่างน้อย 30 วัน; ทั่วไป 7 วัน; ลบได้หลัง QA ยืนยันและไม่มี legal hold
- Signed PDF เก็บ immutable ห้าม optimize ทับต้นฉบับ
- ผ่านเมื่อ trace จากเอกสารปลายทางกลับถึงต้นฉบับและผู้ยืนยันได้ครบ

### DOC-INGEST-004 — สิทธิ์เข้าถึงเอกสารการเงิน

- แยก role/purpose สำหรับบัญชี การเงิน ผู้อนุมัติ ผู้ตรวจสอบ และผู้ดูแลระบบ
- Signed URL อายุสั้น; บันทึก preview/download/export; ป้องกันสมาชิกบริษัททั่วไปเปิดไฟล์การเงิน
- ทดสอบ positive/negative อย่างน้อย 2 บริษัทและ cross-tenant

### DOC-INGEST-005 — Dedupe แบบไฟล์จริงและเอกสารเชิงธุรกิจ

- Blob เดียวกันเก็บครั้งเดียวด้วย SHA-256 แต่ทุก LINE message/document reference ต้องมี logical record ของตัวเอง
- ใช้ perceptual hash ช่วยเตือนภาพเกือบซ้ำ โดยไม่ลบอัตโนมัติ
- ผ่านเมื่อ resend ไม่กินพื้นที่ซ้ำ แต่ยังเห็นประวัติข้อความและสามารถผูกคนละงานได้

### DOC-INGEST-006 — ชุดเอกสารหลายหน้า

- ใช้ group/sender/company/time window และรองรับ out-of-order/redelivery
- เพิ่ม expected page count, ปุ่ม/คำสั่ง “จบชุด”, หน้า preview, merge/split/detach และแจ้งผู้ส่งเมื่อชุดไม่ครบ
- ส่วนที่มีแล้ว: auto-group ภายใน 3 นาที, preview, merge/split; ส่วนที่เหลือ: expected count/end-set/LINE feedback และ UAT

### DOC-INGEST-007 — Pipeline PDF/HEIC/TIFF

- PDF มี text: เก็บต้นฉบับและ extract text โดยไม่ rasterize
- Scan PDF/TIFF: render page เพื่อ OCR และเก็บ optimized WebP ต่อหน้า; HEIC แปลงด้วย color profile ถูกต้อง
- PDF ที่มีลายเซ็นเก็บต้นฉบับ immutable; ห้าม lossy JBIG2 กับเอกสารตัวเลข
- Evidence 16/8/2569: เพิ่ม pipeline contract ที่ `src/utils/documentPipeline.ts` และ corpus test ที่ `scripts/document-pipeline.test.ts` ครบ native/scan/multipage/signed/password PDF, HEIC/TIFF และ page mapping; สถานะยังเป็น review จนกว่าจะผูก production converter และผ่าน binary corpus smoke test

### DOC-INGEST-008 — Retention, Trash, Restore และ Purge

- Worker ตรวจ reference ก่อนลบ; ย้ายเข้า trash 7 วัน; restore ได้; purge หลังครบกำหนดและไม่มี hold
- ทุกขั้นตอน idempotent มี dry-run, batch limit, audit และรายงาน bytes ที่คืนพื้นที่

### DOC-INGEST-009 — ตรวจความสอดคล้อง Storage/Database

- ตรวจ orphan object, dangling DB row, missing thumbnail/page, hash mismatch และผิด tenant namespace
- ซ่อมเฉพาะกรณีปลอดภัย; อื่น ๆ เปิด Incident พร้อม evidence/fingerprint และป้องกันเปิดซ้ำ

### DOC-INGEST-010 — Metadata, OCR Confidence และ Audit

- เก็บ dimensions/DPI/orientation, original/optimized hash, perceptual hash, quality score, transform recipe/version
- เก็บ OCR engine/model/version/confidence ราย field/page และประวัติค่าก่อน-หลังผู้ใช้แก้ไข
- รายงานต้องค้นด้วย intake/document/message/hash ได้

### DOC-INGEST-011 — Quota, Backup และ Restore Test

- แจ้งเตือนการใช้พื้นที่ที่ 70/85/95%; แยกตามบริษัท ประเภท และ retention class
- สำรอง DB metadata และ critical originals; ทดสอบ restore ตามรอบและบันทึก RPO/RTO/evidence

### DOC-INGEST-012 — Specialist AI Router แบบประหยัดค่าใช้จ่าย

- Local-first: OpenCV/ImageMagick, PaddleOCR PP-OCRv5 Thai, PDF.js/Poppler และ PP-Structure/table extraction
- Rules engine ตรวจเลขภาษี วันที่ ยอดรวม VAT และสมการบัญชีก่อนใช้ cloud
- ใช้ cloud/Gemini/Document AI เฉพาะ low confidence หรือรูปยากตาม budget/consent; บันทึกเหตุผลและต้นทุนต่อหน้า

### DOC-INGEST-013 — ส่งต่อจากยืนยันภาพสู่บัญชี/Stock/จัดซื้อ

- Confirmation ต้อง update `accounting_document` เดิม ไม่สร้างซ้ำ และ transaction classification แยกจาก posting
- Route: goods receipt → stock review, billing note → receipt matching, quotation → price list/PO, invoice/receipt → accounting/AP, other → reference archive
- แก้ชนิดก่อน posting ต้อง re-route/rollback แบบมี audit; หลัง posting ใช้ reversal/correction

### DOC-INGEST-014 — กลยุทธ์เก็บ PDF ให้เล็กและปลอดภัย

- Native text PDF เก็บเดิมและบีบ lossless; scanned document เก็บ optimized WebP pages แล้วสร้าง PDF เมื่อขอดู/ส่งออก
- ภาพหลายใบไม่ควรแปลงเป็น PDF เพียงเพื่อหวังลดพื้นที่ เพราะ PDF เป็น container และอาจใหญ่กว่า
- เก็บ thumbnail/text/index แยกจากต้นฉบับ; signed/official PDF ห้ามเปลี่ยน bytes
- Evidence 16/8/2569: เพิ่ม storage-policy contract ที่ `src/utils/pdfStorageStrategy.ts` และ adapter-level corpus test ที่ `scripts/pdf-storage-strategy.test.ts`; native text เก็บ original พร้อม lossless derivative ที่ยังอ่าน text ได้, scan เก็บ lossless WebP ต่อหน้า/OCR/source SHA-256 และระบุสร้าง PDF on demand, ส่วน signed/official บังคับ byte-identical original และ signed ต้อง verify ผ่าน. ตรวจซ้ำด้วย `npm.cmd run test:pdf-storage-strategy` ผ่าน และ `npm.cmd run build` ผ่าน; `npm.cmd run lint` ยังไม่ผ่านจาก 4 pre-existing errors ใน `AccountingDocuments`/`DocumentFlows` ซึ่งไม่เกี่ยวกับไฟล์งานนี้ (`DOC-INGEST-014:LINT_PREEXISTING_REACT_HOOKS`). สถานะยังเป็น review จนกว่าจะทดสอบกับ binary PDF corpus และตัวตรวจลายเซ็น production จริง

### DOC-INGEST-015 — สถานะ, Retry และ Dead-letter

- สถานะมาตรฐาน: received → security_checked → optimized → grouped → OCR → needs_review → confirmed → routed → posted/completed
- แสดงข้อความสาเหตุและสิ่งที่ผู้ใช้ต้องทำ; retry แบบ exponential/idempotent; dead-letter มีปุ่มส่งใหม่และเปิด Incident
- Dashboard แสดงค้างตาม stage, อายุงาน, error fingerprint, attempts และปลายทางที่สร้างแล้ว

## ลำดับดำเนินการ

1. Critical: 001, 003, 004, 009, 011, 013
2. High foundation: 002, 005, 006, 007, 010, 015
3. Optimization: 008, 012, 014

การปิดแต่ละงานต้องมี migration/code reference, automated test, Production smoke test, หลักฐาน audit และคู่มือ rollback/restore ตามความเสี่ยงของงาน
