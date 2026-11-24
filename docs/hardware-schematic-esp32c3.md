# Sơ Đồ Nguyên Lý & Pinout ESP32-C3 SuperMini + L9637D (K-Line Honda)

Tài liệu thiết kế phần cứng cho mạch K-Line thế hệ mới (chưa viết firmware) dùng **ESP32-C3 SuperMini** (ESP32-C3FH4 RISC-V, BLE 5.0 + USB-C Native CDC) kết hợp **ST L9637D (SO-8)**, hạ áp Buck 5V và mạch chuyển mức logic an toàn cho GPIO 3.3V.

---

## 1. Sơ Đồ Khối Tổng Thể

```text
[ Giắc DLC 4 Chân Xe Honda ]
  ├── +12V (Sau khóa) ──► [ Cầu chì 1A + Diode 1N5819 ] ──┬──► Chân 7 (VS) L9637D (+ R 510Ω -> K-Line)
  │                                                        └──► [ Buck MP1584 / LM2596 -> 5.0V ]
  │                                                                   ├──► Chân 3 (VCC) L9637D
  │                                                                   └──► Chân 5V ESP32-C3 SuperMini
  ├── K-Line (Dây K) ◄────────────────────────────────────────── Chân 6 (K) L9637D
  ├── Pin 1 L9637D (RX 5V) ──► [ Cầu phân áp 10k / 20k ] ──────► GPIO 20 (UART0_RX)
  ├── Pin 4 L9637D (TX)    ◄── [ Trở bảo vệ 1 kΩ ] ◄──────────── GPIO 21 (UART0_TX)
  ├── SCS (Tùy chọn) ◄── [ NPN C1815 / 2N2222 + R 2.2k ] ◄────── GPIO 4  (SCS Control)
  └── GND ────────────────────────────────────────────────────── Mass chung toàn mạch
```

---

## 2. Bản Đồ 16 Chân ESP32-C3 SuperMini & Bẫy Phần Cứng

Nhìn từ mặt trước, cổng **USB-C (`GPIO18/19` Native Serial/JTAG — không đụng `UART0`)** ở phía trên:

```text
                     ┌──────────────────┐
                     │    [ USB-C ]     │
                     │  (D-:19, D+:18)  │
                     └──────────────────┘
       [ HÀNG TRÁI ]                      [ HÀNG PHẢI ]
   GPIO 5  ──  [ 5  ]                   [ 5V ]  ──  VBUS / 5V từ Buck
   GPIO 6  ──  [ 6  ]                   [ G  ]  ──  GND chung
   GPIO 7  ──  [ 7  ]                   [ 3V3]  ──  LDO 3.3V Out (KHÔNG cấp nguồn 5V vào đây)
*  GPIO 8  ──  [ 8  ] (LED xanh)        [ 4  ]  ──  GPIO 4 (SCS Control)
*  GPIO 9  ──  [ 9  ] (Nút BOOT)        [ 3  ]  ──  GPIO 3 (ADC1_CH3)
   GPIO 10 ──  [ 10 ]                 * [ 2  ]  ──  GPIO 2 (Strapping pin)
   GPIO 20 ──  [ 20 ] (UART0_RX)        [ 1  ]  ──  GPIO 1 (I2C SCL dự phòng)
   GPIO 21 ──  [ 21 ] (UART0_TX)        [ 0  ]  ──  GPIO 0 (I2C SDA dự phòng)
                     └──────────────────┘
                     (*: Chân strapping — chú ý trạng thái lúc boot)
```

| Chân | Chức năng trong dự án | Cảnh báo & lưu ý phần cứng |
| :---: | :--- | :--- |
| **`20`** | `UART0_RX` $\leftarrow$ `L9637D RX (Pin 1)` | **Bắt buộc** qua cầu phân áp `10 kΩ / 20 kΩ` (ESP32-C3 không chịu được 5V). |
| **`21`** | `UART0_TX` $\rightarrow$ `L9637D TX (Pin 4)` | Nối qua trở bảo vệ `1 kΩ`. Mức `3.3V` vượt ngưỡng $V_{IH} \ge 2.0\text{V}$ của L9637D. |
| **`4`** | Điều khiển chân `SCS` | Qua trở `2.2 kΩ` vào Base transistor NPN `2N2222/C1815`; `LOW` = thả nổi, `HIGH` = kéo mass đọc lỗi MIL. |
| **`8`** | LED xanh onboard (Active-LOW) | Strapping pin — chỉ dùng báo trạng thái (`0` = sáng), không hàn tải nặng. |
| **`9`** | Nút `BOOT` trên board | **Để trống tuyệt đối** tránh rung xe làm chập xuống Mass khiến kẹt bootloader. |
| **`2`** | Strapping pin cấu hình SPI Flash | **Khuyến nghị để trống** tránh kéo thấp khi bật khóa. |
| **`5,6,7,10,3,1,0`** | Dự phòng (SPI TFT / Buzzer / ADC VBAT / OLED I2C) | An toàn để mở rộng về sau. |

