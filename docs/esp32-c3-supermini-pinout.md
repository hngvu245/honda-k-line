# Sơ Đồ & Ý Nghĩa 16 Chân ESP32-C3 SuperMini (Giao Tiếp K-Line & L9637D)

Tài liệu chi tiết giải phẫu toàn bộ **16 chân** trên kit **ESP32-C3 SuperMini** (chip ESP32-C3FH4 RISC-V, tích hợp Bluetooth 5.0 BLE & USB-C Native Serial), các lưu ý bẫy phần cứng (**Strapping pins, 3.3V logic level**) và sơ đồ đấu nối chuẩn với IC K-Line **L9637D** cho xe máy Honda.

---

## 1. Bản Đồ Bố Trí Chân (Nhìn Từ Mặt Trước — Cổng USB-C Ở Phía Trên)

```text
                     ┌──────────────────┐
                     │    [ USB-C ]     │
                     │  (D-:19, D+:18)  │
                     └──────────────────┘
       [ HÀNG TRÁI ]                      [ HÀNG PHẢI ]
   GPIO 5  ──  [ 5  ]                   [ 5V ]  ──  Nguồn 5V vào (VBUS)
   GPIO 6  ──  [ 6  ]                   [ G  ]  ──  GND (Mass chung)
   GPIO 7  ──  [ 7  ]                   [ 3V3]  ──  Nguồn 3.3V ra (từ LDO board)
*  GPIO 8  ──  [ 8  ] (LED xanh)        [ 4  ]  ──  GPIO 4 (An toàn / SCS)
*  GPIO 9  ──  [ 9  ] (Nút BOOT)        [ 3  ]  ──  GPIO 3 (ADC1_CH3)
   GPIO 10 ──  [ 10 ]                 * [ 2  ]  ──  GPIO 2 (Strapping pin)
   GPIO 20 ──  [ 20 ] (UART0_RX)        [ 1  ]  ──  GPIO 1 (ADC1_CH1 / I2C SCL)
   GPIO 21 ──  [ 21 ] (UART0_TX)        [ 0  ]  ──  GPIO 0 (ADC1_CH0 / I2C SDA)
                     └──────────────────┘
                     (*: Chân strapping / phần cứng đặc biệt trên board)
```

---

## 2. Bảng Tra Cứu Tác Dụng Từng Chân & Vai Trò Trong Dự Án Xe Honda

### A. Hàng Chân Bên Trái (8 chân: GPIO 5 -> GPIO 21)

| Ký hiệu trên board | Tên GPIO gốc | Chức năng kỹ thuật chính | Cảnh báo phần cứng | Vai trò trong dự án K-Line Honda |
| :---: | :---: | :--- | :--- | :--- |
| **`5`** | **GPIO5** | GPIO, ADC2_CH0, FSPIWP | Chân thường, an toàn. | **Dự phòng:** Dùng cho còi buzzer báo quá nhiệt / nút chuyển màn hình. |
| **`6`** | **GPIO6** | GPIO, FSPICLK, MTCK | Chân thường, tốc độ cao. | **Dự phòng:** Dùng cho đường CLK nếu sau này muốn gắn màn hình TFT SPI. |
| **`7`** | **GPIO7** | GPIO, FSPID (MOSI), MTDO | Chân thường, tốc độ cao. | **Dự phòng:** Dùng cho đường MOSI màn hình TFT SPI. |
| **`8`** | **GPIO8** | GPIO, Strapping pin | **Đã nối sẵn ĐÈN LED XANH onboard** (Active-LOW: xuất `0` = LED sáng, `1` = LED tắt). | **ĐÈN BÁO TRẠNG THÁI XE:** Chớp chậm lúc chờ kết nối ECU/BLE, sáng đứng/chớp nhanh khi đang truyền dữ liệu Table 11. Không hàn tải nặng ra ngoài. |
| **`9`** | **GPIO9** | GPIO, Strapping pin | **Đã nối sẵn NÚT BẤM BOOT** trên mạch (bấm giữ lúc cắm USB để ép vào chế độ nạp flash). | **ĐỂ TRỐNG TUYỆT ĐỐI:** Không hàn dây vào chân này để tránh xe bị rung lắc làm chập xuống Mass khiến chip bị treo bootloader. |
| **`10`** | **GPIO10** | GPIO, FSPICS0 | Chân thường, an toàn. | **Dự phòng:** Dùng làm chân chọn chip (CS) nếu gắn màn hình hoặc thẻ nhớ microSD log data độc lập. |
| **`20`** | **GPIO20** | **UART0_RX**, GPIO | Chân nhận dữ liệu nối tiếp phần cứng của ESP32-C3. | **CHÂN NHẬN K-LINE RX:** Nối từ **Chân 1 (RX) của L9637D** qua **cầu phân áp (10k / 20k)** để hạ điện áp an toàn từ 5V xuống 3.3V. |
| **`21`** | **GPIO21** | **UART0_TX**, GPIO | Chân truyền dữ liệu nối tiếp phần cứng của ESP32-C3. | **CHÂN TRUYỀN K-LINE TX:** Nối qua trở **1 kΩ** sang **Chân 4 (TX) của L9637D** (phát xung Fast Init 70ms/120ms và gửi lệnh hỏi ECU). |

---

### B. Hàng Chân Bên Phải (8 chân: 5V -> GPIO 0)

