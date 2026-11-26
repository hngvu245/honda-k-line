# Các Quyết Định Kỹ Thuật (Architecture Decision Records)

## ADR-001: Loại bỏ Auto Fast-Init liên tục trong `while(1)` (Rollback về bản tối giản)
- **Bối cảnh:** Khi bấm đề nổ máy, củ đề kéo sụt áp (xuống ~6.7V) và ECU ưu tiên đánh lửa nên ngưng trả lời K-Line 1–2 giây. Cơ chế watchdog tự động gọi `KLine_RunHandshake()` sau 1.8s (kéo `PA9` LOW 70ms) làm phá phiên giao tiếp UART của ECU, gây vòng lặp spam Fast-Init vô tận.
- **Quyết định:** Rollback `firmware/stm32-legacy/Core/Src/main.c` về luồng tối giản: chỉ Fast-Init 1 lần lúc khởi động hoặc khi người dùng chủ động gửi lệnh `WAKEUP`.
- **Hệ quả:** Các tính năng v2.0 (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `REQ_TABLE`, `SCS_ON/OFF`) tạm thời chưa hoạt động ở firmware hiện tại dù giao diện PC/Android đã có sẵn nút bấm.

## ADR-002: Phát triển Offline-First & Toolchain Android cố định trên ổ `D:`
- **Bối cảnh:** Việc mang laptop ra xe nổ máy mỗi lần sửa giao diện hoặc công thức tốn thời gian và dễ dính ground loop qua sạc AC. Ngoài ra ổ `C:` cần tránh phình dung lượng bởi JDK/Gradle/SDK caches.
- **Quyết định:** Mọi thay đổi UI/decoder phải test trước qua `software/logs/kline_debug.log` (PC) và `sample_frames.js` + `test_app.js` (Android). Build APK chạy script `build_apk.ps1` trỏ toàn bộ cache vào `D:\kailc\.android-toolchain`.
- **Hệ quả:** Rút ngắn vòng lặp kiểm thử UI xuống vài giây; khi chạy `apksigner.bat` độc lập cần set `$env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'`.

## ADR-003: Đồng bộ Giao diện TFT Motorsport, Virtual Gear v2 & Tự Học Số Không Preset
- **Bối cảnh:** Xe Honda phổ thông không xuất byte số hộp số qua K-Line Table `11`; các tỷ số đặt sẵn theo dòng xe dễ sai khác theo nhông sên dĩa thực tế, đồng thời `VSS` là số nguyên làm nhảy số ảo ở tốc độ thấp.
- **Quyết định:** Bỏ menu preset xe; xây dựng lõi chung `KlineCore` (`software/android-apk/assets/www/kline_core.js`) hỗ trợ **Học Số 1 (Kéo Max Tua)** dùng Trimmed Median (MAD) + suy ra tạm số `2..6`, **Tự Học 1→6** và **Chỉnh lẻ từng số**; dùng ranh giới Voronoi trung bình nhân ($\sqrt{R_i \cdot R_{i+1}}$), bù lượng tử `VSS ± 0.7 km/h` và **Clutch-In Freeze** đồng bộ sang `calculate_gear()` của `dashboard.py`. Thêm `dev_server.py` trong `software/android-apk/` để debug WebUI & cài APK qua Wi-Fi mà không cần nạp đi nạp lại.
- **Hệ quả:** Mọi xe nhông sên dĩa bất kỳ chỉ cần 1 cú kéo số 1 là hiển thị số chính xác; `test_app.js` import trực tiếp `KlineCore` thay cho mã giả lập.
