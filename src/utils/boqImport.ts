export type BoqQualityStatus='ready'|'review'|'error'
export type ImportedBoqRow={
  import_id:string;sheet_name:string;source_row:number;line_number:number;boq_code:string;category:string;description:string;specification:string;unit:string
  quantity:number;material_unit_cost:number;labour_unit_cost:number;equipment_unit_cost:number
  subcontract_unit_cost:number;indirect_unit_cost:number;selling_unit_price:number
  quality_status:BoqQualityStatus;issues:string[]
}
export type BoqSheetResult={name:string;selected:boolean;headerRow:number;rowCount:number;skipped:number;status:'ready'|'review'|'ignored';message:string}
export type BoqImportResult={rows:ImportedBoqRow[];sheets:BoqSheetResult[];warnings:string[];skipped:number}

const aliases:Record<string,string[]>={
  code:['รหัสboq','รหัส','code','itemcode','ลำดับ','ลําดับ','no','ลำดับที่'],category:['หมวดงาน','หมวด','category','section','กลุ่มงาน','หัวข้อ'],
  description:['รายการ','รายละเอียด','รายละเอียดงาน','description','itemdescription','ชื่องาน'],specification:['สเปค','ข้อกำหนด','specification','spec','หมายเหตุ'],unit:['หน่วย','unit'],
  quantity:['ปริมาณ','จำนวน','quantity','qty'],material:['ค่าวัสดุ','วัสดุต่อหน่วย','materialunitcost','materialcost','วัสดุ'],labour:['ค่าแรง','แรงงานต่อหน่วย','labourunitcost','laborunitcost','labour','labor'],
  equipment:['ค่าเครื่องมือ','ค่าเครื่องจักร','equipmentunitcost','equipment'],subcontract:['ค่าผู้รับเหมาช่วง','ผู้รับเหมาช่วง','subcontractunitcost','subcontract'],indirect:['ค่าใช้จ่ายทางอ้อม','ต้นทุนทางอ้อม','indirectunitcost','indirect'],selling:['ราคาขายต่อหน่วย','ราคาต่อหน่วย','ราคาขาย','sellingunitprice','unitprice','price'],
}
const normalize=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/^\uFEFF/,'').replaceAll(/\s+/g,'').replaceAll(/[().,_\-/%]/g,'')
const text=(value:unknown)=>String(value??'').trim()
const numberValue=(value:unknown)=>{if(typeof value==='number')return Number.isFinite(value)?Math.max(0,value):0;const parsed=Number(String(value??'').replaceAll(',','').replace(/[฿%\s]/g,'').replace(/[()]/g,''));return Number.isFinite(parsed)?Math.max(0,parsed):0}
const findColumn=(headers:string[],key:string)=>{const choices=aliases[key].map(normalize);return headers.findIndex(header=>choices.includes(normalize(header)))}
const headerCandidate=(matrix:unknown[][])=>{let best={index:-1,score:0};for(let index=0;index<Math.min(matrix.length,25);index++){const headers=(matrix[index]??[]).map(text);const score=['description','unit','quantity','code','category'].filter(key=>findColumn(headers,key)>=0).length;if(score>best.score)best={index,score}}return best}

function parseCsv(source:string){const rows:string[][]=[];let row:string[]=[];let value='';let quoted=false;for(let index=0;index<source.length;index++){const character=source[index];if(character==='"'&&quoted&&source[index+1]==='"'){value+='"';index++;continue}if(character==='"'){quoted=!quoted;continue}if(character===','&&!quoted){row.push(value);value='';continue}if((character==='\n'||character==='\r')&&!quoted){if(character==='\r'&&source[index+1]==='\n')index++;row.push(value);if(row.some(cell=>cell.trim()))rows.push(row);row=[];value='';continue}value+=character}row.push(value);if(row.some(cell=>cell.trim()))rows.push(row);return rows}

