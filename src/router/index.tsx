import { Suspense } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import { MainLayout } from '../layouts/MainLayout'
import { ProtectedRoute } from './ProtectedRoute'
import { PublicOnlyRoute } from './PublicOnlyRoute'
import { RouteErrorPage } from './RouteErrorPage'
import { RoleRoute } from './RoleRoute'
import { lazyWithReload } from '../utils/lazyWithReload'

const LoginPage = lazyWithReload(() => import('../pages/Login').then((module) => ({ default: module.LoginPage })))
const DashboardPage = lazyWithReload(() => import('../pages/Dashboard').then((module) => ({ default: module.DashboardPage })))
const EmployeePage = lazyWithReload(() => import('../pages/Employee').then((module) => ({ default: module.EmployeePage })))
const ProjectPage = lazyWithReload(() => import('../pages/Project').then((module) => ({ default: module.ProjectPage })))
const ProjectControlsPage = lazyWithReload(() => import('../pages/ProjectControls').then((module) => ({ default: module.ProjectControlsPage })))
const BOQPage = lazyWithReload(() => import('../pages/BOQ').then((module) => ({ default: module.BOQPage })))
const BoqComparePage = lazyWithReload(() => import('../pages/BoqCompare').then((module) => ({ default: module.BoqComparePage })))
const TimeTrackingPage = lazyWithReload(() => import('../pages/TimeTracking').then((module) => ({ default: module.TimeTrackingPage })))
const WorkSummaryPage = lazyWithReload(() => import('../pages/WorkSummary').then((module) => ({ default: module.WorkSummaryPage })))
const SolarPage = lazyWithReload(() => import('../pages/Solar').then((module) => ({ default: module.SolarPage })))
const SettingsPage = lazyWithReload(() => import('../pages/Settings').then((module) => ({ default: module.SettingsPage })))
const MyProfilePage = lazyWithReload(() => import('../pages/MyProfile').then((module) => ({ default: module.MyProfilePage })))
const FinancialSummaryPage = lazyWithReload(() => import('../pages/FinancialSummary').then((module) => ({ default: module.FinancialSummaryPage })))
const AdvanceSettlementsPage = lazyWithReload(() => import('../pages/AdvanceSettlements').then((module) => ({ default: module.AdvanceSettlementsPage })))
const AdvanceHoldersPage = lazyWithReload(() => import('../pages/AdvanceHolders').then((module) => ({ default: module.AdvanceHoldersPage })))
const AccountingDocumentsPage = lazyWithReload(() => import('../pages/AccountingDocuments').then((module) => ({ default: module.AccountingDocumentsPage })))
const LineMonitorPage = lazyWithReload(() => import('../pages/LineMonitor').then((module) => ({ default: module.LineMonitorPage })))
const ChatPage = lazyWithReload(() => import('../pages/Chat').then((module) => ({ default: module.ChatPage })))
const DrawingAIPage = lazyWithReload(() => import('../pages/DrawingAI').then((module) => ({ default: module.DrawingAIPage })))
const WorkforcePage = lazyWithReload(() => import('../pages/Workforce').then((module) => ({ default: module.WorkforcePage })))
const WorkforceSetupPage = lazyWithReload(() => import('../pages/WorkforceSetup').then((module) => ({ default: module.WorkforceSetupPage })))
const ContractorsPage = lazyWithReload(() => import('../pages/Contractors').then((module) => ({ default: module.ContractorsPage })))
const ApprovalsPage = lazyWithReload(() => import('../pages/Approvals').then((module) => ({ default: module.ApprovalsPage })))
const NotificationsPage = lazyWithReload(() => import('../pages/Notifications').then((module) => ({ default: module.NotificationsPage })))
const ReportsPage = lazyWithReload(() => import('../pages/Reports').then((module) => ({ default: module.ReportsPage })))
const ImageReviewPage = lazyWithReload(() => import('../pages/ImageReview').then((module) => ({ default: module.ImageReviewPage })))
const ResetPasswordPage = lazyWithReload(() => import('../pages/ResetPassword').then((module) => ({ default: module.ResetPasswordPage })))
const SystemHealthPage = lazyWithReload(() => import('../pages/SystemHealth').then((module) => ({ default: module.SystemHealthPage })))
const WorkCommandCenterPage = lazyWithReload(() => import('../pages/WorkCommandCenter').then((module) => ({ default: module.WorkCommandCenterPage })))
const PlatformControlCenterPage = lazyWithReload(() => import('../pages/PlatformControlCenter').then((module) => ({ default: module.PlatformControlCenterPage })))
const WisdomAIControlPage = lazyWithReload(() => import('../pages/WisdomAIControl').then((module) => ({ default: module.WisdomAIControlPage })))
const MutationAttemptCenterPage = lazyWithReload(() => import('../pages/MutationAttemptCenter').then((module) => ({ default: module.MutationAttemptCenterPage })))
const LineAccountLinkPage = lazyWithReload(() => import('../pages/LineAccountLink').then((module) => ({ default: module.LineAccountLinkPage })))
const DocumentFlowsPage = lazyWithReload(() => import('../pages/DocumentFlows').then((module) => ({ default: module.DocumentFlowsPage })))
const FlowRegistryPage = lazyWithReload(() => import('../pages/FlowRegistry').then((module) => ({ default: module.FlowRegistryPage })))
const MasterDataCenterPage = lazyWithReload(() => import('../pages/MasterDataCenter').then((module) => ({ default: module.MasterDataCenterPage })))
const AppLauncherPage = lazyWithReload(() => import('../pages/AppLauncher').then((module) => ({ default: module.AppLauncherPage })))

