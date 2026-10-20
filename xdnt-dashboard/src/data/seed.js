// ------------------------------------------------------------------------
// TDDB — mô hình dữ liệu trung tâm.
// ------------------------------------------------------------------------
// Nguyên tắc: một chuỗi dữ liệu DUY NHẤT —
//   CUSTOMER → OPPORTUNITY → (WON) → PROJECT → TASK / COST / PAYMENT / WARRANTY
// Mỗi dự án có đúng 1 mã (project code) dạng TDDB-26-001, mọi thứ liên quan
// (task, chi phí, thu tiền, bảo hành, log điểm nghẽn) đều gắn theo mã này —
// không có "file CRM" và "file Project" tách rời.
//
// STAGE-GATE: mỗi bước (ở cả Opportunity và Project) có 1 "gate" — danh sách
// điều kiện phải tick đủ mới được bấm "Qua bước tiếp theo". Nếu phát sinh vấn
// đề ở bước hiện tại, dùng "Báo điểm nghẽn — trả về bước trước": hệ thống lùi
// lại đúng 1 bước, mở lại bước đó (chưa hoàn thành), và ghi log lý do — không
// cho nhảy cóc, không cho "coi như xong" khi chưa đủ điều kiện.
// ------------------------------------------------------------------------

/* ---------------------------------------------------------------------- */
/*  CONSTANTS                                                               */
/* ---------------------------------------------------------------------- */

// TODAY chỉ dùng để "neo" các ngày trong dữ liệu MẪU (seedXxx) cho có mạch
// truyện hợp lý — KHÔNG dùng TODAY cho bất kỳ hành động thật của người dùng.
// Mọi hành động thật (qua bước, báo điểm nghẽn, tạo task/dự án mới, ghi nhận
// doanh thu...) phải dùng todayISO() để lấy đúng ngày thực tế trên máy.
export const TODAY = "2026-07-01";
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const CURRENT_YEAR = new Date().getFullYear();
export const CODE_PREFIX = "TDDB";

export const ROLES = ["KD", "BP", "BOD"];
export const ROLE_LABELS = { KD: "Kinh doanh (KD)", BP: "Bộ phận triển khai (BP)", BOD: "Ban điều hành (BOD)" };

export const MONTHS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];
export const BOTTLENECK_THRESHOLD = 3; // số ngày đứng ở 1 bước trước khi bị coi là điểm nghẽn "mềm"
export const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;

export const uid = (p) => p + Math.random().toString(36).slice(2, 9);

export const formatVND = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "0 ₫";
  return Math.round(n).toLocaleString("vi-VN") + " ₫";
};
export const formatCompactVND = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, "") + " tỷ";
  if (abs >= 1e6) return (n / 1e6).toFixed(0) + " tr";
  return n.toLocaleString("vi-VN");
};
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const addMonths = (dateStr, months) => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

/* ---------------------------------------------------------------------- */
/*  MÃ DỰ ÁN — TDDB-26-001                                                  */
/* ---------------------------------------------------------------------- */

export function formatProjectCode(seq, year = CURRENT_YEAR) {
  return `${CODE_PREFIX}-${String(year).slice(-2)}-${String(seq).padStart(3, "0")}`;
}
export function nextProjectCode(existingProjects, year = CURRENT_YEAR) {
  const prefix = `${CODE_PREFIX}-${String(year).slice(-2)}-`;
  const nums = existingProjects
    .filter((p) => p.code && p.code.startsWith(prefix))
    .map((p) => parseInt(p.code.slice(prefix.length), 10))
    .filter((n) => !isNaN(n));
  return formatProjectCode((nums.length ? Math.max(...nums) : 0) + 1, year);
}

/* ---------------------------------------------------------------------- */
/*  STAGE-GATE — cơ chế chung dùng cho cả Opportunity và Project            */
/* ---------------------------------------------------------------------- */
// Một "gate flow" là bất kỳ object có { currentStage, status, stages: { [id]: {
//   state: "pending"|"done", gateChecked: bool[], completedAt, completedBy } },
//   bottlenecks: [{id, stageId, reason, at, by}] }.
// stageDefs là mảng [{ id, key, label, who, gate: [đk1, đk2, ...] }].

export function buildStages(stageDefs) {
  const obj = {};
  stageDefs.forEach((s) => {
    obj[s.id] = { state: "pending", gateChecked: s.gate.map(() => false), completedAt: null, completedBy: null, plannedDate: null };
  });
  return obj;
}
export function canAdvanceGate(stageDef, stageState) {
  if (!stageDef.gate.length) return true;
  return stageState.gateChecked.every(Boolean);
}
export function toggleGateCheck(flow, stageId, idx) {
  const stage = flow.stages[stageId];
  const gateChecked = stage.gateChecked.map((v, i) => (i === idx ? !v : v));
  return { ...flow, stages: { ...flow.stages, [stageId]: { ...stage, gateChecked } } };
}
export function advanceGateStage(flow, stageDefs, by, at) {
  const stageId = flow.currentStage;
  const stage = flow.stages[stageId];
  const def = stageDefs.find((s) => s.id === stageId);
  if (!def || !canAdvanceGate(def, stage)) return flow; // chặn — chưa đủ điều kiện thì không cho qua bước
  const stages = { ...flow.stages, [stageId]: { ...stage, state: "done", completedAt: at, completedBy: by } };
  const last = stageDefs[stageDefs.length - 1].id;
  let next = stageId < last ? stageId + 1 : stageId;
  // Bước đã đặt "bỏ qua" (0 ngày trong kế hoạch) → tự đánh dấu xong & chuyển tiếp, không bắt tick điều kiện
  while (next < last && stages[next] && stages[next].skipped) {
    stages[next] = { ...stages[next], state: "done", completedAt: at, completedBy: by };
    next += 1;
  }
  return { ...flow, stages, currentStage: next };
}
export function sendBackGate(flow, reason, by, at) {
  const stageId = flow.currentStage;
  if (stageId <= 1) return flow;
  let prevId = stageId - 1;
  const stages = { ...flow.stages };
  // lùi qua các bước "bỏ qua" (chúng sẽ tự được bỏ qua lại khi đi tới)
  while (prevId > 1 && stages[prevId] && stages[prevId].skipped) {
    stages[prevId] = { ...stages[prevId], state: "pending", completedAt: null, completedBy: null };
    prevId -= 1;
  }
  const prevStage = stages[prevId];
  stages[prevId] = { ...prevStage, state: "pending", completedAt: null, completedBy: null, gateChecked: prevStage.gateChecked.map(() => false) };
  const bottlenecks = [...(flow.bottlenecks || []), { id: uid("bn"), stageId, reason, by, at, resolvedAt: null }];
  return { ...flow, stages, currentStage: prevId, bottlenecks };
}
export function hasOpenBottleneck(flow) {
  return (flow.bottlenecks || []).some((b) => !b.resolvedAt);
}
export function resolveLastBottleneck(flow, at) {
  const bottlenecks = [...(flow.bottlenecks || [])];
  for (let i = bottlenecks.length - 1; i >= 0; i--) {
    if (!bottlenecks[i].resolvedAt) { bottlenecks[i] = { ...bottlenecks[i], resolvedAt: at }; break; }
  }
  return { ...flow, bottlenecks };
}

/* ---------------------------------------------------------------------- */
/*  OPPORTUNITY — LEAD → ... → WON/LOST (Sales Stage-Gate)                  */
/* ---------------------------------------------------------------------- */

export const OPP_STAGES = [
  { id: 1, key: "lead", label: "Lead", who: "KD", gate: ["Có tên khách hàng + số điện thoại/email liên hệ"] },
  { id: 2, key: "approach", label: "Tiếp cận", who: "KD", gate: ["Đã liên hệ/gặp lần đầu, khách xác nhận có quan tâm"] },
  { id: 3, key: "needs", label: "Xác định nhu cầu", who: "KD", gate: ["Ghi rõ nhu cầu, ngân sách dự kiến, thời gian mong muốn"] },
  { id: 4, key: "survey", label: "Khảo sát", who: "KD", gate: ["Đã khảo sát mặt bằng/hiện trạng thực tế"] },
  { id: 5, key: "concept", label: "Concept / Giải pháp", who: "BP", gate: ["Đã gửi concept/giải pháp đề xuất cho khách hàng"] },
  { id: 6, key: "quote", label: "Báo giá", who: "BP", gate: ["Đã gửi báo giá chính thức"] },
  { id: 7, key: "negotiation", label: "Đàm phán", who: "KD", gate: ["Đã chốt được các điều khoản/mức giá cuối với khách hàng"] },
  { id: 8, key: "decision", label: "WON / LOST", who: "BOD", gate: [] },
];
export const OPP_DECISION_STAGE_ID = OPP_STAGES[OPP_STAGES.length - 1].id;

export function makeOpportunity(data) {
  return {
    id: uid("opp"), title: data.title, customerId: data.customerId, customerName: data.customerName,
    value: data.value || 0, note: data.note || "",
    baseValue: data.value || 0, valueChanges: [], // giá trị gốc + danh sách điều chỉnh/phát sinh có duyệt (xem "GIÁ TRỊ CÔNG TRÌNH" bên dưới)
    currentStage: 1, status: "open", // open | won | lost
    stages: buildStages(OPP_STAGES),
    bottlenecks: [], lostReason: null, wonProjectCode: null,
    createdAt: data.createdAt || todayISO(),
  };
}

/* ---------------------------------------------------------------------- */
/*  PROJECT — Kick-off → ... → CLOSED (Delivery Stage-Gate)                 */
/* ---------------------------------------------------------------------- */

export const PROJECT_STAGES = [
  { id: 1, key: "kickoff", label: "Kick-off", who: "KD", gate: ["Đã họp kick-off nội bộ + khách hàng, xác nhận phạm vi & mốc thời gian"] },
  { id: 2, key: "design", label: "Thiết kế", who: "BP", gate: ["Có bản vẽ/thiết kế sơ bộ"] },
  { id: 3, key: "design_approval", label: "Duyệt bản vẽ/mẫu", who: "KD", gate: ["Khách hàng đã duyệt bản vẽ/mẫu (văn bản/email)"] },
  { id: 4, key: "boq", label: "BOQ", who: "BP", gate: ["Đã lập BOQ (bảng khối lượng vật tư) đầy đủ"] },
  { id: 5, key: "procurement", label: "Procurement", who: "BP", gate: ["Đã đặt hàng/ký PO với NCC cho vật tư chính"] },
  { id: 6, key: "manufacturing", label: "Manufacturing", who: "BP", gate: ["Đã nhận đủ vật tư / gia công hoàn tất"] },
  { id: 7, key: "construction", label: "Construction", who: "BP", gate: ["Thi công đạt tiến độ theo kế hoạch"] },
  { id: 8, key: "qc", label: "QC", who: "BP", gate: ["Đã kiểm tra chất lượng, không còn lỗi nghiêm trọng"] },
  { id: 9, key: "acceptance", label: "Nghiệm thu", who: "KD", gate: ["Có biên bản nghiệm thu ký với khách hàng"] },
  { id: 10, key: "handover", label: "Bàn giao", who: "KD", gate: ["Đã bàn giao công trình + hồ sơ hoàn công"] },
  { id: 11, key: "settlement", label: "Quyết toán", who: "KD", gate: ["Đã chốt giá trị quyết toán cuối cùng với khách hàng"] },
  { id: 12, key: "collection", label: "Thu tiền", who: "KD", gate: ["Đã thu đủ giá trị hợp đồng theo thoả thuận"] },
  { id: 13, key: "warranty", label: "Warranty", who: "KD", gate: ["Hết hạn bảo hành hoặc đã xử lý xong toàn bộ yêu cầu bảo hành"] },
  { id: 14, key: "closed", label: "CLOSED", who: "BOD", gate: [] },
];
export const PROJECT_FINAL_STAGE_ID = PROJECT_STAGES[PROJECT_STAGES.length - 1].id;
export const PROJECT_WARRANTY_STAGE_ID = PROJECT_STAGES.find((s) => s.key === "warranty").id;
export const PROJECT_ACCEPTANCE_STAGE_ID = PROJECT_STAGES.find((s) => s.key === "acceptance").id;

// Mức ưu tiên dùng cho trang "Kế hoạch triển khai" (dashboard tổng hợp tất cả
// dự án đã ký kết) — không ảnh hưởng tới Stage-Gate.
export const PRIORITIES = ["high", "normal", "low"];
export const PRIORITY_LABELS = { high: "Cao", normal: "Trung bình", low: "Thấp" };

// Các hạng mục chi phí phát sinh "chuẩn" gợi ý khi ghi nhận ở CostPanel — người
// dùng vẫn có thể chọn "Khác..." để nhập hạng mục tự do như trước.
export const COST_CATEGORY_PRESETS = [
  "Chi phí Lobby",
  "Chi phí triển khai công trình",
  "Chi phí phát sinh vật tư, nhân công",
  "Chi phí giám sát",
  "Chi phí phụ khác",
];

