# Kiểm Toán Mã Nguồn & Cải Tiến Workflow (Codebase Audit & Workflow)

Tài liệu tổng hợp kết quả đọc toàn bộ mã nguồn thực tế trong `d:\kailc\save\honda_test`, đối chiếu sự sai lệch giữa tài liệu cũ và code hiện hành, liệt kê các lỗi phát hiện được và chuẩn hóa workflow + hệ thống Agent Antigravity mới.

---

## 1. Hiện Trạng Thực Tế Theo Từng Thành Phần

| Thành phần | Đường dẫn thực tế | Trạng thái mã nguồn hiện hành | Khác biệt với tài liệu cũ |
| :--- | :--- | :--- | :--- |
| **Firmware STM32** | `firmware/stm32-legacy/Core/Src/main.c` | Bản tối giản ổn định (`Ban toi gian theo loi goc chay muot`, 294 dòng): Fast-Init 70/120ms lúc boot, nhận `WAKEUP` qua `USART2`, hỏi Table `11` mỗi ~145ms (`POLL_REST_MS=100` + `HAL_Delay(45)`). | `README.md` & `docs/workflow.md` ghi nhầm path `firmware/Core/...` (thiếu `stm32-legacy/`). `docs/workflow.md` §5 & `docs/kline-protocol.md` mô tả tính năng v2.0 (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `REQ_TABLE:XX`, `PB0 SCS`, auto-reconnect 4s/1.8s) **chưa có** trong `main.c` hiện tại sau khi rollback để tránh treo khi đề máy. |
| **MSP / SWD** | `firmware/stm32-legacy/Core/Src/stm32f1xx_hal_msp.c` | Bật `__HAL_AFIO_REMAP_SWJ_NOJTAG()` (giữ SWD `PA13`/`PA14` để nạp ST-Link), `PA9` dùng `GPIO_MODE_AF_OD`, `USART1` priority 1, `USART2` priority 2. | `docs/kline-protocol.md` ghi `PA9` Push-Pull, code dùng Open-Drain (`OUTPUT_OD`/`AF_OD`). `plan.md` đề xuất `__HAL_AFIO_REMAP_SWJ_DISABLE()` khi chạy xe thật để chống nhiễu cao áp bugi. |
| **PC Dashboard** | `software/pc-dashboard/dashboard.py` | 2.052 dòng Python CustomTkinter: 2 chế độ `NERDY (Bench)` (4 tab) & `CASUAL`, Replay từ `software/logs/kline_debug.log`, xuất CSV `software/logs/kline_telemetry.csv`, Virtual Gear (`winner150`, `wave110`, `exciter150`), Pull Timer 4k–9k RPM. | Đồng bộ tốt với giao thức Table `11` (`ecu[4..5]` RPM). Đã hỗ trợ sẵn parse `00`, `73`, `74`, `60` khi firmware v2.0 được bật lại. |
| **CLI Tools** | `software/test_stream.py`, `software/pc-dashboard/{sniffer.py, read_rpm.py}`, `software/check_ports.py` | `test_stream.py` kiểm tra checksum và giải mã đúng Table `11`. `sniffer.py` đọc thô 115200 bps. | `read_rpm.py` là bản cũ đọc lệch index `data[9..10]` (phụ thuộc đúng 5 byte echo đứng trước). |
| **Android APK (Java)** | `software/android-apk/src/com/kailc/hondakline/` | `MainActivity.java` (WebView `appassets.local`, immersive landscape, USB attach), `BtBridge.java` (SPP + BLE + USB + CSV), `UsbSerialManager.java` (CH340, CP2102, FTDI, PL2303, CDC-ACM @ `115200 8N1`). | `build_apk.ps1` dùng `minSdkVersion=24` (`AndroidManifest.xml`), còn `docs/workflow.md` dòng 77 ghi `--min-sdk-version 21`. |
| **Android WebUI** | `software/android-apk/assets/www/` | `index.html`, `app.css`, `app.js`, `sample_frames.js` (410 frame thật): Portrait + Landscape Cockpit 2.2:1 (`hvu24.5`), Casual & Nerdy, Scope, Map, DTC Modal, ODO/Trip. | Đã sửa 2 thẻ `</div>` dư quanh `#lGridNerdy` trong `index.html` và sửa `vendor-id` Qinheng trong `device_filter.xml`. |
| **ESP32-C3** | `docs/esp32-c3-supermini-pinout.md`, `docs/hardware-schematic-esp32c3.md` | Chỉ có tài liệu thiết kế sơ đồ nguyên lý & BOM. | Chưa có thư mục mã nguồn firmware `firmware/esp32-c3/` nào trong repo. |

---

## 2. Các Lỗi Kỹ Thuật Đã Phát Hiện & Trạng Thái Xử Lý

