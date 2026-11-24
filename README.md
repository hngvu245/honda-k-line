# Honda Keihin K-Line Diagnostic & Racing Telemetry

Hệ thống đọc thông số động cơ **Honda PGM-FI (ECU Keihin K-Line 10400 bps)** dùng **STM32F103C8T6 + IC L9637D**, kết nối trực tiếp tới **Dashboard Python (PC)** qua USB-TTL hoặc **Android APK** qua USB OTG / Bluetooth (`HC-05`/`HC-06` SPP & `HM-10`/`JDY-23` BLE).

---

## Cấu trúc dự án

```text
honda_test/
├── AGENTS.md                        # Luật dự án & chuẩn đồng bộ cho AI agents
├── .agents/plugins/honda-kline-workflow/  # Plugin workflow (4 agents + 4 skills)
├── firmware/
│   └── stm32-legacy/                # Code C STM32, CubeMX (.ioc) & project KeilC MDK-ARM
│       ├── Core/Src/main.c          # Logic Fast Init 70ms/120ms, Handshake & hỏi Table 11
│       ├── Core/Src/stm32f1xx_hal_msp.c
│       ├── MDK-ARM/honda_test.uvprojx
│       └── honda_test.ioc
├── software/
│   ├── check_ports.py               # Liệt kê cổng COM khả dụng
│   ├── test_stream.py               # Monitor CLI kiểm tra checksum & gói Table 11
│   ├── pc-dashboard/
│   │   ├── dashboard.py             # Dashboard PC (NERDY + CASUAL) + Replay Log + Ghi CSV
│   │   ├── sniffer.py               # Tool CLI soi gói tin RAW
│   │   └── read_rpm.py              # Script CLI cũ test nhanh RPM
│   ├── android-apk/
│   │   ├── honda-kline-racing.apk   # Bản cài đặt Android (USB OTG + SPP + BLE + Replay Xe)
│   │   ├── build_apk.ps1            # Script tự động biên dịch & ký số APK trên ổ D:
│   │   ├── test_app.js              # Kiểm tra DOM IDs WebUI & thuật toán ước lượng số
│   │   └── README.md                # Hướng dẫn cấu hình Baudrate 115200 cho module Bluetooth
│   └── logs/
│       └── kline_debug.log          # Dữ liệu ECU thật từ xe (dùng cho Replay Simulator)
├── skills/
│   └── taste-skill/                 # Repo skill thiết kế UI tham khảo
└── docs/
    ├── codebase-audit-and-workflow.md # Kiểm toán mã nguồn & chuẩn hóa workflow
    ├── workflow.md                  # Quy trình phát triển Offline-First, lệnh tắt & xử lý lỗi
    ├── kline-protocol.md            # Đặc tả bắt tay 3 nhịp & bảng giải mã 25 byte Table 11
    └── hardware-schematic.md        # Sơ đồ chân chuẩn datasheet ST L9637D, Buck 5V, Bluetooth & SCS
```

---

## Khởi chạy nhanh

* **Mở Dashboard PC (chạy live qua COM hoặc phát lại log không cần xe):**
  ```powershell
  python software/pc-dashboard/dashboard.py
  ```
* **Kiểm tra WebUI & Build lại file cài đặt Android APK:**
  ```powershell
  node software/android-apk/test_app.js
  powershell -ExecutionPolicy Bypass -File "software/android-apk/build_apk.ps1"
  ```
* **Build Firmware STM32 qua Keil CLI:**
  ```powershell
  & "D:\kailc\UV4\UV4.exe" -b "firmware\stm32-legacy\MDK-ARM\honda_test.uvprojx" -j0
  ```
* **Đọc trước khi cắm mạch / đi dây mới:** xem [docs/hardware-schematic.md](file:///d:/kailc/save/honda_test/docs/hardware-schematic.md), [docs/workflow.md](file:///d:/kailc/save/honda_test/docs/workflow.md) và [docs/codebase-audit-and-workflow.md](file:///d:/kailc/save/honda_test/docs/codebase-audit-and-workflow.md).
