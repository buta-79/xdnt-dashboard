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
  projectCollected, projectAR, projectStagePct, projectRiskLevel,
  isTaskOverdue, employeeSummary, addMonths, todayISO,
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
  const header = ["Nhân viên", "Vai trò", "Trạng thái", "Số KH phụ trách", "Số công trình", "Pipeline đang mở (₫)", "Giá trị hợp đồng (₫)", "Đã thu (₫)", "Công nợ A/R (₫)"];
  const rows = summaries.map((s) => [
    s.employee.name, s.employee.role, s.employee.active ? "Đang hoạt động" : "Đã ngừng",
    s.customerCount, s.projectCount, s.pipelineValue, s.contractValue, s.collected, s.ar,
  ]);
  return [header, ...rows];
}

export function buildProjectRows(projects) {
  const header = ["Mã dự án", "Tên dự án", "Khách hàng", "Trạng thái", "Bước hiện tại", "Tên bước", "% tiến độ", "Giá trị hợp đồng (₫)", "Đã thu (₫)", "Công nợ A/R (₫)", "Ngân sách chi phí (₫)", "Chi phí thực tế (₫)", "Ngày tạo"];
  const rows = projects.map((p) => {
    const stg = PROJECT_STAGES.find((s) => s.id === p.currentStage);
    const budget = (p.costs || []).reduce((s, c) => s + c.budget, 0);
    const actual = (p.costs || []).reduce((s, c) => s + c.actual, 0);
    return [
      p.code, p.name, p.customerName, p.status === "active" ? "Đang triển khai" : p.status === "closed" ? "Đã đóng" : "Tạm dừng",
      p.currentStage, stg?.label || "", projectStagePct(p), p.contractValue, projectCollected(p), Math.max(0, projectAR(p)), budget, actual, p.createdAt,
    ];
  });
  return [header, ...rows];
}

export function buildOpportunityRows(opportunities) {
  const header = ["Tên cơ hội", "Khách hàng", "Trạng thái", "Bước hiện tại", "Tên bước", "Giá trị ước tính (₫)", "Ngày tạo", "Kết quả"];
  const rows = opportunities.map((o) => {
    const stg = OPP_STAGES.find((s) => s.id === o.currentStage);
    const outcome = o.status === "won" ? `WON — dự án ${o.wonProjectCode}` : o.status === "lost" ? `LOST — ${o.lostReason || ""}` : "Đang theo đuổi";
    return [o.title, o.customerName, o.status === "open" ? "Đang theo đuổi" : o.status.toUpperCase(), o.currentStage, stg?.label || "", o.value, o.createdAt, outcome];
  });
  return [header, ...rows];
}

export function buildCustomerRows(customers, projects) {
  const header = ["Doanh nghiệp", "Ngành hàng", "Nhân viên phụ trách", "Nhóm tiềm năng", "Số công trình", "Doanh thu đã thu (₫)", "Công nợ A/R (₫)"];
  const rows = customers.map((c) => {
    const related = projects.filter((p) => p.customerId === c.id);
    const collected = related.reduce((s, p) => s + projectCollected(p), 0);
    const ar = related.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);
    return [c.company, c.industry, c.accountOwnerName || "Chưa gán", c.tier === "high" ? "Cao" : "Bình thường", related.length, collected, ar];
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
  addSheet("Khach hang", buildCustomerRows(customers, projects));
  addSheet("Nhiem vu", buildTaskRows(tasks));
  addSheet("Bao hanh", buildWarrantyRows(warrantyRecords));

  XLSX.writeFile(wb, `TDDB-BaoCao-${periodFileTag(period)}.xlsx`);
}
