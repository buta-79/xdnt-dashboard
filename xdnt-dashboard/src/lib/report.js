// ------------------------------------------------------------------------
// XUẤT BÁO CÁO EXCEL (.xlsx) — dùng cho báo cáo hàng tháng/quý.
// ------------------------------------------------------------------------
// Tách riêng 2 phần:
//   1. Các hàm build*Rows(...) — THUẦN, không đụng tới thư viện xlsx hay
//      trình duyệt, chỉ nhận dữ liệu và trả về mảng hàng (array-of-arrays)
//      để dễ viết test độc lập.
//   2. exportMonthlyReport(...) — phần DUY NHẤT động tới thư viện "xlsx"
//      (SheetJS) và trình duyệt (tải file xuống máy).
// ------------------------------------------------------------------------

import {
  PROJECT_STAGES, OPP_STAGES, PROJECT_ACCEPTANCE_STAGE_ID,
  projectCollected, projectAR, projectStagePct, projectRiskLevel, projectScheduleStatus,
  milestoneStatus, milestoneCumPct, isTaskOverdue, employeeSummary, addMonths, todayISO,
  PRIORITY_LABELS,
} from "../data/seed";

/* ---------------------------------------------------------------------- */
/*  KỲ BÁO CÁO                                                              */
/* ---------------------------------------------------------------------- */

export function periodLabel(period) {
  if (period.type === "month") return `Tháng ${period.month}/${period.year}`;
  if (period.type === "quarter") return `Quý ${period.quarter}/${period.year}`;
  return "Toàn bộ (lũy kế đến hiện tại)";
}

export function periodFileTag(period) {
  if (period.type === "month") return `Thang${String(period.month).padStart(2, "0")}-${period.year}`;
  if (period.type === "quarter") return `Quy${period.quarter}-${period.year}`;
  return `ToanBo-${todayISO()}`;
}

/** dateStr dạng "YYYY-MM-DD" — so sánh bằng cắt chuỗi, tránh lệch timezone của new Date(). */
export function inPeriod(dateStr, period) {
  if (!dateStr) return false;
  if (period.type === "all") return true;
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  if (period.type === "month") return year === period.year && month === period.month;
  if (period.type === "quarter") return year === period.year && Math.ceil(month / 3) === period.quarter;
  return true;
}

/* ---------------------------------------------------------------------- */
/*  BUILDERS — mỗi hàm trả về 1 mảng hàng (hàng đầu là tiêu đề cột)          */
/* ---------------------------------------------------------------------- */

export function buildOverviewRows(period, { employees, customers, opportunities, projects, tasks }) {
  const openOpps = opportunities.filter((o) => o.status === "open");
  const pipelineValue = openOpps.reduce((s, o) => s + o.value, 0);
  const contractValue = projects.reduce((s, p) => s + p.contractValue, 0);
  const cashCollected = projects.reduce((s, p) => s + projectCollected(p), 0);
  const recognizedRevenue = projects.filter((p) => p.currentStage >= PROJECT_ACCEPTANCE_STAGE_ID).reduce((s, p) => s + p.contractValue, 0);
  const ar = projects.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);
  const activeProjects = projects.filter((p) => p.status === "active");
  const atRisk = projects.filter((p) => projectRiskLevel(p) === "red");
  const overdueTasks = tasks.filter(isTaskOverdue);

  const periodCollected = projects.reduce((s, p) => s + (p.revenueEvents || [])
    .filter((e) => e.type === "payment" && inPeriod(e.date, period)).reduce((es, e) => es + e.amount, 0), 0);
  const newOppsInPeriod = opportunities.filter((o) => inPeriod(o.createdAt, period));
  const newProjectsInPeriod = projects.filter((p) => inPeriod(p.createdAt, period));
  const wonInPeriod = newOppsInPeriod.concat(opportunities.filter((o) => o.status === "won" && inPeriod(o.createdAt, period)));

  return [
    ["BÁO CÁO TDDB", periodLabel(period)],
    ["Ngày xuất báo cáo", todayISO()],
    [],
    ["SỐ LIỆU TRONG KỲ", ""],
    ["Doanh thu thu được trong kỳ (₫)", periodCollected],
    ["Số cơ hội mới phát sinh trong kỳ", newOppsInPeriod.length],
    ["Số dự án ký mới trong kỳ", newProjectsInPeriod.length],
    [],
    ["SỐ LIỆU LŨY KẾ TẠI THỜI ĐIỂM XUẤT BÁO CÁO", ""],
    ["PIPELINE — cơ hội đang mở (₫)", pipelineValue],
    ["CONTRACT VALUE — tổng giá trị hợp đồng (₫)", contractValue],
    ["REVENUE — doanh thu đã ghi nhận (đã qua Nghiệm thu) (₫)", recognizedRevenue],
    ["CASH COLLECTED — tiền đã thu thực tế (₫)", cashCollected],
    ["A/R — công nợ còn phải thu (₫)", ar],
    ["ACTIVE PROJECTS — dự án đang triển khai", activeProjects.length],
    ["PROJECT AT RISK — dự án có điểm nghẽn mở", atRisk.length],
    ["OVERDUE TASKS — task quá hạn deadline", overdueTasks.length],
    ["Tổng số khách hàng", customers.length],
    ["Tổng số nhân viên", employees.length],
  ];
}