export function makeProject(code, data) {
  return {
    id: uid("p"), code,
    name: data.name, customerId: data.customerId, customerName: data.customerName,
    scope: data.scope || "", contractValue: data.contractValue || 0,
    baseValue: data.baseValue ?? (data.contractValue || 0), valueChanges: data.valueChanges || [], // contractValue = baseValue + điều chỉnh ĐÃ DUYỆT
    currentStage: 1, status: "active", // active | closed | on_hold
    priority: data.priority || "normal", // high | normal | low — dùng cho Kế hoạch triển khai
    plannedStart: data.plannedStart || null, plannedEnd: data.plannedEnd || null, // ngày dự kiến tổng của cả dự án
    stages: buildStages(PROJECT_STAGES),
    bottlenecks: [],
    revenueEvents: [], // ledger thu/chi tiền: {id, type:"invoice"|"payment", date, amount, note}
    costs: [], // {id, category, budget, actual, note}
    workItems: [], // công tác bổ sung ngoài phạm vi ban đầu, theo yêu cầu CĐT: {id, title, requestedAt, status:"todo"|"doing"|"done", note}
    paymentMilestones: [], // đợt thanh toán DỰ KIẾN riêng theo từng dự án: {id, label, pct, plannedDate} — số tiền thực thu vẫn lấy từ revenueEvents (1 nguồn dữ liệu duy nhất)
    createdAt: data.createdAt || todayISO(),
  };
}
export function projectCollected(project) {
  return (project.revenueEvents || []).filter((e) => e.type !== "invoice").reduce((s, e) => s + e.amount, 0);
}
export function projectAR(project) {
  return project.contractValue - projectCollected(project);
}
export function projectStagePct(project) {
  if (project.status === "closed") return 100;
  const stage = project.stages[project.currentStage];
  const completedCount = project.currentStage - 1 + (stage?.state === "done" ? 1 : 0);
  return Math.round((completedCount / PROJECT_FINAL_STAGE_ID) * 100);
}
export function projectRiskLevel(project) {
  if (project.status !== "active") return "none";
  if (hasOpenBottleneck(project)) return "red";
  return "green";
}

/* ---- Kế hoạch triển khai — đối chiếu dự kiến vs thực tế từng bước ---- */
// "good" = đúng tiến độ, "bad" = trễ tiến độ hoặc có điểm nghẽn, "neutral" =
// chưa lập kế hoạch dự kiến, "done" = đã lưu trữ (closed).
export function projectScheduleStatus(project) {
  if (project.status === "closed") return "done";
  if (hasOpenBottleneck(project)) return "bad";
  const stage = project.stages[project.currentStage];
  if (!stage || !stage.plannedDate) return "neutral";
  if (stage.state === "done") return "good";
  return daysBetween(stage.plannedDate, todayISO()) > 0 ? "bad" : "good";
}

/* ---- Thu hồi công nợ — mỗi dự án tự định nghĩa đợt thanh toán riêng ---- */
// Số tiền ĐÃ thu luôn lấy từ revenueEvents (projectCollected) — paymentMilestones
// chỉ là LỊCH dự kiến (label, % hợp đồng, ngày dự kiến), không có cờ "đã thu"
// riêng, để tránh ghi nhận 2 nơi lệch nhau.
export function milestoneCumPct(project, uptoIndex) {
  return (project.paymentMilestones || []).slice(0, uptoIndex + 1).reduce((s, m) => s + (m.pct || 0), 0);
}
// Số tiền từng đợt: đợt ĐÃ CHỐT (lockedAmount — được ghim khi giá trị hợp đồng đổi
// lúc đợt đó đã thu đủ) giữ nguyên; phần còn lại chia cho các đợt chưa chốt theo % mới.
export function milestoneAmounts(project) {
  const list = project.paymentMilestones || [];
  const V = project.contractValue || 0;
  const scheduled = list.reduce((s, m) => s + (m.pct || 0), 0) / 100 * V;
  const lockedSum = list.reduce((s, m) => s + (m.lockedAmount != null ? m.lockedAmount : 0), 0);
  const freePct = list.filter((m) => m.lockedAmount == null).reduce((s, m) => s + (m.pct || 0), 0);
  return list.map((m) => {
    if (m.lockedAmount != null) return m.lockedAmount;
    if (!freePct) return 0;
    return Math.round(Math.max(0, scheduled - lockedSum) * (m.pct || 0) / freePct);
  });
}
// Đợt nào đã thu đủ (tiền đã thu ≥ tổng luỹ kế các đợt tới đó)
export function milestonePaidFlags(project) {
  const collected = projectCollected(project);
  let cum = 0;
  return milestoneAmounts(project).map((a) => { cum += a; return collected >= cum - 0.5; });
}
export function milestoneStatus(project, index) {
  const m = (project.paymentMilestones || [])[index];
  if (!m) return "none";
  if (milestonePaidFlags(project)[index]) return "paid";
  const d = daysBetween(todayISO(), m.plannedDate);
  if (d < 0) return "overdue";
  if (d <= 14) return "upcoming";
  return "ontrack";
}
export function nextPaymentMilestone(project) {
  const list = project.paymentMilestones || [];
  for (let i = 0; i < list.length; i++) {
    if (milestoneStatus(project, i) !== "paid") return { milestone: list[i], index: i, status: milestoneStatus(project, i) };
  }
  return null;
}
/* ---------------------------------------------------------------------- */
/*  GIÁ TRỊ CÔNG TRÌNH — giá trị gốc + điều chỉnh/phát sinh có duyệt          */
/* ---------------------------------------------------------------------- */
// Dùng chung cho cơ hội (trường value) và dự án (trường contractValue):
//   baseValue      giá trị gốc (thiếu → lấy giá trị hiện có, để dữ liệu cũ vẫn chạy)
//   valueChanges[] {id, delta(+/−₫), title, reason, by, byRole, date, status, decidedBy, decidedAt}
//                  status: "proposed" (chờ BOD duyệt) | "approved" | "rejected"
//   value / contractValue = baseValue + tổng các điều chỉnh ĐÃ DUYỆT (lưu sẵn để mọi
//   chỗ đang đọc value/contractValue — báo cáo, Dashboard, Gantt — không phải đổi).
export const VALUE_CHANGE_PRESETS = [
  "Phát sinh thêm hạng mục", "Khách đổi vật liệu cao cấp hơn", "Thêm khối lượng thi công",
  "Phát sinh nhân công ngoài giờ", "Giảm giá theo đàm phán", "Cắt giảm hạng mục",
];
const isProjectDoc = (doc) => "contractValue" in doc;
export const valueField = (doc) => (isProjectDoc(doc) ? "contractValue" : "value");
export const valueBase = (doc) => (doc.baseValue != null ? doc.baseValue : (doc[valueField(doc)] || 0));
export const valueApprovedSum = (doc) => (doc.valueChanges || []).filter((c) => c.status === "approved").reduce((s, c) => s + c.delta, 0);
export const valuePendingSum = (doc) => (doc.valueChanges || []).filter((c) => c.status === "proposed").reduce((s, c) => s + c.delta, 0);
export const valueTotal = (doc) => valueBase(doc) + valueApprovedSum(doc);

// Ghim số tiền các đợt ĐÃ thu đủ (trước khi tổng đổi) để chúng không bị "lật" thành chưa thu.
function lockPaidMilestones(project) {
  const list = project.paymentMilestones || [];
  if (!list.length) return project;
  const amounts = milestoneAmounts(project);
  const paid = milestonePaidFlags(project);
  return { ...project, paymentMilestones: list.map((m, i) => (paid[i] && m.lockedAmount == null ? { ...m, lockedAmount: amounts[i] } : m)) };
}
// Áp tổng mới vào doc: ghim đợt đã thu (nếu là dự án) rồi cập nhật value/contractValue.
function applyValueTotal(doc, nextChanges, nextBase) {
  const locked = isProjectDoc(doc) ? lockPaidMilestones(doc) : doc;
  const next = { ...locked, baseValue: nextBase, valueChanges: nextChanges };
  return { ...next, [valueField(doc)]: nextBase + nextChanges.filter((c) => c.status === "approved").reduce((s, c) => s + c.delta, 0) };
}
// Tổng mới không được thấp hơn số tiền đã thu thực tế (chỉ áp dụng cho dự án)
export function canApplyValue(doc, newTotal) {
  return !isProjectDoc(doc) || newTotal >= projectCollected(doc) - 0.5;
}
// Đề xuất 1 điều chỉnh. approveNow = BOD ghi nhận & duyệt luôn.
export function proposeValueChange(doc, { delta, title, reason, by, byRole, date }, approveNow) {
  if (!delta || !isFinite(delta)) return { error: "Nhập số tiền điều chỉnh khác 0." };
  const ch = { id: uid("vc"), delta: Math.round(delta), title: (title || "").trim() || (delta > 0 ? "Phát sinh tăng" : "Điều chỉnh giảm"),
    reason: (reason || "").trim(), by: by || "", byRole: byRole || "", date: date || todayISO(),
    status: "proposed", decidedBy: null, decidedAt: null };
  const list = doc.valueChanges || [];
  if (!approveNow) return { doc: { ...doc, baseValue: valueBase(doc), valueChanges: [...list, ch] } };
  if (!canApplyValue(doc, valueTotal(doc) + ch.delta)) return { error: "Tổng mới sẽ thấp hơn số tiền đã thu — không thể duyệt." };
  const approved = { ...ch, status: "approved", decidedBy: by || "", decidedAt: ch.date };
  return { doc: applyValueTotal(doc, [...list, approved], valueBase(doc)) };
}
export function approveValueChange(doc, id, by, at) {
  const list = doc.valueChanges || [];
  const ch = list.find((c) => c.id === id);
  if (!ch || ch.status !== "proposed") return { error: "Điều chỉnh này không còn ở trạng thái chờ duyệt." };
  if (!canApplyValue(doc, valueTotal(doc) + ch.delta)) return { error: "Tổng mới sẽ thấp hơn số tiền đã thu — không thể duyệt." };
  const nextList = list.map((c) => (c.id === id ? { ...c, status: "approved", decidedBy: by || "", decidedAt: at || todayISO() } : c));
  return { doc: applyValueTotal(doc, nextList, valueBase(doc)) };
}
export function rejectValueChange(doc, id, by, at) {
  const list = doc.valueChanges || [];
  const nextList = list.map((c) => (c.id === id && c.status === "proposed" ? { ...c, status: "rejected", decidedBy: by || "", decidedAt: at || todayISO() } : c));
  return { doc: { ...doc, baseValue: valueBase(doc), valueChanges: nextList } };
}
// Chỉ xoá được điều chỉnh CHƯA duyệt (đã duyệt muốn hoàn lại → thêm 1 điều chỉnh ngược dấu)
export function removeValueChange(doc, id) {
  return { ...doc, baseValue: valueBase(doc), valueChanges: (doc.valueChanges || []).filter((c) => !(c.id === id && c.status !== "approved")) };
}
// BOD sửa giá trị GỐC — tổng = gốc mới + điều chỉnh đã duyệt
export function setValueBase(doc, newBase) {
  const base = Math.max(0, Math.round(Number(newBase) || 0));
  const list = doc.valueChanges || [];
  const total = base + list.filter((c) => c.status === "approved").reduce((s, c) => s + c.delta, 0);
  if (!canApplyValue(doc, total)) return { error: "Tổng mới sẽ thấp hơn số tiền đã thu — không thể lưu." };
  return { doc: applyValueTotal(doc, list, base) };
}

/* ---------------------------------------------------------------------- */
/*  LỊCH TRIỂN KHAI (Gantt chung) — kế hoạch 12 bước + ghi chú thi công      */
/* ---------------------------------------------------------------------- */
// Kế hoạch của 1 dự án KHÔNG có cấu trúc dữ liệu riêng — dùng lại các trường
// đã có để dữ liệu cũ vẫn đọc được:
//   plannedStart            ngày bắt đầu dự kiến
//   plannedEnd              ngày kết thúc dự kiến (= hạn bước 12)
//   stages[id].plannedDate  HẠN HOÀN THÀNH của bước id (1..12)
//   stages[id].completedAt  ngày hoàn thành THỰC TẾ (bước đã xong → dùng ngày này)
// Trường mới (đều tuỳ chọn, thiếu vẫn chạy):
//   planConfirmed === false  kế hoạch còn ở dạng NHÁP (hệ thống tự đề xuất, chưa được xác nhận)
//   planBaseEnd              ngày kết thúc theo kế hoạch ban đầu (để biết đã dời bao nhiêu ngày)
//   notes[]                  ghi chú/tắc nghẽn/cần hỗ trợ: {id, stage, type, text, need, date, resolved}

