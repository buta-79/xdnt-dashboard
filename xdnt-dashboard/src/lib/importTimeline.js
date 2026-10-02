// ------------------------------------------------------------------------
// NHẬP TIẾN ĐỘ TỪ EXCEL — dùng ở trang "Kế hoạch triển khai".
// ------------------------------------------------------------------------
// Đọc đúng mẫu file .xlsx đã gửi cho người dùng (sheet "Ke hoach tung buoc" +
// "Cong tac bo sung"), đối chiếu Mã dự án với danh sách dự án đang có, và trả
// về 2 danh sách thay đổi THUẦN (chưa ghi gì vào Firestore) kèm danh sách lỗi
// theo từng dòng để người dùng tự sửa file rồi nhập lại — không bao giờ ghi
// nhận 1 phần âm thầm.
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

/**
 * @param {File} file
 * @param {Array} projects — danh sách dự án đang có, để đối chiếu Mã dự án.
 * @returns {Promise<{stageUpdates: Array, workItemUpdates: Array, errors: string[]}>}
 */
export async function parseTimelineImportFile(file, projects) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const codeSet = new Set(projects.map((p) => p.code));
  const errors = [];
  const stageUpdates = []; // {code, stageId, plannedDate}
  const workItemUpdates = []; // {code, title, requestedAt, status, note}

  const sheet1 = wb.Sheets["Ke hoach tung buoc"];
  if (!sheet1) {
    errors.push('Không tìm thấy sheet "Ke hoach tung buoc" trong file — kiểm tra lại có đúng mẫu đã gửi không.');
  } else {
    const rows = XLSX.utils.sheet_to_json(sheet1, { range: 1, header: ["code", "stageId", "stageName", "plannedDate", "note"], defval: "" });
    rows.forEach((r, i) => {
      const rowNum = i + 3; // dòng 1 = tiêu đề, dòng 2 = dòng đầu dữ liệu (range:1 bỏ dòng 1)
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
  if (!sheet2) {
    errors.push('Không tìm thấy sheet "Cong tac bo sung" trong file — kiểm tra lại có đúng mẫu đã gửi không.');
  } else {
    const rows = XLSX.utils.sheet_to_json(sheet2, { range: 1, header: ["code", "title", "requestedAt", "status", "note"], defval: "" });
    rows.forEach((r, i) => {
      const rowNum = i + 3;
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

  return { stageUpdates, workItemUpdates, errors };
}
