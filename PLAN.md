# PLAN.md — Tự Học Cấp Số Kéo Max Tua, Sửa Toàn Diện APK & Workflow Không Cần Tải Lại App

- **Trạng thái:** `CHỜ XÁC NHẬN`
- **Phạm vi:** Giữ nguyên giao diện [dashboard.py](software/pc-dashboard/dashboard.py) (chỉ đồng bộ lõi `calculate_gear()` theo quy tắc dự án); tập trung đại tu **thuật toán tự học số**, **sửa lỗi logic + visual Android WebUI/Java**, và dựng **workflow dev/debug tại chỗ trong `software/android-apk/`**.
- **Tham chiếu:** [MEMORY.md](MEMORY.md), [AGENTS.md](AGENTS.md), [docs/kline-protocol.md](docs/kline-protocol.md)

---

## 1. Thiết Kế Chi Tiết

### A. Thuật toán Track Gear & Tự Học Số Kiểu "Vào Số 1 → Kéo Max Tua"
Không dùng menu chọn preset xe rườm rà. Hệ thống tập trung vào **học trực tiếp từ xe thật** + nhận diện ổn định theo vật lý:

1. **Chế độ Tự Học Số (`GearPullLearner`) — 2 cách dùng song song:**
   - **Cách 1 — Học Từ Cú Kéo Số 1 (`Vào số 1 → Kéo max tua`):**
     - Bấm **Học Số 1 (Kéo Max Tua)** → nhả hết côn vào số 1 và kéo ga lên tua cao (vd `2,500 → 9,000+ RPM`).
     - Bộ lọc chỉ lấy mẫu khi **côn đã bắt hoàn toàn** (`VSS >= 6 km/h`, `RPM >= 2200`, `TPS >= 5%`, `dRPM >= -150`, loại bỏ pha vê côn/trượt côn lúc đề-pa).
     - Trọng số ưu tiên dải **tốc độ cao (`VSS` lớn)** vì `ecu[17]` là số nguyên `km/h` (ở `40 km/h` sai số lượng tử `±1 km/h` chỉ còn `2.5%`, chính xác gấp 10 lần lúc chạy `4 km/h`), sau đó lấy **Trimmed Median (MAD outlier rejection)** để chốt chuẩn tỷ số $R_1$ của xe bạn.
     - Từ $R_1$ vừa đo được, hệ thống **khóa `R[0] = R1`** và tự nội suy tỷ số tham chiếu cho số `2..6` theo tỷ lệ bước số chuẩn Honda để báo số được ngay lập tức sau 1 cú kéo số 1 (gắn nhãn trạng thái từng số: `Đã học` vs `Suy từ Số 1`).
   - **Cách 2 — Tự Học Liên Hoàn / Từng Số (`1 → N`):**
     - Trong **Tự Học Liên Hoàn**, sau khi giữ ổn định dải số 1, mỗi lần bạn sang số cao hơn (tỷ số $R$ giảm đột ngột `>= 18%` và ổn định `>= 5` khung khi `RPM >= 2400`), app tự tách cụm sang số tiếp theo (`R2`, `R3`, ..., tối đa `6` số) và tự xác định hộp số xe có `4`, `5` hay `6` số!
     - Đồng thời có nút **Học riêng từng số (`Số 1`..`Số 6`)** để tinh chỉnh lại bất kỳ số nào chưa ưng, lưu bền vào `localStorage` (`kline_learned_ratios`).

2. **Thuật toán Nhận Diện Số V2 (Chống sai số `VSS` nguyên & giữ số khi cắt côn):**
   - **Vùng Voronoi trung bình nhân (Log-Midpoint):** Ranh giới giữa số $i$ và $i+1$ đặt tại $\sqrt{R_i \cdot R_{i+1}}$ — xóa sạch khoảng chết (`dead-zone`) giữa các số.
   - **Bù lượng tử `VSS ± 0.7 km/h`:** Tính thêm khoảng $[RPM / (VSS + 0.7), RPM / \max(1, VSS - 0.7)]$ ở tốc độ thấp (`VSS < 15`) để số `1`/`2` không nhảy loạn khi `VSS` nhích từng `1 km/h`.
   - **Clutch-In Freeze:** Khi đang lăn bánh (`VSS >= 4`) mà bóp côn khiến `RPM < 1350` hoặc sụt tua gắt (`dRPM < -900`), **khóa giữ nguyên số hiện tại** (tránh nhảy nhầm sang số `5`/`6`) trong tối đa `1200 ms`, chỉ về `N` khi `VSS < 2`.
   - **Hysteresis thông minh:** Đổi sang số liền kề (`±1`) cần `2` khung xác nhận; nhảy cóc `>= 2` số cần `4` khung và `RPM >= 1800`.
   - **Đồng bộ:** Cập nhật hàm tương đương `calculate_gear()` trong `dashboard.py` (không đụng UI PC) và ghi spec vào `docs/kline-protocol.md`.