export function buildRevenueRows(period, projects) {
  const rows = [];
  projects.forEach((p) => {
    (p.revenueEvents || []).forEach((ev) => {
      if (!inPeriod(ev.date, period)) return;
      rows.push([ev.date, p.code, p.name, p.customerName, ev.type === "payment" ? "Thu tiền" : "Xuất hoá đơn", ev.amount, ev.note || ""]);
    });
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const totalPayment = rows.filter((r) => r[4] === "Thu tiền").reduce((s, r) => s + r[5], 0);
  const totalInvoice = rows.filter((r) => r[4] === "Xuất hoá đơn").reduce((s, r) => s + r[5], 0);
  const header = ["Ngày", "Mã dự án", "Tên dự án", "Khách hàng", "Loại", "Số tiền (₫)", "Ghi chú"];
  const footer = [["", "", "", "", "Tổng Thu tiền", totalPayment, ""], ["", "", "", "", "Tổng Xuất hoá đơn", totalInvoice, ""]];
  return [header, ...rows, [], ...footer];
}

export function buildEmployeeRows(employees, customers, opportunities, projects) {
  const summaries = employeeSummary(employees, customers, opportunities, projects);
  const header = ["Nhân viên", "Vai trò", "Trạng thái", "Số KH phụ trách", "Số cơ hội đang mở", "Số công trình", "Pipeline đang mở (₫)", "Giá trị hợp đồng (₫)", "Đã thu (₫)", "Công nợ A/R (₫)"];
  const rows = summaries.map((s) => {
    const ownedCustomerIds = new Set(customers.filter((c) => c.accountOwnerId === s.employee.id).map((c) => c.id));
    const openOppCount = opportunities.filter((o) => o.status === "open" && o.customerId && ownedCustomerIds.has(o.customerId)).length;
    return [
      s.employee.name, s.employee.role, s.employee.active ? "Đang hoạt động" : "Đã ngừng",
      s.customerCount, openOppCount, s.projectCount, s.pipelineValue, s.contractValue, s.collected, s.ar,
    ];
  });
  return [header, ...rows];
}

export function buildProjectRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Khách hàng", "Trạng thái", "Bước hiện tại", "Tên bước", "% tiến độ", "Giá trị hợp đồng (₫)", "Đã thu (₫)", "Công nợ A/R (₫)", "Ngân sách chi phí (₫)", "Chi phí thực tế (₫)", "Chênh lệch ngân sách (₫)", "Số điểm nghẽn", "Điểm nghẽn đang mở?", "Ngày tạo"];
  const rows = projects.map((p) => {
    const stg = PROJECT_STAGES.find((s) => s.id === p.currentStage);
    const budget = (p.costs || []).reduce((s, c) => s + c.budget, 0);
    const actual = (p.costs || []).reduce((s, c) => s + c.actual, 0);
    const bnCount = (p.bottlenecks || []).length;
    const openBn = (p.bottlenecks || []).some((b) => !b.resolvedAt);
    return [
      p.code, p.name, p.customerName, p.status === "active" ? "Đang triển khai" : p.status === "closed" ? "Đã đóng" : "Tạm dừng",
      p.currentStage, stg?.label || "", projectStagePct(p), p.contractValue, projectCollected(p), Math.max(0, projectAR(p)),
      budget, actual, budget - actual, bnCount, openBn ? "Có" : "Không", p.createdAt,
    ];
  });
  return [header, ...rows];
}

export function buildOpportunityRows(opportunities) {
  const header = ["Tên cơ hội", "Khách hàng", "Trạng thái", "Bước hiện tại", "Tên bước", "Giá trị ước tính (₫)", "Số điểm nghẽn", "Điểm nghẽn đang mở?", "Ngày tạo", "Kết quả"];
  const rows = opportunities.map((o) => {
    const stg = OPP_STAGES.find((s) => s.id === o.currentStage);
    const outcome = o.status === "won" ? `WON — dự án ${o.wonProjectCode}` : o.status === "lost" ? `LOST — ${o.lostReason || ""}` : "Đang theo đuổi";
    const bnCount = (o.bottlenecks || []).length;
    const openBn = (o.bottlenecks || []).some((b) => !b.resolvedAt);
    return [o.title, o.customerName, o.status === "open" ? "Đang theo đuổi" : o.status.toUpperCase(), o.currentStage, stg?.label || "", o.value, bnCount, openBn ? "Có" : "Không", o.createdAt, outcome];
  });
  return [header, ...rows];
}

/** Mỗi hàng = 1 lần báo điểm nghẽn (đã xử lý hoặc đang mở) trên các dự án. */
export function buildProjectBottleneckRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Bước", "Lý do điểm nghẽn", "Người báo", "Ngày báo", "Trạng thái"];
  const rows = [];
  projects.forEach((p) => {
    (p.bottlenecks || []).forEach((b) => {
      const stg = PROJECT_STAGES.find((s) => s.id === b.stageId);
      rows.push([p.code, p.name, `Bước ${b.stageId} · ${stg?.label || ""}`, b.reason, b.by, b.at, b.resolvedAt ? `Đã xử lý (${b.resolvedAt})` : "Đang mở"]);
    });
  });
  return [header, ...rows];
}

