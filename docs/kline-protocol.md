# Đặc Tả Giao Thức Honda Keihin K-Line & Giải Mã Table 11

Tài liệu đặc tả giao thức chẩn đoán **Honda Keihin PGM-FI K-Line** (tốc độ **10.400 bps**, 8N1, Half-Duplex 1 dây), được kiểm chứng trực tiếp qua **3.821 khung dữ liệu thật** thu từ ECU xe trong file `software/logs/kline_debug.log`.

---

## 1. Quy Trình Bắt Tay (3-Step Handshake) & Giữ Thức ECU

ECU Honda yêu cầu toàn bộ quá trình đánh thức và hỏi dữ liệu diễn ra trong vòng **dưới 2 giây (2000 ms)**, nếu quá thời gian ECU sẽ tự ngủ lại (Sleep mode). Firmware tối giản hiện tại (`firmware/stm32-legacy/Core/Src/main.c`) giữ chu kỳ hỏi mỗi **~145–160 ms** (`POLL_REST_MS = 100U` + `HAL_Delay(45)`).

| Giai đoạn | Hành động trên STM32 (`PA9` / `USART1`) | Dữ liệu gửi (Hex) | Phản hồi chuẩn từ ECU (Hex) |
| :--- | :--- | :--- | :--- |
| **1. Fast Init (Cứng)** | Tạm tắt UART1, chuyển `PA9` sang Output Open-Drain (`OUTPUT_OD`): kéo **LOW 70 ms** $\rightarrow$ **HIGH 120 ms** $\rightarrow$ bật lại USART1 @ `10400 bps` | *(Xung vật lý)* | *(ECU tỉnh dậy)* |
| **2. Wake-up (Mềm)** | Gửi gói Wake-up | `FE 04 72 8C` | `0E 04 72 7C` |
| **3. Initialise** | Gửi gói khởi tạo phiên | `72 05 00 F0 99` | `02 04 00 FA` |
| **4. Query Loop** | Hỏi liên tục mỗi 300 ms (bảo đảm `< 2s`) | `72 05 71 11 07` | `02 19 71 11 ... [25 byte]` |

---

## 2. Công Thức Checksum & Cấu Trúc Khung

### Công thức tính Checksum (Chiều gửi Request)
Với khung gửi `B[0] B[1] ... B[n-1] CS`:
```text
CS = (0x100 - (sum(B[0..n-1]) & 0xFF)) & 0xFF
```
* Ví dụ lệnh đọc Table 11: `72 + 05 + 71 + 11 = 0xF9` $\rightarrow$ `0x100 - 0xF9 = 0x07` $\rightarrow$ Gói hoàn chỉnh: **`72 05 71 11 07`**.

### Kiểm tra tính toàn vẹn gói nhận từ ECU
Tổng toàn bộ 25 byte của gói ECU (`ecu[0..24]`, tính cả byte Checksum cuối `ecu[24]`) phải chia hết cho `256`:
```text
(sum(ecu[0..24]) & 0xFF) == 0
```
*(Đã kiểm chứng: **3.821 / 3.821** khung trong `kline_debug.log` đều thỏa mãn điều kiện này với `0` lỗi).*

### Hiện tượng Echo trên đường dây K-Line (Half-Duplex)
Vì chân `TX` và `RX` của L9637D cùng bám trên 1 dây vật lý `K`:
* Khi STM32 phát 5 byte lệnh `72 05 71 11 07`, chân `PA10` sẽ hút lại chính 5 byte đó trước, rồi mới tới 25 byte của ECU (`02 19 71 11 ...`), tạo thành dòng dữ liệu **30 byte**.
* Bộ giải mã trên PC (`dashboard.py`) và Android (`app.js`) tự động tìm đúng vị trí đầu khung `02 19 71 11` và kiểm tra Checksum 25 byte, bỏ qua hoàn toàn các byte Echo phía trước.

---

## 3. Bảng Giải Mã Chi Tiết 25 Byte — Table 11 (Đã Kiểm Chứng Thực Tế)

ECU Keihin xuất nhiều cảm biến theo từng **cặp đôi**: `[Điện áp thô ADC]` đi kèm `[Giá trị vật lý đã quy đổi]`. Lưu ý bảng dưới đánh số `ecu[0..24]` bắt đầu từ byte `0x02`:

