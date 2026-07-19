import MenuIcon from '@mui/icons-material/Menu'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import { AppBar, Avatar, Badge, Box, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'

export function TopBar() {
  return (
    <AppBar position="sticky" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar>
        <IconButton edge="start" sx={{ display: { md: 'none' }, mr: 1 }} aria-label="Open navigation">
          <MenuIcon />
        </IconButton>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Construction Management Platform
        </Typography>
        <Tooltip title="Notifications">
          <IconButton aria-label="Notifications" sx={{ mr: 1 }}>
            <Badge color="error" variant="dot"><NotificationsNoneOutlinedIcon /></Badge>
          </IconButton>
        </Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>WA</Avatar>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>Wisdom Admin</Typography>
            <Typography variant="caption" color="text.secondary">Administrator</Typography>
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  )
}