const SCHEDULE_STATUS_LABEL = { good: "Đúng tiến độ", bad: "Trễ tiến độ / điểm nghẽn", neutral: "Chưa lập kế hoạch", done: "Đã hoàn thành (lưu trữ)" };

/** Kế hoạch triển khai — 1 dòng / dự án (chỉ dự án đang triển khai, dùng cho
 * báo cáo nhanh BOD hoặc trao đổi giữa các phòng ban). */
export function buildTimelineRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Khách hàng", "Ưu tiên", "Ngày bắt đầu dự kiến", "Ngày kết thúc dự kiến", "Bước hiện tại", "Tên bước", "% tiến độ", "Trạng thái tiến độ", "Số công tác bổ sung chưa xong", "Giá trị hợp đồng (₫)"];
  const rows = projects.filter((p) => p.status !== "closed").map((p) => {
    const stg = PROJECT_STAGES.find((s) => s.id === p.currentStage);
    const openWorkItems = (p.workItems || []).filter((w) => w.status !== "done").length;
    return [
      p.code, p.name, p.customerName, PRIORITY_LABELS[p.priority] || p.priority,
      p.plannedStart || "", p.plannedEnd || "", p.currentStage, stg?.label || "",
      projectStagePct(p), SCHEDULE_STATUS_LABEL[projectScheduleStatus(p)] || "",
      openWorkItems, p.contractValue,
    ];
  });
  return [header, ...rows];
}

/** Đối chiếu kế hoạch từng bước (dự kiến vs thực tế) — 1 dòng / bước / dự án. */
export function buildStagePlanRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Bước số", "Tên bước", "Ngày dự kiến hoàn thành", "Ngày hoàn thành thực tế", "Chênh lệch (ngày trễ)"];
  const rows = [];
  projects.forEach((p) => {
    PROJECT_STAGES.forEach((s) => {
      const st = p.stages[s.id];
      if (!st || !st.plannedDate) return;
      const lateDays = st.completedAt ? Math.round((new Date(st.completedAt) - new Date(st.plannedDate)) / 86400000)
        : Math.round((new Date(todayISO()) - new Date(st.plannedDate)) / 86400000);
      rows.push([p.code, p.name, s.id, s.label, st.plannedDate, st.completedAt || "(chưa xong)", lateDays]);
    });
  });
  return [header, ...rows];
}

