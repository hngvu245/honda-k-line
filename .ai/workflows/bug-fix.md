# Quy Trình Xử Lý Bug (Bug-Fix Workflow)

1. **Tái hiện Offline trước:**
   - Với lỗi giải mã/UI: trích dòng hex lỗi từ [software/logs/kline_debug.log](file:///d:/kailc/save/honda_test/software/logs/kline_debug.log) hoặc dùng Replay Simulator của `dashboard.py` / Demo `sample_frames.js`.
   - Với lỗi STM32 / kết nối thực tế: kiểm tra log xem là `MCU_BOOT:` (brownout/reset), méo bit do bugi (`00` hoặc sai checksum), spam `"Dang danh thuc"`, hay lỗi COM Windows (`PermissionError(13)` / `OSError(22)`).
2. **Cô lập đúng tầng (Layer Isolation):**
   - **Tầng vật lý / L9637D:** Mất cả 5 byte echo `72 05 71 11 07` $\rightarrow$ kiểm tra 5V VCC, 12V VS, trở kéo `510 Ω`, dây `PA9/PA10`, Mass chung.
   - **Tầng STM32 (`firmware/stm32-legacy/`):** Treo MCU khi đề nổ $\rightarrow$ kiểm tra `stm32f1xx_hal_msp.c` (`SWJ_DISABLE` vs `SWJ_NOJTAG`) và `main.c` (`HAL_UART_ErrorCallback`, không giật Fast-Init trong `while(1)`).
   - **Tầng Bridge/Host:** Sai số đo / vỡ DOM / rớt OTG $\rightarrow$ kiểm tra `BtBridge.java`, `UsbSerialManager.java`, `device_filter.xml`, `app.js`, `dashboard.py`.
3. **Sửa lỗi & đồng bộ:**
   - Cập nhật đồng bộ cả PC (`dashboard.py`) và Android (`app.js`) nếu đụng đến parser/công thức.
4. **Kiểm chứng & ghi nhớ:**
   - Chạy đầy đủ lệnh ở Mục 2 của `AGENTS.md`.
   - Ghi 1 dòng ngắn vào mục **Bài học cần tránh** ở cuối phần 5 của `AGENTS.md`, ghi chi tiết vào `.ai/memory/lessons.md`, và cập nhật `MEMORY.md` & `.ai/memory/progress.md`.