export const PLAN_STAGE_COUNT = 12; // bước 1..12 (Kick-off → Thu tiền); Warranty/CLOSED nằm ngoài kế hoạch
// Tỷ trọng thời gian thông thường của 12 bước (tổng 100) — Construction + Manufacturing chiếm nhiều nhất.
export const PLAN_WEIGHTS = [3, 14, 6, 6, 12, 17, 24, 5, 3, 2, 4, 4];
export const PLAN_PHASES = [
  { name: "Thiết kế & duyệt", from: 1, to: 3 },
  { name: "BOQ & mua sắm", from: 4, to: 5 },
  { name: "Sản xuất & thi công", from: 6, to: 7 },
  { name: "QC & bàn giao", from: 8, to: 10 },
  { name: "Quyết toán & thu tiền", from: 11, to: 12 },
];
export const PLAN_SIZE_OPTIONS = [{ days: 60, label: "Nhỏ ~60 ngày" }, { days: 90, label: "Vừa ~90 ngày" }, { days: 150, label: "Lớn ~150 ngày" }];
export const suggestPlanDays = (contractValue) => {
  // contractValue lưu theo ₫ (đồng): ≤100tr → 75 ngày, ≤150tr → 105 ngày, còn lại 135 ngày
  const m = (contractValue || 0) / 1e6;
  return m <= 100 ? 75 : m <= 150 ? 105 : 135;
};

export const NOTE_TYPES = ["block", "help", "note"];
export const NOTE_LABELS = { note: "Lưu ý", block: "Tắc nghẽn", help: "Cần hỗ trợ" };
export const NOTE_SYMBOL = { note: "i", block: "!", help: "+" };
export const NOTE_NEED_OPTIONS = ["BOD", "KD", "BP", "Mua hàng", "Khách hàng"];
export const NOTE_PRESETS = {
  block: ["Chờ vật tư về công trường", "Mặt bằng chưa bàn giao", "Khách chưa duyệt thay đổi", "MEP / điện nước chưa xong", "Chờ giấy phép thi công / ra vào"],
  help: ["Cần thêm nhân công", "Cần BOD làm việc với khách", "Cần mua gấp vật tư", "Cần người giám sát tại công trình"],
  note: ["Thi công ngoài giờ (sau 22h)", "Chú ý an toàn / PCCC", "Phối hợp nhà thầu khác", "Khách có thể đổi vật liệu"],
};
export function makeNote(data) {
  return {
    id: uid("note"), stage: data.stage, type: data.type, text: data.text,
    need: data.type === "note" ? "" : (data.need || ""), date: data.date || todayISO(), resolved: false,
  };
}
export const openNotes = (project) => (project.notes || []).filter((n) => !n.resolved);

/* ---- VIỆC TRIỂN KHAI HẰNG NGÀY — danh sách việc chi tiết theo từng dự án ---- */
// project.jobs[]: {id, text, date (ngày bắt đầu), due (hạn), done, doneAt, star, stage (bước liên quan, có thể null)}
export function makeJob(data, today) {
  const t = today || todayISO();
  const date = data.date || t;
  return { id: uid("job"), text: String(data.text || "").trim(), date, due: data.due && data.due >= date ? data.due : date, done: false, doneAt: null, star: !!data.star, stage: data.stage || null };
}
export const jobIsLate = (j, today) => !j.done && j.due < today;
export const openJobs = (project) => (project.jobs || []).filter((j) => !j.done);

const stripVN = (t) => String(t || "").toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// Tách ngày trong 1 dòng: "14 - 15/10" (khoảng) hoặc "15.10" / "15/10" (1 ngày). Không có ngày → hôm nay.
export function parseJobDates(text, today) {
  const t = today || todayISO();
  const pad = (n) => String(n).padStart(2, "0");
  const mk = (d, m) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let y = +t.slice(0, 4);
    let iso = `${y}-${pad(m)}-${pad(d)}`;
    if (dayNum(t) - dayNum(iso) > 180) iso = `${y + 1}-${pad(m)}-${pad(d)}`; // đã qua quá lâu → hiểu là năm sau
    return iso;
  };
  let m = String(text).match(/(\d{1,2})\s*-\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/);
  if (m) { const a = mk(+m[1], +m[3]), b = mk(+m[2], +m[3]); if (a && b && b >= a) return { date: a, due: b }; }
  m = String(text).match(/(?:^|[^\d])(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/);
  if (m) { const a = mk(+m[1], +m[2]); if (a) return { date: a, due: a }; }
  return { date: t, due: t };
}
// Nhận ra dự án từ tên nhóm: so các từ của tên nhóm với "mã + tên + khách hàng" của từng dự án.
export function matchProjectByTitle(title, projects) {
  const toks = stripVN(title).split(/[^a-z0-9]+/).filter((x) => x.length >= 2 || /\d/.test(x));
  if (!toks.length) return "";
  const scored = projects.map((p) => {
    const hay = stripVN(`${p.code} ${p.name} ${p.customerName}`);
    const hit = toks.filter((x) => hay.includes(x)).length;
    return { id: p.id, r: hit / toks.length, hit };
  }).sort((a, b) => b.r - a.r || b.hit - a.hit);
  const best = scored[0];
  if (!best || best.r < 0.6) return "";
  if (scored[1] && scored[1].r === best.r && scored[1].hit === best.hit) return ""; // 2 dự án ngang điểm → để người dùng chọn
  return best.id;
}
// Phân tích danh sách dán từ Notion/Word: "1. Tên dự án ⇒ lưu ý" + các dòng con "a. việc …"
export function parseJobList(text, projects, today) {
  const groups = [];
  let g = null;
  String(text || "").split(/\r?\n/).forEach((raw) => {
    if (!raw.trim()) return;
    const ind = raw.match(/^\s*/)[0].length;
    let m = raw.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (m && ind < 2) {
      let title = m[2].trim(), note = null;
      const k = title.search(/⇒|→|=>/);
      if (k > -1) { note = title.slice(k).replace(/^(⇒|→|=>)/, "").trim(); title = title.slice(0, k).trim(); }
      title = title.replace(/:\s*$/, "").trim();
      g = { title, note: note || null, items: [] };
      groups.push(g);
    } else if (g) {
      m = raw.match(/^\s*(?:[a-zA-Z]|[-•*])[.)]?\s+(.+)$/);
      const line = (m ? m[1] : raw).trim();
      if (line) g.items.push(line);
    }
  });
  return groups.map((x) => ({ ...x, pid: matchProjectByTitle(x.title, projects), items: x.items.map((t) => ({ text: t, ...parseJobDates(t, today), on: true })) }));
}

// ---- tiện ích ngày (YYYY-MM-DD, tính theo UTC để không lệch múi giờ) ----
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const numDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDaysISO = (s, k) => numDay(dayNum(s) + k);
export const diffDays = (a, b) => dayNum(b) - dayNum(a); // b - a (ngày)

