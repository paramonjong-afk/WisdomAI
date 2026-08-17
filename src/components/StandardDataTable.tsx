import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import {
  Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TableSortLabel, TextField,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent } from '../lib/telemetry'
import type { CompanyRole } from '../types/auth'
import type { SxProps, Theme } from '@mui/material/styles'

export type StandardTableColumn<Row> = {
  id: string
  label: string
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  render: (row: Row) => ReactNode
  exportValue?: (row: Row) => string | number | null | undefined
  exportable?: boolean
  visible?: boolean
  allowedCompanyRoles?: CompanyRole[]
  linkTo?: (row: Row) => string
  sortable?: boolean
  sortValue?: (row: Row) => string | number | boolean | Date | null | undefined
}

type StandardDataTableProps<Row> = {
  rows: Row[]
  columns: StandardTableColumn<Row>[]
  getRowId: (row: Row) => string
  getSearchText?: (row: Row) => string
  searchLabel?: string
  emptyText?: string
  exportFileName?: string
  toolbar?: ReactNode
  initialRowsPerPage?: number
  minWidth?: number
  exportTitle?: string
  exportSubtitle?: string
  exportMeta?: Array<{label:string;value:string|number|null|undefined}>
  exportSummary?: Array<{label:string;value:string|number|null|undefined}>
  getExportRowTone?: (row:Row) => 'success'|'warning'|'danger'|'holiday'|'muted'|'info'|undefined
  onRowClick?: (row: Row) => void
  getRowSx?: (row: Row) => SxProps<Theme>
  defaultSort?: {columnId:string;direction?:'asc'|'desc'}
}

