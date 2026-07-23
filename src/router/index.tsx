import { createBrowserRouter } from 'react-router-dom'
import { MainLayout } from '../layouts/MainLayout'
import { LoginPage } from '../pages/Login'
import { DashboardPage } from '../pages/Dashboard'
import { EmployeePage } from '../pages/Employee'
import { ProjectPage } from '../pages/Project'
import { BOQPage } from '../pages/BOQ'
import { TimeTrackingPage } from '../pages/TimeTracking'
import { WorkSummaryPage } from '../pages/WorkSummary'
import { SolarPage } from '../pages/Solar'
import { SettingsPage } from '../pages/Settings'
import { MyProfilePage } from '../pages/MyProfile'
import { FinancialSummaryPage } from '../pages/FinancialSummary'
import { AccountingDocumentsPage } from '../pages/AccountingDocuments'
import { LineMonitorPage } from '../pages/LineMonitor'
import { ProtectedRoute } from './ProtectedRoute'
import { PublicOnlyRoute } from './PublicOnlyRoute'

export const router = createBrowserRouter([
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <MainLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'employees', element: <EmployeePage /> },
          { path: 'projects', element: <ProjectPage /> },
          { path: 'boq', element: <BOQPage /> },
          { path: 'time-tracking', element: <TimeTrackingPage /> },
          { path: 'work-summary', element: <WorkSummaryPage /> },
          { path: 'financial-summary', element: <FinancialSummaryPage /> },
          { path: 'accounting-documents', element: <AccountingDocumentsPage /> },
          { path: 'line-monitor', element: <LineMonitorPage /> },
          { path: 'solar', element: <SolarPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'my-profile', element: <MyProfilePage /> },
        ],
      },
    ],
  },
])
