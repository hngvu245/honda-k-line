# Tiến Độ & Trạng Thái Dự Án (Progress)

**Cập nhật:** 2026-11-25

## Trạng thái từng module

| Module | Phiên bản / Trạng thái | Kết quả kiểm chứng gần nhất |
| :--- | :--- | :--- |
| **STM32 Firmware** (`firmware/stm32-legacy/`) | Bản tối giản ổn định (`main.c` 294 dòng, `SWJ_NOJTAG` đang bật) | `UV4.exe -b` ngày 2026-11-25: `0 Error(s), 0 Warning(s)`, xuất `honda_test.hex` |
| **PC Dashboard** (`software/pc-dashboard/dashboard.py`) | Dual-mode `NERDY` + `CASUAL`, Replay + CSV + Gear | `python -m py_compile` pass (Python `3.14.5`, `customtkinter 6.0.0`, `pyserial 3.5`) |
| **Android APK** (`software/android-apk/`) | `v3.2` (`versionCode 15`, `honda-kline-racing.apk` `349.8 KB`) | `node --check`, `test_app.js` (`183` DOM IDs, `410` frames, `7/7` gear PASS), `apksigner` v2/v3 verified |
| **ESP32-C3** | Chỉ có tài liệu thiết kế (`docs/*esp32c3*`) | Chưa có mã nguồn firmware |
| **Hệ thống Agent / Docs** | Đã chuẩn hóa `AGENTS.md`, `PLAN.md`, `MEMORY.md`, `.ai/`, `.agents/plugins/honda-kline-workflow/` | Đã dọn 29 file rác forensic & đồng bộ tài liệu |

## Hạng mục chờ thực hiện
1. Test thực địa trên xe máy: kiểm tra bản firmware tối giản + APK v3.2 khi bật khóa, bấm đề, garanti và kéo ga.
2. Đánh giá có cần đổi `stm32f1xx_hal_msp.c` từ `__HAL_AFIO_REMAP_SWJ_NOJTAG()` sang `__HAL_AFIO_REMAP_SWJ_DISABLE()` nếu gặp nhiễu bugi trên xe.
3. Sau khi chạy ổn định khi đề nổ, quyết định tái tích hợp các lệnh v2.0 (`READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `SCS_ON/OFF`) hay chuyển sang ESP32-C3.
