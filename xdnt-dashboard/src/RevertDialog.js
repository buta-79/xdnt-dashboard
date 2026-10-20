import React, { useState } from "react";
import { formatCompactVND, projectRevertSummary } from "./data/seed";

/* Hộp thoại "Chuyển Dự án về lại Cơ hội" — dùng ở tab Dự án và ở Kế hoạch triển khai */
export function RevertDialog({ project, role, mode, initialReason, onSubmit, onClose }) {
  const sum = projectRevertSummary(project);
  const isBOD = role === "BOD";
  const [reason, setReason] = useState(initialReason || "");
  const hasActual = sum.collected > 0 || sum.actualCost > 0 || sum.pct > 0 || (sum.sitePct || 0) > 0;
  const direct = isBOD || mode === "approve";
  return (
    <div className="ss-ov" onClick={onClose}>
      <div className="ss-dlg ss-dlgs" onClick={(e) => e.stopPropagation()}>
        <h3>{direct ? "Chuyển về Cơ hội" : "Đề nghị chuyển về Cơ hội"} — {project.code}</h3>
        <p className="ss-hint">Dùng khi phải <b>deal lại từ đầu các hạng mục</b>, BOQ đã trao đổi trước đó không còn đảm bảo.</p>
        <div className="rv-eff">
          <div>• Dự án <b>{project.code}</b> được <b>lưu trữ</b>: ẩn khỏi lịch triển khai và các số tổng, vẫn xem lại ở lịch sử của cơ hội.</div>
          <div>• Cơ hội gốc <b>mở lại ở bước Báo giá</b>, kèm nhóm việc “Deal lại” bắt đầu từ hôm nay.</div>
        </div>
        <div className="rv-kv">
          <div><span>Tiến độ dự án</span><b>Bước {sum.stage} {sum.stageLabel} · {sum.pct}%</b></div>
          <div><span>Thi công</span><b>{sum.siteItems ? `${sum.siteDone}/${sum.siteItems} hạng mục · ${sum.sitePct}%` : "chưa có bảng"}</b></div>
          <div><span>Đã thu</span><b>{formatCompactVND(sum.collected)}</b></div>
          <div><span>Chi phí thực tế</span><b>{formatCompactVND(sum.actualCost)}</b></div>
        </div>
        {hasActual && <div className="tl-warnbox" style={{ marginTop: 8, fontSize: 12.5 }}>Dự án <b>đã có phát sinh thực tế</b>. Các số này giữ trong dự án lưu trữ, <b>không mang sang cơ hội</b>{sum.collected > 0 ? <> — khoản <b>đã thu {formatCompactVND(sum.collected)}</b> cần được xử lý riêng (hoàn / chuyển cho dự án mới)</> : null}.</div>}
        <textarea className="ss-ta ss-ta-s" placeholder="Lý do chuyển về cơ hội (bắt buộc) — VD: khách yêu cầu thay đổi phạm vi, BOQ cũ không còn đúng" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="ss-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary btn-sm" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>{mode === "approve" ? "Duyệt & chuyển về Cơ hội" : isBOD ? "Chuyển về Cơ hội" : "Gửi BOD duyệt"}</button>
        </div>
      </div>
    </div>
  );
}
