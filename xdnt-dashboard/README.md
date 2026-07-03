# XD · Nội Thất — Dashboard quản lý triển khai dự án

Web app quản lý dự án nội thất/xây dựng: Tổng quan, Dự án (5 bước + tệp đính
kèm + khoá sau khi duyệt + vòng điều chỉnh), Khách hàng (nhiều liên hệ, phân
nhóm tiềm năng), Pipeline (kéo-thả công trình tiềm năng), Sales Forecast
(theo Ngành hàng → Khách hàng → Tháng).

## 1. Chạy thử trên máy

```bash
npm install
npm run dev
```

Mở địa chỉ hiện trong terminal (mặc định `http://localhost:5173`).

## 2. Build bản tĩnh để deploy

```bash
npm run build
```

Lệnh này tạo ra thư mục `dist/` — đây là toàn bộ "web tĩnh" sẽ được host.

## 3. Đưa lên Netlify

**Cách nhanh nhất (không cần Git):**
1. Chạy `npm run build`.
2. Vào [app.netlify.com/drop](https://app.netlify.com/drop), kéo thả thư mục
   `dist/` vào đó. Netlify cấp ngay 1 link `*.netlify.app`.

**Cách chuẩn hơn (tự deploy lại mỗi khi sửa code):**
1. Đẩy toàn bộ thư mục này lên một repo GitHub/GitLab.
2. Vào Netlify → "Add new site" → "Import an existing project" → chọn repo.
3. Build command: `npm run build`, Publish directory: `dist` (file
   `netlify.toml` đã khai báo sẵn 2 giá trị này, Netlify sẽ tự nhận).
4. Mỗi lần bạn `git push`, Netlify tự build và deploy lại.

## 4. Giới hạn của bản deploy tĩnh này (đọc trước khi giao cho nhiều người dùng)

- **Dữ liệu lưu trong `localStorage` của từng trình duyệt** — mỗi máy/mỗi
  người thấy một bộ dữ liệu riêng, KHÔNG dùng chung được giữa nhiều nhân
  viên. Phù hợp để bạn tự dùng, demo cho đối tác, hoặc dùng thử nội bộ 1
  người trước khi đầu tư làm backend.
- **Không có đăng nhập thật.** Ai có link đều mở được toàn bộ dữ liệu và
  đổi được vai trò (KD/BP/BOD) ở góc sidebar — bộ chọn vai trò chỉ mô phỏng
  luật phân quyền trên giao diện, không phải bảo mật thật.
- **Tệp đính kèm giới hạn 1.5MB**, lưu dưới dạng base64 trong cùng bộ nhớ
  cục bộ — không phù hợp cho quy mô nhiều dự án, nhiều file lớn.
- Vì các lý do trên, đây là bước "dùng thử/demo" — mục 5 bên dưới nói chính
  xác cần đổi gì để lên "web động" dùng chung được nhiều người, phân quyền
  thật.

## 5. Chuyển sang "web động" (backend thật, nhiều người dùng, phân quyền thật)

Toàn bộ phần giao diện (`src/App.jsx` và các component bên trong nó) được
viết để **không cần sửa gì** khi đổi backend. Chỉ có 2 điểm cần đụng vào:

### 5.1. Thay lớp lưu trữ — `src/lib/storage.js`

File này export ra đúng 4 hàm: `get`, `set`, `delete`, `list`. Hiện tại
chúng đọc/ghi `localStorage`. Khi có backend thật (API riêng, Firebase,
Supabase, hoặc Apps Script Web App nối vào Google Sheets như đã bàn ở các
tin nhắn trước), chỉ cần viết lại nội dung 4 hàm này để gọi `fetch(...)`
tới API đó, giữ nguyên "hình dạng" giá trị trả về
(`{ key, value, shared }`). Xem chú thích chi tiết + ví dụ code ngay trong
file `src/lib/storage.js`.

### 5.2. Thêm đăng nhập thật

Hiện `App.jsx` có state `currentRole` chọn tay ở sidebar. Khi có backend
thật, thay bằng đăng nhập Google (Firebase Auth / Google Identity Services)
— vai trò (KD/BP/BOD) nên lấy từ bảng `Users` phía backend theo email đăng
nhập, thay vì cho người dùng tự chọn.

### 5.3. Không cần đổi

- Toàn bộ UI, state logic, luồng 5 bước, khoá/mở khoá, vòng điều chỉnh,
  Kanban, Sales Forecast — giữ nguyên 100%, vì chúng chỉ thao tác với dữ
  liệu trong bộ nhớ React (`useState`) và gọi `storage.get/set` để lưu —
  không quan tâm dữ liệu thật sự nằm ở đâu.
- `src/data/seed.js` vẫn hữu ích sau khi có backend — coi nó như "hợp đồng
  cấu trúc dữ liệu" (project có những field gì, round có những field gì...)
  để bên làm backend/API dựng đúng schema tương ứng (đối chiếu với file
  Google Sheets mẫu đã gửi ở bước trước).

## 6. Cấu trúc thư mục

```
xdnt-dashboard/
├── index.html
├── package.json
├── vite.config.js
├── netlify.toml
└── src/
    ├── main.jsx        # điểm khởi động React
    ├── App.jsx         # toàn bộ giao diện + logic (Dashboard/DuAn/KhachHang/Pipeline/Forecast)
    ├── styles.css      # toàn bộ CSS (theme "bản vẽ kỹ thuật" — đồng/than chì/kem)
    ├── data/
    │   └── seed.js     # constants + dữ liệu mẫu + hàm dựng model (Project/Round/Stage...)
    └── lib/
        └── storage.js  # LỚP DUY NHẤT CẦN SỬA khi chuyển sang backend thật
```
