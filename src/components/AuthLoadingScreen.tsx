import { Box, CircularProgress, Stack, Typography } from '@mui/material'

export function AuthLoadingScreen() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#f5f7fb' }}>
      <Stack spacing={2} sx={{ alignItems: 'center' }}>
        <CircularProgress />
        <Typography color="text.secondary">Checking your session...</Typography>
      </Stack>
    </Box>
  )
}
