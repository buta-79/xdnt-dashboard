// ------------------------------------------------------------------------
// Data model + seed data cho XD · Nội Thất Dashboard.
// Đây là "khuôn dữ liệu" dùng chung cho cả bản demo (localStorage) lẫn
// bản có backend thật sau này — khi đổi sang web động, cấu trúc object ở
// đây (Project/Round/Stage/Client/Pipeline/Forecast/CRM CSKH) nên khớp với
// schema API/DB thật để không phải sửa lại các component trong src/App.jsx.
// ------------------------------------------------------------------------

/* ---------------------------------------------------------------------- */
/*  CONSTANTS                                                               */
/* ---------------------------------------------------------------------- */

export const TODAY = "2026-07-01";

// Quy trình triển khai 1 dự án — 7 bước, áp dụng cho mọi dự án ở trang "Dự án".
// Bước 3 (Báo giá) là bước "chốt quyết định": KH đồng ý → sang bước 4 (Ký hợp
// đồng); KH chưa đồng ý → mở một vòng điều chỉnh mới (quay lại bước 3, giữ
// nguyên thông tin đã có ở bước 1-2). Bước 6 (Nghiệm thu) khi hoàn thành sẽ
// tự động chuyển thông tin dự án sang CRM CSKH để theo dõi giai đoạn bảo hành
// (bước 7).
export const STAGES = [
  { id: 1, label: "Dự án/Khách hàng", who: "KD", desc: "KD tạo hồ sơ dự án, ghi nhận thông tin khách hàng ban đầu." },
  { id: 2, label: "Khảo sát", who: "KD", desc: "KD/BP khảo sát mặt bằng, hiện trạng và nhu cầu thực tế của khách hàng." },
  { id: 3, label: "Báo giá", who: "BP", desc: "BP lập báo giá/dự toán và gửi khách hàng. KH phản hồi đồng ý hoặc yêu cầu điều chỉnh." },
  { id: 4, label: "Ký hợp đồng", who: "KD", desc: "KD hoàn tất thủ tục, ký hợp đồng chính thức với khách hàng." },
  { id: 5, label: "Thi công", who: "BP", desc: "Bộ phận triển khai thi công theo hợp đồng và hồ sơ thiết kế đã duyệt." },
  { id: 6, label: "Nghiệm thu", who: "KD", desc: "Nghiệm thu công trình cùng khách hàng. Chốt nghiệm thu sẽ chuyển hồ sơ sang CRM CSKH." },
  { id: 7, label: "Bảo hành", who: "KD", desc: "Theo dõi bảo hành sau nghiệm thu (quản lý chi tiết ở mục CRM CSKH)." },
];

// Bước "chốt quyết định" của khách hàng (đồng ý báo giá / yêu cầu điều chỉnh).
export const DECISION_STAGE_ID = 3;
// Bước mà khi hoàn thành sẽ tự động tạo hồ sơ CRM CSKH (chốt nghiệm thu).
export const HANDOFF_STAGE_ID = 6;
// Bước cuối cùng của quy trình (Bảo hành).
export const FINAL_STAGE_ID = STAGES[STAGES.length - 1].id;

export const ROLES = ["KD", "BP", "BOD"];
export const ROLE_LABELS = { KD: "Kinh doanh (KD)", BP: "Bộ phận triển khai (BP)", BOD: "Ban điều hành (BOD)" };

export const PIPELINE_STAGES = [
  { key: "leads", label: "Công trình tiềm năng", color: "var(--blue)" },
  { key: "meeting", label: "Cuộc gặp KH", color: "var(--blue)" },
  { key: "survey", label: "Khảo sát", color: "var(--amber)" },
  { key: "quote", label: "Báo giá", color: "var(--amber)" },
  { key: "contract", label: "Hợp đồng", color: "var(--green)" },
];

// Sơ đồ quy trình SOP tổng (Marketing → ... → KH quay lại) dùng cho trang
// "Quy trình SOP" — đánh giá tiềm năng và điểm nghẽn theo từng chặng.
// source: "auto"  → số liệu tính tự động từ dữ liệu Dự án/Khách hàng/Pipeline.
// source: "manual" → chưa có nguồn dữ liệu kết nối, nhập tay ở trang SOP.
export const SOP_FUNNEL_STEPS = [
  { key: "marketing", label: "Marketing", source: "manual" },
  { key: "leads", label: "Khách hàng tiềm năng", source: "auto" },
  { key: "crm", label: "CRM", source: "auto" },
  { key: "sales_process", label: "Quy trình bán hàng", source: "auto" },
  { key: "quote", label: "Báo giá", source: "auto" },
  { key: "contract", label: "Hợp đồng", source: "auto" },
  { key: "design", label: "Thiết kế", source: "manual" },
  { key: "construction", label: "Thi công", source: "auto" },
  { key: "acceptance", label: "Nghiệm thu", source: "auto" },
  { key: "warranty", label: "Bảo hành", source: "auto" },
  { key: "repeat", label: "KH quay lại", source: "manual" },
];
// Ngưỡng % chuyển đổi giữa 2 chặng liên tiếp — dưới ngưỡng này bị đánh dấu là điểm nghẽn.
export const SOP_BOTTLENECK_CONVERSION = 50;

