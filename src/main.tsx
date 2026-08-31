import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { AuthProvider } from './contexts/AuthContext'
import { router } from './router'
import { appTheme } from './theme'
import { installChunkReloadRecovery } from './utils/lazyWithReload'
import { installReleaseFreshnessGuard } from './utils/releaseFreshness'
import { installRequestErrorCenterBridge } from './utils/request-center-bridge'

import './index.css'

installRequestErrorCenterBridge()
installChunkReloadRecovery()
installReleaseFreshnessGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
