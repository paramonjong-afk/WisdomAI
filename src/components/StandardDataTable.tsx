import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import {
  Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TextField,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type StandardTableColumn<Row> = {
  id: string
  label: string
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  render: (row: Row) => ReactNode
  exportValue?: (row: Row) => string | number | null | undefined
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
}

export function StandardDataTable<Row>({
  rows,
  columns,
  getRowId,
  getSearchText,
  searchLabel = 'ค้นหาข้อมูล',
  emptyText = 'ไม่พบข้อมูล',
  exportFileName = 'wisdomai-data',
  toolbar,
  initialRowsPerPage = 10,
  minWidth = 900,
}: StandardDataTableProps<Row>) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage)
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword || !getSearchText) return rows
    return rows.filter((row) => getSearchText(row).toLowerCase().includes(keyword))
  }, [getSearchText, rows, search])
  const visibleRows = filteredRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const exportCsv = () => {
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csvRows = [
      columns.map((column) => column.label),
      ...filteredRows.map((row) => columns.map((column) =>
        column.exportValue ? column.exportValue(row) ?? '' : '')),
    ]
    const csv = '\uFEFF' + csvRows
      .map((row) => row.map((value) => escapeCsv(String(value))).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${exportFileName}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
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
        </Stack>
      </Paper>
      {filteredRows.length === 0 ? (
        <Alert severity="info">{emptyText}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader sx={{ minWidth }}>
            <TableHead>
              <TableRow>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    align={column.align}
                    sx={{ fontWeight: 700, minWidth: column.minWidth }}
                  >
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={getRowId(row)} hover>
                  {columns.map((column) => (
                    <TableCell key={column.id} align={column.align}>
                      {column.render(row)}
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
            onPageChange={(_event, nextPage) => setPage(nextPage)}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value))
              setPage(0)
            }}
          />
        </TableContainer>
      )}
    </Stack>
  )
}
