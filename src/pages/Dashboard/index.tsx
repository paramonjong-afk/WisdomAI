import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined'
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../components/PageHeader'

const metrics = [
  ['Active projects', '12', <AssignmentOutlinedIcon color="primary" />],
  ['Team members', '86', <GroupsOutlinedIcon color="primary" />],
  ['Open actions', '24', <PendingActionsOutlinedIcon color="primary" />],
  ['Schedule health', '94%', <TrendingUpOutlinedIcon color="primary" />],
]

export function DashboardPage() {
  usePageTitle('Dashboard')
  return (
    <Stack spacing={4}>
      <PageHeader title="Dashboard" description="A clear view of your construction operations." />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2 }}>
        {metrics.map(([label, value, icon]) => (
          <Paper key={label as string} variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h4" sx={{ fontWeight: 800, mt: 0.75 }}>{value}</Typography></Box>
              {icon}
            </Stack>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }} gutterBottom>Operations overview</Typography>
        <Typography color="text.secondary">Project progress, workforce activity, and cost controls will appear here as services are connected.</Typography>
      </Paper>
    </Stack>
  )
}