// Rải đều `weights.length` bước trong khoảng from → to theo tỷ trọng, mỗi bước ≥ 1 ngày.
export function distributeDates(from, to, weights) {
  const n = weights.length;
  const total = Math.max(dayNum(to) - dayNum(from), n);
  const sum = weights.reduce((a, b) => a + b, 0);
  const f = dayNum(from);
  let cum = 0, prev = f;
  const out = [];
  weights.forEach((w, i) => {
    cum += w;
    let e = f + Math.round((total * cum) / sum);
    e = Math.max(prev + 1, Math.min(e, f + total - (n - 1 - i)));
    out.push(numDay(e));
    prev = e;
  });
  return out;
}
// known = ngày kết thúc (thực tế) của các bước đã xong (bước 1..cur-1)
// skips[i] = bước i+1 được BỎ QUA (0 ngày): hạn = hạn bước liền trước, không chiếm thời gian.
const normSkips = (skips) => Array.from({ length: PLAN_STAGE_COUNT }, (_, i) => !!(skips && skips[i]));
// ---- BƯỚC CHẠY SONG SONG ----
// plan.starts[i] = ngày bắt đầu RIÊNG của bước i+1 (null = nối tiếp ngay khi bước trước kết thúc, như mặc định).
// Bước có ngày bắt đầu riêng được tính theo kiểu "gồm cả ngày bắt đầu" (từ 05/10 tới 07/10 = 3 ngày); bước nối tiếp tính như cũ (hạn − hạn bước trước).
const maxEnd = (ends) => ends.reduce((m, x) => (dayNum(x) > dayNum(m) ? x : m), ends[0]);
export const planStarts = (plan) => (plan.starts && plan.starts.length === PLAN_STAGE_COUNT ? plan.starts : Array(PLAN_STAGE_COUNT).fill(null));
const firstActiveIdx = (plan) => { const sk = plan.skips || []; let k = 0; while (k < PLAN_STAGE_COUNT - 1 && sk[k]) k += 1; return k; };
// Ngày bắt đầu thực tế của bước idx: bước làm việc đầu tiên = ngày bắt đầu kế hoạch; bước có ngày riêng = ngày đó; còn lại = hạn bước liền trước.
export function stepStart(plan, idx) {
  if (plan.skips && plan.skips[idx]) return plan.ends[idx];
  if (idx === firstActiveIdx(plan)) return plan.start;
  const own = planStarts(plan)[idx];
  if (own) return own;
  return idx > 0 ? plan.ends[idx - 1] : plan.start;
}
export const stepIsOwnStart = (plan, idx) => !(plan.skips && plan.skips[idx]) && idx !== firstActiveIdx(plan) && !!planStarts(plan)[idx];
// Số ngày hiển thị của bước (0 = bỏ qua)
export function stepDays(plan, idx) {
  if (plan.skips && plan.skips[idx]) return 0;
  const d = diffDays(stepStart(plan, idx), plan.ends[idx]);
  return stepIsOwnStart(plan, idx) ? d + 1 : Math.max(1, d); // xong ngay trong ngày bắt đầu (hạn = ngày bắt đầu) vẫn tính 1 ngày
}
// Hạn kết thúc khi nhập số ngày n ≥ 1
export function stepEndForDays(plan, idx, n) {
  const a = stepStart(plan, idx);
  return addDaysISO(a, stepIsOwnStart(plan, idx) ? Math.max(0, n - 1) : n);
}
// Hạn nhỏ nhất (dayNum) cho bước idx: không trước bước liền trước; bước nối tiếp phải ≥ +1 ngày, bước có ngày riêng ≥ ngày bắt đầu của nó.
const minEndOf = (plan, idx) => {
  const own = planStarts(plan)[idx];
  if (idx !== firstActiveIdx(plan) && own) return dayNum(own); // bước có ngày bắt đầu riêng: chỉ cần không trước ngày bắt đầu của nó
  return dayNum(stepStart(plan, idx)); // cho phép hoàn thành ngay trong ngày bắt đầu
};
// hạn lớn nhất của bước idx khi KHÔNG dời các bước sau: bước kế tiếp nối tiếp (không có ngày riêng) bắt đầu đúng ngày hạn này → hạn này phải trước hạn của nó ≥ 1 ngày
const maxEndOf = (plan, idx) => {
  const sk = plan.skips || [];
  const st = planStarts(plan);
  let k = idx + 1;
  while (k < PLAN_STAGE_COUNT && sk[k]) k += 1;
  if (k >= PLAN_STAGE_COUNT) return dayNum(plan.ends[idx]) + 3650;
  return st[k] ? dayNum(plan.ends[idx]) + 3650 : dayNum(plan.ends[k]);
};
// Đặt ngày bắt đầu RIÊNG cho 1 bước (không ảnh hưởng bước khác). newStart=null → quay về nối tiếp bước trước.
export function setStageStart(plan, idx, newStart) {
  if (plan.skips && plan.skips[idx]) return plan;
  if (idx === firstActiveIdx(plan)) return newStart ? setPlanStart(plan, newStart, false) : plan;
  const starts = planStarts(plan).slice();
  if (!newStart) starts[idx] = null;
  else starts[idx] = dayNum(newStart) > dayNum(plan.ends[idx]) ? plan.ends[idx] : newStart; // không cho bắt đầu sau hạn
  return { ...plan, starts };
}
// Các bước đang chạy chồng lên nhau: trả về [{idx, with:[idx...]}]
export function planOverlaps(plan) {
  const sk = plan.skips || [];
  const out = [];
  for (let i = 1; i < PLAN_STAGE_COUNT; i++) {
    if (sk[i]) continue;
    const a = dayNum(stepStart(plan, i));
    const w = [];
    for (let j = 0; j < i; j++) if (!sk[j] && dayNum(plan.ends[j]) > a) w.push(j);
    if (w.length) out.push({ idx: i, with: w });
  }
  return out;
}
export function buildPlan(start, end, cur, known, skips) {
  cur = Math.max(1, Math.min(PLAN_STAGE_COUNT, cur));
  known = (known || []).slice(0, cur - 1);
  const sk = normSkips(skips);
  const last = known.length ? known[known.length - 1] : start;
  const restIdx = [];
  for (let i = cur - 1; i < PLAN_STAGE_COUNT; i++) if (!sk[i]) restIdx.push(i);
  const ends = known.slice();
  if (!restIdx.length) {
    for (let i = cur - 1; i < PLAN_STAGE_COUNT; i++) ends.push(last);
  } else {
    const restW = restIdx.map((i) => PLAN_WEIGHTS[i]);
    const e = Math.max(dayNum(end), dayNum(last) + restW.length);
    const dist = distributeDates(last, numDay(e), restW);
    let k = 0, prev = last;
    for (let i = cur - 1; i < PLAN_STAGE_COUNT; i++) {
      if (sk[i]) ends.push(prev);
      else { prev = dist[k++]; ends.push(prev); }
    }
  }
  return { start, end: maxEnd(ends), baseEnd: end, ends, skips: sk, starts: Array(PLAN_STAGE_COUNT).fill(null) };
}
const prevEndOf = (plan, idx) => (idx > 0 ? plan.ends[idx - 1] : plan.start);
// Dời hạn bước idx (0-based) đi `delta` ngày — mọi bước sau dời theo. Không cho bước idx lùi sát/qua bước trước.
// Bước idx đang "bỏ qua" (0 ngày) thì dời từ bước làm việc gần nhất phía trước (các bước bỏ qua đi theo).
export function shiftPlanFrom(plan, idx, delta) {
  const sk = plan.skips || [];
  let i0 = idx;
  while (i0 > 0 && sk[i0]) i0 -= 1;
  if (sk[i0]) return plan; // tất cả các bước từ đầu tới đây đều bỏ qua — không có gì để dời
  const ends = plan.ends.slice();
  const starts = planStarts(plan).slice();
  const lo = Math.max(minEndOf(plan, i0), 0);
  const d = Math.max(delta, lo - dayNum(ends[i0]));
  for (let i = i0; i < ends.length; i++) ends[i] = addDaysISO(ends[i], d);
  for (let i = i0 + 1; i < ends.length; i++) if (starts[i]) starts[i] = addDaysISO(starts[i], d); // bước chạy song song dời theo
  return { ...plan, ends, starts, end: maxEnd(ends) };
}
// Đổi hạn 1 bước. cascade=true → các bước sau dời theo; false → chỉ bước đó (kẹp giữa 2 bước kề).
export function applyStageEnd(plan, idx, newDate, cascade) {
  const sk = plan.skips || [];
  if (sk[idx]) return plan; // bước bỏ qua: muốn bật lại phải nhập số ngày ≥ 1 (setStageSkip)
  const old = plan.ends[idx];
  if (!newDate || newDate === old) return plan;
  if (cascade || idx === PLAN_STAGE_COUNT - 1) return shiftPlanFrom(plan, idx, diffDays(old, newDate));
  const lo = minEndOf(plan, idx);
  let k = idx + 1;
  while (k < PLAN_STAGE_COUNT && sk[k]) k += 1; // bước làm việc kế tiếp
  const hi = maxEndOf(plan, idx);
  const e = Math.max(lo, Math.min(hi, dayNum(newDate)));
  const ends = plan.ends.slice();
  for (let j = idx; j < k; j++) ends[j] = numDay(e); // gồm cả các bước bỏ qua liền sau
  return { ...plan, ends, end: maxEnd(ends) };
}
// Đặt NGÀY BẮT ĐẦU của kế hoạch (cho phép ngày trong quá khứ — dự án làm gấp, nhập thông tin bù sau).
// cascade=true → toàn bộ hạn các bước dời theo (giữ nguyên số ngày mỗi bước); false → giữ nguyên hạn, chỉ đổi điểm bắt đầu.
export function setPlanStart(plan, newStart, cascade) {
  if (!newStart || newStart === plan.start) return plan;
  const sk = plan.skips || [];
  let first = 0;
  while (first < PLAN_STAGE_COUNT - 1 && sk[first]) first += 1; // bước làm việc đầu tiên
  const ends = plan.ends.slice();
  const starts = planStarts(plan).slice();
  let start = newStart;
  if (cascade) {
    const d = diffDays(plan.start, newStart);
    for (let i = 0; i < ends.length; i++) { ends[i] = addDaysISO(ends[i], d); if (starts[i]) starts[i] = addDaysISO(starts[i], d); }
  } else {
    if (dayNum(start) > dayNum(ends[first])) start = ends[first];
    for (let i = 0; i < first; i++) ends[i] = start;
  }
  return { ...plan, start, ends, starts, end: maxEnd(ends) };
}
// Bật/tắt "bỏ qua" cho bước idx. skip=true → 0 ngày. skip=false → `days` ngày (≥1).
// cascade=true → các bước sau dời theo (rút/kéo dài kế hoạch); false → giữ nguyên hạn các bước sau.
export function setStageSkip(plan, idx, skip, days, cascade) {
  const sk = normSkips(plan.skips);
  if (sk[idx] === !!skip && skip) return plan;
  const pe = dayNum(prevEndOf(plan, idx));
  const ends = plan.ends.slice();
  const starts = planStarts(plan).slice();
  const oldEnd = dayNum(ends[idx]);
  starts[idx] = null; // bật/tắt bỏ qua → bước nối tiếp bước trước như mặc định
  sk[idx] = !!skip;
  let newEnd = skip ? pe : pe + Math.max(1, Math.round(days) || 1);
  let k = idx + 1;
  while (k < PLAN_STAGE_COUNT && sk[k]) k += 1;
  if (!cascade && !skip && k < PLAN_STAGE_COUNT) newEnd = Math.min(newEnd, Math.max(pe + 1, dayNum(ends[k])));
  if (cascade) {
    const delta = newEnd - oldEnd;
    for (let i = idx; i < ends.length; i++) { ends[i] = numDay(dayNum(ends[i]) + delta); if (i > idx && starts[i]) starts[i] = addDaysISO(starts[i], delta); }
  } else {
    for (let i = idx; i < k; i++) ends[i] = numDay(newEnd);
  }
  return { ...plan, ends, starts, end: maxEnd(ends), skips: sk };
}

