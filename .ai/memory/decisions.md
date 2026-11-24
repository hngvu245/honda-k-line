# Các Quyết Định Kỹ Thuật (Architecture Decision Records)

## ADR-001: Loại bỏ Auto Fast-Init liên tục trong `while(1)` (Rollback về bản tối giản)
- **Bối cảnh:** Khi bấm đề nổ máy, củ đề kéo sụt áp (xuống ~6.7V) và ECU ưu tiên đánh lửa nên ngưng trả lời K-Line 1–2 giây. Cơ chế watchdog tự động gọi `KLine_RunHandshake()` sau 1.8s (kéo `PA9` LOW 70ms) làm phá phiên giao tiếp UART của ECU, gây vòng lặp spam Fast-Init vô tận.
- **Quyết định:** Rollback `firmware/stm32-legacy/Core/Src/main.c` về luồng tối giản: chỉ Fast-Init 1 lần lúc khởi động hoặc khi người dùng chủ động gửi lệnh `WAKEUP`.
- **Hệ quả:** Các tính năng v2.0 (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `REQ_TABLE`, `SCS_ON/OFF`) tạm thời chưa hoạt động ở firmware hiện tại dù giao diện PC/Android đã có sẵn nút bấm.

## ADR-002: Phát triển Offline-First & Toolchain Android cố định trên ổ `D:`
- **Bối cảnh:** Việc mang laptop ra xe nổ máy mỗi lần sửa giao diện hoặc công thức tốn thời gian và dễ dính ground loop qua sạc AC. Ngoài ra ổ `C:` cần tránh phình dung lượng bởi JDK/Gradle/SDK caches.
- **Quyết định:** Mọi thay đổi UI/decoder phải test trước qua `software/logs/kline_debug.log` (PC) và `sample_frames.js` + `test_app.js` (Android). Build APK chạy script `build_apk.ps1` trỏ toàn bộ cache vào `D:\kailc\.android-toolchain`.
- **Hệ quả:** Rút ngắn vòng lặp kiểm thử UI xuống vài giây; khi chạy `apksigner.bat` độc lập cần set `$env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'`.

## ADR-003: Đồng bộ Giao diện 2.2:1 TFT Motorsport & Virtual Gear Estimator
- **Bối cảnh:** Xe Honda phổ thông truyền speed `VSS` và `RPM` qua K-Line Table `11` nhưng không xuất trực tiếp byte số hộp số trên mọi đời ECU.
- **Quyết định:** Tính cấp số ảo từ tỷ số $R = \text{RPM} / \text{VSS}$ kèm debounce 3 khung hình ở cả `dashboard.py` (`calculate_gear`) và `app.js` (`calculateGear`), chia chung preset `winner150`, `wave110`, `exciter150`.
- **Hệ quả:** Không cần đấu thêm dây cảm biến số; mọi thay đổi bảng tỷ số phải cập nhật song song ở cả Python, JS và `test_app.js`.
