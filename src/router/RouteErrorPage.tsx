import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { clearChunkReloadMarker, isDynamicImportError } from '../utils/lazyWithReload'

export function RouteErrorPage() {
  const error = useRouteError()
  const chunkError = isDynamicImportError(error)
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'

  const reload = () => {
    clearChunkReloadMarker()
    window.location.reload()
  }

  return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
    <Paper variant="outlined" sx={{ width: '100%', maxWidth: 560, p: { xs: 2.5, sm: 4 } }}>
      <Stack spacing={2}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {chunkError ? 'มีเวอร์ชันใหม่ของระบบ' : 'ไม่สามารถเปิดหน้านี้ได้'}
        </Typography>
        <Alert severity={chunkError ? 'info' : 'error'}>
          {chunkError
            ? 'ไฟล์ของเวอร์ชันเดิมหมดอายุแล้ว กรุณาโหลดหน้าใหม่เพื่อใช้งานเวอร์ชันล่าสุด'
            : detail}
        </Alert>
        <Button variant="contained" size="large" startIcon={<RefreshOutlinedIcon />} onClick={reload}>
          โหลดระบบใหม่
        </Button>
      </Stack>
    </Paper>
  </Box>
}