---

## 3. Chi Tiết Mạch Giao Tiếp & Chuyển Mức Logic

1. **Nguồn & Bảo vệ:** `+12V DLC` $\rightarrow$ Diode `1N5819` + Cầu chì `1A` $\rightarrow$ `VS (Pin 7)` L9637D (lọc tụ gốm `100 nF / 50V`) và mạch **Buck MP1584/LM2596** chỉnh đúng **`5.00V – 5.05V`** (lọc tụ `100 nF / 16V`) cấp cho `VCC (Pin 3)` L9637D và chân `5V` ESP32-C3.
2. **Pull-up K-Line:** Trở **`510 Ω` (công suất $\ge 0.5\text{W}$)** nối giữa chân `6 (K)` và chân `7 (VS)` của L9637D.
3. **Cầu phân áp RX (`5V` $\rightarrow$ `3.33V`):**
   ```text
   L9637D Pin 1 (RX, 5V) ──[ R1: 10 kΩ ]──┬──► GPIO 20 (UART0_RX)
                                          │
                                     [ R2: 20 kΩ ]
                                          │
                                         GND
   ```
4. **Bảo vệ TX & Kích SCS:** `GPIO 21` $\rightarrow$ `R3 (1 kΩ)` $\rightarrow$ `Pin 4 (TX)` L9637D. `GPIO 4` $\rightarrow$ `R4 (2.2 kΩ)` $\rightarrow$ Base `C1815/2N2222` (Collector $\rightarrow$ `SCS`, Emitter $\rightarrow$ `GND`).

---

## 4. Danh Sách Linh Kiện (BOM)

| STT | Linh kiện | Thông số | SL | Ghi chú |
| :---: | :--- | :--- | :---: | :--- |
| 1 | Kit **ESP32-C3 SuperMini** | Bản 16 chân, USB-C Native, BLE 5.0 | 1 | Kiểm tra nhận USB CDC |
| 2 | IC **ST L9637D** | SO-8 | 1 | Transceiver K-Line 12V |
| 3 | Mạch hạ áp **Buck DC-DC** | MP1584EN hoặc LM2596 | 1 | Chỉnh đúng `5.0V` trước khi hàn |
| 4 | Điện trở kéo K-Line | **`510 Ω` — `0.5W` (1/2W)** | 1 | Không dùng trở 1/8W tránh nóng/cháy |
| 5 | Điện trở phân áp & bảo vệ | `10 kΩ`, `20 kΩ`, `1 kΩ`, `2.2 kΩ` (`0.25W`) | Mỗi loại 1 | Phân áp RX + bảo vệ TX + Base NPN |
| 6 | Tụ gốm lọc nhiễu | `100 nF` (mã `104`, $\ge 50\text{V}$) | 2 | Lọc nguồn `VS` 12V và `VCC` 5V |
| 7 | Diode & Cầu chì | `1N5819` + Cầu chì `1A / 30V` | Mỗi loại 1 | Chống ngược cực & quá dòng 12V |
| 8 | Transistor NPN & Giắc DLC | `2N2222`/`C1815` + Giắc Honda 4-pin | 1 bộ | Đóng cắt chân `SCS` & cắm DLC |

---

## 5. Smoke Test Checklist Trước Khi Cắm Xe

1. **Thông mạch Mass:** Chân `GND` DLC, Buck, `Pin 5` L9637D, chân `G` ESP32-C3 đo thông mạch ($R \approx 0\ \Omega$).
2. **Áp Buck (chưa cắm chip):** Đo ngõ ra Buck đạt đúng **`5.0V – 5.1V`** (tuyệt đối không quá `5.3V`).
3. **Áp an toàn tại `GPIO 20`:** Cấp `12V` vào `VS` và `5V` vào `VCC`, đo điểm giữa `10k / 20k` phải đạt **`3.2V – 3.35V`** (nếu vọt lên `5V` là hở mass `R2`).
4. **Trở bus K:** Đo giữa `Pin 6 (K)` và `Pin 7 (VS)` đạt xấp xỉ **`510 Ω`**.
