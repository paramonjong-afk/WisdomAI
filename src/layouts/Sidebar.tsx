import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import EngineeringOutlinedIcon from '@mui/icons-material/EngineeringOutlined'
import FormatListBulletedOutlinedIcon from '@mui/icons-material/FormatListBulletedOutlined'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SolarPowerOutlinedIcon from '@mui/icons-material/SolarPowerOutlined'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined'
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined'
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import WorkHistoryOutlinedIcon from '@mui/icons-material/WorkHistoryOutlined'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined'
import { Avatar, Box, Divider, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography } from '@mui/material'
import { NavLink } from 'react-router-dom'
import { navigationGroups } from '../utils/navigation'
import { useAuth } from '../hooks/useAuth'
import { isPlatformAdmin as resolvePlatformAdmin } from '../utils/permissions'
import { useLocation } from 'react-router-dom'

export const sidebarWidth = 260

const navigationIcons:Record<string,React.ReactNode>={
  '/dashboard':<DashboardOutlinedIcon/>,'/employees':<GroupOutlinedIcon/>,
  '/projects':<EngineeringOutlinedIcon/>,'/boq':<FormatListBulletedOutlinedIcon/>,
  '/project-controls':<PaidOutlinedIcon/>,
  '/boq-compare':<RateReviewOutlinedIcon/>,
  '/drawing-ai':<AutoAwesomeOutlinedIcon/>,'/time-tracking':<TimerOutlinedIcon/>,
  '/workforce':<WorkHistoryOutlinedIcon/>,'/workforce-setup':<SettingsOutlinedIcon/>,
  '/contractors':<PaidOutlinedIcon/>,'/image-review':<RateReviewOutlinedIcon/>,
  '/document-flows':<HubOutlinedIcon/>,
  '/wisdom-ai':<AutoAwesomeOutlinedIcon/>,
  '/approvals':<FactCheckOutlinedIcon/>,'/reports':<SummarizeOutlinedIcon/>,
  '/work-summary':<SummarizeOutlinedIcon/>,'/financial-summary':<PaidOutlinedIcon/>,
  '/accounting-documents':<ReceiptLongOutlinedIcon/>,'/line-monitor':<FactCheckOutlinedIcon/>,
  '/advance-settlements':<PaidOutlinedIcon/>,'/advance-holders':<AccountCircleOutlinedIcon/>,
  '/chat':<ChatBubbleOutlineOutlinedIcon/>,
  '/solar':<SolarPowerOutlinedIcon/>,'/my-profile':<AccountCircleOutlinedIcon/>,
  '/settings':<SettingsOutlinedIcon/>,
  '/admin-account-recovery':<LockResetOutlinedIcon/>,
  '/platform-control-center':<HubOutlinedIcon/>,
  '/mutation-attempt-center':<HistoryOutlinedIcon/>,
  '/flow-registry':<HubOutlinedIcon/>,
  '/system-inventory':<FactCheckOutlinedIcon/>,
}

function NavigationContent() {
  const {profile,currentCompany}=useAuth()
  const location=useLocation()
  const roleFromProfile=(profile?.role ?? 'employee') as 'admin' | 'manager' | 'employee'
  const companyRole=currentCompany?.company_role
  const canManager = roleFromProfile==='admin'||roleFromProfile==='manager'||['company_admin','executive','manager','site_supervisor'].includes(companyRole ?? '')
  const canAdmin = roleFromProfile==='admin'||companyRole==='company_admin'
  const role = roleFromProfile === 'admin' || canAdmin ? 'admin' : canManager ? 'manager' : roleFromProfile
  const isPlatformAdmin=resolvePlatformAdmin(profile)
  const roleLabel = role === 'admin' ? 'ผู้ดูแลระบบ' : role === 'manager' ? 'ผู้จัดการ' : 'พนักงาน'
  const displayName=profile?.full_name||profile?.email||'ผู้ใช้งาน'
  return (
    <Box sx={{ width:sidebarWidth,height:'100%',display:'flex',flexDirection:'column',bgcolor:'#333333',color:'common.white' }}>
      <Toolbar sx={{ px:3,minHeight:'64px!important' }}>
        <Typography variant="h6" sx={{ fontWeight:900,letterSpacing:'-0.5px' }}>
          Wisdom Power
        </Typography>
      </Toolbar>
      <Typography variant="overline" sx={{ px:3,color:'#FABFB2',letterSpacing:'.08em' }}>
        Construction platform
      </Typography>
      <List sx={{ px:1.5,pt:1,pb:3,flex:1,overflowY:'auto' }}>
        {navigationGroups.map((group)=>{
          const items=group.items.filter((item)=>(!item.roles||item.roles.includes(role))&&(!item.platformOnly||isPlatformAdmin))
          if(items.length===0)return null
          const active=items.some((item)=>location.pathname===item.path)
          return <Box component="details" key={group.label} open={active} sx={{
            mb:.5,'&[open] .group-arrow':{transform:'rotate(180deg)'},
          }}>
            <Box component="summary" sx={{
              px:1.5,py:1.1,color:'rgba(255,255,255,.62)',fontSize:11,fontWeight:800,
              textTransform:'uppercase',letterSpacing:'.055em',cursor:'pointer',
              listStyle:'none',display:'flex',alignItems:'center',justifyContent:'space-between',
              '&::-webkit-details-marker':{display:'none'},'&:hover':{color:'#FABFB2'},
            }}>{group.label}<KeyboardArrowDownRoundedIcon className="group-arrow" sx={{fontSize:17,transition:'transform .18s'}}/></Box>
            {items.map((item)=>(
          <ListItemButton
            component={NavLink}
            to={item.path}
            key={item.path}
            end={item.path === '/'}
            sx={{
              mb: 0.35,
              borderRadius:2.5,
              color:'rgba(255,255,255,.82)',
              minHeight:44,position:'relative',px:1.5,
              '&:hover':{bgcolor:'rgba(250,191,178,.10)',color:'common.white'},
              '&.active':{bgcolor:'rgba(166,89,64,.72)',color:'common.white'},
              '&.active:before':{content:'""',position:'absolute',left:0,top:8,bottom:8,width:3,borderRadius:2,bgcolor:'#FABFB2'},
            }}
          >
            <ListItemIcon sx={{ minWidth:38,color:'inherit','& svg':{fontSize:21} }}>{navigationIcons[item.path]}</ListItemIcon>
            <ListItemText primary={item.label} slotProps={{primary:{sx:{fontWeight:650,fontSize:14,lineHeight:1.35}}}} />
          </ListItemButton>
            ))}
          </Box>
        })}
      </List>
      <Box sx={{px:2,pb:2}}>
        <Divider sx={{borderColor:'rgba(255,255,255,.12)',mb:2}}/>
        <Box sx={{display:'flex',alignItems:'center',gap:1.25}}>
          <Avatar sx={{width:36,height:36,bgcolor:'#A65940',fontSize:13}}>{displayName.slice(0,2).toUpperCase()}</Avatar>
          <Box sx={{minWidth:0}}>
            <Typography variant="body2" noWrap sx={{fontWeight:800}}>{displayName}</Typography>
            <Typography variant="caption" sx={{color:'rgba(255,255,255,.58)'}}>{roleLabel}</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

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
          bgcolor: '#333333',
          color: 'common.white',
        }}
      >
        <NavigationContent />
      </Box>
    </Box>
  )
}