/** Công tác bổ sung (ngoài phạm vi ban đầu, theo yêu cầu CĐT) — 1 dòng / công tác. */
export function buildWorkItemRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Tên công tác / yêu cầu từ CĐT", "Ngày yêu cầu", "Trạng thái", "Ghi chú"];
  const STATUS_LABEL = { todo: "Chưa làm", doing: "Đang làm", done: "Đã xong" };
  const rows = [];
  projects.forEach((p) => {
    (p.workItems || []).forEach((w) => {
      rows.push([p.code, p.name, w.title, w.requestedAt, STATUS_LABEL[w.status] || w.status, w.note || ""]);
    });
  });
  return [header, ...rows];
}

/** Chi phí phát sinh theo từng hạng mục — 1 dòng / mục chi phí, kèm tổng phát
 * sinh & chênh lệch so với ngân sách của cả dự án để đối chiếu nhanh. */
export function buildCostBreakdownRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Hạng mục", "Ngân sách (₫)", "Thực tế (₫)", "Ghi chú", "Tổng ngân sách DA (₫)", "Tổng thực tế DA (₫)", "Chênh lệch DA (₫)"];
  const rows = [];
  projects.forEach((p) => {
    const costs = p.costs || [];
    if (!costs.length) return;
    const totalBudget = costs.reduce((s, c) => s + c.budget, 0);
    const totalActual = costs.reduce((s, c) => s + c.actual, 0);
    costs.forEach((c) => {
      rows.push([p.code, p.name, c.category, c.budget, c.actual, c.note || "", totalBudget, totalActual, totalBudget - totalActual]);
    });
  });
  return [header, ...rows];
}

/** Dự án đã hoàn thành (lưu trữ) nhưng còn công nợ — bàn giao CSKH & thu công nợ. */
export function buildCompletedProjectsHandoffRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Khách hàng", "Giá trị hợp đồng (₫)", "Đã thu (₫)", "Còn nợ (₫)"];
  const rows = projects.filter((p) => p.status === "closed" && projectAR(p) > 0)
    .map((p) => [p.code, p.name, p.customerName, p.contractValue, projectCollected(p), projectAR(p)]);
  return [header, ...rows];
}

/** Công nợ tổng hợp — 1 dòng / dự án đang theo dõi (chưa thu đủ, không phân
 * biệt đang triển khai hay đã lưu trữ). */
export function buildDebtSummaryRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Khách hàng", "Giá trị HĐ (₫)", "Đã thu (₫)", "% đã thu", "Còn nợ (₫)", "Đợt gần nhất chưa thu", "Trạng thái đợt"];
  const DEBT_STATUS_LABEL = { overdue: "Quá hạn", upcoming: "Sắp tới hạn", ontrack: "Đúng hạn", paid: "Đã thu đủ", none: "Chưa thiết lập đợt" };
  const rows = projects.filter((p) => projectAR(p) > 0).map((p) => {
    const list = p.paymentMilestones || [];
    let next = null, nextStatus = "none";
    for (let i = 0; i < list.length; i++) {
      const st = milestoneStatus(p, i);
      if (st !== "paid") { next = list[i]; nextStatus = st; break; }
    }
    const pctCollected = p.contractValue ? Math.round((projectCollected(p) / p.contractValue) * 100) : 0;
    return [
      p.code, p.name, p.customerName, p.contractValue, projectCollected(p), pctCollected, projectAR(p),
      next ? `${next.label} (${next.pct}% · ${next.plannedDate})` : "—", DEBT_STATUS_LABEL[nextStatus],
    ];
  });
  return [header, ...rows];
}

/** Chi tiết từng đợt thanh toán — 1 dòng / đợt / dự án (vì mỗi hợp đồng tự
 * định nghĩa đợt riêng). */
export function buildPaymentMilestoneRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Tên đợt", "% hợp đồng", "Số tiền dự kiến (₫)", "Ngày dự kiến thu", "Trạng thái"];
  const DEBT_STATUS_LABEL = { overdue: "Quá hạn", upcoming: "Sắp tới hạn", ontrack: "Đúng hạn", paid: "Đã thu đủ phần này" };
  const rows = [];
  projects.forEach((p) => {
    (p.paymentMilestones || []).forEach((m, i) => {
      rows.push([p.code, p.name, m.label, m.pct, Math.round((p.contractValue || 0) * m.pct / 100), m.plannedDate, DEBT_STATUS_LABEL[milestoneStatus(p, i)] || ""]);
    });
  });
  return [header, ...rows];
}

