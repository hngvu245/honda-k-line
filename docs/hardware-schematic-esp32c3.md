# Sơ Đồ Nguyên Lý Chi Tiết: ESP32-C3 SuperMini + L9637D Đọc K-Line Xe Honda

Tài liệu thiết kế phần cứng hoàn chỉnh cho mạch giao tiếp K-Line thế hệ mới dùng **ESP32-C3 SuperMini** (Bluetooth 5.0 BLE + USB-C Native) kết hợp IC chuyên dụng **ST L9637D (SO-8)**, mạch hạ áp Buck bảo vệ nguồn và mạch chuyển mức logic an toàn cho chip 3.3V.

---

## 1. Sơ Đồ Khối Tổng Thể (System Architecture)

```text
 [ Giắc DLC 4 Chân Xe Honda ]
   │
   ├── +12V (Sau khóa) ──► [ Cầu chì 1A + Diode 1N5819 ] ──┬──► Chân 7 (VS) L9637D (+ R 510Ω kéo lên K-Line)
   │                                                        └──► [ Mạch Buck MP1584 / LM2596 ]
   │                                                                      │
   │                                                                      ▼ (+5.0V Chuẩn)
   │                                                        ┌─────────────┴─────────────┐
   │                                                        │                           │
   │                                                        ▼                           ▼
   │                                                 Chân 3 (VCC) L9637D       Chân 5V ESP32-C3 SuperMini
   │                                                        │                           │
   ├── K-Line (Dây K) ◄─────────────────────────────────────┤ Chân 6 (K)                │
   │                                                        │                           │
   │                                 Chân 1 (RX 5V) ───────►│ Cầu Phân Áp (10k / 20k) ─►│ GPIO 20 (UART0_RX)
   │                                                        │                           │
   │                                 Chân 4 (TX) ◄──────────┤ Trở bảo vệ 1 kΩ ◄─────────│ GPIO 21 (UART0_TX)
   │                                                        │                           │
   ├── SCS (Tùy chọn) ◄── [ Transistor NPN C1815 / 2N2222 ] ┴───────────────────────────│ GPIO 4  (SCS Control)
   │                                                                                    │
   └── GND (Mass sườn xe) ──────────────────────────────────────────────────────────────┴── GND Chung Toàn Mạch
```

---

## 2. Sơ Đồ Nguyên Lý Chi Tiết Từng Khối Mạch

### Khối 1: Nguồn Cấp & Bảo Vệ (Power Supply & Protection)

Lấy điện từ cọc 12V sau khóa (chỉ có điện khi bật chìa khóa xe), chống cắm ngược cực và hạ áp ổn định xuống 5.0V nuôi hệ thống.

```text
               D1: 1N5819
 +12V DLC ────►|─ (Diode) ───[ F1: Cầu chì 1A ]───┬───────────────► +12V Bus (Chân 7 L9637D)
                                                   │
                                              C1: 100nF / 50V
                                                   │
                                                  GND
                                                   │
                                                   ▼
                                         ┌──────────────────┐
                                         │  MẠCH HẠ ÁP BUCK │
                                         │ MP1584 / LM2596  │
                                         │  IN: 12V -> 5.0V │
                                         └────────┬─────────┘
                                                  │
                                                  ▼
                                             +5.0V DC ──┬─────────► VCC L9637D (Chân 3)
                                                        │
                                                   C2: 100nF / 16V
                                                        │
                                                       GND
                                                        │
                                                        └─────────► Chân 5V ESP32-C3
```
* **Lưu ý cân chỉnh:** Trước khi cắm vào ESP32-C3 và L9637D, dùng đồng hồ vặn chiết áp mạch Buck để đo đầu ra chuẩn **5.00V – 5.05V** khi cấp nguồn 12V ở đầu vào.

---

### Khối 2: Tầng Giao Tiếp Bus K-Line (L9637D - SO-8 STMicroelectronics)

IC L9637D làm nhiệm vụ chuyển mức hai chiều giữa đường dây K-Line 12V đơn tuyến của xe và tín hiệu TX/RX logic.

```text
                             L9637D (SO-8)
                          ┌────────∪────────┐
 (Sang cầu phân áp)  RX ──│ 1 (RX)    (LI) 8│── NC (Bỏ trống)
          (Bỏ trống) NC ──│ 2 (LO)    (VS) 7│── +12V Bus (sau D1 & Cầu chì)
            +5V Buck ────│ 3 (VCC)    (K) 6│── Dây K-Line Giắc DLC
    (Từ GPIO 21 C3)  TX ──│ 4 (TX)   (GND) 5│── GND Chung Toàn Mạch
                          └─────────────────┘
                                   │
                                   ├── Giữa Chân 6 (K) và Chân 7 (VS): Mắc trở kéo R_pull = 510 Ω (0.5W)
                                   ├── Giữa Chân 7 (VS) và Chân 5 (GND): Tụ gốm C3 = 100 nF (50V)
                                   └── Giữa Chân 3 (VCC) và Chân 5 (GND): Tụ gốm C2 = 100 nF (16V)
```
* **Điện trở kéo R_pull (510 Ω / 0.5W):** Theo chuẩn ISO 9141-2, đường K cần trở kéo lên 12V. Bắt buộc dùng loại công suất **0.5W trở lên** để tránh cháy trở khi đường K bị kéo về Mass liên tục lúc gửi chuỗi xung 0V.

