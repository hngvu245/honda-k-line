# Keihin K-Line Racing APK (`honda-kline-racing.apk`)

Ứng dụng Android giao diện Motorsport Minimalist kết nối trực tiếp tới STM32 qua **Bluetooth Classic SPP** (`HC-05`, `HC-06`, `JDY-31`) hoặc **Bluetooth Low Energy BLE** (`HM-10`, `JDY-23`, `ESP32`), kèm chế độ **Replay Xe** từ 410 khung dữ liệu thật để test giao diện ngay khi chưa gắn mạch.

---

## 1. Cấu hình Module Bluetooth trước khi hàn vào STM32

Firmware trên STM32 đang mở `USART2` (`PA2` = TX, `PA3` = RX) ở tốc độ **115200 bps, 8N1**.
Đa số module mua mới chạy mặc định `9600 bps`, cần cắm qua mạch USB-TTL CH340 đổi baudrate trước:

* **Với HC-05 (vào chế độ AT Mode: giữ nút bấm trên module rồi cấp 5V):**
  ```text
  AT+NAME=HONDA-KLINE
  AT+UART=115200,0,0
  AT+PSWD=1234
  ```
* **Với HC-06 / JDY-31:**
  ```text
  AT+NAMEHONDA-KLINE
  AT+BAUD8
  ```
* **Với HM-10 / JDY-23 (BLE):**
  ```text
  AT+NAMEHONDA-KLINE
  AT+BAUD4   (hoặc AT+BAUD8 tùy firmware module để chọn 115200)
  ```

### Nối dây với STM32 (dùng chung 5V từ Buck):
* `TXD` của Bluetooth $\rightarrow$ `PA3` (`USART2_RX` STM32)
* `RXD` của Bluetooth $\rightarrow$ `PA2` (`USART2_TX` STM32)
* `VCC` $\rightarrow$ `5V` sau mạch Buck (kiểm tra datasheet module xem chân VCC nhận 5V hay 3.3V)
* `GND` $\rightarrow$ `GND` chung toàn mạch

---

## 2. Cách cài & dùng trên điện thoại Android

1. Chép file `honda-kline-racing.apk` sang điện thoại và cài đặt.
2. **Test ngay không cần xe:** Mở app, bấm **Replay Xe** ở góc trên để phát lại tua máy `0 -> 10,242 RPM`, `TPS`, `MAP`, `INJ`, `IGN`, `ECT`, `IAT`, `VBAT`. Hỗ trợ xoay ngang màn hình gắn ghi-đông.
3. **Kết nối xe thật:**
   * Với **HC-05 / HC-06**: Vào *Cài đặt Bluetooth của Android* ghép đôi (`1234`), sau đó mở app bấm **Bluetooth** $\rightarrow$ chọn module ở cột *Classic SPP*.
   * Với **BLE (HM-10 / JDY-23 / ESP32)**: Bấm **Bluetooth** trong app, app sẽ tự quét và hiện ở cột *BLE*.

---

## 3. Lệnh build lại APK từ mã nguồn

Chạy PowerShell tại thư mục gốc dự án (toàn bộ JDK 17 + Android SDK nằm trên ổ `D:\kailc\.android-toolchain`):

```powershell
powershell -ExecutionPolicy Bypass -File "d:\kailc\save\honda_test\software\android-apk\build_apk.ps1"
```