### B. Danh Sách Lỗi APK Đã Phát Hiện Cần Sửa Triệt Để

1. **Lỗi giao diện & CSS (`index.html` + `app.css` + `app.js`):**
   - **Trùng DOM ID nghiêm trọng:** `#cEctNum`, `#cEctSub`, `#cVbatNum`, `#cVbatSub` xuất hiện **2 lần** trong `page-casual-overview` (`.tft-bars-grid` và `#cSecGrid`), làm 2 card phía dưới chết cứng ở `--` mãi mãi và lặp dữ liệu thô trên màn hình dọc.
   - **Ghi đè `className` phá bố cục Landscape:**
     - `app.js` gán `$("#lcRpm").className = "hero-num hero-num--hud"` (phóng to thành `56px` đè nát thanh tach trên cùng vốn thiết kế `20px` `.tft-rpm-val`).
     - `app.js` gán `$("#lcGearVal").className = "gear-val ..."` làm mất class `.tft-gear-digit` trên khung `#lcGearVal`.
   - **Xung đột Media Query màn hình ngang (`app.css`):** `.portrait-app { display: none; }` nằm trong `(orientation: landscape) and (max-height: 540px)` còn `.landscape-hud` nằm trong `(orientation: landscape)`, dẫn tới máy có chiều cao landscape `> 540px` bị hiện **cả 2 giao diện chồng lên nhau**.
   - **Thẩm mỹ rối & chắp vá:** Gộp 2 phong cách đang đánh nhau trong `app.css` thành **1 hệ thống OEM Motorsport Cockpit đồng nhất** (bỏ `FUEL 71%` giả, bỏ `<input type="hidden">` hack, bỏ halo nhòe quá tay, nới thoáng topbar dọc không bị chật ở `360–390px`, dọn inline `style="..."` và emoji thô ở `#usbDiagBox`, thêm `ResizeObserver` vẽ lại Canvas khi chuyển tab/xoay màn hình).

2. **Lỗi logic JS & Native Java (`app.js`, `BtBridge.java`, `UsbSerialManager.java`, `MainActivity.java`):**
   - `btnResetTrip` quên reset `peakVss` và `tripMeters` (khiến `TRIP A` không về `0.0`), và không cập nhật UI ngay lập tức.
   - `BtBridge.connectSpp()` khối `finally` luôn bắn `emitStatus("disconnected")` cả khi người dùng chuyển sang USB/BLE (gây race-condition reset UI về `Chưa kết nối`).
   - `BtBridge.disconnectUsb()` đóng USB nhưng không phát status `"disconnected"`.
   - `BtBridge.send()` bắn dữ liệu sang `usbSerialManager` ngay cả khi đang dùng BT.
   - Tự động gửi `WAKEUP\r\n` cứng sau `300 ms` lúc mở USB/BT dễ làm STM32 chạy lại Fast-Init lần 2 nếu MCU vừa tự khởi tạo xong (đổi sang chỉ gửi nếu sau `1000 ms` chưa có byte RX nào từ STM32).

### C. Workflow Test & Debug Ngay Trong `software/android-apk/` (Không Tải Đi Tải Lại APK)

1. **`software/android-apk/dev_server.py` (Local Live Preview + Mock/Live Bridge + Wi-Fi APK):**
   - Serve trực tiếp `assets/www/` ở `http://127.0.0.1:8765/www/index.html` — sửa CSS/HTML/JS chỉ cần bấm `F5` trên trình duyệt PC (preview đồng thời khung dọc `390x844` và khung ngang `844x390`).
   - Tự động inject mock `window.AndroidBT` + bảng điều khiển **Test Scenarios** ngay trong trình duyệt:
     - Chạy giả lập **Pull Số 1 → Max Tua**, **Chạy 1→6**, **Cắt côn tụt tua**, **DFCO**, **Lỗi DTC (07/08/21)**, **Mất kết nối USB/BT**.
     - Chế độ `--port COMx` đẩy luồng byte STM32 thật qua SSE vào trình duyệt PC để test giao diện Android bằng phần cứng thật **không cần build APK**.
   - Endpoint `http://<LAN-IP>:8765/apk` để điện thoại tải nhanh bản `.apk` mới qua Wi-Fi khi cần test thực địa.
2. **Tách lõi & nâng cấp `software/android-apk/test_app.js`:**
   - Export `window.KlineCore` từ `app.js` (chạy được cả trên Node lẫn WebView) để `test_app.js` test **chính code thật**, kiểm tra phát hiện **trùng DOM ID**, kiểm tra `GearPullLearner` (kéo số 1 + suy diễn + học 1→6) và các case `VSS` thấp / bóp côn.
