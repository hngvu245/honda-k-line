# Sơ Đồ Phần Cứng & Kết Nối Chuẩn (L9637D - STM32F103C8T6 - Buck - Bluetooth)

Tài liệu kỹ thuật chuẩn hóa theo **Datasheet chính thức ST L9637D (Doc ID 1765 Rev 8)**, cấu hình chân `firmware/stm32-legacy/honda_test.ioc`, sơ đồ nguồn Buck độc lập và module Bluetooth + mạch điều khiển chân `SCS`.

---

## 1. Sơ Đồ Chân IC L9637D (SO-8 — Đã Đối Chiếu Datasheet ST)

Nhìn từ trên xuống, đầu có chấm tròn / rãnh khuyết nằm phía trên:

```text
               ┌───────∪───────┐
  PA10 STM32 <-│ 1 (RX)   (LI) 8 │--- (Bỏ trống / Không dùng)
   (Bỏ trống) -│ 2 (LO)   (VS) 7 │<- +12V (Sau ổ khóa xe, qua Diode + Cầu chì)
  +5V Nguồn  ->│ 3 (VCC)   (K) 6 │<-> Dây K-Line giắc DLC (+ trở 510 Ω kéo lên Chân 7)
   PA9 STM32 ->│ 4 (TX)  (GND) 5 │--- GND Chung toàn hệ thống
               └───────────────┘
```

| Chân IC | Tên | Hướng tín hiệu | Kết nối thực tế | Lưu ý bắt buộc |
| :---: | :---: | :---: | :--- | :--- |
| **1** | **RX** | Output $\rightarrow$ MCU | **`PA10`** (`USART1_RX`) | Đưa mức logic nhận từ xe vào STM32 (`PA10` chịu được 5V). |
| **2** | **LO** | Output | **Bỏ trống (NC)** | Đường L-Line phụ; Honda Keihin chỉ dùng 1 dây K. |
| **3** | **VCC** | Nguồn Logic **+5V** | **+5V** (USB laptop hoặc đầu ra **Buck 5.0V**) | **Bắt buộc đủ ~5V (4.5–5.5V)**. Cắm nhầm VCC/GND sẽ làm chết tầng logic. |
| **4** | **TX** | Input $\leftarrow$ MCU | **`PA9`** (`USART1_TX`) | Nhận chuỗi Fast Init & lệnh hỏi từ STM32. |
| **5** | **GND** | Mass chung | **GND Chung** | Nối chung STM32, L9637D, CH340/Bluetooth và cọc âm / sườn xe. |
| **6** | **K** | Bus 12V Half-Duplex | **Chân K-Line giắc DLC xe** | **Bắt buộc gắn trở kéo 510 Ω (0.5W) từ Chân 6 lên Chân 7 (`VS`).** |
| **7** | **VS** | Nguồn Bus **+12V** | **+12V** xe (sau khóa) | Mắc thêm tụ gốm `100 nF` từ Chân 7 xuống `GND` để lọc nhiễu cao áp. |
| **8** | **LI** | Input | **Bỏ trống (NC)** | Không dùng đường L-Line. |

---

## 2. Trở Treo (Pull-up Resistor)

* **Firmware hiện tại:** Chân `USART1` (`PA9`, `PA10`) trong `firmware/stm32-legacy/Core/Src/stm32f1xx_hal_msp.c` cấu hình `PA9 = GPIO_MODE_AF_OD` và `PA10 = GPIO_MODE_INPUT` (`GPIO_PULLUP`). Khi chạy `KLine_FastInit()` trong `main.c`, `PA9` chuyển tạm sang `GPIO_MODE_OUTPUT_OD`.
* **Phía K-Line 12V (Bắt buộc):** Nối **1 điện trở 510 Ω (công suất 0.5W)** giữa **Chân 6 (`K`)** và **Chân 7 (`VS` +12V)**. Khi bật khóa xe và chưa truyền dữ liệu, đo giữa dây `K` và `GND` phải thấy điện áp nghỉ **~11.5V – 12.5V**.
* **Phía Logic 5V/3.3V:** Với IC L9637D chân `1 (RX)` có thể hoạt động trực tiếp với `PA10` hoặc gắn thêm trở kéo nhẹ `4.7 kΩ – 10 kΩ` lên `+3.3V` để chống trôi khi rút dây.

