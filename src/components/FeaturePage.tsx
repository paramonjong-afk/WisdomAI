import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined'
import { Paper, Stack, Typography } from '@mui/material'
import { usePageTitle } from '../hooks/usePageTitle'
import { PageHeader } from './PageHeader'

interface FeaturePageProps {
  title: string
  description: string
}

export function FeaturePage({ title, description }: FeaturePageProps) {
  usePageTitle(title)

  return (
    <Stack spacing={4}>
      <PageHeader title={title} description={description} />
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, textAlign: 'center' }}>
        <ConstructionOutlinedIcon color="primary" sx={{ fontSize: 44, mb: 1 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }} gutterBottom>
          {title} workspace
        </Typography>
        <Typography color="text.secondary">
          This module is ready for its domain workflows, data services, and role-based actions.
        </Typography>
      </Paper>
    </Stack>
  )
}
