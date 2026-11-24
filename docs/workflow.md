# Quy Trình Phát Triển & Cải Thiện Workflow (Honda Keihin K-Line)

Tài liệu chuẩn hóa quy trình làm việc giữa **Firmware (STM32 / KeilC)**, **Phần mềm (PC Python / Android APK)** và **Phần cứng thực tế trên xe**, giúp giảm thời gian thử đi thử lại ngoài xe và loại bỏ các lỗi kẹt cổng COM / nạp mạch. Quy chuẩn cho AI agent xem tại [AGENTS.md](../AGENTS.md).

---

## 1. Cấu Trúc Thư Mục & Phân Tách Trách Nhiệm

```text
honda_test/
├── AGENTS.md                        # Luật workspace & bất biến phần cứng/giao thức
├── .agents/plugins/honda-kline-workflow/ # 4 subagents + 4 skills quy trình
├── firmware/stm32-legacy/           # Code C STM32, CubeMX (.ioc) & project KeilC MDK-ARM
├── software/
│   ├── pc-dashboard/                # Giao diện Python Racing Telemetry + tool đọc nhanh CLI
│   ├── android-apk/                 # Mã nguồn Android Java + WebUI + test_app.js + build_apk.ps1
│   ├── logs/                        # Kho lưu log gói tin ECU thật & file CSV xuất ra
│   ├── check_ports.py               # Kiểm tra cổng COM hiện có
│   └── test_stream.py               # Monitor console chuẩn checksum không GUI
├── skills/                          # Kho UI skill tham khảo (giữ tách khỏi code chạy)
└── docs/                            # Tài liệu workflow, kiểm toán, giao thức & sơ đồ phần cứng
```

**Nguyên tắc giữ sạch repo:**
* **Không tạo file log, JSON dump hay script tạm ở thư mục gốc hoặc `software/`** — mọi log và CSV xuất từ Dashboard đều đi vào `software/logs/`.
* **Không tách rời `Core/`, `Drivers/`, `MDK-ARM/`, `honda_test.ioc`** — giữ chung bên trong `firmware/stm32-legacy/` để STM32CubeMX và KeilC giữ nguyên đường dẫn tương đối `../Core` và `../Drivers`.
* **Toolchain Android SDK 34 & JDK nằm cố định tại `D:\kailc\.android-toolchain`** (không tốn dung lượng ổ `C:`).

---

## 2. Quy Trình Phát Triển 4 Bước "Offline-First"

Thay vì mỗi lần sửa công thức giải mã hay giao diện lại phải dắt xe ra cắm dây nổ máy, hãy làm đúng theo chu trình khép kín dưới đây:

### Bước 1 — Thu mẫu thực địa 1 lần (Capture)
* Cắm STM32 + L9637D + CH340 vào xe, chạy [test_stream.py](../software/test_stream.py) hoặc [dashboard.py](../software/pc-dashboard/dashboard.py).
* Quét đủ các trạng thái thực tế cần kiểm thử:
  1. Bật khóa điện (chưa đề máy) $\rightarrow$ vặn ga từ `0%` đến `100%` để lấy ngưỡng TPS đóng/mở.
  2. Nổ garanti cho đến khi nóng máy (quan sát ECT tăng dần).
  3. Kéo ga tua cao rồi buông hết ga (để bắt hiện tượng cắt xăng giảm tốc `DFCO` và chân không `MAP`).
* Dữ liệu tự động lưu vào `software/logs/kline_debug.log`.

### Bước 2 — Phát triển & Kiểm chứng trên PC bằng Replay Simulator
* Chạy Dashboard trên máy tính không cần cắm mạch hay xe:
  ```powershell
  python software/pc-dashboard/dashboard.py
  ```
* Bấm **Phát lại Log**, chọn tốc độ `0.5x / 1x / 4x / 10x` hoặc kéo thanh trượt để:
  * Kiểm tra Checksum gói tin (`(sum(ecu[0..24]) & 0xFF) == 0`).
  * Tinh chỉnh công thức vật lý, ngưỡng đèn báo chuyển số, ngưỡng cảnh báo nhiệt `ECT` / tụt áp `VBAT` và Virtual Gear.
  * Xuất thử ra `software/logs/kline_telemetry.csv` bằng nút **Ghi CSV** để phân tích chi tiết hơn.