---

## 3. Sơ Đồ Toàn Hệ Thống Khi Chạy Độc Lập Trên Xe (Buck + Bluetooth)

Khi gắn cố định lên xe qua giắc chẩn đoán DLC 4 chân (không cần dây laptop):

```text
[Giắc DLC 4 chân xe Honda]
  ├── +12V (Sau khóa) ──► [Cầu chì 1A] ──► [Diode 1N5819] ──┬──► Chân 7 (VS) L9637D (+ R510Ω -> Chân 6)
  │                                                         └──► [Buck MP1584 / LM2596] ──► (+5.0V chuẩn)
  │                                                                 ├──► Chân 5V kit STM32F103
  │                                                                 ├──► Chân 3 (VCC) L9637D
  │                                                                 └──► Chân VCC Module Bluetooth*
  ├── K-Line ────────────────────────────────────────────────────► Chân 6 (K) L9637D
  ├── SCS (Tùy chọn) ◄── [Transistor NPN 2N2222 / C1815] ◄── [R 2.2k] ◄── GPIO STM32 (vd: PB0)
  └── GND ───────────────────────────────────────────────────────► Mass chung (STM32 + L9637D + Buck + BT)
```
*\*Kiểm tra kỹ mặt sau module Bluetooth: đa số board đế HC-05/HC-06/HM-10 nhận `VCC = 3.6V – 6V` (cấp 5V tốt), nếu dùng chip trần `ESP32`/`JDY` không có ổn áp tích hợp thì cấp `3.3V` từ chân `3.3V` của kit STM32.*

### Bảng nối dây STM32F103C8T6 (`Blue Pill`)

| Giao tiếp | Chân STM32 | Nối với (Lúc test dây PC) | Nối với (Lúc gắn Bluetooth chạy độc lập) |
| :--- | :--- | :--- | :--- |
| **K-Line TX** | `PA9` (`USART1_TX`) | L9637D — Chân `4 (TX)` | L9637D — Chân `4 (TX)` |
| **K-Line RX** | `PA10` (`USART1_RX`) | L9637D — Chân `1 (RX)` | L9637D — Chân `1 (RX)` |
| **UART PC/BT TX**| `PA2` (`USART2_TX`) | CH340 — `RXD` | Module Bluetooth — `RXD` |
| **UART PC/BT RX**| `PA3` (`USART2_RX`) | CH340 — `TXD` | Module Bluetooth — `TXD` |
| **SWD Nạp Code** | `PA13` (`SWDIO`), `PA14` (`SWCLK`) | ST-Link V2 (`SWDIO`, `SWCLK`, `GND`, `3.3V`) | Để trống khi chạy xe |

---

## 4. Mạch Điều Khiển Chân SCS (Service Check Short) An Toàn

Chân `SCS` trên giắc DLC Honda có điện áp kéo lên `5V – 12V` từ ECU. **Không nối thẳng chân `SCS` vào GPIO STM32**. Dùng 1 transistor NPN nhỏ làm công tắc kéo Mass cách ly:

```text
Chân SCS (Giắc DLC Xe) ────────── Collector (C) của 2N2222 / C1815
                                       │
GPIO STM32 (vd: PB0) ───[ 2.2 kΩ ]─────┤ Base (B)
                                       │
GND Chung ─────────────────────── Emitter (E)
```

* `PB0 = LOW (0V)`: Transistor ngắt $\rightarrow$ Chân SCS thả nổi (xe chạy bình thường).
* `PB0 = HIGH (3.3V)`: Transistor dẫn bão hòa $\rightarrow$ Kéo chân SCS xuống Mass (bật chế độ Service / nháy đèn MIL / Reset ECM).