3. **Debug bên trong APK (`MainActivity.java`, `BtBridge.java`):**
   - Bật `WebView.setWebContentsDebuggingEnabled(true)` (debug trực tiếp qua `chrome://inspect`).
   - Bắt `WebChromeClient.onConsoleMessage` + native ring-buffer log (`BtBridge`/`UsbSerialManager`), hiển thị và cho phép xuất file log ngay trong tab `ECU Lab` (không cần cắm máy tính mới biết app lỗi ở đâu).
4. **Tài liệu `software/android-apk/WORKFLOW.md`:** Ghi rõ quy trình 3 tầng (`Browser Live Reload -> Node Automated Suite -> Build & Cài APK`).

---

## 2. Checklist Thực Thi

- [ ] **Bước 1 — Lõi Gear Tracker v2 & Tự Học Số (`app.js`, `dashboard.py`, `docs/kline-protocol.md`):**
  - [ ] Cài đặt `GearPullLearner` (học từ cú kéo số 1 max tua + nội suy tạm + học liên hoàn/từng số `1..6` + lọc MAD outlier) và `calculateGear` v2 (Voronoi log-midpoint, bù `VSS ±0.7`, clutch-in freeze) trong `app.js` + export `KlineCore`.
  - [ ] Đồng bộ `calculate_gear()` tương ứng trong `software/pc-dashboard/dashboard.py` (giữ nguyên toàn bộ UI PC).
  - [ ] Cập nhật đặc tả thuật toán Gear v2 & Self-Learn vào `docs/kline-protocol.md`.
- [ ] **Bước 2 — Đại Tu Visual & Sửa Bug WebUI Android (`index.html`, `app.css`, `app.js`):**
  - [ ] Xóa thẻ trùng ID `cEctNum`/`cEctSub`/`cVbatNum`/`cVbatSub`, xóa `FUEL` giả & `<input type="hidden">`, dọn 2 bộ CSS đánh nhau thành 1 hệ thống TFT Motorsport thống nhất (Portrait + Landscape `100dvh`, responsive gọn ở `360–412px` & `>540px`).
  - [ ] Sửa lỗi ghi đè `className` trên `#lcRpm` / `#lcGearVal`, sửa `btnResetTrip`, `renderIdleState()`, thêm `ResizeObserver` cho Canvas.
  - [ ] Thêm UI **Tự Học Số (Kéo Số 1 Max Tua / Tự Học 1→6 / Học Từng Số)** và khung **App Debug Log** vào `ECU Lab`.
- [ ] **Bước 3 — Sửa Bug Native Java Bridge & Debug Hooks (`MainActivity.java`, `BtBridge.java`, `UsbSerialManager.java`):**
  - [ ] Sửa race `emitStatus("disconnected")` khi chuyển mode SPP/BLE/USB, sửa `disconnectUsb()` status, tách `send()` theo transport đang nối, hoãn auto-`WAKEUP` thông minh nếu chưa thấy RX.
  - [ ] Bật `WebView.setWebContentsDebuggingEnabled(true)`, bắt `onConsoleMessage` và thêm native debug ring-buffer + `exportDebugLog`.
- [ ] **Bước 4 — Workflow Test & Debug trong `software/android-apk/`:**
  - [ ] Nâng cấp `test_app.js` test trực tiếp `KlineCore` thật + kiểm tra **unique DOM ID** + kịch bản kéo số 1 / 1→6 / cắt côn.
  - [ ] Tạo `software/android-apk/dev_server.py` (preview dọc/ngang, mock `AndroidBT`, kịch bản chạy số `1..6`, optional COM passthrough, `/apk` LAN download).
  - [ ] Tạo `software/android-apk/WORKFLOW.md`.
- [ ] **Bước 5 — Kiểm Chứng Toàn Diện & Đóng Phiên:**
  - [ ] Kiểm tra cân bằng HTML `index.html`, `node --check app.js`, `node software/android-apk/test_app.js`.
  - [ ] Kiểm tra live preview `dev_server.py` ở kích thước dọc `390x844` và ngang `844x390` (xác nhận không tràn chữ, không trùng, số `N -> 1..6` hoạt động mượt).
  - [ ] Chạy `python -m py_compile` cho `dashboard.py` và `dev_server.py`.
  - [ ] Chạy `build_apk.ps1` + `apksigner.bat verify --min-sdk-version 24`.
  - [ ] Cập nhật `MEMORY.md`, `.ai/memory/progress.md`, `.ai/memory/decisions.md` và `AGENTS.md` (Bài học cần tránh).

---

*Duyệt kế hoạch này hoặc góp ý thêm phần visual/tự học số để mình bắt đầu triển khai.*
