# MEMORY.md — Trạng Thái Dự Án & Quyết Định Kỹ Thuật

> **Cập nhật lần cuối:** 2026-11-25  
> **Nguồn sự thật chi tiết:** [.ai/memory/progress.md](.ai/memory/progress.md), [.ai/memory/decisions.md](.ai/memory/decisions.md), [.ai/memory/lessons.md](.ai/memory/lessons.md)

---

## 1. Trạng thái hiện tại (Current State)
- **Firmware STM32 (`firmware/stm32-legacy/`):** Đã nâng cấp [main.c](firmware/stm32-legacy/Core/Src/main.c): giữ nguyên Fast-Init an toàn (không tự giật trong `while(1)`), thêm lệnh `DTC`/`CLEARDTC`/`ECMID`/`PROBE <HEX>` qua `USART2`, `KLine_WaitResponse` đọc độ dài thực `len` (max `65ms`, lọc Echo rác), và `IWDG` ~2s chống treo. Build Keil `UV4.exe -b` exit `0`.
- **Cảnh báo phần cứng đang mở:** `stm32f1xx_hal_msp.c` đang bật `__HAL_AFIO_REMAP_SWJ_NOJTAG()` (mở SWD `PA13`/`PA14` để nạp ST-Link). Chưa kiểm chứng lại trên xe nổ máy xem có cần chuyển về `__HAL_AFIO_REMAP_SWJ_DISABLE()` hay không.
- **PC Dashboard (`software/pc-dashboard/dashboard.py`):** Hoàn chỉnh 2 chế độ (`NERDY (Bench)` & `CASUAL`), Replay từ `software/logs/kline_debug.log`, xuất CSV và Virtual Gear v3 (Voronoi, bù `VSS ±0.7`, chống nhảy số khi âm côn bằng `TPS + INJ + adaptive idleRpm`, giữ nguyên giao diện PC).
- **Android APK (`software/android-apk/honda-kline-racing.apk`):** `v3.2` (`versionCode 15`, `345.9 KB`), logo mới, giao diện Obsidian Carbon TFT 60fps, Virtual Gear v3 chống nhảy số khi âm côn + Pull-Learn Số 1, Hộp Đen REC Replay CSV, font tiếng Việt chuẩn. Kiểm thử `test_app.js` (`12/12` PASS), chữ ký `v2+v3` verified.
- **ESP32-C3:** Mới có tài liệu thiết kế sơ đồ & pinout trong `docs/`, **chưa có mã nguồn firmware**.

## 2. Việc còn dở dang / Bước tiếp theo
1. Test thực địa trên xe máy với bản firmware tối giản + APK v3.2 mới build (kiểm tra độ ổn định lúc bấm đề & chạy garanti).
2. Nếu `SWJ_NOJTAG` vẫn bị treo lúc bugi đánh lửa, đổi `HAL_MspInit()` sang `__HAL_AFIO_REMAP_SWJ_DISABLE()` (và nạp lại bằng giữ nút RESET + Connect Under Reset).
3. Sau khi baseline ổn định hoàn toàn trên xe, quyết định có ghép lại các lệnh v2.0 (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `SCS_ON/OFF`) hay triển khai nhánh `firmware/esp32-c3/`.

## 3. Quyết định kỹ thuật then chốt (Tóm tắt)
- **Không tự động giật Fast-Init trong `while(1)`** — tránh phá phiên giao tiếp ECU khi sụt áp lúc bấm đề (xem ADR-001 trong `.ai/memory/decisions.md`).
- **Offline-First & Toolchains cố định trên ổ `D:`** — phát triển/test trên `kline_debug.log` & `sample_frames.js`; mọi cache Android nằm tại `D:\kailc\.android-toolchain`.
- **Chuẩn hóa cây workspace & tri thức agent** — dùng `AGENTS.md` + `PLAN.md` + `MEMORY.md` + `.ai/` kết hợp plugin Antigravity `.agents/plugins/honda-kline-workflow/`.
