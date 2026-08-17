import { Box, Container } from '@mui/material'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { AppTelemetry } from '../components/AppTelemetry'

export function MainLayout() {
  return (
    <>
      <AppTelemetry />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        <Sidebar />
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <TopBar />
          <Container maxWidth="xl" sx={{ px:{xs:1.25,sm:3,lg:4}, pt:{xs:1.5,md:4}, pb:{xs:3,md:6} }}>
            <Outlet />
          </Container>
        </Box>
      </Box>
    </>
  )
}
