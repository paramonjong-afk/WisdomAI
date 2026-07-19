import { createBrowserRouter } from 'react-router-dom'
import { MainLayout } from '../layouts/MainLayout'
import { LoginPage } from '../pages/Login'
import { DashboardPage } from '../pages/Dashboard'
import { EmployeePage } from '../pages/Employee'
import { ProjectPage } from '../pages/Project'
import { BOQPage } from '../pages/BOQ'
import { TimeTrackingPage } from '../pages/TimeTracking'
import { SolarPage } from '../pages/Solar'
import { SettingsPage } from '../pages/Settings'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'employees', element: <EmployeePage /> },
      { path: 'projects', element: <ProjectPage /> },
      { path: 'boq', element: <BOQPage /> },
      { path: 'time-tracking', element: <TimeTrackingPage /> },
      { path: 'solar', element: <SolarPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])
