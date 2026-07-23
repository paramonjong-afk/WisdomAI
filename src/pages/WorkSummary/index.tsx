import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import type { LineMessageSource, MessageProjectMapping, ReviewStatus, WorkCategory, WorkProject, WorkSummaryItem } from '../../types/work-summary'

const categoryLabels: Record<WorkCategory, string> = {
  completed: 'งานเสร็จ', in_progress: 'กำลังดำเนินการ', planned: 'แผนถัดไป', issue: 'ปัญหา',
  risk: 'ความเสี่ยง', material: 'วัสดุ', safety: 'ความปลอดภัย', general: 'ข้อมูลทั่วไป',
}
const statusLabels: Record<ReviewStatus, string> = { pending: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', dismissed: 'ไม่นำมาใช้' }
const categoryColors: Partial<Record<WorkCategory, 'success' | 'warning' | 'error' | 'info' | 'primary'>> = {
  completed: 'success', in_progress: 'primary', planned: 'info', issue: 'error', risk: 'warning', safety: 'warning',
}

export function WorkSummaryPage() {
  usePageTitle('สรุปงาน LINE')
  const { profile, user } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [items, setItems] = useState<WorkSummaryItem[]>([])
  const [projects, setProjects] = useState<WorkProject[]>([])
  const [messages, setMessages] = useState<LineMessageSource[]>([])
  const [mappings, setMappings] = useState<MessageProjectMapping[]>([])
  const [selectedProjects, setSelectedProjects] = useState<Record<string, string>>({})
  const [dateFilter, setDateFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [summaryResult, projectResult] = await Promise.all([
      supabase.from('work_summary_items')
        .select('id, source_message_id, work_date, category, summary_text, assignee_text, status, project_id')
        .order('work_date', { ascending: false }).limit(500),
      supabase.from('projects').select('id, name, code').eq('status', 'active').order('name'),
    ])
    const initialError = summaryResult.error ?? projectResult.error
    if (initialError) { setError(initialError.message); setLoading(false); return }
    const summaryItems = (summaryResult.data ?? []) as WorkSummaryItem[]
    const messageIds = summaryItems.map((item) => item.source_message_id)
    let sourceMessages: LineMessageSource[] = []
    let projectMappings: MessageProjectMapping[] = []
    if (messageIds.length > 0) {
      const [messageResult, mappingResult] = await Promise.all([
        supabase.from('line_messages')
          .select('id, occurred_at, line_group_id, line_user_id, line_senders(display_name), line_groups(display_name)')
          .in('id', messageIds),
        supabase.from('line_message_projects')
          .select('message_id, project_id, assignment_source, projects(name, code)').in('message_id', messageIds),
      ])
      const relatedError = messageResult.error ?? mappingResult.error
      if (relatedError) { setError(relatedError.message); setLoading(false); return }
      sourceMessages = (messageResult.data ?? []) as unknown as LineMessageSource[]
      projectMappings = (mappingResult.data ?? []) as unknown as MessageProjectMapping[]
    }
    setItems(summaryItems)
    setProjects((projectResult.data ?? []) as WorkProject[])
    setMessages(sourceMessages)
    setMappings(projectMappings)
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
  const mappingsByMessage = useMemo(() => {
    const result = new Map<string, MessageProjectMapping[]>()
    for (const mapping of mappings) result.set(mapping.message_id, [...(result.get(mapping.message_id) ?? []), mapping])
    return result
  }, [mappings])
  const filteredItems = useMemo(() => items.filter((item) => {
    const itemMappings = mappingsByMessage.get(item.source_message_id) ?? []
    return (!dateFilter || item.work_date === dateFilter)
      && (!projectFilter || itemMappings.some((mapping) => mapping.project_id === projectFilter))
      && (!categoryFilter || item.category === categoryFilter)
      && (!statusFilter || item.status === statusFilter)
  }), [categoryFilter, dateFilter, items, mappingsByMessage, projectFilter, statusFilter])
  const counts = useMemo(() => filteredItems.reduce<Record<string, number>>((result, item) => {
    result[item.category] = (result[item.category] ?? 0) + 1
    return result
  }, {}), [filteredItems])
  const unclassifiedCount = filteredItems.filter((item) => !(mappingsByMessage.get(item.source_message_id)?.length)).length

  const review = async (id: string, status: ReviewStatus) => {
    if (!user) return
    setError(null)
    const { error: updateError } = await supabase.from('work_summary_items').update({
      status, reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (updateError) setError(updateError.message)
    else setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item))
  }
  const assignProject = async (messageId: string) => {
    if (!user) return
    const projectId = selectedProjects[messageId]
    if (!projectId) return
    setError(null)
    const { error: insertError } = await supabase.from('line_message_projects').insert({
      message_id: messageId, project_id: projectId, assignment_source: 'manual', assigned_by: user.id,
    })
    if (insertError) setError(insertError.message)
    else {
      const project = projects.find((item) => item.id === projectId)
      setMappings((current) => [...current, {
        message_id: messageId, project_id: projectId, assignment_source: 'manual',
        projects: project ? { name: project.name, code: project.code } : null,
      }])
      setSelectedProjects((current) => ({ ...current, [messageId]: '' }))
    }
  }
  const removeProject = async (messageId: string, projectId: string) => {
    setError(null)
    const { error: deleteError } = await supabase.from('line_message_projects').delete().eq('message_id', messageId).eq('project_id', projectId)
    if (deleteError) setError(deleteError.message)
    else setMappings((current) => current.filter((item) => item.message_id !== messageId || item.project_id !== projectId))
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="สรุปงานจาก LINE" description="ติดตามงาน แยกตามโครงการ ตรวจสอบปัญหา และย้อนดูแหล่งข้อมูล" action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>} />
      {error && <Alert severity="error">ไม่สามารถโหลดหรือบันทึกข้อมูลได้: {error}</Alert>}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField label="วันที่" type="date" size="small" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Select size="small" displayEmpty value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} sx={{ minWidth: 190 }}>
            <MenuItem value="">ทุกโครงการ</MenuItem>{projects.map((project) => <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>)}
          </Select>
          <Select size="small" displayEmpty value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">ทุกหมวดหมู่</MenuItem>{(Object.entries(categoryLabels) as [WorkCategory, string][]).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>
          <Select size="small" displayEmpty value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">ทุกสถานะ</MenuItem>{(Object.entries(statusLabels) as [ReviewStatus, string][]).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>
          <Button color="inherit" onClick={() => { setDateFilter(''); setProjectFilter(''); setCategoryFilter(''); setStatusFilter('') }}>ล้างตัวกรอง</Button>
        </Stack>
      </Paper>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', xl: 'repeat(6, 1fr)' }, gap: 2 }}>
        {([
          ['รายงานทั้งหมด', filteredItems.length, 'primary'], ['งานเสร็จ', counts.completed ?? 0, 'success'],
          ['กำลังดำเนินการ', counts.in_progress ?? 0, 'primary'], ['ปัญหา/ความเสี่ยง', (counts.issue ?? 0) + (counts.risk ?? 0) + (counts.safety ?? 0), 'warning'],
          ['แผนถัดไป', counts.planned ?? 0, 'info'], ['รอระบุโครงการ', unclassifiedCount, 'warning'],
        ] as const).map(([label, value, color]) => (
          <Paper key={label} variant="outlined" sx={{ p: 2, borderTop: 3, borderTopColor: `${color}.main` }}>
            <Typography color="text.secondary" variant="body2">{label}</Typography><Typography variant="h4" sx={{ fontWeight: 800 }}>{value}</Typography>
          </Paper>
        ))}
      </Box>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box> : (
        <StandardDataTable
          rows={filteredItems}
          getRowId={(item) => item.id}
          getSearchText={(item) => {
            const source = messagesById.get(item.source_message_id)
            const itemMappings = mappingsByMessage.get(item.source_message_id) ?? []
            return [
              item.summary_text, item.assignee_text, categoryLabels[item.category], statusLabels[item.status],
              source?.line_senders?.display_name, source?.line_groups?.display_name,
              ...itemMappings.map((mapping) => mapping.projects?.name),
            ].filter(Boolean).join(' ')
          }}
          searchLabel="ค้นหางาน ผู้รายงาน โครงการ หรือข้อความ"
          emptyText={items.length === 0 ? 'ยังไม่มีข้อมูลจาก LINE กรุณาส่งข้อความทดสอบแล้วกดรีเฟรช' : 'ไม่พบข้อมูลที่ตรงกับตัวกรอง'}
          exportFileName="wisdomai-line-work-summary"
          minWidth={1400}
          columns={[
            { id: 'date', label: 'วันที่', minWidth: 110, render: (item) => item.work_date, exportValue: (item) => item.work_date },
            {
              id: 'category', label: 'หมวดหมู่', minWidth: 130,
              render: (item) => <Chip size="small" color={categoryColors[item.category] ?? 'default'} label={categoryLabels[item.category]} />,
              exportValue: (item) => categoryLabels[item.category],
            },
            {
              id: 'summary', label: 'รายละเอียดงาน', minWidth: 320,
              render: (item) => <Typography sx={{ whiteSpace: 'pre-wrap' }}>{item.summary_text}</Typography>,
              exportValue: (item) => item.summary_text,
            },
            {
              id: 'projects', label: 'โครงการ', minWidth: 290,
              render: (item) => {
                const itemMappings = mappingsByMessage.get(item.source_message_id) ?? []
                return <Stack spacing={1}>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                    {itemMappings.length === 0 && <Chip size="small" color="warning" label="รอระบุโครงการ" />}
                    {itemMappings.map((mapping) => <Chip
                      key={mapping.project_id}
                      size="small"
                      variant="outlined"
                      label={`${mapping.projects?.code ? `${mapping.projects.code} · ` : ''}${mapping.projects?.name ?? mapping.project_id}`}
                      onDelete={canManage ? () => void removeProject(item.source_message_id, mapping.project_id) : undefined}
                    />)}
                  </Stack>
                  {canManage && <Stack direction="row" spacing={0.5}>
                    <Select
                      size="small"
                      displayEmpty
                      value={selectedProjects[item.source_message_id] ?? ''}
                      onChange={(event) => setSelectedProjects((current) => ({ ...current, [item.source_message_id]: event.target.value }))}
                      sx={{ minWidth: 180 }}
                    >
                      <MenuItem value="">เพิ่มโครงการ...</MenuItem>
                      {projects.filter((project) => !itemMappings.some((mapping) => mapping.project_id === project.id)).map((project) => (
                        <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>
                      ))}
                    </Select>
                    <Button size="small" variant="outlined" disabled={!selectedProjects[item.source_message_id]} onClick={() => void assignProject(item.source_message_id)}>เพิ่ม</Button>
                  </Stack>}
                </Stack>
              },
              exportValue: (item) => (mappingsByMessage.get(item.source_message_id) ?? []).map((mapping) => mapping.projects?.name).filter(Boolean).join(', '),
            },
            {
              id: 'source', label: 'ผู้รายงาน/กลุ่ม LINE', minWidth: 210,
              render: (item) => {
                const source = messagesById.get(item.source_message_id)
                return `${source?.line_senders?.display_name || source?.line_user_id || 'ไม่ทราบผู้ส่ง'} · ${source?.line_groups?.display_name || (source?.line_group_id ? 'กลุ่ม LINE' : 'แชตส่วนตัว')}`
              },
              exportValue: (item) => {
                const source = messagesById.get(item.source_message_id)
                return `${source?.line_senders?.display_name || source?.line_user_id || 'ไม่ทราบผู้ส่ง'} · ${source?.line_groups?.display_name || (source?.line_group_id ? 'กลุ่ม LINE' : 'แชตส่วนตัว')}`
              },
            },
            {
              id: 'status', label: 'สถานะ', minWidth: 120,
              render: (item) => <Chip size="small" variant="outlined" label={statusLabels[item.status]} />,
              exportValue: (item) => statusLabels[item.status],
            },
            {
              id: 'actions', label: 'ดำเนินการ', minWidth: 190,
              render: (item) => canManage && item.status === 'pending' ? (
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" variant="contained" onClick={() => void review(item.id, 'confirmed')}>ยืนยัน</Button>
                  <Button size="small" color="inherit" onClick={() => void review(item.id, 'dismissed')}>ไม่นำมาใช้</Button>
                </Stack>
              ) : '-',
            },
          ]}
        />
      )}
    </Stack>
  )
}
