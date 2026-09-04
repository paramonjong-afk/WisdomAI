import { Box, Container } from '@mui/material'
import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { MobileSidebar, Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { AppTelemetry } from '../components/AppTelemetry'

export function MainLayout() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isLauncher = location.pathname === '/'
  return (
    <>
      <AppTelemetry />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        {!isLauncher && <><Sidebar /><MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} /></>}
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <TopBar onMenuOpen={() => setMobileMenuOpen(true)} />
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