/** Mỗi hàng = 1 lần báo điểm nghẽn (đã xử lý hoặc đang mở) trên các cơ hội. */
export function buildOpportunityBottleneckRows(opportunities) {
  const header = ["Tên cơ hội", "Khách hàng", "Bước", "Lý do điểm nghẽn", "Người báo", "Ngày báo", "Trạng thái"];
  const rows = [];
  opportunities.forEach((o) => {
    (o.bottlenecks || []).forEach((b) => {
      const stg = OPP_STAGES.find((s) => s.id === b.stageId);
      rows.push([o.title, o.customerName, `Bước ${b.stageId} · ${stg?.label || ""}`, b.reason, b.by, b.at, b.resolvedAt ? `Đã xử lý (${b.resolvedAt})` : "Đang mở"]);
    });
  });
  return [header, ...rows];
}

export function buildCustomerRows(customers, projects, opportunities) {
  const header = ["Tên Doanh nghiệp", "Tên Thương hiệu", "Tên Chi nhánh/Cửa hàng", "Ngành hàng", "Nhân viên phụ trách", "Nhóm tiềm năng", "Số cơ hội đang mở", "Số công trình", "Doanh thu đã thu (₫)", "Công nợ A/R (₫)"];
  const rows = customers.map((c) => {
    const related = projects.filter((p) => p.customerId === c.id);
    const relatedOpenOpps = (opportunities || []).filter((o) => o.customerId === c.id && o.status === "open");
    const collected = related.reduce((s, p) => s + projectCollected(p), 0);
    const ar = related.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);
    return [
      c.company, c.brandName || "", c.branchName || "", c.industry, c.accountOwnerName || "Chưa gán",
      c.tier === "high" ? "Cao" : "Bình thường", relatedOpenOpps.length, related.length, collected, ar,
    ];
  });
  return [header, ...rows];
}

export function buildTaskRows(tasks) {
  const header = ["Việc cần làm", "Dự án", "Người chịu trách nhiệm", "Deadline", "Trạng thái", "Quá hạn?"];
  const rows = tasks.map((t) => [t.title, t.projectCode || "—", t.assignee || "—", t.dueDate, t.status === "done" ? "Đã xong" : "Đang mở", isTaskOverdue(t) ? "Có" : "Không"]);
  return [header, ...rows];
}

export function buildWarrantyRows(warrantyRecords) {
  const header = ["Mã dự án", "Tên dự án", "Khách hàng", "Ngày chuyển giao", "Hạn bảo hành (tháng)", "Hết hạn", "Trạng thái"];
  const rows = warrantyRecords.map((r) => [
    r.projectCode, r.projectName, r.customerName, r.transferredAt, r.warrantyMonths,
    addMonths(r.transferredAt, r.warrantyMonths), r.status === "active" ? "Đang bảo hành" : "Đã hoàn tất",
  ]);
  return [header, ...rows];
}

/* ---------------------------------------------------------------------- */
/*  XUẤT FILE — phần DUY NHẤT động tới thư viện xlsx + trình duyệt          */
/* ---------------------------------------------------------------------- */

export async function exportMonthlyReport(period, { employees, customers, opportunities, projects, tasks, warrantyRecords }) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  addSheet("Tong quan", buildOverviewRows(period, { employees, customers, opportunities, projects, tasks }));
  addSheet("Doanh thu theo thoi gian", buildRevenueRows(period, projects));
  addSheet("Doanh thu theo Nhan vien", buildEmployeeRows(employees, customers, opportunities, projects));
  addSheet("Du an", buildProjectRows(projects));
  addSheet("Co hoi ban hang", buildOpportunityRows(opportunities));
  addSheet("Khach hang", buildCustomerRows(customers, projects, opportunities));
  addSheet("Nhiem vu", buildTaskRows(tasks));
  addSheet("Bao hanh", buildWarrantyRows(warrantyRecords));

  XLSX.writeFile(wb, `TDDB-BaoCao-${periodFileTag(period)}.xlsx`);
}

/* ---------------------------------------------------------------------- */
/*  XUẤT EXCEL THEO TỪNG TRANG — nút "Xuất Excel" ngay trên mỗi trang,       */
/*  chỉ chứa đúng phạm vi dữ liệu của trang đó (khác với báo cáo tổng ở      */
/*  Master Dashboard phía trên, vốn gộp toàn bộ dữ liệu theo kỳ).           */
/* ---------------------------------------------------------------------- */