export const MONTHS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];
export const BOTTLENECK_THRESHOLD = 3;
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

/* ---------------------------------------------------------------------- */
/*  PROJECT / ROUND MODEL HELPERS                                          */
/* ---------------------------------------------------------------------- */

export function pendingStage() {
  return { state: "pending", completedAt: null, completedBy: null, unlockedForEdit: false, attachments: [] };
}
export function doneStage(completedBy, completedAt, attachments = []) {
  return {
    state: "done", completedAt, completedBy, unlockedForEdit: false,
    attachments: attachments.map((a) => ({ id: uid("a"), dataUrl: null, uploadedAt: completedAt, uploadedBy: completedBy, ...a })),
  };
}
export function rejectedStage(completedBy, completedAt) {
  return { state: "rejected", completedAt, completedBy, unlockedForEdit: false, attachments: [] };
}
export function makeRound(number, reason = null, carriedFrom = null) {
  const carried = number !== 1;
  return {
    id: uid("r"), number, reason, createdAt: TODAY,
    outcome: null,
    stageStatus: "in_progress",
    currentStage: carried ? DECISION_STAGE_ID : 1,
    daysInStage: 0,
    stages: {
      1: carried ? doneStage("Kế thừa từ vòng trước", carriedFrom || TODAY) : pendingStage(),
      2: carried ? doneStage("Kế thừa từ vòng trước", carriedFrom || TODAY) : pendingStage(),
      3: pendingStage(), 4: pendingStage(), 5: pendingStage(), 6: pendingStage(), 7: pendingStage(),
    },
  };
}
export function getCurrentRound(project) { return project.rounds[project.rounds.length - 1]; }
export function getRevisionCount(project) { return project.rounds.length - 1; }
export function stageRevisionNote(project, stageId) {
  if (stageId <= 2) return null;
  const n = getRevisionCount(project);
  return n > 0 ? `Đã điều chỉnh lại ${n} lần` : null;
}
export function makeRevenueEvent(date, amount, note) {
  return { id: uid("rev"), date, amount, note };
}
export function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------- */
/*  SEED DATA                                                               */
/* ---------------------------------------------------------------------- */

