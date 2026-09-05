import AddTaskOutlinedIcon from "@mui/icons-material/AddTaskOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { StandardDataTable } from "../../components/StandardDataTable";
import { useAuth } from "../../hooks/useAuth";
import { usePageTitle } from "../../hooks/usePageTitle";
import { supabase } from "../../lib/supabase";
import { userError } from "../../utils/userError";
import { runWithMutationAttempt } from "../../utils/mutationAttemptRunner";

type WorkStatus = "ready" | "doing" | "review" | "blocked" | "done";
type Item = {
  work_key: string;
  title: string;
  category: string;
  status: WorkStatus;
  progress: number;
  risk: string;
  detail: string | null;
  production_status: string;
  owner: string | null;
  evidence: string | null;
  current_step: string | null;
  heartbeat_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};
type Event = {
  id: number;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  old_progress: number | null;
  new_progress: number | null;
  note: string | null;
  created_at: string;
};
type View = "active" | WorkStatus | "all";

const categories = [
  ["operations", "งานทั่วไป"],
  ["automation", "ระบบอัตโนมัติ"],
  ["line", "LINE / Telegram"],
  ["report", "หน้าจอ / รายงาน"],
  ["audit", "ตรวจสอบ"],
  ["tenant", "หลายบริษัท"],
];
const risks = [
  ["low", "ต่ำ"],
  ["medium", "กลาง"],
  ["high", "สูง"],
  ["critical", "วิกฤต"],
];
const statusLabel: Record<WorkStatus, string> = {
  ready: "พร้อมทำ",
  doing: "กำลังทำ",
  review: "รอตรวจ/อนุมัติ",
  blocked: "ติดปัญหา",
  done: "เสร็จแล้ว",
};
const statusColor: Record<
  WorkStatus,
  "info" | "warning" | "secondary" | "error" | "success"
> = {
  ready: "info",
  doing: "warning",
  review: "secondary",
  blocked: "error",
  done: "success",
};
const productionLabel = (value: string) => {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("not_deploy") || normalized.includes("undeployed"))
    return "ยังไม่ขึ้นระบบ";
  if (normalized.includes("pending") || normalized.includes("awaiting"))
    return "รอตรวจหรืออนุมัติ";
  if (
    normalized.includes("smoke_passed") ||
    normalized.includes("deployed_and") ||
    normalized.includes("deployed_cron")
  )
    return "ขึ้นระบบและตรวจผ่าน";
  if (normalized.includes("deployed") || normalized === "production")
    return "ขึ้นระบบแล้ว";
  if (normalized.includes("implementation")) return "กำลังพัฒนา";
  return value || "ยังไม่ระบุ";
};
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("th-TH") : "-";
const hasExpiredLease = (item: Item) =>
  item.status === "doing" &&
  Boolean(item.lease_expires_at) &&
  new Date(item.lease_expires_at as string).getTime() <= Date.now();