async function buildWorkbook(sheets) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name));
  return { XLSX, wb };
}

export async function exportCustomersReport(customers, projects, opportunities) {
  const { XLSX, wb } = await buildWorkbook([
    ["Khach hang", buildCustomerRows(customers, projects, opportunities)],
  ]);
  XLSX.writeFile(wb, `TDDB-KhachHang-${todayISO()}.xlsx`);
}

export async function exportOpportunitiesReport(opportunities) {
  const { XLSX, wb } = await buildWorkbook([
    ["Co hoi ban hang", buildOpportunityRows(opportunities)],
    ["Diem nghen co hoi", buildOpportunityBottleneckRows(opportunities)],
  ]);
  XLSX.writeFile(wb, `TDDB-CoHoi-${todayISO()}.xlsx`);
}

export async function exportProjectsReport(projects) {
  const { XLSX, wb } = await buildWorkbook([
    ["Du an", buildProjectRows(projects)],
    ["Diem nghen du an", buildProjectBottleneckRows(projects)],
    ["Doanh thu theo thoi gian", buildRevenueRows({ type: "all" }, projects)],
  ]);
  XLSX.writeFile(wb, `TDDB-DuAn-${todayISO()}.xlsx`);
}

export async function exportEmployeesReport(employees, customers, opportunities, projects) {
  const { XLSX, wb } = await buildWorkbook([
    ["Nhan vien", buildEmployeeRows(employees, customers, opportunities, projects)],
  ]);
  XLSX.writeFile(wb, `TDDB-NhanVien-${todayISO()}.xlsx`);
}

export async function exportSopReport(opportunities, projects, customers) {
  const salesFunnelRows = [
    ["Bước Sales Funnel", "Số cơ hội đạt/đã qua"],
    ...OPP_STAGES.map((s) => [`Bước ${s.id} · ${s.label}`, opportunities.filter((o) => o.currentStage >= s.id).length]),
  ];
  const deliveryFunnelRows = [
    ["Bước Delivery Funnel", "Số dự án đạt/đã qua"],
    ...PROJECT_STAGES.map((s) => [`Bước ${s.id} · ${s.label}`, projects.filter((p) => p.currentStage >= s.id).length]),
  ];
  const { XLSX, wb } = await buildWorkbook([
    ["Sales Funnel", salesFunnelRows],
    ["Delivery Funnel", deliveryFunnelRows],
    ["Diem nghen co hoi", buildOpportunityBottleneckRows(opportunities)],
    ["Diem nghen du an", buildProjectBottleneckRows(projects)],
    ["Khach hang", buildCustomerRows(customers, projects, opportunities)],
  ]);
  XLSX.writeFile(wb, `TDDB-QuyTrinhSOP-${todayISO()}.xlsx`);
}

/** Trang "Kế hoạch triển khai" — kế hoạch tổng hợp tất cả dự án đang triển
 * khai, đối chiếu từng bước, công tác bổ sung, chi phí phát sinh theo hạng
 * mục, và danh sách dự án đã hoàn thành còn công nợ (bàn giao CSKH). */
export async function exportTimelineReport(projects) {
  const { XLSX, wb } = await buildWorkbook([
    ["Ke hoach tong hop", buildTimelineRows(projects)],
    ["Doi chieu tung buoc", buildStagePlanRows(projects)],
    ["Cong tac bo sung", buildWorkItemRows(projects)],
    ["Chi phi phat sinh", buildCostBreakdownRows(projects)],
    ["Du an da hoan thanh", buildCompletedProjectsHandoffRows(projects)],
  ]);
  XLSX.writeFile(wb, `TDDB-KeHoachTrienKhai-${todayISO()}.xlsx`);
}

/** Trang "Thu hồi công nợ" — công nợ tổng hợp theo dự án + chi tiết từng đợt
 * thanh toán (mỗi hợp đồng tự định nghĩa đợt riêng). */
export async function exportDebtReport(projects) {
  const { XLSX, wb } = await buildWorkbook([
    ["Cong no tong hop", buildDebtSummaryRows(projects)],
    ["Chi tiet dot thanh toan", buildPaymentMilestoneRows(projects)],
  ]);
  XLSX.writeFile(wb, `TDDB-ThuHoiCongNo-${todayISO()}.xlsx`);
}