export function seedProjects() {
  // p1 — Showroom ABC: đã khảo sát + báo giá xong, đang ở bước Ký hợp đồng.
  const p1r1 = makeRound(1);
  p1r1.stages[1] = doneStage("KD - Mai", "2026-06-02", [{ name: "Thong-tin-KH-ABC.pdf", size: 245000 }]);
  p1r1.stages[2] = doneStage("KD - Mai", "2026-06-06", [{ name: "Khao-sat-ABC.pdf", size: 210000 }]);
  p1r1.stages[3] = doneStage("BP - Hùng", "2026-06-09", [{ name: "Bao-gia-ABC-v1.xlsx", size: 98000 }]);
  p1r1.outcome = "approved";
  p1r1.currentStage = 4; p1r1.daysInStage = 5;

  // p2 — Fintech XYZ: vòng 1 báo giá bị KH yêu cầu điều chỉnh, vòng 2 đã được duyệt, đang ký hợp đồng.
  const p2r1 = makeRound(1);
  p2r1.stages[1] = doneStage("KD - Thảo", "2026-06-01", [{ name: "Thong-tin-KH-Fintech.pdf", size: 180000 }]);
  p2r1.stages[2] = doneStage("KD - Thảo", "2026-06-04", [{ name: "Khao-sat-Fintech.pdf", size: 150000 }]);
  p2r1.stages[3] = rejectedStage("BP - Hùng", "2026-06-10");
  p2r1.currentStage = 3; p2r1.outcome = "rejected"; p2r1.stageStatus = "rejected";
  const p2r2 = makeRound(2, "KH yêu cầu giảm giá 5% và bổ sung hạng mục điện nhẹ.", "2026-06-10");
  p2r2.stages[3] = doneStage("BP - Hùng", "2026-06-19", [{ name: "Bao-gia-Fintech-v2.xlsx", size: 118000 }]);
  p2r2.outcome = "approved";
  p2r2.currentStage = 4; p2r2.daysInStage = 4;

  // p3 — Sóng Coffee: mới xong thu thập thông tin, đang khảo sát.
  const p3r1 = makeRound(1);
  p3r1.stages[1] = doneStage("KD - Mai", "2026-06-27", [{ name: "Thong-tin-Song-Coffee.pdf", size: 90000 }]);
  p3r1.currentStage = 2; p3r1.daysInStage = 1;

  // p4 — Sunview: đã nghiệm thu, đang trong giai đoạn Bảo hành (đã chuyển sang CRM CSKH).
  const p4r1 = makeRound(1);
  p4r1.stages[1] = doneStage("KD - Long", "2026-05-05", [{ name: "Thong-tin-Sunview.pdf", size: 120000 }]);
  p4r1.stages[2] = doneStage("KD - Long", "2026-05-08", [{ name: "Khao-sat-Sunview.pdf", size: 100000 }]);
  p4r1.stages[3] = doneStage("BP - Hùng", "2026-05-12", [{ name: "Bao-gia-Sunview.xlsx", size: 100000 }]);
  p4r1.stages[4] = doneStage("KD - Long", "2026-05-15", [{ name: "Hop-dong-Sunview.pdf", size: 70000 }]);
  p4r1.stages[5] = doneStage("BP - Hùng", "2026-06-20", [{ name: "Ban-giao-thi-cong-Sunview.pdf", size: 60000 }]);
  p4r1.stages[6] = doneStage("KD - Long", "2026-06-25", [{ name: "Bien-ban-nghiem-thu-Sunview.pdf", size: 55000 }]);
  p4r1.outcome = "approved";
  p4r1.currentStage = 7; p4r1.daysInStage = 6;

  // p5 — Biển Đông F&B: vừa mở hồ sơ dự án, đang đứng lâu ở bước 1 (điểm nghẽn).
  const p5r1 = makeRound(1);
  p5r1.currentStage = 1; p5r1.daysInStage = 6;

  // p6 — Phương Nam Logistics: đã hoàn tất toàn bộ 7 bước, dự án đóng hồ sơ.
  const p6r1 = makeRound(1);
  p6r1.stages[1] = doneStage("KD - Thảo", "2026-04-02");
  p6r1.stages[2] = doneStage("KD - Thảo", "2026-04-05");
  p6r1.stages[3] = doneStage("BP - Hùng", "2026-04-08");
  p6r1.stages[4] = doneStage("KD - Thảo", "2026-04-12");
  p6r1.stages[5] = doneStage("BP - Hùng", "2026-04-25");
  p6r1.stages[6] = doneStage("KD - Thảo", "2026-04-28");
  p6r1.stages[7] = doneStage("KD - Thảo", "2026-06-15");
  p6r1.outcome = "approved";
  p6r1.currentStage = 7;

  return [
    { id: "p1", name: "Showroom Nội thất ABC – Q7", client: "Công ty CP Nội Thất ABC",
      scope: "Thi công trọn gói nội thất showroom 450m²: hệ tủ trưng bày, quầy lễ tân, hệ thống chiếu sáng.",
      status: "active", paymentTotal: 850000000, paymentCollected: 300000000, rounds: [p1r1],
      revenueEvents: [makeRevenueEvent("2026-06-10", 300000000, "Đặt cọc 35% theo báo giá đã duyệt")] },
    { id: "p2", name: "Văn phòng Fintech XYZ – Q1", client: "Công ty TNHH Fintech XYZ",
      scope: "Thiết kế & thi công nội thất văn phòng 800m², khu làm việc mở, phòng họp kính.",
      status: "active", paymentTotal: 1650000000, paymentCollected: 500000000, rounds: [p2r1, p2r2],
      revenueEvents: [
        makeRevenueEvent("2026-06-20", 300000000, "Tạm ứng ký hợp đồng"),
        makeRevenueEvent("2026-06-28", 200000000, "Thanh toán bổ sung hạng mục điện nhẹ"),
      ] },
    { id: "p3", name: "Chuỗi cafe Sóng – 3 chi nhánh", client: "Sóng Coffee Group",
      scope: "Thi công nội thất 3 chi nhánh cafe theo mẫu thiết kế chuẩn thương hiệu.",
      status: "active", paymentTotal: 420000000, paymentCollected: 0, rounds: [p3r1], revenueEvents: [] },
    { id: "p4", name: "Căn hộ mẫu Sunview – Block A", client: "Sunview Realty",
      scope: "Nội thất căn hộ mẫu 2PN + trang trí showroom bán hàng.",
      status: "active", paymentTotal: 620000000, paymentCollected: 620000000, rounds: [p4r1],
      revenueEvents: [
        makeRevenueEvent("2026-05-16", 300000000, "Tạm ứng ký hợp đồng 50%"),
        makeRevenueEvent("2026-06-26", 320000000, "Thanh toán sau nghiệm thu"),
      ] },
    { id: "p5", name: "Nhà hàng Hải Sản Biển Đông", client: "Biển Đông F&B",
      scope: "Thi công nội thất nhà hàng 600m², khu bếp, khu sảnh, phòng VIP.",
      status: "active", paymentTotal: 980000000, paymentCollected: 100000000, rounds: [p5r1],
      revenueEvents: [makeRevenueEvent("2026-06-26", 100000000, "Tạm ứng thiện chí trước khảo sát")] },
    { id: "p6", name: "Trụ sở Logistics Phương Nam", client: "Phương Nam Logistics",
      scope: "Nội thất khối văn phòng điều hành 3 tầng.",
      status: "completed", paymentTotal: 1100000000, paymentCollected: 1100000000, rounds: [p6r1],
      revenueEvents: [
        makeRevenueEvent("2026-04-13", 550000000, "Tạm ứng ký hợp đồng 50%"),
        makeRevenueEvent("2026-06-16", 550000000, "Thanh toán sau nghiệm thu"),
      ] },
  ];
}

