# PLAN.md — Spec & Checklist Cho Task Hiện Tại

> **Quy tắc:** File này đổi theo từng task đang làm. Spec chi tiết các đợt trước được lưu trong `.ai/specs/` và quyết định đã chốt lưu tại `.ai/memory/decisions.md`.

---

## Task hiện tại: Sẵn sàng Bench & Road-Test Thực Tế Sau Chuẩn Hóa Workflow

- **Trạng thái:** `SẴN SÀNG TRIỂN KHAI NGOÀI XE`
- **Phạm vi:** Kiểm chứng phần cứng + firmware STM32 tối giản + Android APK v3.2 trên xe thật (không sửa code nếu chưa phát sinh log lỗi mới).
- **Tham chiếu:** [MEMORY.md](file:///d:/kailc/save/honda_test/MEMORY.md), [.ai/specs/README.md](file:///d:/kailc/save/honda_test/.ai/specs/README.md), [docs/workflow.md](file:///d:/kailc/save/honda_test/docs/workflow.md)

### Spec & Checklist Trước Khi Ra Xe
- [x] Dọn sạch rác forensic phiên cũ, đồng bộ tài liệu & fix lỗi DOM `index.html` + `device_filter.xml` (`17224`).
- [x] Build & verify STM32 (`honda_test.hex`, `0 Error(s), 0 Warning(s)`) và Android APK (`349.8 KB`, v2/v3 verified).
- [ ] **Kiểm tra cấu hình SWD (`stm32f1xx_hal_msp.c`):** Hiện đang để `__HAL_AFIO_REMAP_SWJ_NOJTAG()` để tiện nạp ST-Link. Nếu test trên xe bị treo CPU khi đề/nổ máy (do nhiễu bugi vào `PA13`/`PA14`), chuyển sang `__HAL_AFIO_REMAP_SWJ_DISABLE()` rồi build lại trước khi test lại.
- [ ] **Smoke test USB OTG & Bluetooth trên xe:**
  - Chạy laptop bằng pin (rút sạc 220V tránh ground loop) hoặc dùng điện thoại Android qua USB OTG / Bluetooth `115200 bps`.
  - Xác nhận nhận đủ frame Table `11` (`02 19 71 11 ...`) khi bật khóa $\rightarrow$ bấm đề $\rightarrow$ nổ garanti $\rightarrow$ kéo ga.
- [ ] **Ghi nhận kết quả vào [MEMORY.md](file:///d:/kailc/save/honda_test/MEMORY.md) & `.ai/memory/progress.md`:** Nếu bản tối giản ổn định 100% lúc đề máy, mở task mới để cân nhắc ghép lại `READ_ECMID` / `READ_DTC` / `CLEAR_DTC` hoặc port sang ESP32-C3.
