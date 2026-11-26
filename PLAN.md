# PLAN.md — Nâng Cấp Virtual Gear v3: Chống Nhảy Số Khi Âm Côn Trôi Xe

- **Trạng thái:** `HOÀN TẤT`
- **Phạm vi:** Đồng bộ thuật toán chống nhảy số khi âm côn trên cả lõi JS ([kline_core.js](software/android-apk/assets/www/kline_core.js), [app.js](software/android-apk/assets/www/app.js), [test_app.js](software/android-apk/test_app.js)), PC Dashboard ([dashboard.py](software/pc-dashboard/dashboard.py)), và [docs/kline-protocol.md](docs/kline-protocol.md).
- **Tham chiếu:** [MEMORY.md](MEMORY.md), [AGENTS.md](AGENTS.md)

---

## 1. Nguyên Nhân Thực Tế (Đã đối chiếu log `sample_frames.js`)
- Trong 215 mẫu garanti thực của xe (`VSS = 0, TPS = 0%`), vòng tua garanti trung vị là **1.608 RPM** (`avg_inj = 2.26 ms`), không phải `< 1.350 RPM`.
- Code hiện tại chỉ đóng băng khi `RPM < 1350 || dRPM < -900` và chưa đọc `TPS (%)` / `INJ (ms)` từ Table `11`. Khi bạn âm côn để xe trôi, tua tụt dần qua ~`1.600 RPM` (`> 1.350` và `dRPM ~ -400 RPM/frame`) trong khi `VSS` giữ cao $\rightarrow$ tỷ số $R = \text{RPM}/\text{VSS}$ quét qua vùng số `2 → 3 → 4 → 5` nên app tưởng bạn đang lên số thật.

---

## 2. Checklist Thực Thi

- [x] **Bước 1 — Lõi Anti-Coasting trong `kline_core.js` & `app.js`:**
  - [x] Bổ sung tự học `idleRpm` (EMA khi `VSS < 2, TPS <= 1.2%`), đặt trần garanti `idleCeil = idleRpm + 320`.
  - [x] Truyền thêm `tpsPct` và `injMs` vào `gearTracker.update(rpm, vss, nowMs, tpsPct, injMs)`: bắt pha cắt côn (`TPS <= 2.5%` + tua rớt `dRPM <= -220` hoặc 2 khung `dRPM <= -110`), khóa số suốt lúc trôi ở garanti (`injMs > 0.4ms`), chặn mọi **upshift** khi đóng ga tua thấp (`TPS <= 2.5%` & `RPM < max(2300, idleRpm + 650)`), chỉ mở khóa khi mở ga (`TPS > 3.5%` x2) hoặc hãm máy DFCO ổn định 3 khung.
  - [x] Cập nhật `app.js` truyền `d.tpsPct, d.injMs` và hiện phụ đề `"Âm côn · trôi"`.
- [x] **Bước 2 — Đồng bộ `dashboard.py` & `docs/kline-protocol.md`:**
  - [x] Đồng bộ `calculate_gear(rpm, vss, now, tps_pct=None, inj_ms=None)` trong `dashboard.py` (giữ nguyên toàn bộ UI PC).
  - [x] Cập nhật đặc tả Virtual Gear v3 vào `docs/kline-protocol.md`.
- [x] **Bước 3 — Kiểm thử & Build APK:**
  - [x] Thêm test âm côn kéo dài (`4100 -> 1610 RPM` tại `VSS = 29..21 km/h`, học `idleRpm ~1610`) và nhả côn sang số 2 vào `test_app.js`.
  - [x] Chạy `node --check`, `test_app.js` (`12/12 PASS`), `python -B -m py_compile`, `build_apk.ps1` (`345.9 KB`) và `apksigner verify` (`v2+v3`).
  - [x] Cập nhật `MEMORY.md`, `.ai/memory/progress.md` và `PLAN.md`.