| Byte (`ecu[i]`) | Dữ liệu mẫu (Garanti / Tua cao) | Đại lượng | Công thức quy đổi | Dải giá trị thực tế đo trên xe (`kline_debug.log`) |
| :---: | :---: | :--- | :--- | :--- |
| `0` | `0x02` | Response Header | Cố định `0x02` | `0x02` |
| `1` | `0x19` | Payload Length | `25` byte tổng | `0x19` (25) |
| `2..3` | `71 11` | Query / Table ID | Table `0x11` | `71 11` |
| **`4..5`** | `06 4C` / `28 02` | **Vòng tua máy (RPM)** | `(ecu[4] << 8) \| ecu[5]` | `0` $\rightarrow$ `1.612` (garanti) $\rightarrow$ **`10.242 RPM`** |
| `6` | `0x17` $\rightarrow$ `0xDF` | Điện áp cảm biến TPS | `ecu[6] * 5.0 / 256.0` | `0.45 V` (đóng) $\rightarrow$ `4.36 V` (hết ga) |
| **`7`** | `0x00` $\rightarrow$ `0x9C` | **Độ mở bướm ga (TPS %)** | `min(ecu[7] / 1.56, 100.0)` | **`0.0 %`** (đóng kín) $\rightarrow$ **`100.0 %`** (`0x9C`) |
| `8` | `0x45` $\rightarrow$ `0x26` | Điện áp cảm biến ECT | `ecu[8] * 5.0 / 256.0` | Giảm dần khi máy nóng (NTC) |
| **`9`** | `0x63` $\rightarrow$ `0x7B` | **Nhiệt độ nước mát (ECT)** | `ecu[9] - 40` (°C) | **`59 °C`** $\rightarrow$ **`83 °C`** |
| `10` | `0x7D` $\rightarrow$ `0x76` | Điện áp cảm biến IAT | `ecu[10] * 5.0 / 256.0` | ~`2.30 – 2.46 V` |
| **`11`** | `0x4A` $\rightarrow$ `0x4E` | **Nhiệt độ khí nạp (IAT)** | `ecu[11] - 40` (°C) | **`34 °C`** $\rightarrow$ **`38 °C`** |
| `12` | `0x2F` $\rightarrow$ `0x96` | Điện áp cảm biến MAP | `ecu[12] * 5.0 / 256.0` | Tỉ lệ theo độ chân không cổ hút |
| **`13`** | `0x64` / `0x37` / `0x1D` | **Áp suất đường nạp (MAP)** | `ecu[13]` (kPa) | **`100–102 kPa`** (tắt máy) / **`55 kPa`** (garanti) / **`29 kPa`** (hạ ga) |
| `14..15` | `FF FF` | Dự phòng (Unused) | Không dùng trên đời xe này | `0xFF 0xFF` |
| **`16`** | `0x51` / `0x7A` / `0x92` | **Điện áp ắc-quy / Sạc (VBAT)** | `ecu[16] / 10.0` (V) | `8.1 V` (đề máy) / `12.0 V` (nghỉ) / **`13.7 – 14.6 V`** (nổ máy sạc) |
| **`17`** | `0x00`..`0x01` | **Tốc độ xe (VSS)** | `ecu[17]` (km/h) | `0 – 1 km/h` (test tại chỗ) |
| **`18..19`** | `00 00` / `02 95` | **Độ rộng xung kim phun (INJ) & % Duty** | `inj_ms = ((ecu[18] << 8) \| ecu[19]) * 0.00390625` (ms); `Duty = (RPM * inj_ms) / 1200` (%) | `0.00 ms` (cắt xăng DFCO) / `~2.58 ms` (garanti) / **`6.42 ms`** (`53.9%` peak) |
| **`20`** | `0x80` / `0x8E` / `0xFF` | **Góc đánh lửa sớm (IGN)** | `(ecu[20] - 128) * 0.5` (° BTDC) | `0.0°` (tắt máy) / **`+7.0°`** (garanti) / **`+30°..+63.5°`** (tua cao) |
| **`21`** | `0x24`..`0x2E` | **Bước van cầm chừng (IACV)** | `ecu[21]` (stp) | **`35 – 46 stp`** (giảm dần khi máy nóng) |
| `22` | `0x11`..`0x15` | Trimming / Trạng thái nội bộ | Tham số nội bộ ECU | `17 – 21` |
| **`23`** | `0x00`..`0xFF` | **Cảm biến Oxy (O2) & AFR ước tính** | `O2 = ecu[23] / 256.0` (V); `AFR ≈ clamp(16.2 - O2 * 3.8, 11.8, 16.5)` | **`0.00 – 1.00 V`** |
| `24` | *(biến thiên)* | **Checksum Byte** | Bù tổng 25 byte $\equiv 0 \pmod{256}$ | Đảm bảo toàn vẹn gói tin |