const loading = (
  <Box sx={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
    <CircularProgress size={32} />
  </Box>
)

const deferred = (page: React.ReactNode) => <Suspense fallback={loading}>{page}</Suspense>
const managerOnly=(page:React.ReactNode)=>deferred(<RoleRoute access="manager">{page}</RoleRoute>)
const adminOnly=(page:React.ReactNode)=>deferred(<RoleRoute access="admin">{page}</RoleRoute>)
const platformOnly=(page:React.ReactNode)=>deferred(<RoleRoute access="platform">{page}</RoleRoute>)

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: '/reset-password', element: deferred(<ResetPasswordPage />),
      },
      {
        element: <PublicOnlyRoute />,
        children: [{ path: '/login', element: deferred(<LoginPage />) }],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: '/', element: <MainLayout />, children: [
              { index: true, element: deferred(<AppLauncherPage />) },
              { path: 'dashboard', element: managerOnly(<DashboardPage />) },
              { path: 'employees', element: managerOnly(<EmployeePage />) },
              { path: 'projects', element: managerOnly(<ProjectPage />) },
              { path: 'project-controls', element: managerOnly(<ProjectControlsPage />) },
              { path: 'boq', element: managerOnly(<BOQPage />) },
              { path: 'boq-compare', element: managerOnly(<BoqComparePage />) },
              { path: 'drawing-ai', element: managerOnly(<DrawingAIPage />) },
              { path: 'time-tracking', element: deferred(<TimeTrackingPage />) },
              { path: 'workforce', element: deferred(<WorkforcePage />) },
              { path: 'workforce-setup', element: managerOnly(<WorkforceSetupPage />) },
              { path: 'contractors', element: managerOnly(<ContractorsPage />) },
              { path: 'approvals', element: managerOnly(<ApprovalsPage />) },
              { path: 'notifications', element: deferred(<NotificationsPage />) },
              { path: 'reports', element: managerOnly(<ReportsPage />) },
              { path: 'image-review', element: managerOnly(<ImageReviewPage />) },
              { path: 'document-flows', element: managerOnly(<DocumentFlowsPage />) },
              { path: 'document-flows/intake-room', element: <Navigate to="/document-flows" replace /> },
              { path: 'document-flows/intake-room/filtered', element: <Navigate to="/document-flows" replace /> },
              { path: 'intake-room', element: <Navigate to="/document-flows" replace /> },
              { path: 'wisdom-ai', element: managerOnly(<WisdomAIControlPage />) },
              { path: 'work-summary', element: managerOnly(<WorkSummaryPage />) },
              { path: 'financial-summary', element: managerOnly(<FinancialSummaryPage />) },
              { path: 'advance-settlements', element: managerOnly(<AdvanceSettlementsPage />) },
              { path: 'advance-holders', element: managerOnly(<AdvanceHoldersPage />) },
              { path: 'master-data', element: managerOnly(<MasterDataCenterPage />) },
              { path: 'accounting-documents', element: managerOnly(<AccountingDocumentsPage />) },
              { path: 'line-monitor', element: managerOnly(<LineMonitorPage />) },
              { path: 'chat', element: deferred(<ChatPage />) },
              { path: 'solar', element: managerOnly(<SolarPage />) },
              { path: 'settings', element: adminOnly(<SettingsPage />) },
              { path: 'system-health', element: adminOnly(<SystemHealthPage />) },
              { path: 'flow-registry', element: adminOnly(<FlowRegistryPage />) },
              { path: 'work-command-center', element: adminOnly(<WorkCommandCenterPage />) },
              { path: 'platform-control-center', element: platformOnly(<PlatformControlCenterPage />) },
              { path: 'my-profile', element: deferred(<MyProfilePage />) },
              { path: 'line-link', element: deferred(<LineAccountLinkPage />) },
              { path: 'mutation-attempt-center', element: adminOnly(<MutationAttemptCenterPage />) },
            ],
          },
        ],
      },
    ],
  },
])