export function StandardDataTable<Row>({
  rows,
  columns,
  getRowId,
  getSearchText,
  searchLabel = 'ค้นหาข้อมูล',
  emptyText = 'ไม่พบข้อมูล',
  exportFileName,
  toolbar,
  initialRowsPerPage = 10,
  minWidth = 900,
  exportTitle,
  exportSubtitle,
  exportMeta=[] as Array<{label:string;value:string|number|null|undefined}>,
  exportSummary=[] as Array<{label:string;value:string|number|null|undefined}>,
  getExportRowTone,
  onRowClick,
  getRowSx,
  defaultSort,
}: StandardDataTableProps<Row>) {
  const {profile,currentCompany}=useAuth()
  const location=useLocation()
  const resolvedExportFileName=exportFileName||`wisdomai-${location.pathname.replace(/^\/+|\/+$/g,'').replaceAll('/','-')||'home'}-${columns[0]?.id||'table'}`
  const stateKey=`wisdomai-table:${resolvedExportFileName}`
  const restored=useMemo(()=>{try{return JSON.parse(localStorage.getItem(stateKey)??sessionStorage.getItem(stateKey)??'{}') as {search?:string;page?:number;rowsPerPage?:number;sortColumn?:string;sortDirection?:'asc'|'desc'}}catch{return {}}},[stateKey])
  const [search, setSearch] = useState(restored.search??'')
  const [page, setPage] = useState(restored.page??0)
  const [rowsPerPage, setRowsPerPage] = useState(restored.rowsPerPage??initialRowsPerPage)
  const [sortColumn,setSortColumn]=useState(restored.sortColumn??defaultSort?.columnId??'')
  const [sortDirection,setSortDirection]=useState<'asc'|'desc'>(restored.sortDirection??defaultSort?.direction??'asc')
  const saveTableState=(next:{search?:string;page?:number;rowsPerPage?:number;sortColumn?:string;sortDirection?:'asc'|'desc'})=>{
    const state={search,page,rowsPerPage,sortColumn,sortDirection,...next}
    localStorage.setItem(stateKey,JSON.stringify(state))
    sessionStorage.setItem(stateKey,JSON.stringify(state))
  }
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword || !getSearchText) return rows
    return rows.filter((row) => getSearchText(row).toLowerCase().includes(keyword))
  }, [getSearchText, rows, search])
  const visibleColumns=useMemo(()=>columns.filter(column=>column.visible!==false&&(!column.allowedCompanyRoles||Boolean(currentCompany&&column.allowedCompanyRoles.includes(currentCompany.company_role)))),[columns,currentCompany])
  const exportColumns=useMemo(()=>visibleColumns.filter(column=>column.exportable!==false),[visibleColumns])
  const exportCellValue=(column:StandardTableColumn<Row>,row:Row)=>{const value=column.exportValue?column.exportValue(row):column.render(row);return typeof value==='string'||typeof value==='number'?value:''}
  const sortedRows=useMemo(()=>{
    if(!sortColumn)return filteredRows
    const column=visibleColumns.find(item=>item.id===sortColumn)
    if(!column||column.sortable===false)return filteredRows
    const valueOf=(row:Row)=>column.sortValue?.(row)??column.exportValue?.(row)??column.render(row)
    const normalized=(value:unknown):string|number=>{
      if(value instanceof Date)return value.getTime()
      if(typeof value==='number')return Number.isNaN(value)?0:value
      if(typeof value==='boolean')return value?1:0
      if(typeof value==='string')return value.trim()
      return ''
    }
    return filteredRows.map((row,index)=>({row,index})).sort((left,right)=>{
      const a=normalized(valueOf(left.row));const b=normalized(valueOf(right.row))
      const compared=typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b),'th',{numeric:true,sensitivity:'base'})
      return (compared||left.index-right.index)*(sortDirection==='asc'?1:-1)
    }).map(item=>item.row)
  },[filteredRows,sortColumn,sortDirection,visibleColumns])
  const visibleRows = sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const changeSort=(column:StandardTableColumn<Row>)=>{
    if(column.sortable===false)return
    const direction=sortColumn===column.id&&sortDirection==='asc'?'desc':'asc'
    setSortColumn(column.id);setSortDirection(direction);setPage(0)
    saveTableState({sortColumn:column.id,sortDirection:direction,page:0})
  }

  const auditExport=(format:'csv'|'pdf')=>{if(profile)void logAppEvent(profile.id,{eventType:'export_data',message:`Export ${format.toUpperCase()}: ${resolvedExportFileName}`,metadata:{format,file:resolvedExportFileName,row_count:filteredRows.length,company_id:currentCompany?.company_id??null}})}

  const exportCsv = () => {
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`
    const reportMeta=[
      ['รายงาน',exportTitle??resolvedExportFileName],
      ['บริษัท',currentCompany?.company_name??'WisdomAI'],
      ...(exportSubtitle?[['ช่วงข้อมูล',exportSubtitle]]:[]),
      ...exportMeta.map(item=>[item.label,item.value??'-']),
      ['ตัวกรอง',search||'ทั้งหมด'],
      ['จำนวนรายการ',filteredRows.length],
      ['สร้างเมื่อ',new Date().toLocaleString('th-TH')],
      ['จัดทำโดย',profile?.full_name??profile?.email??'-'],
    ]
    const csvRows:(string|number)[][] = [
      ...reportMeta.map(row=>row.map(value=>String(value))),
      [],
      exportColumns.map((column) => column.label),
      ...sortedRows.map((row) => exportColumns.map((column) =>
        exportCellValue(column,row))),
      ...(exportSummary.length?[[],['สรุป','ค่า'],...exportSummary.map(item=>[item.label,String(item.value??'-')])]:[]),
    ]
    const csv = '\uFEFF' + csvRows
      .map((row) => row.map((value) => escapeCsv(String(value))).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${resolvedExportFileName}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    auditExport('csv')
  }

  const exportPdf=()=>{
    const escapeHtml=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
    const title=exportTitle??resolvedExportFileName
    const reportWindow=window.open('','_blank')
    if(!reportWindow)return
    try{reportWindow.history.replaceState(null,'',`/print/${encodeURIComponent(resolvedExportFileName)}`)}catch{/* printable window remains available */}
    const head=exportColumns.map(column=>`<th>${escapeHtml(column.label)}</th>`).join('')
    const body=sortedRows.map(row=>`<tr class="${getExportRowTone?.(row)??''}">${exportColumns.map(column=>`<td>${escapeHtml(exportCellValue(column,row))}</td>`).join('')}</tr>`).join('')
    const landscape=exportColumns.length>6
    const metadata=[...(exportSubtitle?[{label:'ช่วงข้อมูล',value:exportSubtitle}]:[]),...exportMeta,{label:'ตัวกรอง',value:search||'ทั้งหมด'},{label:'จำนวนรายการ',value:filteredRows.length},{label:'สร้างเมื่อ',value:new Date().toLocaleString('th-TH')},{label:'จัดทำโดย',value:profile?.full_name??profile?.email??'-'}]
    const metaHtml=metadata.map(item=>`<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value??'-')}</strong></div>`).join('')
    const summaryHtml=exportSummary.length?`<section class="summary"><h2>สรุป</h2><div class="summary-grid">${exportSummary.map(item=>`<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value??'-')}</strong></div>`).join('')}</div></section>`:''
    reportWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:${landscape?'A4 landscape':'A4 portrait'};margin:11mm}*{box-sizing:border-box}body{font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;color:#2f2926;font-size:9px;margin:0}h1{font-size:17px;margin:2px 0 7px}.company{font-weight:700;color:#a65940}.meta-grid,.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-bottom:9px}.meta-grid div,.summary-grid div{border:1px solid #ddd3ce;border-radius:4px;padding:4px 6px}.meta-grid span,.summary-grid span{display:block;color:#766b66;font-size:8px}.meta-grid strong,.summary-grid strong{display:block;margin-top:2px}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #c8c0bc;padding:4px 5px;vertical-align:top;word-break:break-word}th{background:#efe4df;font-weight:700}tr{break-inside:avoid}.success{background:#edf8f0}.warning{background:#fff7df}.danger{background:#fff0f0}.holiday{background:#f3f0fa}.muted{background:#f4f4f4}.info{background:#eef6ff}.summary{margin-top:9px;break-inside:avoid}.summary h2{font-size:12px;margin:0 0 4px}footer{margin-top:8px;font-size:8px;color:#777}</style></head><body><div class="company">${escapeHtml(currentCompany?.company_name??'WisdomAI')}</div><h1>${escapeHtml(title)}</h1><div class="meta-grid">${metaHtml}</div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${summaryHtml}<footer>ข้อมูลตามสิทธิ์ของผู้ส่งออก · ${escapeHtml(window.location.origin+location.pathname)}</footer><script>window.onload=async()=>{try{await document.fonts.ready}catch{}window.print()}</script></body></html>`)
    reportWindow.document.close()
    auditExport('pdf')
  }

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          {getSearchText && (
            <TextField
              fullWidth
              size="small"
              label={searchLabel}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
                saveTableState({search:event.target.value,page:0})
              }}
            />
          )}
          {toolbar}
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            disabled={filteredRows.length === 0}
            onClick={exportCsv}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Export CSV
          </Button>
          <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon/>} disabled={filteredRows.length===0} onClick={exportPdf} sx={{whiteSpace:'nowrap'}}>Export PDF</Button>
        </Stack>
      </Paper>
      {filteredRows.length === 0 ? (
        <Alert severity="info">{emptyText}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader sx={{ minWidth }}>
            <TableHead>
              <TableRow>
                {visibleColumns.map((column) => (
                  <TableCell
                    key={column.id}
                    align={column.align}
                    sx={{ fontWeight: 700, minWidth: column.minWidth }}
                  >
                    <TableSortLabel active={sortColumn===column.id} direction={sortColumn===column.id?sortDirection:'asc'} hideSortIcon={column.sortable===false} disabled={column.sortable===false} onClick={()=>changeSort(column)}>
                      {column.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  hover
                  onClick={(event) => {
                    if (!onRowClick) return
                    const target = event.target as HTMLElement
                    if (target.closest('button,a,input,textarea,select,[role="button"]')) return
                    onRowClick(row)
                  }}
                  sx={{...(getRowSx?.(row)??{}),...(onRowClick?{cursor:'pointer'}:{})}}
                >
                  {visibleColumns.map((column) => (
                    <TableCell key={column.id} align={column.align}>
                      {column.linkTo?<RouterLink to={column.linkTo(row)} style={{color:'inherit',fontWeight:600,textDecorationColor:'#a65940'}}>{column.render(row)}</RouterLink>:column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={filteredRows.length}
            page={Math.min(page, Math.max(0, Math.ceil(filteredRows.length / rowsPerPage) - 1))}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="แถวต่อหน้า"
            onPageChange={(_event, nextPage) => {setPage(nextPage);saveTableState({page:nextPage})}}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value))
              setPage(0)
              saveTableState({rowsPerPage:Number(event.target.value),page:0})
            }}
          />
        </TableContainer>
      )}
    </Stack>
  )
}
