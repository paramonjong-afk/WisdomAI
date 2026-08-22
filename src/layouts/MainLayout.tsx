import { Box, Container } from '@mui/material'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { AppTelemetry } from '../components/AppTelemetry'

export function MainLayout() {
  const location = useLocation()
  const isLauncher = location.pathname === '/'
  return (
    <>
      <AppTelemetry />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        {!isLauncher && <Sidebar />}
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <TopBar />
          <Container
            maxWidth={false}
            sx={{
              width: '100%',
              px: { xs: 1.5, sm: 3, lg: 4 },
              pt: { xs: 1.5, md: 4 },
              pb: { xs: 3, md: 6 },
            }}
          >
            <Outlet />
          </Container>
        </Box>
      </Box>
    </>
  )
}