### Bước 3 — Đồng bộ & Đóng gói Android APK
* Khi giao diện và công thức trên PC đã chuẩn, đồng bộ sang `software/android-apk/assets/www/` (`app.js`, `index.html`, `app.css`).
* Chạy kiểm tra cú pháp JS, DOM IDs và bộ test tỷ số truyền trước khi build:
  ```powershell
  node --check "software/android-apk/assets/www/app.js"
  node "software/android-apk/test_app.js"
  powershell -ExecutionPolicy Bypass -File "d:\kailc\save\honda_test\software\android-apk\build_apk.ps1"
  ```
* Chép `software/android-apk/honda-kline-racing.apk` (hoặc tải từ GitHub Releases) vào điện thoại và bấm **Demo** để test bố cục dọc/ngang trực tiếp trước khi ra xe.

### Bước 4 — Nạp Firmware STM32 & Kiểm tra trên xe (Pre-Flight Checklist)
Trước khi bấm **Download (F8)** trên KeilC và cắm lên xe thật, kiểm tra đủ 4 mục sau:
1. **Giải phóng cổng COM & mạch nạp:** Tắt hết `dashboard.py`, `sniffer.py`, `test_stream.py` đang chạy ngầm trước khi build/nạp.
2. **Kiểm tra chế độ SWD/EMI trong `stm32f1xx_hal_msp.c`:** `__HAL_AFIO_REMAP_SWJ_NOJTAG()` dùng để nạp ST-Link trên bàn; khi chạy thử trên xe gặp xung cao áp bugi gây treo MCU, cân nhắc chuyển sang `__HAL_AFIO_REMAP_SWJ_DISABLE()` (chi tiết tại [lessons.md](../.ai/memory/lessons.md)).
3. **Đo nguồn Buck (khi dùng độc lập trên xe):** Chỉnh đầu ra Buck (MP1584/LM2596) đúng **`5.0V`** trước khi cấp vào STM32 `5V`, L9637D `Pin 3 (VCC)` và module Bluetooth.
4. **Kiểm tra Baudrate Bluetooth & an toàn 12V:** Module Bluetooth phải set **`115200 bps`** khớp `USART2` trong [main.c](../firmware/stm32-legacy/Core/Src/main.c) (`huart2.Init.BaudRate = 115200`); đường `+12V` phải qua cầu chì + diode `1N5819` và nối chung `GND` trước.

---

## 3. Bảng Lệnh Nhanh (PowerShell Cheat-Sheet)

Chạy từ thư mục gốc `d:\kailc\save\honda_test`:

| Tác vụ | Lệnh thực thi |
| :--- | :--- |
| **Mở Dashboard PC (Live / Replay)** | `python software/pc-dashboard/dashboard.py` |
| **Monitor Console chuẩn Checksum** | `python software/test_stream.py` |
| **Soi gói tin RAW qua Terminal** | `python software/pc-dashboard/sniffer.py` |
| **Mở khóa cổng COM đang bị treo** | `Stop-Process -Name python -Force` |
| **Kiểm tra JS & DOM Android WebUI** | `node software/android-apk/test_app.js` |
| **Build & ký lại file APK** | `powershell -ExecutionPolicy Bypass -File "software/android-apk/build_apk.ps1"` |
| **Build Firmware KeilC qua CLI** | `& "D:\kailc\UV4\UV4.exe" -b "firmware\stm32-legacy\MDK-ARM\honda_test.uvprojx" -j0` |
| **Xác thực chữ ký v2/v3 APK** | `$env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'; & "D:\kailc\.android-toolchain\sdk\build-tools\34.0.0\apksigner.bat" verify --verbose --min-sdk-version 24 "software\android-apk\honda-kline-racing.apk"` |

---

## 4. Sổ Tay Xử Lý Lỗi Thực Tế (Troubleshooting)

