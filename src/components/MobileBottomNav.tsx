import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

export type MobileNavKey = 'overview' | 'employees' | 'time-tracking' | 'approvals' | 'menu'

type NavTab = { key: MobileNavKey; label: string; icon: ReactNode; path: string }

const TABS: NavTab[] = [
  { key: 'overview', label: 'ภาพรวม', icon: <HomeRoundedIcon />, path: '/overview' },
  { key: 'employees', label: 'พนักงาน', icon: <GroupsRoundedIcon />, path: '/employees' },
  { key: 'time-tracking', label: 'ลงเวลา', icon: <TimerOutlinedIcon />, path: '/time-tracking' },
  { key: 'approvals', label: 'อนุมัติ', icon: <FactCheckRoundedIcon />, path: '/approvals' },
  { key: 'menu', label: 'เมนู', icon: <MenuRoundedIcon />, path: '/' },
]

/**
 * Mobile-only bottom tab bar for the "Wisdom Power" admin app shell.
 * Hidden at sm+ breakpoints, where the existing desktop Sidebar is used instead.
 *
 * Flow reference: docs/MOBILE_ADMIN_OVERVIEW_DASHBOARD_FLOW.md v1.0
 */
export function MobileBottomNav({ active }: { active: MobileNavKey }) {
  const navigate = useNavigate()

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        borderRadius: 0,
        display: { xs: 'block', sm: 'none' },
      }}
    >
      <BottomNavigation
        value={active}
        showLabels
        sx={{ height: 64 }}
        onChange={(_event, value: MobileNavKey) => {
          const tab = TABS.find((item) => item.key === value)
          if (tab) navigate(tab.path)
        }}
      >
        {TABS.map((tab) => (
          <BottomNavigationAction
            key={tab.key}
            value={tab.key}
            label={tab.label}
            icon={tab.icon}
            sx={{ minWidth: 0, px: 0.5, '&.Mui-selected': { color: 'primary.main' } }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
