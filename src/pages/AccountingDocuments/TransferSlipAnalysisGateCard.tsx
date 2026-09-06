import { Alert, Chip, Paper, Stack, Typography } from '@mui/material'
import type { SlipAnalysisGate } from '../../services/transferSlipAnalysisGate'
import { moneyPurposeRoute } from '../../services/transferSlipMoneyLineage'

const stateLabel = {
  auto_routed: 'ผ่านครบ · ส่งต่ออัตโนมัติแล้ว',
  ready_to_confirm: 'ข้อมูลครบ · รอยืนยันครั้งสุดท้าย',
  needs_confirmation: 'ค้างเพราะมีข้อมูลต้องยืนยัน/แก้ไข',
} as const

export function TransferSlipAnalysisGateCard({ analysis }: { analysis: SlipAnalysisGate }) {
  const color = analysis.state === 'auto_routed' ? 'success' : analysis.state === 'ready_to_confirm' ? 'info' : 'warning'
  return <Paper variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: `${color}.main` }}>
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ fontWeight: 800, flex: 1 }}>Slip Analysis Gate</Typography>
        <Chip size="small" color={color} label={stateLabel[analysis.state]} />
      </Stack>
      <Typography variant="body2"><strong>ประเภทเงิน:</strong> {moneyPurposeRoute(analysis.purpose).label} · ความมั่นใจ {Math.round(analysis.confidence * 100)}%</Typography>
      <Typography variant="body2"><strong>เหตุผล:</strong> {analysis.reasons.join(' · ')}</Typography>
      <Typography variant="body2"><strong>เส้นทาง:</strong> {analysis.destination}</Typography>
      {analysis.blockers.length > 0 ? <Alert severity="warning"><Typography variant="body2" sx={{ fontWeight: 700 }}>รายการนี้ค้างเฉพาะจุดต่อไปนี้</Typography>{analysis.blockers.map(blocker => <Typography key={blocker} variant="body2">• {blocker}</Typography>)}</Alert> : <Alert severity={analysis.state === 'auto_routed' ? 'success' : 'info'}>{analysis.state === 'auto_routed' ? 'ทุก Gate ผ่านแล้ว ระบบใช้ Transaction เดิมส่งไปตามประเภทเงินโดยไม่สร้างซ้ำ' : 'ข้อมูลครบแล้ว กดยืนยันเพื่อบันทึก Audit และส่งต่ออัตโนมัติ'}</Alert>}
    </Stack>
  </Paper>
}
