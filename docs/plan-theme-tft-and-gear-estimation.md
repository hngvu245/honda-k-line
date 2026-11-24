# Kế Hoạch Triển Khai: Theme TFT Motorsport (Ảnh 1) & Thuật Toán Báo Số Ảo

Tài liệu kế hoạch chi tiết triển khai thay đổi giao diện ứng dụng **Android APK** và **PC Dashboard** sang phong cách **TFT Motorsport Cockpit (Ảnh 1)**, tích hợp **Logo linh vật (Ảnh 2) + chữ `hvu24.5`**, và thuật toán **Ước tính cấp số ảo (Gear Indicator)** thuần toán học (chạy tương thích 100% với phần cứng STM32 hiện tại, sẵn sàng cho ESP32 sau này).

---

## 1. Thiết Kế Giao Diện TFT Mới (Theo Đúng Tỉ Lệ Ảnh 1)

### A. Bản Đồ Bố Cục Màn Hình Ngang (Landscape - Cockpit Hero Mode)

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 1300 rpm ── [ ─── DẢI TUA MÁY QUÉT 0 ─── 9 ─── 13 (RED 10..13) ─── ]   │
 │ [LOGO linh vật] hvu24.5                      • REC   FI (MIL)   BT:ON  │
 ├───────────────────┬────────────────────┬───────────────────────────────┤
 │ [CỤM TRÁI]        │ [TRUNG TÂM - HERO] │ [CỤM PHẢI]                    │
 │                   │                    │  GEAR                         │
 │ C.TEMP    83 °C   │                    │  ┌──────────┐   TIME 21:38    │
 │ [========     ]   │        0           │  │    N     │   TRIP   12.4 km│
 │                   │       km/h         │  │ (Neon Gr)│   ODO   506  km │
 │ BATTERY   12.4 V  │ (Neon Cyan Halo)   │  └──────────┘                 │
 │ [=========    ]   │                    │  (Số 1..6 khi xe lăn bánh)    │
 ├───────────────────┴────────────────────┴───────────────────────────────┤
 │ [BOTTOM BAR]  Mode: CASUAL / NERDY  ·  Replay Timeline  ·  0.5x 1x 4x  │
 └────────────────────────────────────────────────────────────────────────┘
```

### B. Bảng Màu & Hiệu Ứng Ánh Sáng (Neon Cyber-Motorsport)
- **Màu nền chủ đạo:** Nền đen carbon sâu `#05070B`, viền khối `#121722`.
- **Hero Vận Tốc (`km/h`):** Màu xanh neon cyan `#00E5FF`, font số vuông thể thao `Barlow` (lòng số 0 rỗng), hiệu ứng phát quang tỏa sáng `text-shadow: 0 0 20px rgba(0, 229, 255, 0.7)`.
- **Hộp Báo Số (`GEAR`):** 
  - Về Mo / Đứng yên: Chữ **`N` rực sáng màu xanh lá neon `#00FF66`** `text-shadow: 0 0 18px rgba(0, 255, 102, 0.8)`.
  - Đang chạy (Số `1` .. `6`): Màu trắng băng `#FFFFFF` hoặc vàng hổ phách `#FFB300` khi kéo tua cao.
- **Thanh Tua Máy (Horizontal Sweep Tach):** Vạch chạy mỏng nằm sát mép trên, chia vạch `0 .. 13` ($\times 1000\text{ RPM}$). Vùng 0..9k màu xanh cyan/trắng, vùng 10..13k đổi sang màu đỏ lửa `#FF1744`.
- **Hai Thanh Thông Số Bên Trái:**
  - `C.TEMP` (Nhiệt nước `ECT`): Thanh bar cyan/xanh lam, tự chuyển đỏ cảnh báo khi vượt quá `105°C`.
  - `BATTERY` (Điện bình `VBAT`): Thanh bar xanh lá, chuyển vàng khi dưới `11.8V`.
- **Branding Header:** Biểu tượng linh vật Ảnh 2 tách nền trong suốt, đứng cạnh dòng chữ thể thao góc cạnh **`hvu24.5`**.

---

## 2. Thuật Toán Nhận Diện Cấp Số Ảo Thuần Toán Học (Không Cần Dây Cảm Biến)

Hệ thống hoạt động trực tiếp trên luồng dữ liệu K-Line hiện tại của **STM32** (chưa cần phần cứng ESP32).

### A. Công Thức & Bảng Tỷ Số Truyền Chuẩn
Tỷ số truyền tức thời:
$$R = \frac{RPM}{VSS}$$

App tích hợp sẵn bảng tỷ số mặc định (ví dụ dòng xe 6 số như Winner X / CBR150):
- **Số 1:** $R_1 \approx 160$ (Dải nhận diện: $140 \le R < 185$)
- **Số 2:** $R_2 \approx 107$ (Dải nhận diện: $95 \le R < 125$)
- **Số 3:** $R_3 \approx 78$ (Dải nhận diện: $70 \le R < 88$)
- **Số 4:** $R_4 \approx 62$ (Dải nhận diện: $56 \le R < 66$)
- **Số 5:** $R_5 \approx 54$ (Dải nhận diện: $49 \le R < 55$)
- **Số 6:** $R_6 \approx 47$ (Dải nhận diện: $40 \le R < 48$)

