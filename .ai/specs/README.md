# Specs & Kế Hoạch Chức Năng (.ai/specs)

Thư mục này quản lý spec cho các đợt phát triển dài hạn; spec của task đang chạy nằm ở [PLAN.md](file:///d:/kailc/save/honda_test/PLAN.md).

## Danh mục Spec hiện có trong `docs/`
- [docs/kline-protocol.md](file:///d:/kailc/save/honda_test/docs/kline-protocol.md) — Đặc tả bắt tay K-Line 10400 bps, checksum và 25 byte Table `0x11` + các bảng mở rộng (`00`, `73`, `74`, `60`).
- [docs/plan-theme-tft-and-gear-estimation.md](file:///d:/kailc/save/honda_test/docs/plan-theme-tft-and-gear-estimation.md) — Spec giao diện TFT Motorsport Cockpit và thuật toán Virtual Gear Estimator.
- [docs/plan-usb-to-ttl-and-tft-v2.md](file:///d:/kailc/save/honda_test/docs/plan-usb-to-ttl-and-tft-v2.md) — Spec driver USB-to-TTL OTG native Android (CH340, CP2102, FTDI, PL2303, CDC-ACM) & layout 2.2:1.
- [docs/esp32-c3-supermini-pinout.md](file:///d:/kailc/save/honda_test/docs/esp32-c3-supermini-pinout.md) & [docs/hardware-schematic-esp32c3.md](file:///d:/kailc/save/honda_test/docs/hardware-schematic-esp32c3.md) — Spec phần cứng định hướng chuyển sang ESP32-C3 SuperMini (chưa implement firmware).
- [docs/kline-telemetry-fault-analysis-and-firmware.md](file:///d:/kailc/save/honda_test/docs/kline-telemetry-fault-analysis-and-firmware.md) — Tài liệu đối soát lỗi cranking, ground loop & STM32 ISR.

## Quy ước tạo Spec mới cho task
Khi khởi động một feature lớn (vd: tái tích hợp DTC vào `main.c` hoặc viết `firmware/esp32-c3/`), tạo `.ai/specs/<ten-feature>.md` gồm: Mục tiêu, Giao thức/Pinout chạm tới, Kế hoạch test Offline, và tiêu chí Done, rồi link vào `PLAN.md`.
