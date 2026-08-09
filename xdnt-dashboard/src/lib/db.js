// ------------------------------------------------------------------------
// TẦNG TRUY CẬP DỮ LIỆU (Firestore) — thay thế storage.js (localStorage).
// ------------------------------------------------------------------------
// Mô hình: MỖI thực thể (customer, opportunity, project, task, warranty
// record, forecast row, employee) là 1 DOCUMENT riêng trong 1 collection
// riêng — KHÔNG còn dồn tất cả vào 1 "khối JSON" duy nhất như localStorage
// trước đây. Đây là điều kiện bắt buộc để Firestore Security Rules có thể
// phân quyền theo TỪNG loại dữ liệu (xem firestore.rules).
//
// Mọi component UI trong App.jsx vẫn làm việc với các mảng JS bình thường
// (customers, projects, ...) — chỉ có tầng này là biết tới Firestore.
// ------------------------------------------------------------------------

import {
  collection, doc, setDoc, deleteDoc, onSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";

/** Bỏ field `id` trước khi lưu — id đã là tên document, không cần lưu lại trong data. */
export function stripId(obj) {
  const { id, ...rest } = obj;
  return rest;
}

/**
 * Lắng nghe real-time 1 collection — mỗi khi có thay đổi (do chính mình
 * hoặc do người khác/thiết bị khác ghi), callback được gọi lại với TOÀN BỘ
 * mảng hiện tại của collection đó.
 * Trả về hàm unsubscribe (nhớ gọi khi component unmount / đăng xuất).
 */
export function subscribeCollection(name, cb, onError) {
  return onSnapshot(
    collection(db, name),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error(`[Firestore] Lỗi đồng bộ collection "${name}":`, err);
      if (onError) onError(err);
    }
  );
}

/** Ghi đè toàn bộ 1 document (dùng cho create lẫn update — mỗi entity luôn được ghi lại đầy đủ). */
export function saveDoc(name, id, data) {
  return setDoc(doc(db, name, id), stripId(data)).catch((err) => {
    console.error(`[Firestore] Không lưu được ${name}/${id}:`, err);
    throw err;
  });
}

export function removeDoc(name, id) {
  return deleteDoc(doc(db, name, id)).catch((err) => {
    console.error(`[Firestore] Không xoá được ${name}/${id}:`, err);
    throw err;
  });
}

/** Helper hiển thị lỗi quyền hạn cho người dùng khi 1 hành động bị Firestore Rules chặn. */
export function explainWriteError(err) {
  if (err && (err.code === "permission-denied" || /permission/i.test(err.message || ""))) {
    return "Bạn không có quyền thực hiện thao tác này. Vui lòng liên hệ BOD để được điều chỉnh.";
  }
  return "Có lỗi khi lưu dữ liệu — vui lòng kiểm tra kết nối mạng và thử lại.";
}