1. **Đã sửa — Lỗi cấu trúc DOM trong `software/android-apk/assets/www/index.html`:**
   - Đã xóa 2 thẻ `</div>` dư từng đóng sớm `#landscapeHud` trước `#lGridNerdy`; kiểm tra cân bằng thẻ `<div>` đạt `0` lỗi.
2. **Đã sửa — Sai hệ số thập phân Vendor ID trong `software/android-apk/res/xml/device_filter.xml` (dòng 16):**
   - Đã đổi `<usb-device vendor-id="4348" />` sang `vendor-id="17224"` (đúng giá trị thập phân của `0x4348` Qinheng WCH).
3. **Đã sửa — Lệch đường dẫn và `min-sdk` trong tài liệu:**
   - Đã đồng bộ `README.md` và `docs/workflow.md` sang `firmware/stm32-legacy/...`, `--min-sdk-version 24`, và biến `$env:JAVA_HOME` cho `apksigner.bat`.
4. **Đã dọn — Rác điều tra phiên trước (29 file):**
   - Đã xóa các file `main_found_*.c`, `orig_step.json`, `step_373.json` ở gốc; 17 script forensic rời trong `software/`; file sao lưu `honda_test - Copy*`, `build*.log` và `live_pc_sniff.log`.
5. **Chú ý còn lại — Script legacy `software/pc-dashboard/read_rpm.py`:**
   - Giữ lại để tham khảo lịch sử nhưng script này đọc offset cứng `data[9..10]` (lệ thuộc 5 byte echo); hãy ưu tiên dùng `software/test_stream.py` hoặc `dashboard.py`.

---

## 3. Kiến Trúc Workflow & Agent Mới Đã Thiết Lập

Dự án đã được bổ sung chuẩn tùy biến Antigravity tại gốc repo và `.agents/plugins/honda-kline-workflow/`:

- **[AGENTS.md](file:///d:/kailc/save/honda_test/AGENTS.md)**: Luật dự án luôn nạp cho mọi agent (bản đồ path thật, chuẩn K-Line 10400/115200, quy tắc đồng bộ công thức PC <-> Android <-> Docs, quy tắc giữ sạch repo).
- **Plugin `.agents/plugins/honda-kline-workflow/`**:
  - **4 Agent chuyên biệt (`agents/`)**:
    1. `kline-firmware-engineer` — Sửa & build firmware STM32F103 (`UV4.exe`), kiểm soát timing K-Line 10400 bps, ngắt UART và chế độ SWD/EMI.
    2. `telemetry-ui-sync` — Đồng bộ logic giải mã Table 11, tỷ số truyền Virtual Gear và giao diện giữa `dashboard.py` và `software/android-apk/assets/www/`.
    3. `kline-log-analyst` — Phân tích offline `software/logs/kline_debug.log`, bắt lỗi checksum, phân biệt nhiễu bugi EMI với rớt CH340 / reset MCU.
    4. `apk-release-qa` — Bảo trì Java OTG/BT bridge (`BtBridge.java`, `UsbSerialManager.java`), chạy `node test_app.js`, build & verify APK bằng `build_apk.ps1`.
  - **4 Skill quy trình (`skills/`)**:
    1. `stm32-firmware-build` — Quy trình giải phóng COM -> build Keil CLI -> kiểm tra `.hex` & SWD.
    2. `android-apk-build` — Quy trình lint JS / DOM -> `build_apk.ps1` -> `apksigner verify`.
    3. `kline-offline-replay` — Quy trình phát triển/kiểm thử không cần xe dựa trên `kline_debug.log` và `sample_frames.js`.
    4. `repo-hygiene` — Quy tắc phân loại thư mục, chống xả script/log tạm vào root.

---

## 4. Lệnh Chuẩn Hóa Hằng Ngày (Verified)

Chạy tại `d:\kailc\save\honda_test`:

```powershell
# 1. Giải phóng cổng COM trước khi nạp/build Keil
Stop-Process -Name python -Force -ErrorAction SilentlyContinue

# 2. Build Firmware STM32 qua Keil CLI (không cần mở GUI)
& "D:\kailc\UV4\UV4.exe" -b "firmware\stm32-legacy\MDK-ARM\honda_test.uvprojx" -j0

# 3. Kiểm tra WebUI & thuật toán Gear trên PC (không cần điện thoại)
node --check "software/android-apk/assets/www/app.js"
node "software/android-apk/test_app.js"

# 4. Build & kiểm tra chữ ký Android APK
powershell -ExecutionPolicy Bypass -File "software/android-apk/build_apk.ps1"
$env:JAVA_HOME = 'D:\kailc\.android-toolchain\jdk'
& "D:\kailc\.android-toolchain\sdk\build-tools\34.0.0\apksigner.bat" verify --verbose --min-sdk-version 24 "software\android-apk\honda-kline-racing.apk"

# 5. Chạy Dashboard PC (Offline Replay / Live COM) hoặc Monitor Console
python "software/pc-dashboard/dashboard.py"
python "software/test_stream.py"
```
