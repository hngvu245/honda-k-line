# AGENTS.md

## 1. Tổng quan dự án (Project Overview)
- **Mục đích:** Hệ thống đọc, giải mã và hiển thị thông số động cơ xe máy **Honda PGM-FI** qua đường truyền **Keihin K-Line (`10400 bps`, Half-Duplex 1 dây)** theo thời gian thực trên PC và Android (USB OTG / Bluetooth SPP & BLE).
- **Tech Stack:**
  - **Firmware:** C / STM32 HAL (`STM32Cube FW_F1 V1.8.7`, `STM32F103C8T6`), biên dịch bằng **Keil uVision V5.29.0.0 (`ARMCC V5.06 update 6 build 750`)**.
  - **PC Workbench:** **Python `3.14.5`** (`customtkinter 6.0.0`, `pyserial 3.5`).
  - **Android Host & WebUI:** Java (`OpenJDK 17.0.21`, `--release 11`, Android SDK 34 `minSdk=24`) + HTML/CSS/JS thuần, kiểm thử JS bằng **Node.js `v24.20.0`**.
- **Kiến trúc:** Pipeline 3 tầng tách biệt phần cứng–phần mềm (**Hardware Bridge** `L9637D + STM32F103` $\rightarrow$ **Serial Transport** `115200 bps` qua CH340 USB-TTL hoặc Bluetooth SPP/BLE $\rightarrow$ **Dual Host UI** PC Dashboard / Android WebView), phát triển theo mô hình **Offline-First** từ log xe thật.

## 2. Lệnh thực thi cốt lõi (Commands)
> Agent PHẢI chạy các lệnh kiểm chứng tương ứng với phần vừa sửa trước khi báo hoàn thành task.

- **Cài đặt / Môi trường:**
  - PC Python cần `customtkinter` và `pyserial`; Android SDK/JDK đặt cố định tại `D:\kailc\.android-toolchain`.
- **Chạy dev / Replay Offline:**
  - PC Dashboard (Live COM + Replay Log): `python software/pc-dashboard/dashboard.py`
  - Monitor Console chuẩn Checksum: `python software/test_stream.py`
  - Kiểm tra cổng COM: `python software/check_ports.py`
- **Build:**
  - Firmware STM32 (tắt Python đang giữ COM trước): `& "D:\kailc\UV4\UV4.exe" -b "firmware\stm32-legacy\MDK-ARM\honda_test.uvprojx" -j0`
  - Android APK: `powershell -ExecutionPolicy Bypass -File "software/android-apk/build_apk.ps1"`
- **Test & Xác thực chữ ký:**
  - Android WebUI DOM IDs & Gear Math: `node software/android-apk/test_app.js`
  - Python compile check: `python -m py_compile software/pc-dashboard/dashboard.py software/test_stream.py`
  - Xác thực chữ ký APK: `$env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'; & "D:\kailc\.android-toolchain\sdk\build-tools\34.0.0\apksigner.bat" verify --verbose --min-sdk-version 24 "software\android-apk\honda-kline-racing.apk"`
- **Lint & Format:**
  - Kiểm tra cú pháp JS WebUI: `node --check software/android-apk/assets/www/app.js`

## 3. Bản đồ thư mục (Directory Map)
- `firmware/stm32-legacy/` — Project STM32CubeMX (`honda_test.ioc`), nguồn C (`Core/Src/main.c`, `stm32f1xx_hal_msp.c`, `stm32f1xx_it.c`) và project Keil (`MDK-ARM/honda_test.uvprojx`).
- `software/pc-dashboard/` — Dashboard Python Dual-Mode (`dashboard.py`) cùng tool CLI (`sniffer.py`, `read_rpm.py`).
- `software/android-apk/` — Java Native Host (`src/com/kailc/hondakline/`), USB OTG filter (`res/xml/device_filter.xml`), WebUI (`assets/www/`), test (`test_app.js`) và `build_apk.ps1`.
- `software/logs/` — Log ECU thật từ xe (`kline_debug.log` phục vụ Replay) và CSV xuất (`kline_telemetry.csv`).
- `docs/` — Đặc tả giao thức (`kline-protocol.md`), sơ đồ phần cứng STM32/ESP32-C3 (`hardware-schematic*.md`) và hướng dẫn thao tác (`workflow.md`).
- `skills/` — Kho `taste-skill` tham khảo giao diện.
- `.agents/` — Antigravity plugin `honda-kline-workflow` (4 specialized subagents + 4 skills).
- `.ai/` — Tài liệu ngữ cảnh, spec, trí nhớ dài hạn và checklist review/fix bug của agent.
- `PLAN.md` & `MEMORY.md` — Spec/checklist cho task hiện tại và trạng thái phiên làm việc tại gốc dự án.