---

### Khối 3: Mạch Chuyển Mức Logic Bảo Vệ ESP32-C3 (3.3V Logic Interface)

ESP32-C3 không chịu được 5V. Khối này bảo vệ chân UART của chip không bị quá áp.

```text
 1. Chiều Nhận (L9637D RX -> ESP32-C3 GPIO 20):
    L9637D Chân 1 (RX, 5V) ────[ R1: 10 kΩ ]────┬────► GPIO 20 (UART0_RX ESP32-C3)
                                                │
                                           [ R2: 20 kΩ ]
                                                │
                                               GND
    -> Điện áp đưa vào GPIO 20: V_rx = 5.0V * (20 / (10 + 20)) = 3.33V (An toàn tuyệt đối).

 2. Chiều Truyền (ESP32-C3 GPIO 21 -> L9637D TX):
    GPIO 21 (UART0_TX, 3.3V) ────[ R3: 1 kΩ ]────► L9637D Chân 4 (TX)
    -> Ngưỡng logic cao (V_ih) của L9637D chỉ cần >= 2.0V, mức 3.3V kích thẳng hoàn toàn mượt mà.
       Trở 1 kΩ đóng vai trò dập xung và hạn dòng bảo vệ GPIO 21 khi có sự cố.
```

---

### Khối 4: Mạch Kích Chân SCS (Service Check Short - Đọc & Xóa Lỗi MIL)

Chân SCS trên xe Honda có áp treo 5V–12V từ ECM. Dùng transistor NPN làm công tắc dập Mass cách ly để bảo vệ an toàn cho chip ESP32.

```text
                      Chân SCS (Giắc DLC Xe Máy)
                                 │
                                 ├─── Collector (C) Transistor NPN (C1815 hoặc 2N2222)
                                 │
 GPIO 4 ESP32-C3 ───[ R4: 2.2 kΩ ]─── Base (B)
                                 │
                                 └─── Emitter (E) ───► GND Chung Toàn Mạch

 * Nguyên lý hoạt động:
   - GPIO 4 = LOW (0V): Transistor ngắt -> Chân SCS thả nổi (Xe vận hành bình thường).
   - GPIO 4 = HIGH (3.3V): Transistor dẫn bão hòa -> Kéo chân SCS xuống 0V (Kích hoạt chế độ đọc lỗi chớp đèn FI trên đồng hồ táp-lô).
```

---

## 3. Bảng Kết Nối Dây Chi Tiết Chân-Đối-Chân (Pin-to-Pin Interconnect)

| Điểm đầu | Điểm cuối | Linh kiện phụ trên đường truyền | Chức năng kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Giắc DLC: Dây +12V** | Mạch Buck (IN+) | Diode 1N5819 + Cầu chì 1A | Cấp nguồn 12V chính sau khóa |
| **Giắc DLC: Dây +12V** | L9637D: Chân 7 (`VS`) | Sau Diode 1N5819 & Cầu chì | Cấp nguồn cực thu cho đường Bus K |
| **Giắc DLC: Dây K-Line**| L9637D: Chân 6 (`K`) | Có trở 510 Ω nối từ Chân 6 lên Chân 7 | Đường truyền dữ liệu chẩn đoán 10.4 kbps |
| **Giắc DLC: Dây SCS** | Transistor: Chân Collector | Nối trực tiếp | Chân kích chế độ dịch vụ |
| **Giắc DLC: Dây GND** | GND Chung toàn mạch | Nối trực tiếp | Dây mass chuẩn xe |
| **Buck: Đầu ra +5.0V** | L9637D: Chân 3 (`VCC`)| Tụ 100nF xuống GND | Cấp nguồn logic 5V cho L9637D |
| **Buck: Đầu ra +5.0V** | ESP32-C3: Chân `5V` | Nối trực tiếp | Cấp nguồn nuôi bo mạch ESP32-C3 |
| **L9637D: Chân 1 (`RX`)**| ESP32-C3: Chân `20` (`GPIO20`)| Qua cầu phân áp R1=10k, R2=20k xuống GND | Nhận gói tin K-Line từ xe vào MCU |
| **ESP32-C3: Chân `21` (`GPIO21`)**| L9637D: Chân 4 (`TX`)| Qua trở R3=1k | Gửi mã Wakeup/FastInit/Table 11 |
| **ESP32-C3: Chân `4` (`GPIO4`)** | Transistor: Chân Base | Qua trở R4=2.2k | Điều khiển kích SCS |
| **ESP32-C3: Chân `8` (`GPIO8`)** | LED Xanh onboard | Tích hợp sẵn trên board | Đèn chớp báo trạng thái kết nối |

