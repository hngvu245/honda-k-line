# Checklist Review Code Trước Khi Build / Nạp Xe (Code Review)

## 1. Firmware STM32 (`firmware/stm32-legacy/`)
- [ ] Không gọi `KLine_FastInit()` hay kéo `PA9` LOW 70ms tự động trong `while(1)` khi ECU tạm trễ phản hồi.
- [ ] Mọi biến dùng chung giữa ISR và `main()` đều có `volatile` và được đọc/reset qua `__disable_irq()` / `__enable_irq()`.
- [ ] `HAL_UART_ErrorCallback()` đọc `SR` $\rightarrow$ `DR`, xóa đủ `ORE/FE/NE` và re-arm `HAL_UART_Receive_IT()`.
- [ ] Kiểm tra chủ đích của `HAL_MspInit()`: `__HAL_AFIO_REMAP_SWJ_NOJTAG()` (nạp bàn) hay `__HAL_AFIO_REMAP_SWJ_DISABLE()` (chạy xe chống EMI).
- [ ] Đã chạy `UV4.exe -b` đạt `0 Error(s), 0 Warning(s)`.

## 2. Telemetry Parser & UI (`dashboard.py` & `software/android-apk/assets/www/`)
- [ ] Kiểm tra checksum `(sum & 0xFF) == 0` và header `0x02`, không hardcode offset echo.
- [ ] Công thức Table `0x11` và `GEAR_PRESETS` khớp nhau giữa Python (`dashboard.py`), JS (`app.js`), `test_app.js` và `docs/kline-protocol.md`.
- [ ] Đã chạy `python -m py_compile` cho PC, `node --check` + `node software/android-apk/test_app.js` cho Android WebUI.
- [ ] Không thêm nút gửi lệnh mới tới STM32 khi `main.c` chưa cài đặt handler cho lệnh đó.

## 3. Android Native & APK Packaging
- [ ] Mọi `vendor-id` / `product-id` trong `res/xml/device_filter.xml` viết ở hệ thập phân.
- [ ] `build_apk.ps1` chạy sạch và `apksigner.bat verify --min-sdk-version 24` trả về `Verifies` (v2/v3 `true`).

## 4. Vệ sinh Repo (`repo-hygiene`)
- [ ] Không có script tạm, file `.json` dump, `.c` backup hay log mới ở thư mục gốc và `software/`.
- [ ] `PLAN.md`, `MEMORY.md` và `.ai/memory/progress.md` đã phản ánh đúng thực tế sau thay đổi.
