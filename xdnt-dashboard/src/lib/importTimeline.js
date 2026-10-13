// ------------------------------------------------------------------------
// NHẬP KẾ HOẠCH TỪ EXCEL — dùng ở trang "Kế hoạch triển khai".
// ------------------------------------------------------------------------
// Đọc file .xlsx theo mẫu, gồm 3 sheet (sheet nào có thì đọc sheet đó — chỉ cần
// có ÍT NHẤT 1 sheet):
//   - "Ke hoach nhanh"     : Mã DA | Ngày bắt đầu | Ngày kết thúc (hoặc Quy mô Nhỏ/Vừa/Lớn)
//                            → hệ thống tự chia 12 bước thành kế hoạch NHÁP (cách nhập nhanh nhất)
//   - "Ke hoach tung buoc" : Mã DA | Bước | Tên bước | Ngày dự kiến hoàn thành (cách cũ, vẫn dùng được)
//   - "Cong tac bo sung"   : công tác phát sinh từ CĐT
// Đối chiếu Mã dự án với danh sách dự án đang có, trả về các danh sách thay đổi
// THUẦN (chưa ghi gì vào Firestore) kèm danh sách lỗi theo từng dòng để người
// dùng tự sửa file rồi nhập lại — không bao giờ ghi nhận 1 phần âm thầm.
// ------------------------------------------------------------------------

const todayStr = () => new Date().toISOString().slice(0, 10);

function toDateStr(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Excel đôi khi trả về số serial ngày nếu ô không ở định dạng ngày thật.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

const WORK_STATUS_MAP = { "Chưa làm": "todo", "Đang làm": "doing", "Đã xong": "done" };
const SIZE_DAYS = { "nhỏ": 60, "vừa": 90, "lớn": 150 };

/**
 * @param {File} file
 * @param {Array} projects — danh sách dự án đang có, để đối chiếu Mã dự án.
 * @returns {Promise<{stageUpdates: Array, workItemUpdates: Array, planRequests: Array, errors: string[]}>}
 */
export async function parseTimelineImportFile(file, projects) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const codeSet = new Set(projects.map((p) => p.code));
  const errors = [];
  const stageUpdates = []; // {code, stageId, plannedDate}
  const workItemUpdates = []; // {code, title, requestedAt, status, note}
  const planRequests = []; // {code, start, end|null, days|null}

  const sheet0 = wb.Sheets["Ke hoach nhanh"];
  if (sheet0) {
    const rows = XLSX.utils.sheet_to_json(sheet0, { range: 1, header: ["code", "start", "end", "size", "note"], defval: "" });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      if (!r.code && !r.start && !r.end) return;
      const code = String(r.code || "").trim();
      if (!code) { errors.push(`Sheet "Ke hoach nhanh", dòng ${rowNum}: thiếu Mã dự án.`); return; }
      if (!codeSet.has(code)) { errors.push(`Sheet "Ke hoach nhanh", dòng ${rowNum}: mã dự án "${code}" không khớp dự án nào đang có trong hệ thống.`); return; }
      const start = toDateStr(r.start), end = toDateStr(r.end);
      if (!start) { errors.push(`Sheet "Ke hoach nhanh", dòng ${rowNum}: thiếu ngày bắt đầu.`); return; }
      const days = SIZE_DAYS[String(r.size || "").trim().toLowerCase()] || null;
      if (end && end <= start) { errors.push(`Sheet "Ke hoach nhanh", dòng ${rowNum}: ngày kết thúc phải sau ngày bắt đầu.`); return; }
      planRequests.push({ code, start, end: end || null, days: end ? null : days });
    });
  }

  const sheet1 = wb.Sheets["Ke hoach tung buoc"];
  if (sheet1) {
    const rows = XLSX.utils.sheet_to_json(sheet1, { range: 1, header: ["code", "stageId", "stageName", "plannedDate", "note"], defval: "" });
    rows.forEach((r, i) => {
      const rowNum = i + 2; // dòng 1 = tiêu đề, dòng 2 = dòng đầu dữ liệu (range:1 bỏ dòng 1)
      if (!r.code && !r.stageId && !r.plannedDate) return; // dòng trống — bỏ qua
      const code = String(r.code || "").trim();
      if (!code) { errors.push(`Sheet "Ke hoach tung buoc", dòng ${rowNum}: thiếu Mã dự án.`); return; }
      if (!codeSet.has(code)) { errors.push(`Sheet "Ke hoach tung buoc", dòng ${rowNum}: mã dự án "${code}" không khớp dự án nào đang có trong hệ thống.`); return; }
      const stageId = Number(r.stageId);
      if (!stageId || stageId < 1 || stageId > 14) { errors.push(`Sheet "Ke hoach tung buoc", dòng ${rowNum}: bước số "${r.stageId}" không hợp lệ (phải từ 1 đến 14).`); return; }
      const plannedDate = toDateStr(r.plannedDate);
      if (!plannedDate) { errors.push(`Sheet "Ke hoach tung buoc", dòng ${rowNum}: thiếu ngày dự kiến hoàn thành.`); return; }
      stageUpdates.push({ code, stageId, plannedDate });
    });
  }

  const sheet2 = wb.Sheets["Cong tac bo sung"];
  if (!sheet0 && !sheet1 && !sheet2) {
    errors.push('Không tìm thấy sheet nào của mẫu ("Ke hoach nhanh", "Ke hoach tung buoc", "Cong tac bo sung") — kiểm tra lại có đúng mẫu đã gửi không.');
  }
  if (sheet2) {
    const rows = XLSX.utils.sheet_to_json(sheet2, { range: 1, header: ["code", "title", "requestedAt", "status", "note"], defval: "" });
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      if (!r.code && !r.title) return;
      const code = String(r.code || "").trim();
      if (!code) { errors.push(`Sheet "Cong tac bo sung", dòng ${rowNum}: thiếu Mã dự án.`); return; }
      if (!codeSet.has(code)) { errors.push(`Sheet "Cong tac bo sung", dòng ${rowNum}: mã dự án "${code}" không khớp dự án nào đang có trong hệ thống.`); return; }
      const title = String(r.title || "").trim();
      if (!title) { errors.push(`Sheet "Cong tac bo sung", dòng ${rowNum}: thiếu tên công tác.`); return; }
      workItemUpdates.push({
        code, title,
        requestedAt: toDateStr(r.requestedAt) || todayStr(),
        status: WORK_STATUS_MAP[String(r.status || "").trim()] || "todo",
        note: String(r.note || "").trim(),
      });
    });
  }

  return { stageUpdates, workItemUpdates, planRequests, errors };
}