---

## 4. Danh Sách Linh Kiện Cần Chuẩn Bị (Bill of Materials - BOM)

| STT | Tên linh kiện | Thông số chi tiết | Số lượng | Ghi chú & lưu ý |
| :---: | :--- | :--- | :---: | :--- |
| 1 | **Kit ESP32-C3 SuperMini** | Bản 16 chân, tích hợp USB-C, BLE 5.0 | 1 cái | Kiểm tra cổng nạp Type-C nhận driver Native CDC |
| 2 | **IC L9637D** | Gói SO-8 dán (hoặc mạch hàn sẵn adapter) | 1 con | Chuẩn STMicroelectronics |
| 3 | **Mạch hạ áp Buck DC-DC** | MP1584EN hoặc LM2596 (chọn MP1584 cho siêu nhỏ) | 1 mạch | Chỉnh biến trở ra đúng 5.00V trước khi hàn vào mạch |
| 4 | **Điện trở kéo K-Line** | **510 Ω — Công suất 0.5W (1/2W)** | 1 con | Bắt buộc 0.5W, không dùng trở dán 1/8W bé xíu sẽ nóng |
| 5 | **Điện trở cầu phân áp** | **10 kΩ** (0.25W) & **20 kΩ** (0.25W) | Mỗi loại 1 con | Phân áp hạ 5V -> 3.3V cho chân RX |
| 6 | **Điện trở hạn dòng** | **1 kΩ** & **2.2 kΩ** (0.25W) | Mỗi loại 1 con | 1k bảo vệ TX; 2.2k kích cực B transistor SCS |
| 7 | **Tụ gốm lọc nhiễu** | **100 nF (0.1 µF / mã 104)** chịu áp >= 50V | 2 con | 1 con lọc chân VS (12V), 1 con lọc chân VCC (5V) |
| 8 | **Diode chống cắm ngược**| **1N5819** (Schottky 1A, sụt áp thấp ~0.3V) | 1 con | Mắc nối tiếp ở dây dương 12V từ giắc DLC |
| 9 | **Cầu chì bảo vệ** | Cầu chì ống hoặc cầu chì tự phục hồi (PPTC) **1A / 30V** | 1 cái | Bảo vệ cháy nổ hệ thống điện xe nếu lỡ chạm chập |
| 10 | **Transistor NPN** | **2N2222** hoặc **C1815** (TO-92) | 1 con | Làm khóa kích mass cho chân SCS |
| 11 | **Giắc cắm DLC 4 chân xe máy** | Giắc chuẩn Honda Sumitomo 4-pin chống nước | 1 bộ | Có sẵn 4 đầu cos bấm dây |

---

## 5. Quy Trình Kiểm Tra An Toàn Trước Khi Cắm Vào Xe (Smoke Test Checklist)

1. **Kiểm tra thông mạch Mass (GND):**
   - Đặt thang đo thông mạch đồng hồ VOM: Chân GND giắc DLC, GND mạch Buck, Chân 5 L9637D, Chân G của ESP32-C3 phải thông mạch hoàn toàn với nhau ($R \approx 0\ \Omega$).
2. **Kiểm tra điện áp ngõ ra Buck (Chưa cắm ESP32-C3):**
   - Cấp nguồn 12V thử nghiệm vào đầu vào mạch Buck. Đo que đỏ vào ngõ ra Buck, que đen vào GND: Kim đồng hồ phải chỉ đúng **5.0V – 5.1V**. Tuyệt đối không cắm ESP32 nếu áp ra vượt quá 5.3V.
3. **Kiểm tra mức áp an toàn tại chân RX (GPIO 20):**
   - Cấp điện 12V vào đường VS và 5V vào VCC của L9637D. Khi đường K-Line đang ở trạng thái nghỉ (idle 12V), đo điện áp tại điểm nối giữa R1 (10k) và R2 (20k) nối vào GPIO 20: Điện áp bắt buộc phải đo được xấp xỉ **~3.2V – 3.35V**. Nếu thấy vọt lên 5V nghĩa là cầu phân áp hàn sai hoặc lỏng chân GND của R2.
4. **Kiểm tra điện trở đường K:**
   - Đo giữa chân 6 (`K`) và chân 7 (`VS` 12V): Phải đo được giá trị đúng xấp xỉ **510 Ω**.
