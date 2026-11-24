# Danh Sách Lỗi Đã Gặp & Cách Tránh (Lessons Learned)

## Phần cứng & Nhiễu trên xe (STM32 + L9637D + CH340)
1. **Spam Fast-Init 70ms khi bấm đề:**
   - *Nguyên nhân:* Đếm thiếu gói ECU (`1.8s`) trong `while(1)` rồi giật `PA9` LOW 70ms giữa lúc đề nổ máy khiến ECU sập phiên UART.
   - *Phòng tránh:* Không bao giờ đặt `KLine_FastInit()` tự động theo chu kỳ ngắn trong `while(1)`.
2. **Nhiễu cao áp bugi làm treo CPU qua chân SWD (`PA13`/`PA14`):**
   - *Nguyên nhân:* Khi bật `__HAL_AFIO_REMAP_SWJ_NOJTAG()`, chân `PA13`/`PA14` không đấu mạch nạp ngoài xe hoạt động như ăng-ten bắt xung 25kV từ mobin/bugi.
   - *Phòng tránh:* Khi chạy road-test thực tế nếu bị đơ MCU sau vài giây nổ máy, chuyển `HAL_MspInit()` sang `__HAL_AFIO_REMAP_SWJ_DISABLE()` và dùng `Connect Under Reset` để nạp lại.
3. **Bão ngắt UART (`HAL_UART_ErrorCallback`) khi nổ máy:**
   - *Nguyên nhân:* Nhiễu sinh Framing Error (`FE`) / Overrun (`ORE`); nếu không đọc `SR` + `DR` và reset `RxState = HAL_UART_STATE_READY`, `ErrorCode = HAL_UART_ERROR_NONE`, ngắt có thể lặp vô hạn hoặc chết hẳn.
   - *Phòng tránh:* Luôn đọc `SR` $\rightarrow$ `DR`, xóa đủ `ORE/FE/NE`, reset trạng thái HAL trước khi re-arm `HAL_UART_Receive_IT()`.
4. **Windows báo `PermissionError(13, Access is denied)` / rớt cổng CH340:**
   - *Nguyên nhân:* (a) Quên tắt process Python cũ đang mở cổng COM, hoặc (b) Vòng lặp Mass (Ground Loop) giữa sạc AC 220V laptop với hệ thống sạc 14.5V xe máy.
   - *Phòng tránh:* Chạy `Stop-Process -Name python -Force` trước khi mở cổng mới hoặc nạp Keil; khi cắm laptop vào xe thật nên rút sạc AC dùng pin.
5. **Trở kéo K-Line 510 Ω chạm/lỏng chân:**
   - *Hiện tượng:* L9637D mất điện áp nghỉ 12V trên dây K, rớt về `00` hoặc mất trắng cả 5 byte echo.
   - *Phòng tránh:* Đo chân 6 (`K`) với `GND` lúc bật khóa phải đạt `~11.5–12.5V`, và `510 Ω` (0.5W) nối chắc giữa chân 6 (`K`) và chân 7 (`VS`).

## Phần mềm PC & Android APK
6. **Offset cứng cho byte Echo (`read_rpm.py`):**
   - *Lỗi:* `read_rpm.py` đọc cứng `data[9..10]` (giả định luôn có đúng 5 byte echo phía trước). Nếu UART tách dòng hoặc bỏ echo sẽ sai dữ liệu.
   - *Phòng tránh:* Luôn tìm byte `0x02`, kiểm tra độ dài và checksum `(sum & 0xFF) == 0` như `dashboard.py`, `app.js`, `test_stream.py`.
7. **Thẻ `</div>` dư trong HTML làm trôi layout Landscape (`index.html`):**
   - *Lỗi:* 2 thẻ `</div>` thừa đóng sớm `#landscapeHud` trước `#lGridNerdy`.
   - *Phòng tránh:* Kiểm tra cân bằng thẻ HTML mỗi khi chỉnh sửa bố cục `index.html`.
8. **Hệ thập lục phân vs thập phân trong `device_filter.xml`:**
   - *Lỗi:* Ghi `vendor-id="4348"` cho chip WCH `0x4348` khiến Android hiểu nhầm thành `0x10FC` (`17224` mới là decimal của `0x4348`).
   - *Phòng tránh:* Mọi `vendor-id` / `product-id` trong XML Android phải quy đổi sang thập phân.
9. **`apksigner.bat` lỗi `JAVA_HOME is not set`:**
   - *Phòng tránh:* Luôn set `$env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'` trước khi gọi `apksigner.bat` ngoài `build_apk.ps1`.