### Lỗi 1: KeilC báo `No target connected` hoặc `Target DLL has been cancelled`
* **Nguyên nhân:** Dây `SWDIO`/`SWCLK`/`3.3V`/`GND` lỏng, nguồn sụt áp, SWD đang bị tắt (`SWJ_DISABLE`), hoặc cổng USB-Serial đang giữ mạch.
* **Cách xử lý:**
  1. Rút dây 12V K-Line và tắt hết phần mềm Python trên PC.
  2. Trong KeilC -> *Options for Target -> Debug -> Settings -> Connect*: chọn **Under Reset**.
  3. Nhấn **GIỮ im nút RESET** trên board STM32 $\rightarrow$ bấm **F8 (Download)** $\rightarrow$ vừa thấy thanh tiến trình chạy thì thả tay.

### Lỗi 2: Python báo `PermissionError(13, 'Access is denied', None, 5)` khi mở cổng COM
* **Nguyên nhân:** Có cửa sổ `test_stream.py`, `sniffer.py`, `read_rpm.py` hoặc `dashboard.py` khác đang mở ngầm, hoặc xung nhiễu/ground loop làm Windows ngắt cổng CH340.
* **Cách xử lý:** Chạy `Stop-Process -Name python -Force`, kiểm tra chạy laptop bằng pin (không cắm sạc AC khi đấu vào xe), rồi bấm **Quét lại cổng** $\rightarrow$ **Kết nối ECU**.

### Lỗi 3: STM32 báo `"Hoan tat khoi tao! Bat dau doc Table 11."` nhưng không có byte nào hiện lên
* **Nguyên nhân:** Theo chuẩn Half-Duplex, ít nhất STM32 phải tự đọc lại được **5 byte Echo (`72 05 71 11 07`)** của chính mình. Nếu mất trắng cả Echo $\rightarrow$ đường từ L9637D về `PA10` chưa có tín hiệu.
* **Cách xử lý (kiểm tra theo thứ tự):**
  1. Đo chân `3 (VCC)` của L9637D: phải đạt **+5V**.
  2. Đo chân `6 (K)` so với `GND` khi cắm giắc xe và bật khóa: phải đạt **~12V** nhờ trở kéo **510 Ω** lên chân `7 (VS)`.
  3. Kiểm tra đúng chân datasheet ST: `Pin 1 (RX) -> PA10`, `Pin 4 (TX) -> PA9`, `Pin 5 -> GND chung`.

### Lỗi 4: Bluetooth kết nối báo "Đã kết nối" nhưng màn hình đứng im ở `0 RPM`
* **Nguyên nhân:** Module Bluetooth mặc định chạy `9600 bps`, trong khi `USART2` trên STM32 xuất ra `115200 bps`.
* **Cách xử lý:** Cắm module Bluetooth qua mạch CH340, gửi lệnh AT đổi Baudrate về **`115200`** (chi tiết lệnh xem tại [software/android-apk/README.md](../software/android-apk/README.md)).

---

## 5. Trạng Thái Firmware Hiện Hành vs Lộ Trình Mở Rộng

1. **Firmware hiện tại (`firmware/stm32-legacy/Core/Src/main.c` — bản tối giản ổn định khi đề máy):**
   * Chỉ phát Fast-Init 70/120ms lúc khởi động hoặc khi nhận lệnh ASCII `WAKEUP` từ `USART2`.
   * Vòng lặp chính gửi đều `req_table11` (`72 05 71 11 07`), chờ `45 ms` và xuất `"Data khac: <HEX>\r\n"` qua `USART2`. Không tự ý giật xung Fast-Init khi ECU bận lúc đề máy.
2. **Tính năng mở rộng đã chuẩn bị sẵn trên Dashboard PC & Android APK (chưa kích hoạt lại trong `main.c` hiện hành):**
   * Các lệnh chẩn đoán mở rộng (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `REQ_TABLE:XX`, `SCS_ON`/`SCS_OFF` qua `PB0`) đã được lập trình sẵn giao diện/parser ở phía PC và Android, nhưng cần kiểm thử kỹ khả năng chống nhiễu khi nổ máy trước khi ghép lại vào `main.c`.
3. **Việc cần làm khi gắn cố định lên xe:**
   * Đổi Baudrate module Bluetooth sang **`115200 bps`** qua CH340 trước khi hàn vào `PA2`/`PA3`.
   * Đo chuẩn đầu ra Buck **`5.0V`** trước khi cấp vào STM32, L9637D `VCC` và module Bluetooth.