| Ký hiệu trên board | Tên GPIO gốc | Chức năng kỹ thuật chính | Cảnh báo phần cứng | Vai trò trong dự án K-Line Honda |
| :---: | :---: | :--- | :--- | :--- |
| **`5V`** | **VBUS / VIN** | Chân cấp nguồn dương 5V (nối trực tiếp với chân VBUS của cổng USB-C qua diode). | Dùng cấp nguồn khi chạy không cắm máy tính. | **CẤP NGUỒN 5V:** Nối đầu ra **5.0V** từ mạch hạ áp Buck (MP1584/LM2596 lấy từ bình 12V xe). **Nối chung sang Chân 3 (VCC) của L9637D**. |
| **`G`** | **GND** | Mass chung toàn hệ thống (0V). | Luôn nối chung mass tất cả các khối. | **MASS CHUNG:** Nối chung GND ESP32-C3, GND L9637D, GND Buck và dây xanh lá (GND) giắc DLC xe. |
| **`3.3`** | **3V3 Output** | Ngõ ra 3.3V từ IC ổn áp LDO nhỏ trên board (dòng tải tối đa ~400–500mA). | **Không cấp nguồn ngược 5V vào đây** (sẽ cháy chip ngay lập tức). | **ĐỂ TRỐNG:** Chỉ dùng nếu sau này có gắn cảm biến môi trường nhiệt độ/áp suất ngoài chạy mức 3.3V. |
| **`4`** | **GPIO4** | GPIO, ADC1_CH4, FSPIHD | Chân thường, an toàn, không vướng strapping lúc khởi động. | **ĐIỀU KHIỂN CHÂN SCS (ĐỌC/XÓA LỖI):** Nối qua trở **2.2 kΩ** vào chân **B (Base)** của transistor NPN (2N2222 / C1815) để kéo Mass chân SCS khi cần xem đèn MIL chớp lỗi. |
| **`3`** | **GPIO3** | GPIO, ADC1_CH3 | Chân đo tương tự (ADC) 12-bit độ nhạy cao. | **Dự phòng:** Đo trực tiếp điện áp bình ắc quy xe (qua cầu phân áp 100k / 22k) độc lập với ECU. |
| **`2`** | **GPIO2** | GPIO, ADC1_CH2, **Strapping pin** | Chip đọc trạng thái chân này khi vừa cấp nguồn để định cấu hình SPI Flash. | **ĐỂ TRỐNG (KHUYẾN NGHỊ):** Tránh nối mạch ngoài làm kéo chân này xuống thấp lúc vừa bật khóa xe. |
| **`1`** | **GPIO1** | GPIO, ADC1_CH1 | Chân thường, mặc định làm đường clock I2C (SCL). | **Dự phòng:** Dùng làm chân **SCL** nếu muốn gắn màn hình phụ OLED 0.96" trên ghi-đông xe. |
| **`0`** | **GPIO0** | GPIO, ADC1_CH0 | Chân thường, mặc định làm đường data I2C (SDA). | **Dự phòng:** Dùng làm chân **SDA** cho màn hình OLED. |

---

## 3. Ba Nguyên Tắc Sống Còn Khi Đấu ESP32-C3 SuperMini Với L9637D

### 1. Hạ áp chân RX (L9637D -> ESP32-C3)
* IC L9637D bắt buộc phải nuôi `VCC = 5.0V` (để tầng transceiver bên trong lái đường K-Line 12V ổn định).
* Do đó, chân `1 (RX)` của L9637D khi ở mức cao sẽ xuất xấp xỉ **5V**.
* **ESP32-C3 không chịu được 5V (Non 5V-tolerant)**, cắm thẳng vào `GPIO20` sẽ làm chết cổng UART của chip sau một thời gian ngắn.
* **Giải pháp bắt buộc:** Đấu cầu phân áp bằng 2 điện trở:
  ```text
  L9637D Chân 1 (RX) ────[ R1: 10 kΩ ]────┬────► Chân 20 (GPIO20) ESP32-C3
                                          │
                                       [ R2: 20 kΩ ]
                                          │
                                         GND (Mass)
  ```
  *(Điện áp sau phân áp: $5\text{V} \times \frac{20}{10 + 20} \approx 3.33\text{V}$ chuẩn an toàn tuyệt đối).*

### 2. Chiều truyền TX (ESP32-C3 -> L9637D)
* Chân `21 (GPIO21)` của ESP32-C3 xuất mức cao `3.3V`.
* Ngưỡng nhận diện mức cao ($V_{IH}$) của L9637D theo datasheet chuẩn TTL chỉ từ **~2.0V**, nên mức `3.3V` kích thẳng L9637D nhận diện cực kỳ chuẩn xác và ổn định.
* Để chống xung sét hoặc chạm chập ngược, chỉ cần chèn **1 điện trở $1\text{ k}\Omega$** nối tiếp giữa `GPIO21` và `Chân 4 (TX)` của L9637D.

### 3. Cổng USB-C Native trên ESP32-C3
* Cổng Type-C trên board SuperMini không dùng chip chuyển đổi rời (như CH340 hay CP2102) mà nối trực tiếp vào bộ điều khiển **USB Serial/JTAG tích hợp sẵn bên trong chip (GPIO18/GPIO19)**.
* Do đó, bạn vừa có thể nạp code hoặc mở `dashboard.py` qua USB-C mà **hoàn toàn không bị trùng lặp hay xung đột với cổng UART0 (`GPIO20`/`GPIO21`)** đang nối ra ECU xe.
