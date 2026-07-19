import { CssBaseline, Box, Container, ThemeProvider, createTheme } from '@mui/material'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

const theme = createTheme({
  palette: { primary: { main: '#2563eb' }, background: { default: '#f5f7fb' } },
  shape: { borderRadius: 10 },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
})

export function MainLayout() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        <Sidebar />
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <TopBar />
          <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 } }}>
            <Outlet />
          </Container>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
