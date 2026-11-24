# Quy Chuẩn Code & Đồng Bộ (Conventions)

## 1. Firmware STM32 (`firmware/stm32-legacy/`)
- **Bảo vệ CubeMX:** Chỉ sửa code trong vùng `/* USER CODE BEGIN ... */` / `/* USER CODE END ... */` nếu còn ý định mở lại `honda_test.ioc`.
- **Biến dùng chung với ISR:** Khai báo `volatile` cho chỉ số/cờ (`rx_index`, `rx2_index`, `wakeup_pending`). Khi đọc & reset buffer từ `main()`, bọc trong `__disable_irq()` / `__enable_irq()` và copy sang buffer cục bộ trước khi truyền UART2.
- **Khôi phục lỗi UART:** `HAL_UART_ErrorCallback()` phải đọc `SR` rồi `DR`, xóa cờ `ORE/FE/NE`, đặt lại `huart->ErrorCode = HAL_UART_ERROR_NONE` và `huart->RxState = HAL_UART_STATE_READY` trước khi gọi `HAL_UART_Receive_IT()`.
- **Ngắt ưu tiên:** `USART1_IRQn` ưu tiên cao hơn hoặc bằng `USART2_IRQn` (`1` vs `2` trong `stm32f1xx_hal_msp.c`) để không rớt byte K-Line 10400 bps khi đang đẩy log 115200 bps.

## 2. Đồng Bộ PC (`dashboard.py`) & Android (`app.js`)
- **Không phụ thuộc offset cố định:** Luôn quét tìm `0x02`, kiểm tra độ dài và `(sum & 0xFF) == 0`.
- **Đồng bộ công thức & hằng số:** `GEAR_PRESETS`, `HONDA_DTC_DICT`, `RPM_BINS`, `TPS_BINS`, `MAX_RPM_SCALE` (`13000`) phải giống hệt nhau giữa `dashboard.py` và `app.js`.
- **Mặc định an toàn:** Mọi đồng hồ số khởi tạo về `--` (riêng `cSpeedNum`/`lcSpeedNum` về `0` và Gear về `N`) trước khi có frame live.

## 3. Android Native (`software/android-apk/`)
- **WebView Asset Loading:** HTML/CSS/JS/Font tải nội bộ qua `https://appassets.local/www/...` trong `MainActivity.java` — không dùng CDN ngoài để app chạy hoàn toàn offline trên xe.
- **USB Host XML:** `res/xml/device_filter.xml` dùng hệ **thập phân** cho `vendor-id` (VD: `0x1A86` $\rightarrow$ `6790`, `0x4348` $\rightarrow$ `17224`).
- **DOM Parity:** Mỗi ID phần tử `$("#id")` dùng trong `app.js` phải tồn tại trong `index.html` và vượt qua `node software/android-apk/test_app.js`.

## 4. Vệ Sinh Kho Mã Nguồn
- Không lưu file tạm (`.py`, `.json`, `.c`, `.log`) tại root hoặc `software/`.
- Log thu thập đặt trong `software/logs/`. Không xóa `software/logs/kline_debug.log`.
- Không để cache `__pycache__` hoặc build rác mới ngoài `build/` (Android) và `MDK-ARM/honda_test/` (Keil).
