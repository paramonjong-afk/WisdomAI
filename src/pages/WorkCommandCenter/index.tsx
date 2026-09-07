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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { StandardDataTable } from "../../components/StandardDataTable";
import { useAuth } from "../../hooks/useAuth";
import { usePageTitle } from "../../hooks/usePageTitle";
import { supabase } from "../../lib/supabase";
import { userError } from "../../utils/userError";
import { runWithMutationAttempt } from "../../utils/mutationAttemptRunner";
import { shouldApplyDetailResponse } from "./detailRequestGuard";

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
  worker_id: string | null;
  evidence: string | null;
  current_step: string | null;
  heartbeat_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  approval_status?: string | null;
  company_id?: string | null;
};
type WorkItemDetail = Pick<Item, "detail" | "evidence">;
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
type WorkerRun = {
  id: string;
  worker_id: string;
  status: "running" | "completed" | "failed" | "expired";
  current_step: string | null;
  progress: number;
  heartbeat_at: string | null;
  started_at: string;
  finished_at: string | null;
  evidence: string | null;
  error_fingerprint: string | null;
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
const hasStaleHeartbeat = (item: Item) => item.status === "doing" && (!item.heartbeat_at || Date.now() - new Date(item.heartbeat_at).getTime() > 10 * 60_000);
const leaseLabel = (value: string | null) => {
  if (!value) return "ยังไม่มี lease";
  const minutes = Math.ceil((new Date(value).getTime() - Date.now()) / 60_000);
  return minutes <= 0 ? "lease หมดอายุ" : `เหลือ ${minutes} นาที`;
};
type WorkerOutcome = "acknowledged" | "claimed" | "blocked" | "completed" | "no_output";
const workerOutcome = (item: Item): { value: WorkerOutcome; label: string; reason: string; nextAction: string } => {
  if (item.status === "done") return { value: "completed", label: "เสร็จแล้ว", reason: "งานปิดจากคิวกลางแล้ว", nextAction: "อ่านหลักฐานและ Audit ก่อนเริ่มงานใหม่" };
  if (item.status === "blocked") return { value: "blocked", label: "ติดปัญหา", reason: item.current_step || "มี blocker ที่ต้องตรวจ", nextAction: "เปิดรายละเอียดและแก้ blocker ตามหลักฐาน" };
  if (item.status === "ready") return { value: "acknowledged", label: "รับเข้าแล้ว รอ Worker", reason: "คำสั่งอยู่คิวกลาง แต่ยังไม่มี Worker ถือ lease", nextAction: "รอ Worker รับงานหรือเริ่มแบบระบุงาน" };
  if (!item.worker_id || hasExpiredLease(item) || hasStaleHeartbeat(item)) return { value: "no_output", label: "ไม่มีผลลัพธ์จาก Worker", reason: hasStaleHeartbeat(item) ? "heartbeat เกิน 10 นาที" : "ไม่มี Worker หรือ lease ที่ยังใช้งาน", nextAction: "ตรวจ worker run และ recovery ก่อนลองใหม่" };
  return { value: "claimed", label: "Worker กำลังทำงาน", reason: item.current_step || "Worker รับงานแล้ว", nextAction: "ติดตาม heartbeat และผลลัพธ์ในรายละเอียด" };
};
const workerOutcomeColor = (outcome: WorkerOutcome): "error" | "warning" | "success" | "info" =>
  outcome === "blocked" || outcome === "no_output" ? "error" : outcome === "claimed" ? "warning" : outcome === "completed" ? "success" : "info";

export function WorkCommandCenterPage() {
  usePageTitle("ศูนย์สั่งงาน");
  const { currentCompany, profile, user } = useAuth();
  const [rows, setRows] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequestId = useRef(0);
  const pendingRefreshRef = useRef(false);
  const [view, setView] = useState<View>("active"),
    [createOpen, setCreateOpen] = useState(false),
    [selected, setSelected] = useState<Item | null>(null),
    [events, setEvents] = useState<Event[]>([]);
  const [workerRuns, setWorkerRuns] = useState<WorkerRun[]>([]);
  const [title, setTitle] = useState(""),
    [detail, setDetail] = useState(""),
    [category, setCategory] = useState("operations"),
    [risk, setRisk] = useState("medium");

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    const { data, error } = await supabase
      .from("system_work_items")
      .select(
        "work_key,title,category,status,progress,risk,production_status,owner,worker_id,current_step,heartbeat_at,lease_expires_at,created_at,updated_at",
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
              item.worker_id === next[index]?.worker_id &&
              item.heartbeat_at === next[index]?.heartbeat_at &&
              item.lease_expires_at === next[index]?.lease_expires_at &&
              item.updated_at === next[index]?.updated_at,
          );
        return unchanged ? current : next;
      });
      setSelected((current) => {
        if (!current) return null;
        const refreshed = next.find((item) => item.work_key === current.work_key);
        return refreshed ? { ...current, ...refreshed } : null;
      });
    }
    if (error) setNotice(userError(error));
    else if (silent) setNotice("");
    if (!silent) setBusy(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const flushAfterCopy = () => {
      if (!pendingRefreshRef.current || document.getSelection()?.toString()) return;
      pendingRefreshRef.current = false;
      void load(true);
    };
    document.addEventListener("selectionchange", flushAfterCopy);
    return () => document.removeEventListener("selectionchange", flushAfterCopy);
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
      refreshTimer = window.setTimeout(() => {
        if (document.getSelection()?.toString()) { pendingRefreshRef.current = true; return; }
        void load(true);
      }, 200);
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
    const requestId = ++detailRequestId.current;
    setSelected(item);
    setEvents([]);
    setWorkerRuns([]);
    setDetailError("");
    setDetailBusy(true);
    const [detailResult, eventsResult, runsResult] = await Promise.all([
      supabase
        .from("system_work_items")
        .select("detail,evidence")
        .eq("work_key", item.work_key)
        .maybeSingle(),
      supabase
        .from("system_work_item_events")
        .select(
          "id,event_type,old_status,new_status,old_progress,new_progress,note,created_at",
        )
        .eq("work_key", item.work_key)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("system_worker_runs")
        .select(
          "id,worker_id,status,current_step,progress,heartbeat_at,started_at,finished_at,evidence,error_fingerprint",
        )
        .eq("work_key", item.work_key)
        .order("started_at", { ascending: false })
        .limit(5),
    ]);
    if (!shouldApplyDetailResponse(requestId, detailRequestId.current)) return;
    if (detailResult.data) {
      const detail = detailResult.data as WorkItemDetail;
      setSelected((current) =>
        current?.work_key === item.work_key ? { ...current, ...detail } : current,
      );
    }
    setEvents(eventsResult.data ? (eventsResult.data as Event[]) : []);
    setWorkerRuns(runsResult.data ? (runsResult.data as WorkerRun[]) : []);
    const error = detailResult.error ?? eventsResult.error ?? runsResult.error;
    if (error) setDetailError(userError(error));
    setDetailBusy(false);
  };
  const closeDetail = () => {
    detailRequestId.current += 1;
    setSelected(null);
    setEvents([]);
    setWorkerRuns([]);
    setDetailError("");
    setDetailBusy(false);
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
    try {
      const decision = await runWithMutationAttempt<{ work_key: string; approved: boolean; reason: string }, { data?: { result_status?: string; decision_channel?: string } | null }>({
        module: "WorkCommandCenter",
        action: `${approved ? "อนุมัติ" : "ไม่อนุมัติ"}งานจากศูนย์สั่งงาน`,
        actorProfileId: user?.id || profile?.id,
        companyId: currentCompany?.company_id ?? null,
        request: { work_key: selected.work_key, approved, reason },
        operation: async () => {
          const { data, error } = await supabase.rpc("decide_system_work_item_approval", {
            target_work_key: selected.work_key,
            target_decision: approved ? "approve" : "reject",
            target_reason: reason,
            target_channel: "web",
          });
          if (error) throw error;
          return { data: data?.[0] ?? null };
        },
      });
      const result = decision.data;
      setNotice(result?.result_status === "already_decided"
        ? `รายการนี้ถูกจัดการแล้วผ่าน ${result.decision_channel ?? "อีกช่องทาง"}`
        : `${approved ? "อนุมัติ" : "ไม่อนุมัติ"} ${selected.work_key} และบันทึก Audit แล้ว`);
      await load();
      setSelected(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : userError(error));
    }
    setBusy(false);
  };
  const sendApprovalNotice = async () => {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("health-monitor", {
        body: { action: "send_work_approval", work_key: selected.work_key },
      });
      if (error) throw error;
      const result = data as { status?: string } | null;
      setNotice(result?.status === "rate_limited"
        ? "งานนี้เพิ่งส่งแจ้งเตือนไปแล้ว ระบบกันการส่งซ้ำไว้ 5 นาที"
        : `ส่งแจ้งเตือนเฉพาะ ${selected.work_key} แล้ว`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : userError(error));
    } finally {
      setBusy(false);
    }
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
          `${r.work_key} ${r.title} ${r.current_step ?? ""} ${r.owner ?? ""} ${r.status}`
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
            id: "worker",
            label: "Worker / ผลลัพธ์",
            minWidth: 210,
            render: (r) => {
              const outcome = workerOutcome(r);
              const color = workerOutcomeColor(outcome.value);
              return <Box><Chip size="small" color={color} label={outcome.label} /><Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>{r.worker_id || "ยังไม่มี Worker"}{r.status === "doing" ? ` · ${leaseLabel(r.lease_expires_at)}` : ""}</Typography></Box>;
            },
            exportValue: (r) => `${workerOutcome(r).label} · ${r.worker_id || ""}`,
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
        onClose={closeDetail}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 580 }, p: 3 } } }}
      >
        {selected && (
          <Stack spacing={2}>
            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
              <Box>
                <Typography variant="overline">{selected.work_key}</Typography>
                <Typography variant="h5">{selected.title}</Typography>
              </Box>
              <IconButton onClick={closeDetail}>
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
                {selected.current_step || "ยังไม่ระบุ"}
              </Typography>
            </Box>
            {(() => {
              const outcome = workerOutcome(selected);
              const color = workerOutcomeColor(outcome.value);
              return <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2">สถานะ Worker จริง</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, alignItems: { sm: "center" } }}><Chip color={color} label={outcome.label} /><Typography variant="body2">{selected.worker_id || "ยังไม่มี Worker ถือ lease"}</Typography></Stack>
                <Typography variant="body2" sx={{ mt: 1 }}>Progress {selected.progress}% · heartbeat {formatDate(selected.heartbeat_at)} · {leaseLabel(selected.lease_expires_at)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>เหตุผล: {outcome.reason} · ถัดไป: {outcome.nextAction}</Typography>
                {hasStaleHeartbeat(selected) && <Alert severity="warning" sx={{ mt: 1 }}>Worker ยังไม่ยืนยันความคืบหน้าเกิน 10 นาที โปรดตรวจ run ก่อนสั่งซ้ำ</Alert>}
              </Paper>;
            })()}
            <Box>
              <Typography variant="subtitle2">Worker runs ล่าสุด</Typography>
              {workerRuns.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  ยังไม่พบ run ที่อ่านได้สำหรับงานนี้
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {workerRuns.map((run) => (
                    <Paper key={run.id} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={0.75} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{run.worker_id}</Typography>
                        <Chip size="small" color={run.status === "failed" || run.status === "expired" ? "error" : run.status === "completed" ? "success" : "warning"} label={run.status} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        {run.current_step || "ยังไม่ระบุขั้นตอน"} · {run.progress}% · heartbeat {formatDate(run.heartbeat_at)}
                      </Typography>
                      {run.error_fingerprint && <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 0.5 }}>ข้อผิดพลาด: {run.error_fingerprint}</Typography>}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Box>
            {detailBusy && <LinearProgress aria-label="กำลังโหลดรายละเอียด" />}
            {detailError && (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void openDetail(selected)}>
                    ลองใหม่
                  </Button>
                }
              >
                โหลดรายละเอียดไม่สำเร็จ: {detailError}
              </Alert>
            )}
            {selected.detail && (
              <Box>
                <Typography variant="subtitle2">รายละเอียดงาน</Typography>
                <Typography sx={{ whiteSpace: "pre-wrap" }}>
                  {selected.detail}
                </Typography>
              </Box>
            )}
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
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => void sendApprovalNotice()}
                >
                  ส่งแจ้งเตือนเฉพาะงานนี้
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