### Các bảng lệnh chẩn đoán mở rộng (đã hỗ trợ parser trên PC/Android; chưa kích hoạt trong `main.c` bản tối giản hiện tại)
* **`Table 00` (`72 05 71 00 18`):** Trả về mã phụ tùng `ECM ID`.
* **`Table 73` (`72 05 71 73 A5`):** Đọc mã lỗi **hiện tại** (Current DTC).
* **`Table 74` (`72 05 71 74 A4`):** Đọc mã lỗi **quá khứ** (Stored/Past DTC).
* **`Service 60` (`72 05 60 01 28`):** Xóa bộ nhớ lỗi DTC trong ECU.

### Nhận diện cắt xăng giảm tốc (DFCO — Deceleration Fuel Cut-Off)
Trong log tại `19:11:42` khi buông hết ga (`TPS = 0%`) ở `5.343 RPM`:
* Kim phun lập tức đóng kín về **`0.00 ms`** (`ecu[18..19] = 00 00`) và áp suất cổ hút tụt về chân không mạnh (`29 – 35 kPa`).
* Điều kiện hiển thị cờ **`DFCO CUT`** trên Dashboard: `rpm > 2200 && ecu[7] == 0 && inj_ms == 0.0`.

---

## 4. Thuật Toán Ước Lượng & Tự Học Cấp Số Ảo (Virtual Gear v3)

Vì giắc K-Line Keihin không xuất byte cảm biến số, cả PC (`dashboard.py`) và Android (`kline_core.js`) ước lượng số từ `RPM`, `VSS`, kết hợp `TPS (%)` và `INJ (ms)` trong Table `11`:

1. **Chia vùng Voronoi trung bình nhân:** Ranh giới chuyển tiếp giữa số $i$ và $i+1$ đặt tại $\sqrt{R_i \cdot R_{i+1}}$ (xóa bỏ khoảng chết giữa các số); biên ngoài ở số 1 mở rộng thích ứng theo `VSS` (`R_1 * (1.28 + 1.5 / max(VSS, 2))`), biên dưới `R_N * 0.84`.
2. **Bù lượng tử tốc độ thấp (`VSS < 15 km/h`):** Giữ số hiện tại nếu khoảng $[RPM / (VSS + 0.7), RPM / \max(1, VSS - 0.7)]$ còn giao với vùng số đang gài.
3. **Chống nhảy số khi âm côn trôi xe (`Anti-Coasting & Clutch-In Classifier`):**
   - **Tự học garanti thực (`idleRpm`):** Học EMA khi `VSS < 2, TPS <= 1.2%, 450 <= RPM <= 2400` để tính trần garanti `idleCeil = idleRpm + 320`.
   - **Bắt cắt côn & vùng garanti:** Khi `VSS >= 4` và `TPS <= 2.5%`, nếu tua rớt (`dRPM <= -220` hoặc 2 khung `dRPM <= -110`) hoặc rơi vào vùng garanti (`RPM <= idleCeil`) mà kim phun vẫn mở nuôi máy (`INJ > 0.4 ms`), khóa cứng số hiện tại (`frozenByClutch = true`, hiển thị `"Âm côn · trôi"`) suốt thời gian trôi xe.
   - **Chốt chặn lên số & nhả khóa:** Chặn mọi `upshift` khi `TPS <= 2.5% && RPM < max(2300, idleRpm + 650) && dRPM <= 0`. Chỉ mở khóa khi vặn ga lại (`TPS > 3.5%` 2 khung), tăng tua đồng bộ (`dRPM > 220` trên `idleCeil`), hoặc hãm máy DFCO (`INJ < 0.05 ms` ở `RPM > idleCeil + 300`) ổn định 3 khung.
4. **Hysteresis theo bước nhảy:** Đổi sang số liền kề (`±1`) cần `2` khung liên tiếp; nhảy cóc `>= 2` số cần `4` khung và `RPM >= 1800`. Giữ số tối đa `1200 ms` trước khi trả `--`.
5. **Tự học qua cú kéo tua trên xe (`GearPullLearner` trên Android):**
   - **Học Số 1 (Kéo max tua):** Lấy mẫu khi côn đã bắt hoàn toàn (`VSS >= 6`, `RPM >= 2200`, `TPS >= 4%`, `dRPM >= -150`), ưu tiên dải tốc độ lớn và lọc nhiễu bằng MAD median để chốt `R1`, sau đó tạm nội suy số `2..6` theo bước truyền chuẩn (`[1.0, 0.6685, 0.4863, 0.3893, 0.3364, 0.2948]`).
   - **Tự học liên hoàn `1 -> N` / Học từng số:** Phát hiện sang số tự động khi tỷ số giảm `>= 18%` ổn định `>= 4` khung để khóa trực tiếp từng cấp số thực tế của xe.
