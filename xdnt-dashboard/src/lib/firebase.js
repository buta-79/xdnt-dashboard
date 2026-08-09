// ------------------------------------------------------------------------
// KHỞI TẠO FIREBASE — Authentication (đăng nhập) + Firestore (lưu dữ liệu).
// Đây là điểm DUY NHẤT trong app khởi tạo kết nối tới Firebase.
// ------------------------------------------------------------------------

import { initializeApp, getApps, getApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

/**
 * Tạo tài khoản đăng nhập (Firebase Auth) cho 1 Nhân viên MỚI, mà KHÔNG làm
 * mất phiên đăng nhập của người đang thực hiện (thường là BOD).
 *
 * Vấn đề: createUserWithEmailAndPassword() trên instance Auth "chính" sẽ tự
 * động ĐĂNG NHẬP LUÔN vào tài khoản vừa tạo — làm người đang dùng app (BOD)
 * bị đăng xuất khỏi tài khoản của họ.
 *
 * Giải pháp chuẩn của Firebase: tạo 1 Firebase App "phụ" (secondary) dùng
 * CÙNG config, chỉ dùng để tạo tài khoản mới, rồi đăng xuất + dọn dẹp app
 * phụ đó ngay. App "chính" (nơi BOD đang đăng nhập) không hề bị ảnh hưởng.
 */
export async function createStaffAuthAccount(email, password) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Math.random().toString(36).slice(2)}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await fbSignOut(secondaryAuth);
    return uid;
  } finally {
    try { await deleteApp(secondaryApp); } catch (e) { /* bỏ qua — không ảnh hưởng app chính */ }
  }
}
