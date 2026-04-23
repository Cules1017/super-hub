# Mega Hub — Mega-Site Đa Tiện Ích (Serverless)

Nền tảng đa tiện ích với kiến trúc **serverless**:

- **Frontend:** React (Vite) + Tailwind CSS + `@react-three/fiber` + Framer Motion + React Router + `react-helmet-async`
- **Backend / Database:** Google Apps Script (GAS) + Google Sheets (2 tab: `Settings`, `LiveScore`)
- **Cron / Automation:** GAS trigger (1 phút) chạy `fetchSportsData()`
- **Admin:** Trang bí mật `/secret-admin` dùng Access Token để GHI ngược về Sheets qua `doPost`.

---

## 1) Triển khai Backend (Google Apps Script)

1. Tạo 1 file Google Sheets mới.
2. Vào **Extensions → Apps Script**, dán toàn bộ nội dung `apps-script/backend.gs`.
3. Đổi giá trị `ADMIN_TOKEN` ở đầu file thành một chuỗi bí mật của bạn.
4. Chạy hàm **`setupSpreadsheet`** 1 lần (xác nhận quyền). Hàm này:
   - Tạo tab `Settings` với các key mặc định (site_name, meta_title, primary_color, announcement, ads_slot_*, ...).
   - Tạo tab `LiveScore` với header chuẩn.
   - Gọi `fetchSportsData()` để ghi dữ liệu mẫu (hoặc gọi API-Football nếu có `football_api_key`).
5. **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy **Web App URL** → sẽ dùng cho `.env`.
6. **Triggers** → Add trigger:
   - Function: `fetchSportsData`
   - Event source: Time-driven
   - Type: Minutes timer · Every minute
7. (Tuỳ chọn) Nếu bạn có API-Football key, nhập vào row `football_api_key` trong tab `Settings` để scrape dữ liệu thật.

### API của Backend

- `GET {WEBAPP_URL}` — trả về:

  ```json
  {
    "ok": true,
    "ts": 1700000000000,
    "settings": { "site_name": "Mega Hub", "...": "..." },
    "liveScore": [{ "id": 1, "home": "...", "away": "...", "...": "..." }]
  }
  ```

- `POST {WEBAPP_URL}` — content-type `text/plain` (tránh CORS preflight). Body:

  ```json
  { "action": "updateSettings", "token": "SECRET", "settings": { "site_name": "New Name" } }
  ```

  Hoặc:

  ```json
  { "action": "refreshSports", "token": "SECRET" }
  ```

---

## 2) Chạy Frontend

```bash
cd gg-ads
cp .env.example .env
# Sửa VITE_GAS_URL và VITE_ADMIN_TOKEN theo bước trên
npm install
npm run dev
```

- Nếu chưa có `VITE_GAS_URL`, app tự chạy ở **chế độ DEMO** với dữ liệu mock (vẫn polling, vẫn render đủ UI).
- Build production:

```bash
npm run build
npm run preview
```

Deploy `dist/` lên Vercel / Netlify / Cloudflare Pages / GitHub Pages.

---

## 3) Kiến trúc thư mục

```
gg-ads/
├── apps-script/
│   └── backend.gs              # Toàn bộ backend GAS (doGet/doPost/fetchSportsData)
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx                # Entry: HelmetProvider + Router
│   ├── App.jsx                 # Routes + ConfigProvider
│   ├── index.css               # Tailwind + glassmorphism utilities
│   ├── config/
│   │   └── api.js              # fetch GET/POST tới GAS + mock demo
│   ├── hooks/
│   │   └── useConfig.js        # Context + polling theo poll_interval_ms
│   ├── components/
│   │   ├── three/ParticlesBackground.jsx   # Scene 3D background
│   │   ├── layout/ (Header, Footer, AnnouncementBar, Layout, MaintenanceScreen)
│   │   ├── ads/AdsPlaceholder.jsx          # Slot AdSense lấy ID từ Settings
│   │   ├── sport/MatchCard.jsx             # Card trận đấu với 3D tilt + pulse
│   │   └── ui/SEO.jsx                      # Helmet + JSON-LD
│   └── pages/ (HomePage, SportHub, AdminLogin, AdminPanel, NotFound)
├── index.html
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
├── .env.example
└── package.json
```

---

## 4) Điểm nổi bật

- **Không hardcode:** mọi nhãn, màu, ID quảng cáo, meta SEO, thông báo, chế độ bảo trì đều đọc từ `useConfig()`.
- **Polling mượt:** dùng `AbortController` + chu kỳ đọc từ `poll_interval_ms` (tối thiểu 15s an toàn); cache-busting `?t=timestamp`.
- **Admin động:** `AdminPanel` tự render form theo các key trong tab `Settings`. Có thể **thêm key mới** ngay từ UI.
- **Bảo mật cơ bản:**
  - Token so khớp ở Frontend (UX) **và** ở GAS (server) — quan trọng nhất là phía GAS.
  - Token chỉ lưu ở `sessionStorage` (tự mất khi đóng tab).
- **UI/UX:** Glassmorphism, dark mode default, Framer Motion (3D tilt, page transition, pulse), background 3D low-poly + particles với `@react-three/fiber`.
- **SEO-ready:** Helmet động cho từng trang + JSON-LD `SportsEvent` cho Sport Hub — sẵn sàng duyệt Google AdSense.

---

## 5) Mở rộng sau MVP

- Thêm tab Sheets mới (ví dụ `Blog`, `Tools`) → chỉ cần bổ sung reader trong `doGet` và module tương ứng phía React.
- Thêm bài viết "Nhận định & Tin tức" để đạt tiêu chuẩn AdSense.
- Thêm `PropertiesService` trong GAS để lưu token thay vì hardcode trong file.