// Đọc kế hoạch của dự án → { start, ends[12], starts[12], derived[12], end, baseEnd, confirmed } hoặc null nếu chưa có kế hoạch đầy đủ.
// Bước có hạng mục trong "Tiến độ thi công" (project.schedule) → ngày bắt đầu / kết thúc lấy TỪ bảng đó (derived[i] = {s,e,pc,n}).
export function projectPlan(project) {
  const start = project.plannedStart;
  if (!start) return null;
  const skips = [];
  const ends = [];
  const starts = [];
  const derived = [];
  for (let id = 1; id <= PLAN_STAGE_COUNT; id++) {
    const st = project.stages?.[id];
    const sk = !!(st && st.skipped);
    skips.push(sk);
    const isDone = !!(st && st.state === "done" && st.completedAt);
    const dv = !sk && !(st && st.state === "done") ? schedDerive(project, id) : null;
    derived.push(dv);
    const d = isDone ? String(st.completedAt).slice(0, 10) : dv ? dv.e : st?.plannedDate;
    if (!d && !sk) return null;
    ends.push(d || start);
    starts.push(sk ? null : dv ? dv.s : (st && st.plannedStart) || null);
  }
  const first = (() => { let k = 0; while (k < PLAN_STAGE_COUNT - 1 && skips[k]) k += 1; return k; })();
  // chuẩn hoá: bước bỏ qua = hạn bước liền trước (0 ngày); bước nối tiếp bắt đầu khi bước trước kết thúc nên hạn ≥ +1 ngày;
  // bước có ngày bắt đầu riêng (song song) chỉ cần hạn không trước ngày bắt đầu của nó.
  for (let i = 0; i < ends.length; i++) {
    const pe = i ? dayNum(ends[i - 1]) : dayNum(start);
    if (skips[i]) { ends[i] = numDay(pe); starts[i] = null; continue; }
    if (i === first) starts[i] = null;
    const own = starts[i];
    if (own) { if (dayNum(ends[i]) < dayNum(own)) ends[i] = own; continue; }
    if (dayNum(ends[i]) < pe) ends[i] = numDay(pe);
  }
  const end = maxEnd(ends);
  let minStart = start;
  starts.forEach((x) => { if (x && dayNum(x) < dayNum(minStart)) minStart = x; });
  return { start, minStart, ends, starts, skips, derived, end, baseEnd: project.planBaseEnd || end, confirmed: project.planConfirmed !== false };
}
// Ghi kế hoạch vào các trường của dự án (trả về patch cho updateProject). Bước đã xong giữ nguyên plannedDate gốc.
export function planToPatch(project, plan, confirmed, by) {
  const stages = { ...project.stages };
  for (let id = 1; id <= PLAN_STAGE_COUNT; id++) {
    const st = stages[id];
    if (st && st.state !== "done") {
      const ps = plan.starts ? plan.starts[id - 1] || null : null;
      stages[id] = { ...st, plannedDate: plan.ends[id - 1], plannedStart: ps, skipped: plan.skips ? !!plan.skips[id - 1] : !!st.skipped };
    }
  }
  const patch = { plannedStart: plan.start, plannedEnd: plan.end, planBaseEnd: plan.baseEnd || plan.end, planConfirmed: confirmed, stages };
  // Bước hiện tại vừa bị đặt "bỏ qua" → tự đánh dấu xong và chuyển tới bước kế tiếp cần làm
  let cs = project.currentStage;
  const at = todayISO();
  while (cs <= PLAN_STAGE_COUNT && stages[cs] && stages[cs].skipped && stages[cs].state !== "done") {
    stages[cs] = { ...stages[cs], state: "done", completedAt: at, completedBy: by || null };
    cs += 1;
  }
  if (cs !== project.currentStage) patch.currentStage = cs;
  return patch;
}
// Gợi ý kế hoạch chỉ từ: ngày bắt đầu + (số ngày theo quy mô | ngày kết thúc).
// Các bước đã xong dùng ngày thực tế; nếu thiếu thì rải đều tới 7 ngày trước hôm nay.
export function suggestPlan(project, opts, today = todayISO()) {
  const start = opts.start || project.plannedStart || project.createdAt || today;
  const cur = Math.max(1, Math.min(PLAN_STAGE_COUNT, project.currentStage));
  const sk = normSkips(Array.from({ length: PLAN_STAGE_COUNT }, (_, i) => !!project.stages?.[i + 1]?.skipped));
  let known = [];
  if (cur > 1) {
    const lk = dayNum(addDaysISO(today, -7)) > dayNum(start) + cur - 1 ? addDaysISO(today, -7) : addDaysISO(start, cur - 1);
    const cw = PLAN_WEIGHTS.slice(0, cur - 1).map((w, i) => (sk[i] ? 0 : w));
    const sum = cw.reduce((a, b) => a + b, 0) || 1;
    let c = 0, prev = dayNum(start);
    cw.forEach((w, i) => {
      c += w;
      if (sk[i]) { known.push(numDay(prev)); return; }
      const st = project.stages?.[i + 1];
      const actual = st && st.state === "done" && st.completedAt ? dayNum(String(st.completedAt).slice(0, 10)) : null;
      let e = actual !== null ? actual : dayNum(start) + Math.round(((dayNum(lk) - dayNum(start)) * c) / sum);
      e = Math.max(e, prev + 1);
      known.push(numDay(e));
      prev = e;
    });
  }
  const last = known.length ? known[known.length - 1] : start;
  const restW = PLAN_WEIGHTS.slice(cur - 1).filter((_, i) => !sk[cur - 1 + i]);
  const share = restW.reduce((a, b) => a + b, 0) / 100;
  const end = opts.end ? opts.end : addDaysISO(last, Math.max(restW.length, Math.round((opts.days || suggestPlanDays(project.contractValue)) * share)));
  const plan = buildPlan(start, end, cur, known, sk);
  plan.baseEnd = plan.end;
  // Kế hoạch do hệ thống tự đề xuất (chưa ai nhập ngày kết thúc): bước hiện tại luôn còn ≥ 7 ngày kể từ hôm nay,
  // để bản nháp không "trễ" ngay từ đầu chỉ vì giả định thời lượng chung — người dùng sẽ chỉnh ở bước kiểm tra.
  if (!opts.end) {
    const need = diffDays(plan.ends[cur - 1], addDaysISO(today, 7));
    if (need > 0) {
      const shifted = shiftPlanFrom(plan, cur - 1, need);
      shifted.baseEnd = shifted.end;
      return shifted;
    }
  }
  return plan;
}
// Trạng thái tiến độ: good | warn (sắp hạn ≤3 ngày) | bad (trễ hoặc có điểm nghẽn) | none (chưa có kế hoạch) | ready (xong 12/12) | done (đã lưu trữ)
export function planStatus(project, today = todayISO()) {
  if (project.status === "closed") return { k: "done" };
  if (project.currentStage > PLAN_STAGE_COUNT) return { k: "ready" };
  const plan = projectPlan(project);
  const bn = hasOpenBottleneck(project);
  if (!plan) return { k: bn ? "bad" : "none", late: 0, left: null, bn, plan: null };
  const e = plan.ends[project.currentStage - 1];
  const late = Math.max(0, diffDays(e, today));
  const left = diffDays(today, e);
  const forecastEnd = addDaysISO(plan.end, late);
  if (late > 0 || bn) return { k: "bad", late, left, bn, forecastEnd, plan };
  if (left <= 3) return { k: "warn", late: 0, left, bn, forecastEnd, plan };
  return { k: "good", late: 0, left, bn, forecastEnd, plan };
}
export function planProgressPct(project, today = todayISO()) {
  if (project.status === "closed" || project.currentStage > PLAN_STAGE_COUNT) return 100;
  const cur = project.currentStage;
  const plan = projectPlan(project);
  const sk = plan ? plan.skips : [];
  const w = PLAN_WEIGHTS.map((x, i) => (sk[i] ? 0 : x)); // bước bỏ qua không tính vào tiến độ
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let pct = 0;
  for (let i = 0; i < PLAN_STAGE_COUNT; i++) {
    if (!w[i]) continue;
    if (i + 1 < cur) { pct += w[i]; continue; }
    if (!plan) { if (i + 1 === cur) pct += 0; continue; }
    const dv = plan.derived[i];
    if (dv) { pct += (w[i] * dv.pc) / 100; continue; }          // bước lấy từ Tiến độ thi công: dùng % thực tế của hạng mục
    const own = stepIsOwnStart(plan, i);
    if (i + 1 === cur || own) {                                  // bước hiện tại / bước chạy song song: theo tỷ lệ thời gian đã qua
      const s0 = stepStart(plan, i), e = plan.ends[i];
      pct += w[i] * Math.max(0, Math.min(1, diffDays(s0, today) / Math.max(1, diffDays(s0, e))));
    }
  }
  return Math.round((pct * 100) / total);
}
// ======================================================================
//  TIẾN ĐỘ THI CÔNG — bảng hạng mục chi tiết kiểu Excel của từng dự án
//  project.schedule = { groups: [{id,name}], items: [{id,gid,t,s,e,who,st,pc,note}] }
//    s/e = ngày bắt đầu/kết thúc (YYYY-MM-DD) · who = bên thực hiện · st = thuộc bước nào (1..12) · pc = % hoàn thành 0..100
//  Các bước có hạng mục (st) → ngày bắt đầu/kết thúc/% của bước đó TỰ LẤY từ bảng này (xem projectPlan / schedDerive).
//  "Số ngày" = ngày làm việc, KHÔNG tính Chủ nhật (như file Excel).
// ======================================================================
export const SCHED_WHO = ["NHÀ THẦU", "CĐT", "NHÀ THẦU & CĐT", "BP", "KD", "Khác"];
export const SCHED_STAGE_IDS = [2, 3, 4, 5, 6, 7, 8, 9, 10]; // các bước chọn được ở cột "Thuộc bước"
const dowOf = (iso) => new Date(dayNum(iso) * 86400000).getUTCDay();
export const isSunday = (iso) => dowOf(iso) === 0;
export function schedWdays(s, e) {
  let c = 0;
  for (let x = dayNum(s); x <= dayNum(e); x++) if (new Date(x * 86400000).getUTCDay() !== 0) c += 1;
  return c;
}
// Ngày kết thúc khi làm n ngày làm việc kể từ s (ngày s tính là ngày 1; n ≤ 0 → trả về s)
export function schedEndFromDays(s, n) {
  if (!(n >= 1)) return s;
  let c = 0, x = dayNum(s);
  for (let guard = 0; guard < 4000; guard++, x++) {
    if (new Date(x * 86400000).getUTCDay() !== 0) { c += 1; if (c === n) return numDay(x); }
  }
  return numDay(x);
}
export function makeSchedGroup(name) { return { id: uid("sg"), name: name || "Nhóm mới" }; }
export function makeSchedItem(data) {
  const s = data.s || todayISO();
  const e = data.e && data.e >= s ? data.e : s;
  return {
    id: data.id || uid("si"), gid: data.gid, t: data.t || "Hạng mục mới", s, e,
    who: data.who || "NHÀ THẦU", st: data.st || 7, pc: Math.max(0, Math.min(100, Math.round(+data.pc || 0))), note: data.note || "",
    // vết hoàn thành / dời lịch: ngày xong thực tế, kế hoạch gốc (s0/e0) để biết sớm – trễ bao nhiêu, % trước khi bấm xong (pc0)
    doneAt: data.doneAt || null, s0: data.s0 || null, e0: data.e0 || null, pc0: data.pc0 == null ? null : data.pc0,
    sp: data.sp || null, ep: data.ep || null, dv: data.dv == null ? null : data.dv, bd: data.bd || null,
  };
}
export const schedItems = (project) => (project.schedule && project.schedule.items) || [];
export const schedGroups = (project) => (project.schedule && project.schedule.groups) || [];
export const schedWeight = (it) => Math.max(1, schedWdays(it.s, it.e));
export function schedPct(items) {
  if (!items.length) return 0;
  const w = items.reduce((a, i) => a + schedWeight(i), 0);
  return Math.round(items.reduce((a, i) => a + schedWeight(i) * (i.pc || 0), 0) / w);
}
export function schedRange(items) {
  if (!items.length) return null;
  return { s: items.reduce((m, i) => (i.s < m ? i.s : m), items[0].s), e: items.reduce((m, i) => (i.e > m ? i.e : m), items[0].e) };
}
// Bước stageId lấy ngày & % từ các hạng mục gắn với nó
export function schedDerive(project, stageId) {
  const a = schedItems(project).filter((i) => i.st === stageId);
  if (!a.length) return null;
  const r = schedRange(a);
  return { s: r.s, e: r.e, pc: schedPct(a), n: a.length };
}
export const schedIsLate = (it, today) => (it.pc || 0) < 100 && it.e < today;
// Sớm (+) / trễ (−) bao nhiêu ngày:
//  - hạng mục ĐÃ XONG: so với hạn kế hoạch của nó TẠI THỜI ĐIỂM bấm xong (it.dv) — không tính các lần dời lịch trước đó
//    (đang chờ BOD duyệt ngày xong → 0, chưa kết luận sớm/trễ)
//  - hạng mục CHƯA XONG nhưng đã được dời lịch: so với kế hoạch gốc (e0)
export const schedPending = (it) => !!(it.bd && it.bd.status === "pending");
export function schedVariance(it) {
  if (it.doneAt) return schedPending(it) ? 0 : (it.dv || 0);
  return it.e0 && it.e0 !== it.e ? diffDays(it.e, it.e0) : 0;
}
// Ngày kết thúc theo kế hoạch gốc của cả bảng (để biết đã rút ngắn bao nhiêu)
export function schedBaseEnd(items) {
  if (!items.length) return null;
  const be = (i) => (i.doneAt && i.ep == null ? i.e : (i.e0 || i.e)); // hạng mục xong từ bản cũ không có vết đáng tin → coi như không có kế hoạch gốc
  return items.reduce((m, i) => (be(i) > m ? be(i) : m), be(items[0]));
}
// Đánh dấu hoàn thành / bỏ hoàn thành 1 hạng mục.
//  opts = { date, reason, by, role }:
//   - date = ngày hoàn thành THỰC TẾ (mặc định hôm nay; chọn ngày đã qua nếu quên cập nhật).
//   - Ngày đã qua do BOD nhập → áp dụng ngay. Do KD/BP nhập → ghi nhận xong hôm nay và CHỜ BOD DUYỆT ngày thực tế (it.bd.status = "pending").
//  Xong sớm → hạn của hạng mục rút về ngày xong thực tế. Trả về { items, early, pending }
//  (early > 0 sớm, < 0 trễ so với hạn kế hoạch lúc bấm xong; 0 nếu đúng hạn / đang chờ duyệt / bỏ hoàn thành).
export function schedSetDone(items, id, done, today, opts) {
  const o = opts || {};
  let early = 0, pending = false;
  const out = items.map((it) => {
    if (it.id !== id) return it;
    if (done) {
      if (it.doneAt && (it.pc || 0) >= 100) return it;
      let want = o.date && o.date <= today ? o.date : today;
      const back = want < today;
      pending = back && o.role !== "BOD";
      const actual = pending ? today : want;
      const x = { ...it, pc0: (it.pc || 0) < 100 ? (it.pc || 0) : (it.pc0 == null ? 0 : it.pc0), pc: 100, doneAt: actual, sp: it.s, ep: it.e, s0: it.s0 || it.s, e0: it.e0 || it.e };
      if (actual < x.s) { x.s = actual; x.e = actual; } else x.e = actual;
      x.dv = diff2(x.e, it.e);
      x.bd = back ? { date: want, reason: o.reason || "", by: o.by || o.role || "", at: today, status: pending ? "pending" : "approved", decidedBy: pending ? null : (o.by || o.role || ""), decidedAt: pending ? null : today } : null;
      early = pending ? 0 : x.dv;
      return x;
    }
    // bỏ hoàn thành: trả về lịch trước khi bấm xong (kế hoạch gốc chỉ giữ lại nếu hạng mục từng được dời)
    const pc0 = it.pc0 == null ? 0 : Math.min(99, it.pc0);
    const ns = it.sp || it.s0 || it.s, ne = it.ep || it.e0 || it.e;
    const keep = it.e0 && it.e0 !== ne;
    return { ...it, pc: pc0, doneAt: null, s: ns, e: ne, sp: null, ep: null, dv: null, bd: null, pc0: null, s0: keep ? it.s0 : null, e0: keep ? it.e0 : null };
  });
  return { items: out, early, pending };
}
const diff2 = (a, b) => diffDays(a, b); // b − a: dương = a sớm hơn b
// BOD duyệt / từ chối ngày hoàn thành thực tế đang chờ. Duyệt → ngày xong = ngày đã nhập; từ chối → giữ nguyên là xong hôm nay đã ghi.
export function schedDecide(items, id, approve, by, today) {
  return items.map((it) => {
    if (it.id !== id || !schedPending(it)) return it;
    if (!approve) return { ...it, bd: { ...it.bd, status: "rejected", decidedBy: by || "BOD", decidedAt: today } };
    const actual = it.bd.date;
    const x = { ...it, doneAt: actual, s: it.sp || it.s, e: it.ep || it.e };
    if (actual < x.s) { x.s = actual; x.e = actual; } else x.e = actual;
    x.dv = diff2(x.e, it.ep || it.e);
    x.bd = { ...it.bd, status: "approved", decidedBy: by || "BOD", decidedAt: today };
    return x;
  });
}
export const schedPendingItems = (items) => items.filter(schedPending);
// Câu thông báo sau khi bấm hoàn thành / bỏ hoàn thành
export function schedDoneMessage(name, done, r) {
  if (!done) return `Đã bỏ đánh dấu xong “${name}” — trả về kế hoạch trước khi bấm xong`;
  if (r.pending) return `Đã ghi nhận “${name}” xong — ngày thực tế đã nhập đang CHỜ BOD DUYỆT (chưa tính sớm/trễ)`;
  if (r.early > 0) return `Xong “${name}” sớm ${r.early} ngày so với kế hoạch — hạn hạng mục đã rút ngắn`;
  if (r.early < 0) return `Xong “${name}” trễ ${-r.early} ngày so với kế hoạch`;
  return `Xong “${name}” đúng tiến độ`;
}
// Sau khi 1 hạng mục xong sớm `early` ngày: dời các hạng mục NỐI SAU nó (bắt đầu từ ngày hạn kế hoạch của nó lúc bấm xong, chưa xong) sớm lên tương ứng,
// giữ nguyên số ngày làm việc, không sớm hơn ngày hạng mục kia xong thực tế và không sớm hơn hôm nay.
export function schedPullForward(items, id, early, today) {
  const src = items.find((i) => i.id === id);
  if (!src || !(early > 0)) return { items, moved: 0 };
  const orig = src.ep || src.e;
  let moved = 0;
  const floor = src.e > today ? src.e : today;
  const out = items.map((it) => {
    if (it.id === id || (it.pc || 0) >= 100 || it.doneAt || it.s < orig) return it;
    let ns = addDaysISO(it.s, -early);
    if (ns < floor) ns = floor;
    if (isSunday(ns)) ns = addDaysISO(ns, 1);
    if (ns >= it.s) return it;
    const n = schedWdays(it.s, it.e);
    const ne = n >= 1 ? schedEndFromDays(ns, n) : ns;
    moved += 1;
    return { ...it, s0: it.s0 || it.s, e0: it.e0 || it.e, s: ns, e: ne };
  });
  return { items: out, moved };
}