*(Đồng thời có preset cho xe 4 số: Wave/Future và xe 5 số: Exciter 150)*.

### B. Máy Trạng Thái Xử Lý Khi Đứng Yên & Bóp Côn Đá Số
1. **Trường Hợp Đứng Yên ($VSS < 2\text{ km/h}$):**
   - Động cơ nổ máy ($RPM > 400$): Mặc định hiển thị **`N` (Xanh lá)**.
   - Dù người lái có đạp số lung tung tại chỗ (do bóp côn nên nhông xe không quay): Hệ thống giữ nguyên trạng thái chờ `N` hoặc `--` an toàn, không tính toán sai lệch.
2. **Khoảnh Khắc Bắt Côn Lăn Bánh ($VSS \ge 2\text{ km/h}$):**
   - Chỉ cần nhả côn cho bánh xe nhích lăn bánh nhẹ ($VSS$ nhảy lên $2 - 3\text{ km/h}$), thuật toán lập tức chia tỷ số $R$ và bắt trúng ngay số đang đề-pa (hiển thị số `1`, hoặc số `2` nếu khởi hành số 2).
3. **Bộ Lọc Debounce (Chống Nhảy Số Khi Đang Cắt Côn Sang Số):**
   - Khi bóp côn đá số, tỷ số $R$ bị trượt ra ngoài dải.
   - Thuật toán **khóa giữ nguyên số cũ trong vòng `500ms`**.
   - Chỉ cập nhật số mới khi tỷ số mới rơi đúng vào dải của số đó ổn định **liên tục 3 khung hình (`~150ms`)**.
4. **Tính Năng "Tự Học Cấp Số" (Auto-Calibrate):**
   - Người dùng có thể chạy xe thực tế ở từng số và bấm "Lưu", app tự đo $R$ thực tế của xe và lưu vĩnh viễn vào `localStorage`.

---

## 3. Các Bước Triển Khai Cụ Thể

### Bước 1: Xử Lý Đồ Họa Logo
- [ ] Tách nền trong suốt logo linh vật Ảnh 2 thành file PNG độ phân giải cao và lưu vào `software/android-apk/assets/www/img/logo_hvu.png`.
- [ ] Tạo cụm thương hiệu logo + chữ `hvu24.5` (font `Chakra Petch`, màu xanh neon) trên thanh header.

### Bước 2: Tái Cấu Trúc Giao Diện Android (`index.html` & `app.css`)
- [ ] Tái cấu trúc layout theo đúng Ảnh 1:
  - Dải thước đo tua quét ngang phía trên (`0..13k RPM`, vạch redline `10..13k`).
  - Khối Hero vận tốc trung tâm (`0 km/h` lớn viền cyan halo).
  - Khối `GEAR` box góc phải (chữ `N` xanh lá neon hoặc số `1..6`).
  - Cụm `TIME`, `TRIP A`, `ODO` góc dưới phải.
  - Cụm thanh bar `C.TEMP` (°C) và `BATTERY` (V) góc trái.
- [ ] Bổ sung hiệu ứng glowing CSS (`box-shadow`, `text-shadow`) tạo cảm giác màn hình hiển thị TFT cao cấp ban đêm.
- [ ] Giữ đầy đủ các nút chức năng cốt lõi: Kết nối Bluetooth, Đèn báo lỗi FI, Ghi log CSV `REC`, và nút chuyển chế độ Nerdy xem cảm biến sâu.

### Bước 3: Viết Module Báo Số & Đồng Hồ Hành Trình (`app.js`)
- [ ] Thêm logic máy trạng thái `updateGearIndicator(rpm, vss)` với bộ lọc Debounce 3 khung hình.
- [ ] Thêm tính toán quãng đường phiên chạy `tripA` tích phân từ $VSS \times \Delta t$ và lưu tổng `odo` vào `localStorage`.
- [ ] Thêm đồng hồ giờ thực tế (`TIME`) tự đồng bộ theo giờ điện thoại.

### Bước 4: Đồng Bộ Hóa Sang Dashboard PC (`dashboard.py`)
- [ ] Bổ sung ô hiển thị `GEAR` lớn (chữ `N` xanh lá / số `1..6`) vào giao diện `dashboard.py`.
- [ ] Bổ sung dải tua máy quét ngang `0..13k` đồng bộ phong cách với app điện thoại.
- [ ] Tích hợp hàm ước tính cấp số vào vòng lặp nhận khung dữ liệu từ STM32.

### Bước 5: Biên Dịch APK & Kiểm Thử Toàn Diện
- [ ] Kiểm tra cú pháp JavaScript & đối chiếu toàn bộ DOM IDs bằng Node.js.
- [ ] Chạy replay toàn bộ 3.821 khung hình trong file log thực tế `kline_debug.log` để kiểm tra độ ổn định của thuật toán báo số.
- [ ] Chạy file `build_apk.ps1` để biên dịch bản APK mới v2.3 và ký số `apksigner`.
