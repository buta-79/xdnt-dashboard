// ------------------------------------------------------------------------
// CẤU HÌNH FIREBASE — điền 6 giá trị lấy từ:
//   Firebase Console → (chọn project) → Project settings (icon bánh răng)
//   → mục "Your apps" → chọn app Web (icon </>) → phần "SDK setup and
//   configuration" → chọn "Config".
//
// LƯU Ý: các giá trị này AN TOÀN để đưa vào code / để công khai trên
// Internet (kể cả trong file này khi đẩy lên GitHub public). Đây KHÔNG
// phải là mật khẩu hay API secret — chúng chỉ giúp app biết "kết nối tới
// project Firebase nào". Bảo mật dữ liệu thật nằm ở:
//   1. Firebase Authentication (phải đăng nhập đúng mới vào được app)
//   2. Firestore Security Rules (firestore.rules — quyết định ai được
//      đọc/ghi/xoá dữ liệu gì)
// Không phải ở việc giấu file config này.
// ------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyDg3UU2rReHe6K6HMfbohrtW6Lf3nIRZw0",
  authDomain: "tddb-vanhanh.firebaseapp.com",
  projectId: "tddb-vanhanh",
  storageBucket: "tddb-vanhanh.firebasestorage.app",
  messagingSenderId: "62605065827",
  appId: "1:62605065827:web:ac53e3dd403cc8db164256",
};