function parseSheet(name:string,matrix:unknown[][],lineStart:number){
  const candidate=headerCandidate(matrix)
  if(candidate.score<3)return{rows:[] as ImportedBoqRow[],sheet:{name,selected:false,headerRow:0,rowCount:0,skipped:matrix.length,status:'ignored' as const,message:'ไม่พบหัวตาราง BOQ'},skipped:matrix.length}
  const headers=matrix[candidate.index].map(text),columns=Object.fromEntries(Object.keys(aliases).map(key=>[key,findColumn(headers,key)])) as Record<string,number>
  if(columns.description<0||columns.unit<0||columns.quantity<0)return{rows:[] as ImportedBoqRow[],sheet:{name,selected:false,headerRow:candidate.index+1,rowCount:0,skipped:matrix.length-candidate.index-1,status:'ignored' as const,message:'ขาดคอลัมน์รายการ หน่วย หรือปริมาณ'},skipped:matrix.length-candidate.index-1}
  const rows:ImportedBoqRow[]=[];let skipped=0;let currentCategory='ไม่ระบุหมวด'
  matrix.slice(candidate.index+1).forEach((sourceRow,offset)=>{
    const description=text(sourceRow[columns.description]),unit=text(sourceRow[columns.unit]),category=columns.category>=0?text(sourceRow[columns.category]):''
    if(category)currentCategory=category
    if(!description||!unit){skipped++;return}
    const code=columns.code>=0?text(sourceRow[columns.code]):''
    const getNumber=(key:string)=>columns[key]>=0?numberValue(sourceRow[columns[key]]):0
    const issues:string[]=[];const quantity=getNumber('quantity'),selling=getNumber('selling')
    if(!code)issues.push('AI เสนอรหัสภายใน เนื่องจากไม่มีรหัสในไฟล์')
    if(quantity<=0)issues.push('ปริมาณเป็นศูนย์ กรุณาตรวจสอบ')
    if(!selling&&!getNumber('material')&&!getNumber('labour')&&!getNumber('equipment')&&!getNumber('subcontract'))issues.push('ไม่พบราคาหรือต้นทุน')
    rows.push({import_id:`${name}-${candidate.index+offset+2}`,sheet_name:name,source_row:candidate.index+offset+2,line_number:lineStart+rows.length+1,boq_code:code||`AI-${String(lineStart+rows.length+1).padStart(5,'0')}`,category:currentCategory,description,specification:columns.specification>=0?text(sourceRow[columns.specification]):'',unit,quantity,material_unit_cost:getNumber('material'),labour_unit_cost:getNumber('labour'),equipment_unit_cost:getNumber('equipment'),subcontract_unit_cost:getNumber('subcontract'),indirect_unit_cost:getNumber('indirect'),selling_unit_price:selling,quality_status:issues.some(issue=>issue.includes('ศูนย์'))?'error':issues.length?'review':'ready',issues})
  })
  const duplicateGroups=new Map<string,ImportedBoqRow[]>()
  rows.forEach(row=>{const key=`${normalize(row.category)}|${normalize(row.boq_code)}`;duplicateGroups.set(key,[...(duplicateGroups.get(key)??[]),row])})
  duplicateGroups.forEach(group=>{if(group.length>1)group.forEach(row=>{row.issues.push('รหัสซ้ำภายใน Sheet และหัวข้อเดียวกัน');row.quality_status='error'})})
  return{rows,sheet:{name,selected:true,headerRow:candidate.index+1,rowCount:rows.length,skipped,status:rows.some(row=>row.quality_status==='error')?'review' as const:'ready' as const,message:`อ่านได้ ${rows.length} รายการ`},skipped}
}

export async function readBoqFile(file:File):Promise<BoqImportResult>{
  const extension=file.name.split('.').pop()?.toLowerCase();let inputs:{name:string;data:unknown[][]}[]
  if(extension==='csv'){const buffer=await file.arrayBuffer();let source=new TextDecoder('utf-8').decode(buffer);if(source.includes('\uFFFD'))source=new TextDecoder('windows-874').decode(buffer);inputs=[{name:'CSV',data:parseCsv(source)}]}
  else if(extension==='xlsx'){try{const{default:readXlsxFile}=await import('read-excel-file/browser');const sheets=await readXlsxFile(file);inputs=(sheets as unknown as {sheet:string;data:unknown[][]}[]).map(sheet=>({name:sheet.sheet,data:sheet.data}))}catch(error){throw new Error(`อ่านโครงสร้าง Excel ไม่สำเร็จ (${error instanceof Error?error.message:'รูปแบบไม่ถูกต้อง'}) กรุณา Save As เป็น .xlsx ใหม่`,{cause:error})}}
  else throw new Error('รองรับไฟล์ Excel (.xlsx) และ CSV (.csv) เท่านั้น')
  if(!inputs.length)throw new Error('ไม่พบข้อมูลในไฟล์')
  const rows:ImportedBoqRow[]=[],sheets:BoqSheetResult[]=[];let skipped=0
  inputs.forEach(input=>{const parsed=parseSheet(input.name,input.data,rows.length);rows.push(...parsed.rows);sheets.push(parsed.sheet);skipped+=parsed.skipped})
  if(!rows.length)throw new Error('ไม่พบ Sheet ที่มีหัวตาราง BOQ และรายการพร้อมนำเข้า')
  if(rows.length>5000)throw new Error('ไฟล์มีเกิน 5,000 รายการ กรุณาแบ่งไฟล์ก่อนนำเข้า')
  const warnings=[] as string[]
  if(sheets.some(sheet=>sheet.status==='ignored'))warnings.push('มี Sheet ที่ไม่ใช่ BOQ หรือหัวตารางไม่ครบ ระบบไม่นำเข้า Sheet เหล่านั้น')
  if(rows.some(row=>row.quality_status==='error'))warnings.push('พบข้อมูลสีแดง ต้องแก้ไขก่อนยืนยันนำเข้า')
  if(rows.some(row=>row.quality_status==='review'))warnings.push('พบข้อมูลที่ AI แนะนำให้ตรวจสอบ')
  return{rows,sheets,warnings,skipped}
}