// Hạng mục chưa xong đang chạy hôm nay / trong khoảng, hoặc đã trễ
export function schedDueItems(project, from, to) {
  return schedItems(project).filter((i) => (i.pc || 0) < 100 && (i.e < from || (i.s <= to && i.e >= from)));
}
const STAGE_GUESS = [
  [/bàn giao/i, 10], [/test|dặm vá|nghiệm thu|qc|kiểm tra/i, 8], [/sản xuất|xưởng|gia công/i, 6],
  [/bản vẽ|shop|duyệt|mẫu|trình|thiết kế/i, 3],
];
export function guessSchedStage(text) {
  for (const [re, id] of STAGE_GUESS) if (re.test(text)) return id;
  return 7;
}
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)[.):]?$/i;
function parseVNDate(x, today) {
  let m = String(x).trim().match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? +m[3] : +today.slice(0, 4);
    if (y < 100) y += 2000;
    const mo = +m[2], d = +m[1];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = String(x).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : null;
}
// Dán từ Excel: các cột phân cách bằng Tab (hoặc ≥2 dấu cách): STT · Hạng mục · Bắt đầu · Kết thúc · Thời lượng · Thực hiện
// Dòng chỉ có "I", "II", "III" (+ tên nhóm) = nhóm. Trả về [{name, items:[{t,s,e,who,st,pc,note}]}]
export function parseSchedule(text, today) {
  const out = [];
  let g = null;
  String(text || "").split(/\r?\n/).forEach((raw) => {
    if (!raw.trim()) return;
    const c = raw.split(/\t| {2,}/).map((x) => x.trim()).filter((x) => x !== "");
    if (!c.length) return;
    if (ROMAN.test(c[0]) && c.length <= 2) { g = { name: (c[0].toUpperCase().replace(/[.):]$/, "") + (c[1] ? " · " + c[1] : "")), items: [] }; out.push(g); return; }
    const dates = c.map((x) => parseVNDate(x, today)).filter(Boolean);
    if (!dates.length) return;
    if (!g) { g = { name: "Hạng mục", items: [] }; out.push(g); }
    const isNum = (x) => /^\d+([.,]\d+)?$/.test(x);
    const whoCell = c.find((x) => SCHED_WHO.some((w) => w.toUpperCase() === x.toUpperCase()));
    const t = c.find((x, i) => i < 3 && !isNum(x) && !parseVNDate(x, today) && !/ngày$/i.test(x) && !SCHED_WHO.some((w) => w.toUpperCase() === x.toUpperCase())) || c[1] || c[0];
    const s = dates[0];
    const e = dates[1] && dates[1] >= s ? dates[1] : s;
    g.items.push({ t, s, e, who: whoCell ? SCHED_WHO.find((w) => w.toUpperCase() === whoCell.toUpperCase()) : "NHÀ THẦU", st: guessSchedStage(t), pc: 0, note: "" });
  });
  return out.filter((x) => x.items.length);
}
// Mẫu nhanh — rút từ bảng tiến độ thực tế (Cơm Tấm Má Tư – CN5). Ngày tương đối so với ngày bắt đầu.
const TPL_BASE = "2026-10-05";
const TPL_FB = [
  ["I · Chuẩn bị", [
    ["Chốt bản vẽ, shop draw", "2026-10-05", "2026-10-11", "NHÀ THẦU & CĐT", 3],
    ["Trình & duyệt mẫu vật tư", "2026-10-05", "2026-10-11", "NHÀ THẦU & CĐT", 3]]],
  ["II · XDCB + MEP", [
    ["Tháo dỡ", "2026-10-06", "2026-10-07", "NHÀ THẦU", 7],
    ["MEP âm tường, âm sàn, thả trần", "2026-10-08", "2026-10-13", "NHÀ THẦU", 7],
    ["Thi công phần vách thạch cao", "2026-10-11", "2026-10-11", "NHÀ THẦU", 7],
    ["Thi công PCCC, điện lạnh & điện nhẹ", "2026-10-12", "2026-10-14", "NHÀ THẦU", 7],
    ["Sơn nước hoàn thiện + các phần sơn khác", "2026-10-15", "2026-10-21", "NHÀ THẦU", 7],
    ["Thi công công tác hoàn thiện sàn", "2026-10-20", "2026-10-21", "NHÀ THẦU", 7],
    ["Lắp vách trang trí & mặt dựng băng hiệu", "2026-10-21", "2026-10-22", "NHÀ THẦU", 7],
    ["Đấu nối lắp đặt thiết bị", "2026-10-23", "2026-10-24", "NHÀ THẦU", 7],
    ["Thi công cửa phòng kho & tay nắm cửa mặt tiền", "2026-10-25", "2026-10-25", "NHÀ THẦU", 7],
    ["Vệ sinh thô", "2026-10-25", "2026-10-25", "NHÀ THẦU", 7]]],
  ["III · Thi công hoàn thiện", [
    ["Sản xuất phần nội thất", "2026-10-11", "2026-10-23", "NHÀ THẦU", 6],
    ["Lắp đặt phần nội thất & sắp xếp cửa hàng", "2026-10-26", "2026-10-28", "NHÀ THẦU", 7],
    ["Lắp đặt phần quảng cáo, MKT & thiết bị hỗ trợ khác", "2026-10-28", "2026-10-29", "NHÀ THẦU", 7],
    ["Chạy test hệ thống + dặm vá (nếu có)", "2026-10-29", "2026-10-30", "NHÀ THẦU", 8],
    ["Vệ sinh công nghiệp", "2026-10-30", "2026-10-30", "NHÀ THẦU", 7],
    ["Bàn giao", "2026-10-31", "2026-10-31", "CĐT", 10]]],
];
export const SCHED_TEMPLATES = [
  { id: "fb", label: "Cửa hàng F&B — mẫu Cơm Tấm Má Tư (~27 ngày)", scale: 1 },
  { id: "fb-s", label: "Cửa hàng nhỏ — rút gọn (~14 ngày)", scale: 0.5 },
  { id: "fb-l", label: "Cửa hàng lớn — kéo dài (~40 ngày)", scale: 1.5 },
  { id: "blank", label: "Bảng trống (3 nhóm: Chuẩn bị / XDCB + MEP / Hoàn thiện)", scale: 0 },
];
export function schedFromTemplate(tplId, start) {
  const tpl = SCHED_TEMPLATES.find((x) => x.id === tplId) || SCHED_TEMPLATES[0];
  const groups = [], items = [];
  TPL_FB.forEach(([name, rows]) => {
    const g = makeSchedGroup(name);
    groups.push(g);
    if (!tpl.scale) return;
    rows.forEach(([t, s0, e0, who, st]) => {
      const so = Math.round(diffDays(TPL_BASE, s0) * tpl.scale), eo = Math.max(so, Math.round(diffDays(TPL_BASE, e0) * tpl.scale));
      items.push(makeSchedItem({ gid: g.id, t, s: addDaysISO(start, so), e: addDaysISO(start, eo), who, st, pc: 0 }));
    });
  });
  return { groups, items };
}

/* ---------------------------------------------------------------------- */
/*  CƠ HỘI BÁN HÀNG — bảng công việc & timeline (cùng mô hình với tiến độ thi công) */
/*  opportunity.schedule = { groups[], items[] }; item.st = id bước Stage-Gate (OPP_STAGES) */
/* ---------------------------------------------------------------------- */
export const OPP_SCHED_WHO = ["KD", "BP", "BOD", "Khách hàng", "Khác"];
export const OPP_SCHED_STAGE_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
// [bước, tên nhóm, [[tên việc, ai, số ngày làm việc]...]]
const OPP_TPL = [
  [1, "I · Lead", [["Ghi nhận lead, thông tin liên hệ khách", "KD", 1]]],
  [2, "II · Tiếp cận", [["Liên hệ lần đầu (gọi / nhắn)", "KD", 1], ["Gặp / trao đổi, khách xác nhận quan tâm", "KD", 2]]],
  [3, "III · Xác định nhu cầu", [["Thu thập nhu cầu, ngân sách dự kiến", "KD", 2], ["Chốt thời gian mong muốn & tiêu chí chọn nhà thầu", "KD", 1]]],
  [4, "IV · Khảo sát", [["Hẹn lịch khảo sát mặt bằng", "KD", 1], ["Khảo sát, đo đạc hiện trạng", "KD", 2], ["Tổng hợp hồ sơ khảo sát", "BP", 1]]],
  [5, "V · Concept / Giải pháp", [["Lên concept / giải pháp", "BP", 4], ["Trình bày concept với khách", "KD", 1], ["Chỉnh sửa theo góp ý của khách", "BP", 2]]],
  [6, "VI · Báo giá", [["Bóc khối lượng, lập báo giá", "BP", 3], ["Duyệt nội bộ báo giá", "BOD", 1], ["Gửi báo giá chính thức cho khách", "KD", 1]]],
  [7, "VII · Đàm phán", [["Đàm phán giá & điều khoản", "KD", 4], ["Chốt dự thảo hợp đồng", "KD", 2]]],
  [8, "VIII · Chốt WON / LOST", [["Ký hợp đồng / nhận phản hồi cuối của khách", "KD", 1]]],
];
export const OPP_SCHED_TEMPLATES = [
  { id: "full", label: "Đủ 7 bước bán hàng (~28 ngày làm việc)", mode: "full" },
  { id: "fast", label: "Cơ hội nhanh — mỗi bước 1 việc chính (~10 ngày)", mode: "fast" },
  { id: "blank", label: "Bảng trống (các nhóm theo 7 bước, tự thêm việc)", mode: "blank" },
];
const nextWorkDay = (iso) => { let x = iso; while (isSunday(x)) x = addDaysISO(x, 1); return x; };
export function oppSchedFromTemplate(tplId, start) {
  const tpl = OPP_SCHED_TEMPLATES.find((x) => x.id === tplId) || OPP_SCHED_TEMPLATES[0];
  const groups = [], items = [];
  let cur = nextWorkDay(start);
  OPP_TPL.forEach(([st, name, rows]) => {
    const g = makeSchedGroup(name);
    groups.push(g);
    if (tpl.mode === "blank") return;
    const use = tpl.mode === "fast" ? [[rows[0][0], rows[0][1], 1]] : rows;
    use.forEach(([t, who, n]) => {
      const e = schedEndFromDays(cur, n);
      items.push(makeSchedItem({ gid: g.id, t, s: cur, e, who, st, pc: 0 }));
      cur = nextWorkDay(addDaysISO(e, 1));
    });
  });
  return { groups, items };
}

