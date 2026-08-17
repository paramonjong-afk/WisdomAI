import type { ImportedBoqRow } from './boqImport'

export type PdfLine={page:number;text:string}
export type BoqComparison={
  import_id:string;page:number|null;pdfText:string;match:'matched'|'different'|'excel_only';confidence:number;differences:string[]
}
export type PdfExtraction={pageCount:number;lines:PdfLine[];warnings:string[]}

const normalize=(value:string)=>value.toLowerCase().replaceAll(/\s+/g,'').replaceAll(/[.,()\-_/]/g,'')
const tokens=(value:string)=>new Set(normalize(value).match(/[\p{L}\p{N}]+/gu)??[])
const similarity=(left:string,right:string)=>{const a=tokens(left),b=tokens(right);if(!a.size||!b.size)return 0;let common=0;a.forEach(value=>{if(b.has(value))common++});return common/Math.max(a.size,b.size)}
const numbers=(value:string)=>(value.match(/-?\d[\d,]*(?:\.\d+)?/g)??[]).map(item=>Number(item.replaceAll(',',''))).filter(Number.isFinite)

export async function readBoqPdf(file:File):Promise<PdfExtraction>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs',import.meta.url).toString()
  const document=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise
  const lines:PdfLine[]=[]
  for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
    const page=await document.getPage(pageNumber),content=await page.getTextContent()
    const grouped=new Map<number,{x:number;text:string}[]>()
    for(const raw of content.items){
      if(!('str' in raw)||!raw.str.trim())continue
      const y=Math.round(Number(raw.transform[5])/3)*3,x=Number(raw.transform[4])
      grouped.set(y,[...(grouped.get(y)??[]),{x,text:raw.str.trim()}])
    }
    ;[...grouped.entries()].sort((a,b)=>b[0]-a[0]).forEach(([,items])=>{const line=items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ').trim();if(line)lines.push({page:pageNumber,text:line})})
  }
  const warnings:string[]=[]
  if(!lines.length)warnings.push('PDF ไม่มีข้อความที่เลือกได้ อาจเป็นไฟล์สแกนและต้องใช้ OCR')
  return{pageCount:document.numPages,lines,warnings}
}

export function compareBoqSources(rows:ImportedBoqRow[],pdf:PdfExtraction):BoqComparison[]{
  return rows.map(row=>{
    const code=normalize(row.boq_code),description=normalize(row.description)
    const candidates=pdf.lines.map(line=>({line,score:(code&&normalize(line.text).includes(code)?0.75:0)+similarity(description,line.text)*0.45})).sort((a,b)=>b.score-a.score)
    const best=candidates[0]
    if(!best||best.score<0.25)return{import_id:row.import_id,page:null,pdfText:'',match:'excel_only',confidence:0,differences:['ไม่พบรายการที่ตรงกันใน PDF']}
    const pdfNumbers=numbers(best.line.text),expected=[row.quantity,row.material_unit_cost,row.labour_unit_cost,row.selling_unit_price].filter(value=>value>0)
    const missing=expected.filter(value=>!pdfNumbers.some(candidate=>Math.abs(candidate-value)<=Math.max(.01,Math.abs(value)*.001)))
    const differences:string[]=[]
    if(missing.length)differences.push(`ตัวเลขไม่ตรงหรือไม่พบ: ${missing.join(', ')}`)
    if(!normalize(best.line.text).includes(code))differences.push('จับคู่จากชื่อรายการ ไม่พบรหัสตรงกัน')
    return{import_id:row.import_id,page:best.line.page,pdfText:best.line.text,match:differences.length?'different':'matched',confidence:Math.min(100,Math.round(best.score*100)),differences}
  })
}
