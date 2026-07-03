// ------------------------------------------------------------------------
// LỚP TRỪU TƯỢNG LƯU TRỮ DỮ LIỆU
// ------------------------------------------------------------------------
// Đây là file DUY NHẤT cần sửa khi chuyển từ "web tĩnh trên Netlify" sang
// "web động" có backend dùng chung cho nhiều người.
//
// Bản hiện tại: lưu vào localStorage của trình duyệt (mỗi máy/mỗi trình
// duyệt có dữ liệu riêng — phù hợp để demo, dùng thử một mình, hoặc chạy
// offline). App.jsx và các component khác KHÔNG biết (và không cần biết)
// dữ liệu đang được lưu ở đâu — chúng chỉ gọi storage.get()/storage.set().
//
// KHI NÂNG CẤP LÊN BACKEND THẬT (Google Sheets qua Apps Script, Firebase,
// Supabase, hay một API Node.js riêng), chỉ cần viết lại 4 hàm bên dưới để
// gọi fetch() tới API đó — KHÔNG cần sửa bất kỳ dòng nào trong App.jsx.
//
// Ví dụ khi có backend thật (Apps Script Web App làm ví dụ):
//
//   const API_BASE = "https://script.google.com/macros/s/XXX/exec";
//
//   async function get(key) {
//     const res = await fetch(`${API_BASE}?key=${encodeURIComponent(key)}`, {
//       headers: { Authorization: `Bearer ${getIdToken()}` },
//     });
//     if (!res.ok) return null;
//     return res.json(); // kỳ vọng trả về { key, value, shared }
//   }
//
//   async function set(key, value) {
//     const res = await fetch(API_BASE, {
//       method: "POST",
//       headers: { "Content-Type": "application/json", Authorization: `Bearer ${getIdToken()}` },
//       body: JSON.stringify({ key, value }),
//     });
//     return res.json();
//   }
//
// Giữ nguyên "hình dạng" (shape) dữ liệu trả về — { key, value, shared } cho
// get/set, { key, deleted, shared } cho delete, { keys, prefix, shared } cho
// list — để phần còn lại của app không phải đổi gì cả.
// ------------------------------------------------------------------------

const NAMESPACE = "xdnt:";

function readAll() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(NAMESPACE)) out[k.slice(NAMESPACE.length)] = localStorage.getItem(k);
  }
  return out;
}

async function get(key) {
  const raw = localStorage.getItem(NAMESPACE + key);
  if (raw === null) return null;
  return { key, value: raw, shared: false };
}

async function set(key, value) {
  localStorage.setItem(NAMESPACE + key, value);
  return { key, value, shared: false };
}

async function del(key) {
  const existed = localStorage.getItem(NAMESPACE + key) !== null;
  localStorage.removeItem(NAMESPACE + key);
  return { key, deleted: existed, shared: false };
}

async function list(prefix = "") {
  const all = readAll();
  const keys = Object.keys(all).filter((k) => k.startsWith(prefix));
  return { keys, prefix, shared: false };
}

export const storage = { get, set, delete: del, list };