/* ---------------------------------------------------------------------- */
/*  CHUYỂN DỰ ÁN VỀ LẠI CƠ HỘI (deal lại từ đầu hạng mục / BOQ)              */
/*  - KD/BP đề xuất (project.revert = {status:"pending",…}); BOD duyệt hoặc chuyển thẳng */
/*  - dự án được LƯU TRỮ (status "reverted", ẩn khỏi mọi số tổng), cơ hội cũ mở lại ở bước Báo giá */
/* ---------------------------------------------------------------------- */
export const OPP_REVERT_STAGE_ID = 6; // Báo giá
// [tên việc, ai, số ngày làm việc, bước Stage-Gate]
const REVERT_TPL = [
  ["Rà soát phạm vi & các hạng mục phải deal lại với khách", "KD", 1, 6],
  ["Lập lại BOQ / khối lượng theo phạm vi mới", "BP", 3, 6],
  ["Duyệt nội bộ báo giá mới", "BOD", 1, 6],
  ["Gửi báo giá mới cho khách", "KD", 1, 6],
  ["Đàm phán lại giá & hạng mục", "KD", 3, 7],
  ["Chốt phụ lục / hợp đồng điều chỉnh", "KD", 2, 7],
  ["Ký lại — WON", "KD", 1, 8],
];
export function projectRevertSummary(p) {
  const items = schedItems(p);
  return {
    stage: p.currentStage, stageLabel: (PROJECT_STAGES.find((s) => s.id === p.currentStage) || {}).label || "",
    pct: projectStagePct(p), contractValue: p.contractValue || 0, collected: projectCollected(p),
    budget: (p.costs || []).reduce((a, c) => a + (c.budget || 0), 0), actualCost: (p.costs || []).reduce((a, c) => a + (c.actual || 0), 0),
    siteItems: items.length, siteDone: items.filter((i) => (i.pc || 0) >= 100).length, sitePct: items.length ? schedPct(items) : null,
  };
}
export const makeRevertRequest = (reason, by, now) => ({ status: "pending", reason, by, at: now, decidedBy: null, decidedAt: null, note: null });
export function revertProjectToOpportunity(project, opp, { reason, requestedBy, approvedBy, now }) {
  const sum = projectRevertSummary(project);
  const freshStage = (st) => ({ ...st, state: "pending", gateChecked: (st.gateChecked || []).map(() => false), completedAt: null, completedBy: null });
  let base = opp;
  if (!base) {
    base = makeOpportunity({ title: project.name, customerId: project.customerId, customerName: project.customerName, value: project.contractValue, note: project.scope, createdAt: project.createdAt });
    const st = {};
    OPP_STAGES.forEach((d) => { const cur = base.stages[d.id]; st[d.id] = d.id < OPP_REVERT_STAGE_ID ? { ...cur, state: "done", gateChecked: cur.gateChecked.map(() => true), completedAt: now, completedBy: approvedBy } : cur; });
    base = { ...base, stages: st };
  }
  const stages = {};
  OPP_STAGES.forEach((d) => { const cur = base.stages[d.id]; stages[d.id] = d.id >= OPP_REVERT_STAGE_ID ? freshStage(cur) : cur; });
  // nhóm việc "deal lại" bắt đầu từ hôm nay
  const sch = base.schedule || { groups: [], items: [] };
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][sch.groups.length] || String(sch.groups.length + 1);
  const g = makeSchedGroup(`${roman} · Deal lại (chuyển từ dự án ${project.code})`);
  let cur = nextWorkDay(now);
  const newItems = REVERT_TPL.map(([t, who, n, st]) => {
    const e = schedEndFromDays(cur, n);
    const it = makeSchedItem({ gid: g.id, t, s: cur, e, who, st, pc: 0 });
    cur = nextWorkDay(addDaysISO(e, 1));
    return it;
  });
  const hist = {
    id: uid("rv"), code: project.code, name: project.name, contractValue: sum.contractValue, collected: sum.collected, actualCost: sum.actualCost,
    stage: sum.stage, stageLabel: sum.stageLabel, pct: sum.pct, sitePct: sum.sitePct, reason, requestedBy, approvedBy, at: now,
  };
  const newOpp = {
    ...base, status: "open", currentStage: OPP_REVERT_STAGE_ID, stages, lostReason: null, wonProjectCode: null,
    projectHistory: [...(base.projectHistory || []), hist], reopenedFromProject: project.code, reopenedAt: now,
    bottlenecks: [...(base.bottlenecks || []), { id: uid("bn"), stageId: OPP_DECISION_STAGE_ID, reason: `Chuyển từ dự án ${project.code} về cơ hội: ${reason}`, by: approvedBy, at: now, resolvedAt: now }],
    schedule: { groups: [...sch.groups, g], items: [...sch.items, ...newItems] },
  };
  const newProject = {
    ...project, status: "reverted", revertedAt: now, revertedToOppId: newOpp.id,
    revert: { ...(project.revert || {}), status: "approved", reason, by: requestedBy, decidedBy: approvedBy, decidedAt: now },
  };
  return { project: newProject, opp: newOpp };
}

// Sau khi 1 bước vừa được hoàn thành: nếu hoàn thành TRỄ hơn hạn của bước đó → chia lại các bước còn lại
// từ hôm nay tới ngày kết thúc (kế hoạch giữ nguyên ngày kết thúc). Hoàn thành đúng/sớm hạn → giữ nguyên.
export function replanAfterAdvance(oldProject, newProject) {
  const old = projectPlan(oldProject);
  if (!old) return newProject;
  if (old.starts.some(Boolean) || (oldProject.schedule?.items || []).length) return newProject; // kế hoạch có bước chạy song song / có bảng thi công: không tự chia lại, người dùng chỉnh tay
  const stageId = oldProject.currentStage;
  if (stageId > PLAN_STAGE_COUNT || newProject.currentStage === stageId) return newProject;
  const actual = newProject.stages[stageId]?.completedAt;
  if (!actual || diffDays(old.ends[stageId - 1], String(actual).slice(0, 10)) <= 0 || newProject.currentStage > PLAN_STAGE_COUNT) return newProject;
  const cur = newProject.currentStage;
  const known = old.ends.slice(0, cur - 1);
  known[stageId - 1] = String(actual).slice(0, 10);
  for (let i = stageId; i < cur - 1; i++) if (old.skips[i]) known[i] = known[stageId - 1]; // bước bỏ qua đi theo
  const plan = buildPlan(old.start, old.end, cur, known, old.skips);
  plan.baseEnd = old.baseEnd;
  return { ...newProject, ...planToPatch(newProject, plan, old.confirmed) };
}
export const milestoneAmount = (project, index) => milestoneAmounts(project)[index] || 0;

export function makeRevenueEvent(type, date, amount, note) {
  return { id: uid("rev"), type, date, amount, note };
}
export function makeCost(category, budget, actual, note) {
  return { id: uid("cost"), category, budget: budget || 0, actual: actual || 0, note: note || "" };
}

/* ---------------------------------------------------------------------- */
/*  TASK & DEADLINE (chung toàn hệ thống, gắn theo mã dự án)                */
/* ---------------------------------------------------------------------- */

export function makeTask(data) {
  return {
    id: uid("task"), title: data.title, projectCode: data.projectCode || null,
    assignee: data.assignee || "", dueDate: data.dueDate || todayISO(),
    status: "open", // open | done
    note: data.note || "", createdAt: todayISO(),
  };
}
export function isTaskOverdue(task) {
  return task.status === "open" && task.dueDate < todayISO();
}

/* ---------------------------------------------------------------------- */
/*  WARRANTY / CRM CSKH (tự tạo khi Project vào bước Warranty)              */
/* ---------------------------------------------------------------------- */

export function makeWarrantyRecord(project) {
  return {
    id: uid("crm"), projectCode: project.code, projectName: project.name, customerName: project.customerName,
    transferredAt: todayISO(), warrantyMonths: 12, status: "active", notes: [],
  };
}

/* ---------------------------------------------------------------------- */
/*  SOP FUNNEL — theo cấu trúc mới, tách 2 chặng Sales & Delivery            */
/* ---------------------------------------------------------------------- */
export const SOP_BOTTLENECK_CONVERSION = 50;

/* ---------------------------------------------------------------------- */
/*  NHÂN VIÊN (Employee) — roster có thể thêm/sửa/đổi vai trò/ngừng hoạt động */
/* ---------------------------------------------------------------------- */
// Mọi "Nhân viên phụ trách" gắn vào Khách hàng đều tham chiếu tới đúng 1 bản
// ghi ở đây qua accountOwnerId — không còn nhập tay tên tự do.

export function makeEmployee(data) {
  return { id: uid("emp"), name: data.name, role: data.role || "KD", active: data.active !== false };
}

export function seedEmployees() {
  return [
    { id: "e1", name: "Nguyễn Văn Long", role: "KD", active: true },
    { id: "e2", name: "Phạm Thu Hà", role: "KD", active: true },
    { id: "e3", name: "Lê Gia Bảo", role: "KD", active: true },
    { id: "e4", name: "Trần Minh Hùng", role: "BP", active: true },
  ];
}

/** Doanh thu / công nợ / pipeline quy về theo từng Nhân viên phụ trách khách hàng. */
export function employeeSummary(employees, customers, opportunities, projects) {
  return employees.map((e) => {
    const ownedCustomers = customers.filter((c) => c.accountOwnerId === e.id);
    const ownedCustomerIds = new Set(ownedCustomers.map((c) => c.id));
    const ownedProjects = projects.filter((p) => p.customerId && ownedCustomerIds.has(p.customerId));
    const ownedOpenOpps = opportunities.filter((o) => o.status === "open" && o.customerId && ownedCustomerIds.has(o.customerId));
    return {
      employee: e,
      customerCount: ownedCustomers.length,
      projectCount: ownedProjects.length,
      pipelineValue: ownedOpenOpps.reduce((s, o) => s + o.value, 0),
      contractValue: ownedProjects.reduce((s, p) => s + p.contractValue, 0),
      collected: ownedProjects.reduce((s, p) => s + projectCollected(p), 0),
      ar: ownedProjects.reduce((s, p) => s + Math.max(0, projectAR(p)), 0),
    };
  });
}

/* ---------------------------------------------------------------------- */
/*  SEED DATA                                                               */
/* ---------------------------------------------------------------------- */

export function seedCustomers() {
  return [
    { id: "c1", company: "Công ty CP Nội Thất ABC", industry: "Nội thất bán lẻ", tier: "high",
      accountOwnerId: "e1", accountOwnerName: "Nguyễn Văn Long",
      contacts: [
        { id: uid("ct"), name: "Nguyễn Thị Lan Anh", position: "Giám đốc Vận hành", phone: "090 123 4567", isPrimary: true },
        { id: uid("ct"), name: "Trần Bảo Châu", position: "Trưởng phòng Thu mua", phone: "090 111 2222", isPrimary: false },
      ],
      overview: "Chuỗi showroom nội thất trung – cao cấp, đang mở rộng thêm 2 showroom tại TP.HCM trong năm nay.",
      advantage: "Khách hàng cũ, đã hợp tác 1 dự án thành công, thiện chí thanh toán tốt." },
    { id: "c2", company: "Công ty TNHH Fintech XYZ", industry: "Công nghệ tài chính", tier: "high",
      accountOwnerId: "e2", accountOwnerName: "Phạm Thu Hà",
      contacts: [
        { id: uid("ct"), name: "Trần Minh Khoa", position: "Trưởng phòng Hành chính", phone: "091 234 5678", isPrimary: true },
        { id: uid("ct"), name: "Vũ Ngọc Diệp", position: "CFO", phone: "091 222 3333", isPrimary: false },
      ],
      overview: "Startup fintech tăng trưởng nhanh, vừa gọi vốn vòng Series A, có nhu cầu mở thêm văn phòng chi nhánh.",
      advantage: "Ngân sách lớn, ra quyết định nhanh, tiềm năng hợp đồng dài hạn cho các chi nhánh mới." },
    { id: "c3", company: "Sóng Coffee Group", industry: "F&B", tier: "high",
      accountOwnerId: "e1", accountOwnerName: "Nguyễn Văn Long",
      contacts: [
        { id: uid("ct"), name: "Phạm Anh Tuấn", position: "Giám đốc Phát triển", phone: "093 345 6789", isPrimary: true },
        { id: uid("ct"), name: "Ngô Thị Kim", position: "Quản lý Vận hành chuỗi", phone: "093 333 4444", isPrimary: false },
      ],
      overview: "Chuỗi cafe đang nhân rộng mô hình, kế hoạch mở 10 chi nhánh trong 18 tháng tới.",
      advantage: "Đơn hàng lặp lại theo chuỗi, thiết kế mẫu có thể tái sử dụng, biên lợi nhuận ổn định." },
    { id: "c4", company: "Sunview Realty", industry: "Bất động sản", tier: "normal",
      accountOwnerId: "e3", accountOwnerName: "Lê Gia Bảo",
      contacts: [{ id: uid("ct"), name: "Lê Thị Hồng Nhung", position: "Giám đốc Kinh doanh", phone: "094 456 7890", isPrimary: true }],
      overview: "Chủ đầu tư bất động sản, cần đối tác nội thất căn hộ mẫu cho nhiều dự án song song.",
      advantage: "Khối lượng công việc lớn nhưng cạnh tranh giá cao, cần kiểm soát chi phí chặt." },
    { id: "c5", company: "Biển Đông F&B", industry: "F&B", tier: "normal",
      accountOwnerId: "e2", accountOwnerName: "Phạm Thu Hà",
      contacts: [{ id: uid("ct"), name: "Đỗ Văn Hùng", position: "Chủ đầu tư", phone: "090 567 8901", isPrimary: true }],
      overview: "Nhà đầu tư mở chuỗi nhà hàng hải sản cao cấp, đang khảo sát thêm 2 mặt bằng mới.",
      advantage: "Ngân sách tốt, quyết định nhanh vì là chủ đầu tư trực tiếp." },
  ];
}

