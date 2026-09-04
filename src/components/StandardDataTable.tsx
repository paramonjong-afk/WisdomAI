import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import {
  Alert, Box, Checkbox, IconButton, ListItemText, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TableSortLabel, TextField, Tooltip,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
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
export type StandardDataTableTools = {
  openColumnSettings: (anchorEl: HTMLElement | null) => void
  exportCsv: () => void
  exportPdf: () => void
}

type StandardDataTableProps<Row> = {
  rows: Row[]
  columns: StandardTableColumn<Row>[]
  getRowId: (row: Row) => string
  getSearchText?: (row: Row) => string
  searchLabel?: string
  emptyText?: string
  exportFileName?: string
  toolbar?: ReactNode | ((actions: StandardDataTableTools) => ReactNode)
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
  hideBuiltInToolbarActions?: boolean
  /** Optional because loading data belongs to each page, not to the table. */
  onRefresh?: () => void
  refreshDisabled?: boolean
  hideToolbar?: boolean
  compactToolbar?: boolean
  flatToolbar?: boolean
  onToolsReady?: (tools: StandardDataTableTools) => void
  onSearchReady?: (actions: { toggle: () => void }) => void
  /** Reports the row count after the built-in search predicate is applied. */
  onFilteredRowCountChange?: (count: number) => void
}

type PersistedStandardDataTableState = {
  search?: string
  page?: number
  rowsPerPage?: number
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
  visibleColumnIds?: string[]
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
  hideBuiltInToolbarActions,
  onRefresh,
  refreshDisabled,
  hideToolbar,
  compactToolbar,
  flatToolbar,
  onToolsReady,
  onSearchReady,
  onFilteredRowCountChange,
}: StandardDataTableProps<Row>) {
  const {profile,currentCompany}=useAuth()
  const location=useLocation()
  const resolvedExportFileName=exportFileName||`wisdomai-${location.pathname.replace(/^\/+|\/+$/g,'').replaceAll('/','-')||'home'}-${columns[0]?.id||'table'}`
  const stateKey=`wisdomai-table:${resolvedExportFileName}`
  const restored = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(stateKey) ?? sessionStorage.getItem(stateKey) ?? '{}') as PersistedStandardDataTableState
    } catch { return {} }
  }, [stateKey])
  const [search, setSearch] = useState(restored.search??'')
  const [searchOpen, setSearchOpen] = useState(false)
  const [page, setPage] = useState(restored.page??0)
  const [rowsPerPage, setRowsPerPage] = useState(restored.rowsPerPage??initialRowsPerPage)
  const [sortColumn,setSortColumn]=useState(restored.sortColumn??defaultSort?.columnId??'')
  const [sortDirection,setSortDirection]=useState<'asc'|'desc'>(restored.sortDirection??defaultSort?.direction??'asc')
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<HTMLElement | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [pdfExportError, setPdfExportError] = useState('')
  const loggedTableMetric = useRef('')
  const roleFilteredColumns = useMemo(() => columns.filter((column) => !column.allowedCompanyRoles || Boolean(currentCompany && column.allowedCompanyRoles.includes(currentCompany.company_role))), [columns, currentCompany])
  const defaultVisibleColumnIds = useMemo(() => roleFilteredColumns.filter((column)=>column.visible !== false).map((column) => column.id), [roleFilteredColumns])
  const normalizeInitialColumnIds = useMemo(() => {
    const availableIds = roleFilteredColumns.map((column) => column.id)
    const fromStorage = restored.visibleColumnIds?.filter((id) => availableIds.includes(id)) ?? []
    const fallback = roleFilteredColumns.filter((column)=>column.visible !== false).map((column)=>column.id)
    const selected = fromStorage.length > 0 ? fromStorage : fallback
    const deduped = Array.from(new Set(selected))
    return deduped.length > 0 ? deduped : fallback
  }, [roleFilteredColumns, restored.visibleColumnIds])
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(normalizeInitialColumnIds)
  const normalizedVisibleColumnIds = useMemo(() => {
    const availableIds = roleFilteredColumns.map((column) => column.id)
    const filtered = visibleColumnIds.filter((id) => availableIds.includes(id))
    return filtered.length > 0 ? Array.from(new Set(filtered)) : defaultVisibleColumnIds
  }, [defaultVisibleColumnIds, roleFilteredColumns, visibleColumnIds])
  useEffect(() => {
    if (!profile) return
    const metricKey = `${location.pathname}:${rows.length}:${rowsPerPage}`
    if (loggedTableMetric.current === metricKey) return
    loggedTableMetric.current = metricKey
    void logAppEvent(profile.id, {
      eventType: 'page_view', pagePath: location.pathname, message: 'Table page-size sample',
      metadata: { performance_kind: 'table', module: location.pathname, row_count: rows.length, page_size: rowsPerPage, result: 'success' },
    })
  }, [location.pathname, profile, rows.length, rowsPerPage])
  const effectiveSortColumn = useMemo(() => {
    return sortColumn && normalizedVisibleColumnIds.includes(sortColumn)
      ? sortColumn
      : normalizedVisibleColumnIds[0] ?? ''
  }, [normalizedVisibleColumnIds, sortColumn])

  const saveTableState=(next:{search?:string;page?:number;rowsPerPage?:number;sortColumn?:string;sortDirection?:'asc'|'desc';visibleColumnIds?:string[]})=>{
    const state={search,page,rowsPerPage,sortColumn,sortDirection,...next}
    localStorage.setItem(stateKey,JSON.stringify(state))
    sessionStorage.setItem(stateKey,JSON.stringify(state))
  }
  const visibleColumns=useMemo(()=>roleFilteredColumns.filter((column)=>normalizedVisibleColumnIds.includes(column.id)),[roleFilteredColumns,normalizedVisibleColumnIds])
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword || !getSearchText) return rows
    return rows.filter((row) => getSearchText(row).toLowerCase().includes(keyword))
  }, [getSearchText, rows, search])
  useEffect(() => {
    onFilteredRowCountChange?.(filteredRows.length)
  }, [filteredRows.length, onFilteredRowCountChange])
  const exportColumns=useMemo(()=>visibleColumns.filter(column=>column.exportable!==false),[visibleColumns])
  const exportCellValue=(column:StandardTableColumn<Row>,row:Row)=>{const value=column.exportValue?column.exportValue(row):column.render(row);return typeof value==='string'||typeof value==='number'?value:''}
  const openColumnMenu = (anchorEl: HTMLElement | null) => setColumnMenuAnchor(anchorEl)
  const closeColumnMenu=()=>setColumnMenuAnchor(null)
  const toggleColumn=(columnId: string, checked: boolean) => {
    const nextIds = checked ? [...visibleColumnIds, columnId].filter((id, index, list) => list.indexOf(id) === index) : visibleColumnIds.filter((id) => id !== columnId)
    if (!checked && nextIds.length === 0) return
    const ordered = roleFilteredColumns.filter((column) => nextIds.includes(column.id)).map((column) => column.id)
    const nextSortColumn = ordered.includes(sortColumn) ? sortColumn : ordered[0] ?? ''
    setVisibleColumnIds(ordered)
    if (nextSortColumn !== sortColumn) {
      setSortColumn(nextSortColumn)
      setSortDirection(defaultSort?.direction ?? 'asc')
      saveTableState({sortColumn:nextSortColumn,sortDirection:defaultSort?.direction ?? 'asc',visibleColumnIds:ordered,page:0})
      setPage(0)
    } else {
      saveTableState({visibleColumnIds:ordered})
    }
  }
  const resetColumns=() => {
    setVisibleColumnIds(defaultVisibleColumnIds)
    const fallbackSort = defaultVisibleColumnIds[0] ?? ''
    setSortColumn(fallbackSort)
    setSortDirection(defaultSort?.direction ?? 'asc')
    setPage(0)
    saveTableState({visibleColumnIds: defaultVisibleColumnIds,sortColumn:fallbackSort,sortDirection:defaultSort?.direction ?? 'asc',page:0})
    closeColumnMenu()
  }
  const sortedRows=useMemo(()=>{
    if(!effectiveSortColumn)return filteredRows
    const column=visibleColumns.find(item=>item.id===effectiveSortColumn)
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
  },[effectiveSortColumn,filteredRows,sortDirection,visibleColumns])
  const visibleRows = sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)

  useEffect(() => {
    const tableScroller = tableScrollRef.current
    const topScroller = topScrollRef.current
    if (!tableScroller || !topScroller) return undefined
    let synchronizing = false
    const measure = () => {
      setTableScrollWidth(tableScroller.scrollWidth)
      setHasHorizontalOverflow(tableScroller.scrollWidth > tableScroller.clientWidth + 1)
    }
    const syncFromTable = () => {
      if (synchronizing) return
      synchronizing = true
      topScroller.scrollLeft = tableScroller.scrollLeft
      synchronizing = false
    }
    const syncFromTop = () => {
      if (synchronizing) return
      synchronizing = true
      tableScroller.scrollLeft = topScroller.scrollLeft
      synchronizing = false
    }
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(tableScroller)
    tableScroller.addEventListener('scroll', syncFromTable, { passive: true })
    topScroller.addEventListener('scroll', syncFromTop, { passive: true })
    measure()
    return () => {
      resizeObserver.disconnect()
      tableScroller.removeEventListener('scroll', syncFromTable)
      topScroller.removeEventListener('scroll', syncFromTop)
    }
  }, [visibleColumns, visibleRows])
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

  const exportPdf=async()=>{
    if (exportingPdf || filteredRows.length === 0) return
    const escapeHtml=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
    const title=exportTitle??resolvedExportFileName
    const head=exportColumns.map(column=>`<th>${escapeHtml(column.label)}</th>`).join('')
    const body=sortedRows.map(row=>`<tr class="${getExportRowTone?.(row)??''}">${exportColumns.map(column=>`<td>${escapeHtml(exportCellValue(column,row))}</td>`).join('')}</tr>`).join('')
    const landscape=exportColumns.length>6
    const metadata=[...(exportSubtitle?[{label:'ช่วงข้อมูล',value:exportSubtitle}]:[]),...exportMeta,{label:'ตัวกรอง',value:search||'ทั้งหมด'},{label:'จำนวนรายการ',value:filteredRows.length},{label:'สร้างเมื่อ',value:new Date().toLocaleString('th-TH')},{label:'จัดทำโดย',value:profile?.full_name??profile?.email??'-'}]
    const metaHtml=metadata.map(item=>`<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value??'-')}</strong></div>`).join('')
    const summaryHtml=exportSummary.length?`<section class="summary"><h2>สรุป</h2><div class="summary-grid">${exportSummary.map(item=>`<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value??'-')}</strong></div>`).join('')}</div></section>`:''
    const report=document.createElement('section')
    report.lang='th'
    // html2canvas does not reliably render elements outside the viewport. The React export mask
    // covers this temporary report while it remains in the layout viewport for capture.
    report.style.cssText=`position:fixed;left:0;top:0;width:${landscape?'1400px':'920px'};padding:32px;background:#fff;font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;color:#2f2926;font-size:13px;line-height:1.35;z-index:1300`
    report.innerHTML=`<style>*{box-sizing:border-box}h1{font-size:24px;margin:3px 0 11px}.company{font-weight:700;color:#a65940;font-size:15px}.meta-grid,.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-bottom:14px}.meta-grid div,.summary-grid div{border:1px solid #ddd3ce;border-radius:5px;padding:7px 9px}.meta-grid span,.summary-grid span{display:block;color:#766b66;font-size:11px}.meta-grid strong,.summary-grid strong{display:block;margin-top:3px}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #c8c0bc;padding:6px 7px;vertical-align:top;word-break:break-word}th{background:#efe4df;font-weight:700}tr{break-inside:avoid}.success{background:#edf8f0}.warning{background:#fff7df}.danger{background:#fff0f0}.holiday{background:#f3f0fa}.muted{background:#f4f4f4}.info{background:#eef6ff}.summary{margin-top:14px;break-inside:avoid}.summary h2{font-size:16px;margin:0 0 7px}footer{margin-top:12px;font-size:10px;color:#777}</style><div class="company">${escapeHtml(currentCompany?.company_name??'WisdomAI')}</div><h1>${escapeHtml(title)}</h1><div class="meta-grid">${metaHtml}</div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${summaryHtml}<footer>ข้อมูลตามสิทธิ์ของผู้ส่งออก · ${escapeHtml(window.location.origin+location.pathname)}</footer>`
    setExportingPdf(true)
    setPdfExportError('')
    document.body.appendChild(report)
    try {
      await (document.fonts ? document.fonts.ready : Promise.resolve())
      const { jsPDF } = await import('jspdf')
      const { default: html2canvas } = await import('html2canvas')
      const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
      const canvas = await html2canvas(report, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        windowWidth: landscape ? 1400 : 920,
      })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 7
      const contentWidth = pageWidth - margin * 2
      const contentHeight = pageHeight - margin * 2
      const pageCanvasHeight = Math.floor(canvas.width * (contentHeight / contentWidth))
      let sourceY = 0
      let pageIndex = 0
      while (sourceY < canvas.height) {
        const sliceHeight = Math.min(pageCanvasHeight, canvas.height - sourceY)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = canvas.width
        pageCanvas.height = sliceHeight
        const context = pageCanvas.getContext('2d')
        if (!context) throw new Error('PDF canvas context unavailable')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        context.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)
        if (pageIndex > 0) pdf.addPage()
        const imageHeight = contentWidth * (sliceHeight / canvas.width)
        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, contentWidth, imageHeight)
        sourceY += sliceHeight
        pageIndex += 1
      }
      pdf.save(`${resolvedExportFileName}-${new Date().toISOString().slice(0, 10)}.pdf`)
      auditExport('pdf')
    } catch (error) {
      console.error('Direct PDF export failed', error)
      setPdfExportError('สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      report.remove()
      setExportingPdf(false)
    }
  }
  const tableTools: StandardDataTableTools = { openColumnSettings: openColumnMenu, exportCsv, exportPdf }
  if (onToolsReady) onToolsReady(tableTools)
  if (onSearchReady) onSearchReady({ toggle: () => setSearchOpen((open) => !open) })

  return (
    <Stack spacing={1.5}>
      {exportingPdf ? <Box sx={{ position: 'fixed', inset: 0, zIndex: 1301, display: 'grid', placeItems: 'center', bgcolor: 'rgba(255,255,255,.94)', color: 'text.primary', fontWeight: 700 }}>กำลังสร้างไฟล์ PDF…</Box> : null}
      {pdfExportError ? <Alert severity="error" onClose={() => setPdfExportError('')}>{pdfExportError}</Alert> : null}
      {!hideToolbar && (!compactToolbar || searchOpen || Boolean(toolbar) || !hideBuiltInToolbarActions) ? <Paper variant={flatToolbar ? undefined : "outlined"} elevation={flatToolbar ? 0 : 1} sx={{ p: flatToolbar ? 0 : 2, bgcolor: flatToolbar ? 'transparent' : undefined }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          {getSearchText && (!compactToolbar || searchOpen) && (
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
          {getSearchText && compactToolbar && !onSearchReady ? <>
            {searchOpen ? <TextField autoFocus size="small" label={searchLabel} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); saveTableState({search:event.target.value,page:0}) }} sx={{ flex: 1, minWidth: 180 }} /> : null}
            <Tooltip title={searchOpen ? 'ปิดการค้นหา' : 'ค้นหา'}>
              <IconButton size="small" color={search ? 'primary' : 'inherit'} onClick={() => setSearchOpen((open) => !open)} aria-label={searchOpen ? 'ปิดการค้นหา' : 'ค้นหา'}><SearchOutlinedIcon fontSize="small" /></IconButton>
            </Tooltip>
          </> : null}
          {typeof toolbar === 'function'
            ? toolbar({
                ...tableTools,
              })
            : toolbar}
          {!hideBuiltInToolbarActions && (
            <Stack direction="row" spacing={0.25} sx={{ ml: { md: 'auto' }, alignItems: 'center', flexShrink: 0 }}>
              {onRefresh ? (
                <Tooltip title="รีเฟรชข้อมูล">
                  <span>
                    <IconButton size="small" color="primary" onClick={onRefresh} disabled={refreshDisabled}>
                      <RefreshOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
              {roleFilteredColumns.length > 1 ? <>
              <Tooltip title="ตั้งค่าคอลัมน์ที่แสดง">
                <IconButton size="small" onClick={(event) => openColumnMenu(event.currentTarget)} color="inherit">
                  <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              </> : null}
              <Tooltip title="Export CSV">
                <span>
                  <IconButton size="small" onClick={exportCsv} disabled={filteredRows.length === 0}>
                    <DownloadOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={exportingPdf ? 'กำลังสร้าง PDF' : 'ดาวน์โหลด PDF'}>
                <span>
                  <IconButton size="small" onClick={() => void exportPdf()} disabled={filteredRows.length === 0 || exportingPdf}>
                    <PictureAsPdfOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          )}
          {roleFilteredColumns.length > 1 && (
            <Menu
              anchorEl={columnMenuAnchor}
              open={Boolean(columnMenuAnchor)}
              onClose={closeColumnMenu}
              slotProps={{ paper: { sx: { minWidth: 260 } } }}
            >
              {roleFilteredColumns.map((column) => {
                const visible = visibleColumnIds.includes(column.id)
                const disabled = visibleColumns.length === 1 && visible
                return (
                  <MenuItem key={column.id} dense>
                    <Checkbox
                      checked={visible}
                      disabled={disabled}
                      onClick={(event)=>event.stopPropagation()}
                      onChange={(event) => {
                        const checked = event.target.checked
                        toggleColumn(column.id, checked)
                      }}
                    />
                    <ListItemText primary={column.label} />
                  </MenuItem>
                )
              })}
              <MenuItem onClick={resetColumns}>
                <ListItemText primary="รีเซ็ตคอลัมน์เริ่มต้น" />
              </MenuItem>
            </Menu>
          )}
        </Stack>
      </Paper> : null}
      {filteredRows.length === 0 ? (
        <Alert severity="info">{emptyText}</Alert>
      ) : (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box
            ref={topScrollRef}
            aria-label="เลื่อนตารางแนวนอน"
            sx={{ display: hasHorizontalOverflow ? 'block' : 'none', overflowX: 'auto', overflowY: 'hidden', height: 14, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
          >
            <Box sx={{ width: tableScrollWidth, height: 1 }} />
          </Box>
          {hasHorizontalOverflow ? <Box sx={{ display: { xs: 'block', md: 'none' }, px: 1.5, py: 0.75, color: 'text.secondary', fontSize: 12, bgcolor: 'background.paper' }}>ปัดซ้ายหรือขวาเพื่อดูคอลัมน์เพิ่มเติม</Box> : null}
          <TableContainer ref={tableScrollRef} sx={{ maxHeight: { xs: 'calc(100vh - 230px)', md: 'calc(100vh - 300px)' }, overflow: 'auto' }}>
          <Table size="small" stickyHeader sx={{ minWidth }}>
            <TableHead>
              <TableRow>
                {visibleColumns.map((column) => (
                  <TableCell
                    key={column.id}
                    align={column.align}
                    sx={{ fontWeight: 700, minWidth: column.minWidth }}
                  >
                      <TableSortLabel active={effectiveSortColumn===column.id} direction={effectiveSortColumn===column.id?sortDirection:'asc'} hideSortIcon={column.sortable===false} disabled={column.sortable===false} onClick={()=>changeSort(column)}>
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
          </TableContainer>
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
        </Paper>
      )}
    </Stack>
  )
}
