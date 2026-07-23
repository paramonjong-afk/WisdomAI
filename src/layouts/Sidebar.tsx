import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import EngineeringOutlinedIcon from '@mui/icons-material/EngineeringOutlined'
import FormatListBulletedOutlinedIcon from '@mui/icons-material/FormatListBulletedOutlined'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SolarPowerOutlinedIcon from '@mui/icons-material/SolarPowerOutlined'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined'
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined'
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography } from '@mui/material'
import { NavLink } from 'react-router-dom'
import { navigationItems } from '../utils/navigation'

export const sidebarWidth = 260

const navigationIcons = [
  <DashboardOutlinedIcon />, <GroupOutlinedIcon />, <EngineeringOutlinedIcon />,
  <FormatListBulletedOutlinedIcon />, <TimerOutlinedIcon />, <SummarizeOutlinedIcon />, <PaidOutlinedIcon />, <ReceiptLongOutlinedIcon />, <FactCheckOutlinedIcon />, <SolarPowerOutlinedIcon />,
  <AccountCircleOutlinedIcon />, <SettingsOutlinedIcon />,
]

export function Sidebar() {
  return (
    <Box
      component="aside"
      sx={{ width: sidebarWidth, flexShrink: 0, display: { xs: 'none', md: 'block' } }}
    >
      <Box
        sx={{
          width: sidebarWidth,
          position: 'fixed',
          inset: 0,
          bgcolor: '#14213d',
          color: 'common.white',
        }}
      >
        <Toolbar sx={{ px: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.4px' }}>
            WisdomAI
          </Typography>
        </Toolbar>
        <Typography variant="overline" sx={{ px: 3, color: 'rgba(255,255,255,.55)' }}>
          Construction platform
        </Typography>
        <List sx={{ px: 1.5, pt: 1 }}>
          {navigationItems.map((item, index) => (
            <ListItemButton
              component={NavLink}
              to={item.path}
              key={item.path}
              end={item.path === '/'}
              sx={{
                mb: 0.5,
                borderRadius: 2,
                color: 'rgba(255,255,255,.75)',
                '&.active, &:hover': { bgcolor: 'rgba(255,255,255,.12)', color: 'common.white' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{navigationIcons[index]}</ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Box>
  )
}
