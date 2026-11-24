# Specs & Tài Liệu Kỹ Thuật (.ai/specs)

Spec chi tiết của task đang làm đặt tại [PLAN.md](../../PLAN.md).

## Tài liệu tham chiếu hiện hành trong `docs/`
- [docs/kline-protocol.md](../../docs/kline-protocol.md) — Đặc tả bắt tay K-Line 10400 bps, checksum và 25 byte Table `0x11` + các bảng mở rộng (`00`, `73`, `74`, `60`).
- [docs/hardware-schematic.md](../../docs/hardware-schematic.md) — Sơ đồ phần cứng STM32F103 + L9637D + Buck 5V + Bluetooth + mạch kích SCS.
- [docs/hardware-schematic-esp32c3.md](../../docs/hardware-schematic-esp32c3.md) — Sơ đồ nguyên lý, pinout 16 chân, BOM và checklist test mạch ESP32-C3 SuperMini (chưa viết firmware).
- [docs/workflow.md](../../docs/workflow.md) — Quy trình Offline-First, lệnh PowerShell và xử lý lỗi thực tế.

## Quy ước tạo Spec mới
Khi mở feature lớn (vd: tái tích hợp DTC vào `main.c` hoặc viết `firmware/esp32-c3/`), tạo `.ai/specs/<ten-feature>.md` gồm mục tiêu, giao thức/pinout chạm tới, test offline và tiêu chí hoàn thành, rồi gắn link vào [PLAN.md](../../PLAN.md).