## 4. Quy tắc cứng (Hard Constraints / Guardrails)
### Bắt buộc làm (Do)
- Luôn chạy đúng bộ kiểm chứng cho vùng vừa sửa (`UV4.exe` cho STM32, `py_compile` cho PC, `node --check` + `test_app.js` + `build_apk.ps1` + `apksigner` cho Android).
- Mọi thay đổi giải mã gói Keihin Table `0x11` hoặc cấp số ảo (`GEAR_PRESETS`, `calculate_gear`/`calculateGear`) PHẢI đồng bộ 3 nơi: `software/pc-dashboard/dashboard.py`, `software/android-apk/assets/www/app.js` và `docs/kline-protocol.md`.
- Luôn quét byte header `0x02`, lấy `len = ecu[1]` và kiểm tra `(sum(ecu[0..len-1]) & 0xFF) == 0`; luôn dùng atomic `__disable_irq()` / `__enable_irq()` khi copy buffer ngắt trên STM32.
- Kiểm tra tính sẵn có thực tế trong `firmware/stm32-legacy/Core/Src/main.c` trước khi gắn thêm nút/lệnh từ UI (`main.c` bản hiện tại chỉ hỗ trợ `WAKEUP` và poll Table `11`).
- Thực hiện kiểm thử **Offline-First** qua `software/logs/kline_debug.log` (PC) và `sample_frames.js` (Android) trước khi test trên xe thật.

### Tuyệt đối tránh (Don't)
- KHÔNG tự động giật xung Fast-Init (`PA9` LOW `70 ms`) liên tục bên trong `while(1)` khi ECU tạm im lặng lúc bấm đề nổ máy.
- KHÔNG tách rời `Core/`, `Drivers/`, `MDK-ARM/`, `honda_test.ioc` khỏi `firmware/stm32-legacy/` (sẽ làm gãy đường dẫn tương đối của CubeMX/Keil).
- KHÔNG xả script debug tạm, file `.json` step dump, bản sao `.c` hay file log vào thư mục gốc hoặc `software/`.
- KHÔNG xóa `software/logs/kline_debug.log` hoặc đổi đường dẫn cache Android ra khỏi `D:\kailc\.android-toolchain`.
- KHÔNG nạp firmware / mở Keil Debug khi tiến trình Python (`dashboard.py`, `test_stream.py`, `sniffer.py`) đang khóa cổng COM.

## 5. Quy trình làm việc (3-File Workflow)
1. **Khởi động:** Đọc `MEMORY.md` để nắm trạng thái hiện tại và các quyết định kỹ thuật cũ.
2. **Lập kế hoạch:** Viết thiết kế ngắn gọn + checklist `- [ ]` vào `PLAN.md` và đợi xác nhận trước khi code (với task sửa > 2 file).
3. **Thực thi:** Làm từng mục trong `PLAN.md`, tự chạy lint/test, sau đó đánh dấu `[x]`.
4. **Đóng phiên:** Cập nhật việc đang dở / quyết định mới vào `MEMORY.md` (và `.ai/memory/progress.md`). Nếu vừa sửa một lỗi dễ lặp lại, ghi 1 dòng vào mục **Bài học cần tránh** bên dưới (chi tiết lưu tại `.ai/memory/lessons.md`).

### Bài học cần tránh
- Không đặt `KLine_FastInit()` tự chạy theo chu kỳ trong `while(1)` vì xung `70 ms` sẽ reset phiên ECU lúc đề nổ máy.
- `stm32f1xx_hal_msp.c` giữ `SWJ_NOJTAG` để nạp ST-Link trên bàn, nhưng khi test xe thật bị treo do xung bugi vào `PA13`/`PA14` thì phải đổi sang `SWJ_DISABLE`.
- `HAL_UART_ErrorCallback()` luôn phải đọc `SR` $\rightarrow$ `DR`, xóa đủ cờ `ORE/FE/NE` và reset `RxState` trước khi re-arm `HAL_UART_Receive_IT()`.
- Luôn chạy `Stop-Process -Name python -Force` trước khi nạp Keil/mở COM mới, và dùng pin laptop (rút sạc AC) khi cắm vào xe tránh ground loop CH340.
- `res/xml/device_filter.xml` dùng hệ thập phân (`0x4348` = `17224`, không ghi `4348`); chạy `apksigner.bat` độc lập phải set `$env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'`.
- `KlineCore.parseKlinePacket()` trả về `afrEst` dạng chuỗi (`"CUT"`/`"--"`/`"14.2"`), không gọi `.toFixed()`; kiểm tra USB connection phải parse JSON `getUsbDebugInfo().isConnected` (tránh `.includes("connected")` trúng chuỗi `"isConnected":false`).
- Khế ước callback từ `BtBridge.java` xuống WebUI là `window.__onBtFrame`, `window.__onBtStatus`, `window.__onPairedDevices`, `window.__onBleDeviceFound`, `window.__onBleScanDone` — luôn giữ alias khớp tên khi sửa `app.js` và kiểm tra bằng `test_app.js`.

## 6. Điều hướng tài liệu (Context Routing)
Chỉ đọc các file dưới đây khi task có liên quan để tiết kiệm context:
- Trạng thái tổng & việc dở dang: `MEMORY.md`, `.ai/memory/progress.md`
- Kế hoạch task hiện hành & spec: `PLAN.md`, `.ai/specs/`
- Kiến trúc & luồng dữ liệu: `.ai/context/architecture.md`
- Quy chuẩn code & đồng bộ đa nền tảng: `.ai/context/conventions.md`
- Các quyết định kỹ thuật cũ (ADR): `.ai/memory/decisions.md`
- Danh sách lỗi phần cứng/firmware cần tránh: `.ai/memory/lessons.md`
- Quy trình fix bug / review: `.ai/workflows/bug-fix.md`, `.ai/workflows/code-review.md`