export function WorkCommandCenterPage() {
  usePageTitle("ศูนย์สั่งงาน");
  const { currentCompany, profile, user } = useAuth();
  const [rows, setRows] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("active"),
    [createOpen, setCreateOpen] = useState(false),
    [selected, setSelected] = useState<Item | null>(null),
    [events, setEvents] = useState<Event[]>([]);
  const [title, setTitle] = useState(""),
    [detail, setDetail] = useState(""),
    [category, setCategory] = useState("operations"),
    [risk, setRisk] = useState("medium");

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    const { data, error } = await supabase
      .from("system_work_items")
      .select(
        "work_key,title,category,status,progress,risk,detail,production_status,owner,evidence,current_step,heartbeat_at,lease_expires_at,created_at,updated_at",
      )
      .order("updated_at", { ascending: false });
    if (data) {
      const next = data as Item[];
      setRows((current) => {
        const unchanged =
          current.length === next.length &&
          current.every(
            (item, index) =>
              item.work_key === next[index]?.work_key &&
              item.status === next[index]?.status &&
              item.progress === next[index]?.progress &&
              item.production_status === next[index]?.production_status &&
              item.updated_at === next[index]?.updated_at,
          );
        return unchanged ? current : next;
      });
      setSelected((current) =>
        current
          ? next.find((item) => item.work_key === current.work_key) ?? null
          : null,
      );
    }
    if (error) setNotice(userError(error));
    if (!silent) setBusy(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    let refreshTimer: number | undefined;
    const refreshFromRealtime = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load(true), 200);
    };
    const channel = supabase
      .channel("work-command-center-system-work-items")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "system_work_items",
        },
        refreshFromRealtime,
      )
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [load]);
  const openDetail = async (item: Item) => {
    setSelected(item);
    setEvents([]);
    const { data, error } = await supabase
      .from("system_work_item_events")
      .select(
        "id,event_type,old_status,new_status,old_progress,new_progress,note,created_at",
      )
      .eq("work_key", item.work_key)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setEvents(data as Event[]);
    if (error) setNotice(userError(error));
  };
  const create = async () => {
    if (title.trim().length < 3) {
      setNotice("กรุณาระบุหัวข้องานอย่างน้อย 3 ตัวอักษร");
      return;
    }
    if (!currentCompany?.company_id) {
      setNotice("กรุณาเลือกบริษัทก่อนสร้างงาน เพื่อป้องกันข้อมูลข้ามบริษัท");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const data = await runWithMutationAttempt({
        module: "WorkCommandCenter",
        action: "สร้างงานใหม่จากศูนย์สั่งงาน",
        actorProfileId: user?.id || profile?.id,
        companyId: currentCompany.company_id,
        request: {
          target_title: title.trim(),
          target_detail: detail.trim() || null,
          target_category: category,
          target_risk: risk,
          target_company_id: currentCompany.company_id,
        },
        operation: async () =>
          await supabase.rpc("create_system_work_item", {
            target_title: title.trim(),
            target_detail: detail.trim() || null,
            target_category: category,
            target_risk: risk,
            target_company_id: currentCompany.company_id,
          }),
      })
      const item = Array.isArray(data) ? data[0] : data;
      setNotice(`สร้างงาน ${item?.work_key ?? ""} เรียบร้อยแล้ว`);
      setTitle("");
      setDetail("");
      setCreateOpen(false);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : userError(error));
    }
    setBusy(false);
  };
  const decide = async (approved: boolean) => {
    if (!selected) return;
    const reason = window
      .prompt(
        `${approved ? "อนุมัติ" : "ไม่อนุมัติ"} ${selected.work_key}\nกรุณาระบุเหตุผลเพื่อบันทึก Audit`,
      )
      ?.trim();
    if (!reason) return;
    setBusy(true);
    setNotice("");
    const changes = approved
      ? {
          status: "ready" as WorkStatus,
          evidence: `อนุมัติให้ดำเนินการผ่านศูนย์สั่งงาน: ${reason}`,
          current_step: "ได้รับอนุมัติ รอเริ่มดำเนินการ",
          production_status: "approved_for_execution",
        }
      : {
          status: "blocked" as WorkStatus,
          evidence: `ไม่อนุมัติผ่านศูนย์สั่งงาน: ${reason}`,
          current_step: "ไม่ผ่านการอนุมัติ",
          production_status: "rejected_by_admin",
        };
    try {
      const data = await runWithMutationAttempt({
        module: "WorkCommandCenter",
        action: `${approved ? "อนุมัติ" : "ไม่อนุมัติ"}งานจากศูนย์สั่งงาน`,
        actorProfileId: user?.id || profile?.id,
        companyId: currentCompany?.company_id ?? null,
        request: { work_key: selected.work_key, approved, reason },
        operation: async () =>
          await supabase
            .from("system_work_items")
            .update(changes)
            .eq("work_key", selected.work_key)
            .eq("status", "review")
            .select(
              "work_key,title,category,status,progress,risk,detail,production_status,owner,evidence,current_step,heartbeat_at,lease_expires_at,created_at,updated_at",
            )
            .single(),
      }) as Item | null;
      setNotice(
        `${approved ? "อนุมัติ" : "ไม่อนุมัติ"} ${selected.work_key} และบันทึก Audit แล้ว`,
      );
      await load();
      await openDetail(data as Item);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : userError(error));
    }
    setBusy(false);
  };
  const counts = useMemo(
    () => ({
      ready: rows.filter((r) => r.status === "ready").length,
      doing: rows.filter((r) => r.status === "doing").length,
      review: rows.filter((r) => r.status === "review").length,
      blocked: rows.filter((r) => r.status === "blocked").length,
      done: rows.filter((r) => r.status === "done").length,
    }),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      view === "all"
        ? rows
        : view === "active"
          ? rows.filter((row) => row.status !== "done")
          : rows.filter((row) => row.status === view),
    [rows, view],
  );
  const cards: [WorkStatus, string][] = [
    ["ready", "ต้องดำเนินการ"],
    ["doing", "กำลังทำ"],
    ["review", "รอตรวจ/อนุมัติ"],
    ["blocked", "ติดปัญหา"],
  ];

  return (
    <Stack spacing={2.5}>
      <PageHeader
        title="ศูนย์สั่งงาน"
        description="สร้างคำสั่ง ลงมือทำ อนุมัติ และติดตามหลักฐานจากคิวกลางเดียวกัน"
        action={
          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<RefreshOutlinedIcon />}
              onClick={() => void load()}
              disabled={busy}
            >
              รีเฟรช
            </Button>
            <Button
              variant="contained"
              startIcon={<AddTaskOutlinedIcon />}
              onClick={() => setCreateOpen(true)}
            >
              สร้างงาน
            </Button>
          </Stack>
        }
      />
      {notice && (
        <Alert
          severity={notice.includes("เรียบร้อย") ? "success" : "error"}
          onClose={() => setNotice("")}
        >
          {notice}
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", lg: "repeat(4,1fr)" },
          gap: 1.5,
        }}
      >
        {cards.map(([status, label]) => (
          <Paper
            key={status}
            variant="outlined"
            onClick={() => setView(status)}
            sx={{
              p: 2,
              cursor: "pointer",
              borderColor:
                view === status ? `${statusColor[status]}.main` : "divider",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="h4" sx={{ mt: 0.5 }}>
              {counts[status]}
            </Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined">
        <Tabs
          value={view}
          onChange={(_e, value: View) => setView(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            value="active"
            label={`งานที่ต้องลงมือ (${rows.length - counts.done})`}
          />
          <Tab value="ready" label={`พร้อมทำ (${counts.ready})`} />
          <Tab value="doing" label={`กำลังทำ (${counts.doing})`} />
          <Tab value="review" label={`รอตรวจ (${counts.review})`} />
          <Tab value="blocked" label={`ติดปัญหา (${counts.blocked})`} />
          <Tab value="done" label={`เสร็จแล้ว (${counts.done})`} />
          <Tab value="all" label={`ทั้งหมด (${rows.length})`} />
        </Tabs>
      </Paper>
      <StandardDataTable
        rows={visibleRows}
        getRowId={(r) => r.work_key}
        onRowClick={(r) => void openDetail(r)}
        getSearchText={(r) =>
          `${r.work_key} ${r.title} ${r.detail ?? ""} ${r.owner ?? ""} ${r.status}`
        }
        searchLabel="ค้นหาเลขงาน งาน ผู้รับผิดชอบ หรือสถานะ"
        emptyText={busy ? "กำลังโหลด..." : "ไม่มีงานในสถานะนี้"}
        exportFileName="system-work-items"
        minWidth={900}
        columns={[
          {
            id: "key",
            label: "เลขงาน",
            render: (r) => r.work_key,
            exportValue: (r) => r.work_key,
          },
          {
            id: "title",
            label: "งาน / ขั้นตอนล่าสุด",
            minWidth: 300,
            render: (r) => (
              <Box>
                <Typography sx={{ fontWeight: 700 }}>{r.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {r.current_step || r.detail || "ยังไม่ระบุขั้นตอนถัดไป"}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={r.progress}
                  color={
                    r.status === "blocked"
                      ? "error"
                      : r.status === "done"
                        ? "success"
                        : "primary"
                  }
                  sx={{ mt: 1, height: 5, borderRadius: 5 }}
                />
              </Box>
            ),
            exportValue: (r) => r.title,
          },
          {
            id: "owner",
            label: "ผู้รับผิดชอบ",
            render: (r) => r.owner || "ยังไม่มอบหมาย",
            exportValue: (r) => r.owner || "",
          },
          {
            id: "status",
            label: "สถานะ",
            render: (r) => (
              <Chip
                size="small"
                color={hasExpiredLease(r) ? "error" : statusColor[r.status]}
                label={hasExpiredLease(r) ? "Worker ขาดการติดต่อ" : statusLabel[r.status]}
              />
            ),
            exportValue: (r) => statusLabel[r.status],
          },
          {
            id: "progress",
            label: "ความก้าวหน้า",
            render: (r) => `${r.progress}%`,
            exportValue: (r) => r.progress,
          },
          {
            id: "risk",
            label: "ความเสี่ยง",
            render: (r) =>
              risks.find(([value]) => value === r.risk)?.[1] ?? r.risk,
            exportValue: (r) => r.risk,
          },
          {
            id: "production",
            label: "Production",
            minWidth: 170,
            render: (r) => productionLabel(r.production_status),
            exportValue: (r) => productionLabel(r.production_status),
          },
          {
            id: "updated",
            label: "อัปเดตล่าสุด",
            minWidth: 150,
            render: (r) => formatDate(r.updated_at),
            exportValue: (r) => formatDate(r.updated_at),
          },
        ]}
      />

      <Drawer
        anchor="right"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 }, p: 3 } } }}
      >
        <Stack spacing={2}>
          <Stack
            direction="row"
            sx={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <Box>
              <Typography variant="overline">คำสั่งใหม่</Typography>
              <Typography variant="h5">
                สร้างงานสำหรับ{" "}
                {currentCompany?.company_name ?? "บริษัทที่เลือก"}
              </Typography>
            </Box>
            <IconButton onClick={() => setCreateOpen(false)}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          <Alert severity="info">
            งานจะผูกกับบริษัทที่กำลังใช้งาน เพื่อรักษาการแยกข้อมูลและสิทธิ์
          </Alert>
          <TextField
            label="หัวข้องาน"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            fullWidth
          />
          <TextField
            label="รายละเอียด ผลลัพธ์ที่ต้องการ และหลักฐานตรวจรับ"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            fullWidth
            multiline
            minRows={5}
          />
          <TextField
            select
            label="ประเภท"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="ความสำคัญ / ความเสี่ยง"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
          >
            {risks.map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            size="large"
            startIcon={<AddTaskOutlinedIcon />}
            onClick={() => void create()}
            disabled={
              busy || title.trim().length < 3 || !currentCompany?.company_id
            }
          >
            เพิ่มเข้าคิวงาน
          </Button>
          {!currentCompany?.company_id && (
            <Alert severity="warning">
              ยังสร้างไม่ได้: กรุณาเลือกบริษัทก่อน
            </Alert>
          )}
        </Stack>
      </Drawer>

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 580 }, p: 3 } } }}
      >
        {selected && (
          <Stack spacing={2}>
            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
              <Box>
                <Typography variant="overline">{selected.work_key}</Typography>
                <Typography variant="h5">{selected.title}</Typography>
              </Box>
              <IconButton onClick={() => setSelected(null)}>
                <CloseRoundedIcon />
              </IconButton>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Chip
                color={statusColor[selected.status]}
                label={statusLabel[selected.status]}
              />
              <Chip
                variant="outlined"
                label={`ความก้าวหน้า ${selected.progress}%`}
              />
              <Chip
                variant="outlined"
                label={`ความเสี่ยง ${risks.find(([value]) => value === selected.risk)?.[1] ?? selected.risk}`}
              />
            </Stack>
            <LinearProgress
              variant="determinate"
              value={selected.progress}
              sx={{ height: 8, borderRadius: 8 }}
            />
            <Box>
              <Typography variant="subtitle2">ขั้นตอนล่าสุด</Typography>
              <Typography>
                {selected.current_step || selected.detail || "ยังไม่ระบุ"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2">ผู้รับผิดชอบ</Typography>
              <Typography>{selected.owner || "ยังไม่มอบหมาย"}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2">Production</Typography>
              <Typography>
                {productionLabel(selected.production_status)}
              </Typography>
            </Box>
            {selected.heartbeat_at && (
              <Alert severity={hasExpiredLease(selected) ? "error" : "info"}>
                {hasExpiredLease(selected)
                  ? "Worker ขาดการติดต่อ — lease หมดอายุแล้ว"
                  : "Worker กำลังทำงาน"}
                {` · heartbeat ล่าสุด ${formatDate(selected.heartbeat_at)}`}
                {selected.lease_expires_at &&
                  ` · lease ถึง ${formatDate(selected.lease_expires_at)}`}
              </Alert>
            )}
            {selected.evidence && (
              <Box>
                <Typography variant="subtitle2">หลักฐานล่าสุด</Typography>
                <Paper
                  variant="outlined"
                  sx={{ p: 1.5, whiteSpace: "pre-wrap" }}
                >
                  {selected.evidence}
                </Paper>
              </Box>
            )}
            {selected.status === "review" && (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="contained"
                  color="success"
                  disabled={busy}
                  onClick={() => void decide(true)}
                >
                  อนุมัติให้ดำเนินการ
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  ไม่อนุมัติ
                </Button>
              </Stack>
            )}
            <Divider />
            <Typography variant="h6">Timeline และ Audit</Typography>
            {events.length === 0 ? (
              <Alert severity="info">ยังไม่มีประวัติการเปลี่ยนแปลง</Alert>
            ) : (
              events.map((event) => (
                <Box
                  key={event.id}
                  sx={{
                    pl: 2,
                    borderLeft: "3px solid",
                    borderColor: "divider",
                  }}
                >
                  <Typography sx={{ fontWeight: 700 }}>
                    {event.event_type === "created" ? "สร้างงาน" : "อัปเดตงาน"}{" "}
                    · {formatDate(event.created_at)}
                  </Typography>
                  <Typography variant="body2">
                    {event.old_status && event.new_status
                      ? `${statusLabel[event.old_status as WorkStatus] ?? event.old_status} → ${statusLabel[event.new_status as WorkStatus] ?? event.new_status}`
                      : ""}{" "}
                    {event.new_progress != null
                      ? `· ${event.new_progress}%`
                      : ""}
                  </Typography>
                  {event.note && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ whiteSpace: "pre-wrap" }}
                    >
                      {event.note}
                    </Typography>
                  )}
                </Box>
              ))
            )}
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