// Hồ sơ CRM CSKH — được tạo tự động khi 1 dự án chốt Nghiệm thu (bước 6),
// dùng để theo dõi giai đoạn Bảo hành (bước 7) độc lập với trang Dự án.
export function seedCrmCskh() {
  return [
    { id: "crm1", projectId: "p4", projectName: "Căn hộ mẫu Sunview – Block A", client: "Sunview Realty",
      transferredAt: "2026-06-25", warrantyMonths: 12, status: "active",
      notes: [{ id: uid("nt"), date: "2026-06-28", text: "Đã gọi hỏi thăm khách hàng sau bàn giao, chưa phát sinh sự cố." }] },
    { id: "crm2", projectId: "p6", projectName: "Trụ sở Logistics Phương Nam", client: "Phương Nam Logistics",
      transferredAt: "2026-04-28", warrantyMonths: 12, status: "active", notes: [] },
  ];
}

// Số liệu chưa có nguồn dữ liệu kết nối trong app (Marketing/Thiết kế/KH quay
// lại) — nhập tay ở trang Quy trình SOP, lưu lại như phần còn lại của dữ liệu.
export function seedSopManual() {
  return { marketing: 42, design: 5, repeat: 2 };
}

export function seedClients() {
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

export function seedPipeline() {
  return [
    { id: "lp1", title: "5 phòng khám mới", clientName: "Chuỗi Nha Khoa Sài Gòn", clientId: null, value: 400000000, note: "Quan tâm nội thất 5 phòng khám mới.", stage: "leads", priority: false },
    { id: "lp2", title: "2 cơ sở mầm non", clientName: "Trường Mầm non Ánh Dương", clientId: null, value: 250000000, note: "Cần nội thất 2 cơ sở.", stage: "leads", priority: true },
    { id: "lp3", title: "Phòng gym 800m²", clientName: "Gym & Fitness PowerHouse", clientId: null, value: 600000000, note: "Đã hẹn gặp tuần sau.", stage: "meeting", priority: true },
    { id: "lp4", title: "Spa 3 phòng", clientName: "Spa Ngọc Trai", clientId: null, value: 320000000, note: "Đang chờ lịch khảo sát mặt bằng.", stage: "meeting", priority: false },
    { id: "lp5", title: "Văn phòng luật 2 tầng", clientName: "Văn phòng Luật Minh Tín", clientId: null, value: 480000000, note: "Đã khảo sát, chờ lên dự toán.", stage: "survey", priority: false },
    { id: "lp6", title: "3 chi nhánh Anh ngữ", clientName: "Trung tâm Anh ngữ Bright", clientId: null, value: 350000000, note: "Khảo sát 3 chi nhánh.", stage: "survey", priority: false },
    { id: "lp7", title: "Chi nhánh Sóng Coffee thứ 4", clientName: "Sóng Coffee Group", clientId: "c3", value: 150000000, note: "Khách cũ mở rộng thêm chi nhánh mới.", stage: "survey", priority: false },
    { id: "lp8", title: "Nhà hàng chay 400m²", clientName: "Nhà hàng Chay An Lạc", clientId: null, value: 290000000, note: "Đã gửi báo giá, chờ phản hồi.", stage: "quote", priority: false },
    { id: "lp9", title: "Coworking 1.200m²", clientName: "Coworking Space Hive", clientId: null, value: 900000000, note: "Đang thương lượng lại BLN.", stage: "quote", priority: true },
    { id: "lp10", title: "Showroom ô tô 600m²", clientName: "Showroom Ô tô Đức Long", clientId: null, value: 1200000000, note: "Sắp ký hợp đồng, chờ pháp lý.", stage: "contract", priority: true },
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
