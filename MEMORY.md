# MEMORY.md — Trạng Thái Dự Án & Quyết Định Kỹ Thuật

> **Cập nhật lần cuối:** 2026-11-25  
> **Nguồn sự thật chi tiết:** [.ai/memory/progress.md](.ai/memory/progress.md), [.ai/memory/decisions.md](.ai/memory/decisions.md), [.ai/memory/lessons.md](.ai/memory/lessons.md)

---

## 1. Trạng thái hiện tại (Current State)
- **Firmware STM32 (`firmware/stm32-legacy/`):** Đang ở bản tối giản ổn định (`main.c` 294 dòng: Fast-Init 70/120ms lúc boot + lệnh `WAKEUP`, poll Table `11` mỗi `POLL_REST_MS=100` + `HAL_Delay(45)`). Build Keil CLI mới nhất `0 Error(s), 0 Warning(s)`.
- **Cảnh báo phần cứng đang mở:** `stm32f1xx_hal_msp.c` đang bật `__HAL_AFIO_REMAP_SWJ_NOJTAG()` (mở SWD `PA13`/`PA14` để nạp ST-Link). Chưa kiểm chứng lại trên xe nổ máy xem có cần chuyển về `__HAL_AFIO_REMAP_SWJ_DISABLE()` hay không.
- **PC Dashboard (`software/pc-dashboard/dashboard.py`):** Hoàn chỉnh 2 chế độ (`NERDY (Bench)` & `CASUAL`), Replay từ `software/logs/kline_debug.log`, xuất CSV và Virtual Gear.
- **Android APK (`software/android-apk/honda-kline-racing.apk`):** `v3.2` (`versionCode 15`, `349.8 KB`), đã sửa lỗi đóng thẻ `</div>` dư quanh `#lGridNerdy` trong `index.html` và lỗi VID thập phân Qinheng (`17224`) trong `device_filter.xml`; `test_app.js` pass (`183` DOM IDs, `410` sample frames, `7/7` gear tests), chữ ký v2/v3 verified.
- **ESP32-C3:** Mới có tài liệu thiết kế sơ đồ & pinout trong `docs/`, **chưa có mã nguồn firmware**.

## 2. Việc còn dở dang / Bước tiếp theo
1. Test thực địa trên xe máy với bản firmware tối giản + APK v3.2 mới build (kiểm tra độ ổn định lúc bấm đề & chạy garanti).
2. Nếu `SWJ_NOJTAG` vẫn bị treo lúc bugi đánh lửa, đổi `HAL_MspInit()` sang `__HAL_AFIO_REMAP_SWJ_DISABLE()` (và nạp lại bằng giữ nút RESET + Connect Under Reset).
3. Sau khi baseline ổn định hoàn toàn trên xe, quyết định có ghép lại các lệnh v2.0 (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `SCS_ON/OFF`) hay triển khai nhánh `firmware/esp32-c3/`.

## 3. Quyết định kỹ thuật then chốt (Tóm tắt)
- **Không tự động giật Fast-Init trong `while(1)`** — tránh phá phiên giao tiếp ECU khi sụt áp lúc bấm đề (xem ADR-001 trong `.ai/memory/decisions.md`).
- **Offline-First & Toolchains cố định trên ổ `D:`** — phát triển/test trên `kline_debug.log` & `sample_frames.js`; mọi cache Android nằm tại `D:\kailc\.android-toolchain`.
- **Chuẩn hóa cây workspace & tri thức agent** — dùng `AGENTS.md` + `PLAN.md` + `MEMORY.md` + `.ai/` kết hợp plugin Antigravity `.agents/plugins/honda-kline-workflow/`.
