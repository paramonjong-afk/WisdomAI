import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography color="text.secondary">{description}</Typography>
      </Stack>
      {action}
    </Stack>
  )
}
