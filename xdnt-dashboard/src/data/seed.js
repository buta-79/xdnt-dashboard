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
    obj[s.id] = { state: "pending", gateChecked: s.gate.map(() => false), completedAt: null, completedBy: null };
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
  return { ...flow, stages, currentStage: stageId < last ? stageId + 1 : stageId };
}
export function sendBackGate(flow, reason, by, at) {
  const stageId = flow.currentStage;
  if (stageId <= 1) return flow;
  const prevId = stageId - 1;
  const prevStage = flow.stages[prevId];
  const stages = {
    ...flow.stages,
    [prevId]: { ...prevStage, state: "pending", completedAt: null, completedBy: null, gateChecked: prevStage.gateChecked.map(() => false) },
  };
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

export function makeProject(code, data) {
  return {
    id: uid("p"), code,
    name: data.name, customerId: data.customerId, customerName: data.customerName,
    scope: data.scope || "", contractValue: data.contractValue || 0,
    currentStage: 1, status: "active", // active | closed | on_hold
    stages: buildStages(PROJECT_STAGES),
    bottlenecks: [],
    revenueEvents: [], // ledger thu/chi tiền: {id, type:"invoice"|"payment", date, amount, note}
    costs: [], // {id, category, budget, actual, note}
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
/*  SEED DATA                                                               */
/* ---------------------------------------------------------------------- */

export function seedCustomers() {
  return [
    { id: "c1", company: "Công ty CP Nội Thất ABC", industry: "Nội thất bán lẻ", tier: "high",
      accountOwner: "Nguyễn Văn Long (KD)",
      contacts: [
        { id: uid("ct"), name: "Nguyễn Thị Lan Anh", position: "Giám đốc Vận hành", phone: "090 123 4567", isPrimary: true },
        { id: uid("ct"), name: "Trần Bảo Châu", position: "Trưởng phòng Thu mua", phone: "090 111 2222", isPrimary: false },
      ],
      overview: "Chuỗi showroom nội thất trung – cao cấp, đang mở rộng thêm 2 showroom tại TP.HCM trong năm nay.",
      advantage: "Khách hàng cũ, đã hợp tác 1 dự án thành công, thiện chí thanh toán tốt." },
    { id: "c2", company: "Công ty TNHH Fintech XYZ", industry: "Công nghệ tài chính", tier: "high",
      accountOwner: "Phạm Thu Hà (KD)",
      contacts: [
        { id: uid("ct"), name: "Trần Minh Khoa", position: "Trưởng phòng Hành chính", phone: "091 234 5678", isPrimary: true },
        { id: uid("ct"), name: "Vũ Ngọc Diệp", position: "CFO", phone: "091 222 3333", isPrimary: false },
      ],
      overview: "Startup fintech tăng trưởng nhanh, vừa gọi vốn vòng Series A, có nhu cầu mở thêm văn phòng chi nhánh.",
      advantage: "Ngân sách lớn, ra quyết định nhanh, tiềm năng hợp đồng dài hạn cho các chi nhánh mới." },
    { id: "c3", company: "Sóng Coffee Group", industry: "F&B", tier: "high",
      accountOwner: "Nguyễn Văn Long (KD)",
      contacts: [
        { id: uid("ct"), name: "Phạm Anh Tuấn", position: "Giám đốc Phát triển", phone: "093 345 6789", isPrimary: true },
        { id: uid("ct"), name: "Ngô Thị Kim", position: "Quản lý Vận hành chuỗi", phone: "093 333 4444", isPrimary: false },
      ],
      overview: "Chuỗi cafe đang nhân rộng mô hình, kế hoạch mở 10 chi nhánh trong 18 tháng tới.",
      advantage: "Đơn hàng lặp lại theo chuỗi, thiết kế mẫu có thể tái sử dụng, biên lợi nhuận ổn định." },
    { id: "c4", company: "Sunview Realty", industry: "Bất động sản", tier: "normal",
      accountOwner: "Lê Gia Bảo (KD)",
      contacts: [{ id: uid("ct"), name: "Lê Thị Hồng Nhung", position: "Giám đốc Kinh doanh", phone: "094 456 7890", isPrimary: true }],
      overview: "Chủ đầu tư bất động sản, cần đối tác nội thất căn hộ mẫu cho nhiều dự án song song.",
      advantage: "Khối lượng công việc lớn nhưng cạnh tranh giá cao, cần kiểm soát chi phí chặt." },
    { id: "c5", company: "Biển Đông F&B", industry: "F&B", tier: "normal",
      accountOwner: "Phạm Thu Hà (KD)",
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