export function seedOpportunities(customers) {
  const byName = (n) => customers.find((c) => c.company === n);

  const o1 = makeOpportunity({ title: "5 phòng khám mới", customerId: null, customerName: "Chuỗi Nha Khoa Sài Gòn", value: 400000000, note: "Quan tâm nội thất 5 phòng khám mới.", createdAt: "2026-06-20" });
  o1.currentStage = 2;

  const o2 = makeOpportunity({ title: "Phòng gym 800m²", customerId: null, customerName: "Gym & Fitness PowerHouse", value: 600000000, note: "Đã hẹn gặp tuần sau.", createdAt: "2026-06-10" });
  o2.stages[1] = { state: "done", gateChecked: [true], completedAt: "2026-06-12", completedBy: "KD - Thảo" };
  o2.currentStage = 2;

  const o3 = makeOpportunity({ title: "Văn phòng luật 2 tầng", customerId: null, customerName: "Văn phòng Luật Minh Tín", value: 480000000, note: "Đã khảo sát, chờ lên concept.", createdAt: "2026-06-01" });
  [1, 2, 3].forEach((id) => { o3.stages[id] = { state: "done", gateChecked: OPP_STAGES.find((s) => s.id === id).gate.map(() => true), completedAt: "2026-06-05", completedBy: "KD - Thảo" }; });
  o3.currentStage = 4;

  const o4 = makeOpportunity({ title: "Coworking 1.200m²", customerId: null, customerName: "Coworking Space Hive", value: 900000000, note: "Đang chờ khách phản hồi báo giá.", createdAt: "2026-05-20" });
  [1, 2, 3, 4, 5].forEach((id) => { o4.stages[id] = { state: "done", gateChecked: OPP_STAGES.find((s) => s.id === id).gate.map(() => true), completedAt: "2026-05-25", completedBy: "KD - Long" }; });
  o4.currentStage = 6;
  o4.stages[6] = { state: "done", gateChecked: [true], completedAt: "2026-06-24", completedBy: "BP - Hùng" };
  o4.currentStage = 7;
  o4.stages[3] = { state: "done", gateChecked: [true], completedAt: "2026-05-30", completedBy: "KD - Long" };

  const o5 = makeOpportunity({ title: "Chi nhánh Sóng Coffee thứ 4", customerId: byName("Sóng Coffee Group")?.id, customerName: "Sóng Coffee Group", value: 150000000, note: "Khách cũ mở rộng thêm chi nhánh mới.", createdAt: "2026-06-15" });
  o5.currentStage = 2;

  const o6 = makeOpportunity({ title: "Showroom ô tô 600m²", customerId: null, customerName: "Showroom Ô tô Đức Long", value: 1200000000, note: "Sắp chốt, chờ ký hợp đồng.", createdAt: "2026-05-01" });
  [1, 2, 3, 4, 5, 6].forEach((id) => { o6.stages[id] = { state: "done", gateChecked: OPP_STAGES.find((s) => s.id === id).gate.map(() => true), completedAt: "2026-06-01", completedBy: "KD - Long" }; });
  o6.currentStage = 7;
  o6.stages[7] = { state: "done", gateChecked: [true], completedAt: "2026-06-28", completedBy: "KD - Long" };
  o6.currentStage = OPP_DECISION_STAGE_ID;

  const o7 = makeOpportunity({ title: "Spa 3 phòng", customerId: null, customerName: "Spa Ngọc Trai", value: 320000000, note: "Khách chọn đối tác khác vì giá.", createdAt: "2026-05-10" });
  [1, 2, 3, 4, 5, 6, 7].forEach((id) => { o7.stages[id] = { state: "done", gateChecked: OPP_STAGES.find((s) => s.id === id).gate.map(() => true), completedAt: "2026-05-20", completedBy: "KD - Thảo" }; });
  o7.currentStage = OPP_DECISION_STAGE_ID;
  o7.status = "lost"; o7.lostReason = "Khách chọn đối tác khác vì giá cao hơn 8%.";

  return [o1, o2, o3, o4, o5, o6, o7];
}

export function seedProjects(customers) {
  const byName = (n) => customers.find((c) => c.company === n);
  const stampDone = (stages, defs, ids, dates, by) => ids.forEach((id, i) => {
    const def = defs.find((s) => s.id === id);
    stages[id] = { state: "done", gateChecked: def.gate.map(() => true), completedAt: dates[i], completedBy: by };
  });

  // TDDB-26-001 — Showroom ABC: đã qua Thiết kế + Duyệt mẫu, đang lập BOQ.
  const p1 = makeProject(formatProjectCode(1), { name: "Showroom Nội thất ABC – Q7", customerId: byName("Công ty CP Nội Thất ABC")?.id, customerName: "Công ty CP Nội Thất ABC", scope: "Thi công trọn gói nội thất showroom 450m²: hệ tủ trưng bày, quầy lễ tân, hệ thống chiếu sáng.", contractValue: 850000000, createdAt: "2026-06-02" });
  stampDone(p1.stages, PROJECT_STAGES, [1, 2, 3], ["2026-06-05", "2026-06-12", "2026-06-18"], "KD - Long");
  p1.currentStage = 4;
  p1.revenueEvents = [makeRevenueEvent("payment", "2026-06-10", 300000000, "Đặt cọc 35% theo hợp đồng")];
  p1.costs = [makeCost("Vật tư chính", 400000000, 120000000, "Gỗ công nghiệp, phụ kiện"), makeCost("Nhân công thi công", 200000000, 0, "")];

  // TDDB-26-002 — Fintech XYZ: đang Procurement, có 1 điểm nghẽn đã xử lý xong ở BOQ.
  const p2 = makeProject(formatProjectCode(2), { name: "Văn phòng Fintech XYZ – Q1", customerId: byName("Công ty TNHH Fintech XYZ")?.id, customerName: "Công ty TNHH Fintech XYZ", scope: "Thiết kế & thi công nội thất văn phòng 800m², khu làm việc mở, phòng họp kính.", contractValue: 1650000000, createdAt: "2026-05-15" });
  stampDone(p2.stages, PROJECT_STAGES, [1, 2, 3, 4], ["2026-05-18", "2026-05-25", "2026-06-02", "2026-06-12"], "KD - Thảo");
  p2.currentStage = 5;
  p2.bottlenecks = [{ id: uid("bn"), stageId: 4, reason: "KH yêu cầu bổ sung hạng mục điện nhẹ vào BOQ, phải làm lại bảng khối lượng.", by: "KD - Thảo", at: "2026-06-08", resolvedAt: "2026-06-12" }];
  p2.revenueEvents = [makeRevenueEvent("payment", "2026-06-20", 300000000, "Tạm ứng ký hợp đồng"), makeRevenueEvent("payment", "2026-06-28", 200000000, "Thanh toán bổ sung điện nhẹ")];
  p2.costs = [makeCost("Vật tư chính", 800000000, 300000000, ""), makeCost("Thiết kế & giám sát", 100000000, 60000000, "")];

  // TDDB-26-003 — Sóng Coffee: mới kick-off, đang thiết kế.
  const p3 = makeProject(formatProjectCode(3), { name: "Chuỗi cafe Sóng – 3 chi nhánh", customerId: byName("Sóng Coffee Group")?.id, customerName: "Sóng Coffee Group", scope: "Thi công nội thất 3 chi nhánh cafe theo mẫu thiết kế chuẩn thương hiệu.", contractValue: 420000000, createdAt: "2026-06-25" });
  stampDone(p3.stages, PROJECT_STAGES, [1], ["2026-06-27"], "KD - Mai");
  p3.currentStage = 2;

  // TDDB-26-004 — Sunview: đã Nghiệm thu + Bàn giao + Quyết toán + Thu đủ tiền, đang Warranty.
  const p4 = makeProject(formatProjectCode(4), { name: "Căn hộ mẫu Sunview – Block A", customerId: byName("Sunview Realty")?.id, customerName: "Sunview Realty", scope: "Nội thất căn hộ mẫu 2PN + trang trí showroom bán hàng.", contractValue: 620000000, createdAt: "2026-05-01" });
  stampDone(p4.stages, PROJECT_STAGES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    ["2026-05-03", "2026-05-08", "2026-05-12", "2026-05-15", "2026-05-18", "2026-05-25", "2026-06-05", "2026-06-15", "2026-06-20", "2026-06-22", "2026-06-24", "2026-06-25"], "KD - Long");
  p4.currentStage = PROJECT_WARRANTY_STAGE_ID;
  p4.revenueEvents = [makeRevenueEvent("payment", "2026-05-16", 300000000, "Tạm ứng 50%"), makeRevenueEvent("payment", "2026-06-26", 320000000, "Thanh toán sau nghiệm thu")];
  p4.costs = [makeCost("Vật tư chính", 380000000, 375000000, ""), makeCost("Nhân công", 120000000, 118000000, "")];

  // TDDB-26-005 — Biển Đông: vừa tạo, đứng lâu ở Kick-off (điểm nghẽn mềm theo ngày).
  const p5 = makeProject(formatProjectCode(5), { name: "Nhà hàng Hải Sản Biển Đông", customerId: byName("Biển Đông F&B")?.id, customerName: "Biển Đông F&B", scope: "Thi công nội thất nhà hàng 600m², khu bếp, khu sảnh, phòng VIP.", contractValue: 980000000, createdAt: "2026-06-25" });
  p5.revenueEvents = [makeRevenueEvent("payment", "2026-06-26", 100000000, "Tạm ứng thiện chí trước khảo sát")];

  // TDDB-26-006 — Phương Nam Logistics: đã CLOSED hoàn toàn.
  const p6 = makeProject(formatProjectCode(6), { name: "Trụ sở Logistics Phương Nam", customerId: null, customerName: "Phương Nam Logistics", scope: "Nội thất khối văn phòng điều hành 3 tầng.", contractValue: 1100000000, createdAt: "2026-04-02" });
  stampDone(p6.stages, PROJECT_STAGES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    ["2026-04-04", "2026-04-08", "2026-04-12", "2026-04-15", "2026-04-18", "2026-04-25", "2026-05-05", "2026-05-15", "2026-05-20", "2026-05-22", "2026-05-24", "2026-05-25", "2026-06-15", "2026-06-16"], "KD - Thảo");
  p6.currentStage = PROJECT_FINAL_STAGE_ID;
  p6.status = "closed";
  p6.revenueEvents = [makeRevenueEvent("payment", "2026-04-13", 550000000, "Tạm ứng 50%"), makeRevenueEvent("payment", "2026-06-16", 550000000, "Thanh toán sau nghiệm thu")];
  p6.costs = [makeCost("Vật tư chính", 700000000, 690000000, ""), makeCost("Nhân công", 250000000, 245000000, "")];

  return [p1, p2, p3, p4, p5, p6];
}

export function seedWarrantyRecords(projects) {
  return projects.filter((p) => p.currentStage >= PROJECT_WARRANTY_STAGE_ID).map((p) => ({
    ...makeWarrantyRecord(p),
    transferredAt: p.stages[PROJECT_ACCEPTANCE_STAGE_ID]?.completedAt || TODAY,
    status: p.status === "closed" ? "completed" : "active",
    notes: p.code === formatProjectCode(4) ? [{ id: uid("nt"), date: "2026-06-28", text: "Đã gọi hỏi thăm khách hàng sau bàn giao, chưa phát sinh sự cố." }] : [],
  }));
}

export function seedTasks() {
  return [
    { id: uid("task"), title: "Gửi lại BOQ điều chỉnh cho KH Fintech", projectCode: formatProjectCode(2), assignee: "BP - Hùng", dueDate: "2026-06-30", status: "done", note: "" },
    { id: uid("task"), title: "Chốt lịch khảo sát chi nhánh Sóng Coffee #2", projectCode: formatProjectCode(3), assignee: "KD - Mai", dueDate: "2026-06-28", status: "open", note: "" },
    { id: uid("task"), title: "Theo dõi công nợ đợt 2 — Showroom ABC", projectCode: formatProjectCode(1), assignee: "KD - Long", dueDate: "2026-06-29", status: "open", note: "Khách hẹn thanh toán trước 30/6." },
    { id: uid("task"), title: "Gọi hỏi thăm bảo hành Sunview tháng 7", projectCode: formatProjectCode(4), assignee: "KD - Long", dueDate: "2026-07-05", status: "open", note: "" },
    { id: uid("task"), title: "Chốt kick-off Biển Đông F&B", projectCode: formatProjectCode(5), assignee: "KD - Hà", dueDate: "2026-06-27", status: "open", note: "Đang trễ, cần xử lý gấp." },
  ];
}

export function seedForecast() {
  const rows = [];
  const plan = [
    { client: "Công ty CP Nội Thất ABC", industry: "Nội thất bán lẻ", base: 90 },
    { client: "Showroom mới dự kiến (nội thất bán lẻ)", industry: "Nội thất bán lẻ", base: 40 },
    { client: "Sóng Coffee Group", industry: "F&B", base: 60 },
    { client: "Biển Đông F&B", industry: "F&B", base: 35 },
    { client: "Fintech XYZ & chi nhánh mới", industry: "Công nghệ tài chính", base: 140 },
    { client: "Sunview Realty", industry: "Bất động sản", base: 70 },
  ];
  plan.forEach((p, pi) => {
    for (let m = 1; m <= 12; m++) {
      const seasonal = 1 + 0.25 * Math.sin((m + pi * 2) / 2);
      const revenue = Math.round((p.base * 1000000 * seasonal) / 5) * 5;
      const cost = Math.round(revenue * (0.62 + (pi % 3) * 0.03));
      rows.push({ id: uid("f"), client: p.client, industry: p.industry, year: 2026, month: m, revenue, cost });
    }
  });
  return rows;
}
