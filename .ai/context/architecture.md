# Kiến Trúc Hệ Thống (Honda Keihin K-Line)

## 1. Luồng Dữ Liệu End-to-End

```text
[Honda PGM-FI ECU (10400 bps, 12V Single-Wire K-Line)]
        │  (Pin 6 K <-> R_pull 510 Ω <-> Pin 7 VS +12V)
        ▼
[ST L9637D Transceiver]
  ├── Pin 4 (TX) ◄── PA9  (USART1_TX, 10400 bps / Fast-Init 70ms LOW, 120ms HIGH)
  └── Pin 1 (RX) ──► PA10 (USART1_RX, nhận cả 5 byte echo + 25 byte ECU)
        │
        ▼
[STM32F103C8T6 (72 MHz HSE PLL)]  -- firmware/stm32-legacy/Core/Src/main.c
  ├── USART2 (PA2/PA3, 115200 bps 8N1) ──► "Data khac: <HEX>\r\n"
  └── RX2 Command Parser ◄── "WAKEUP\r\n" (chỉ hỗ trợ WAKEUP ở bản tối giản hiện tại)
        │
        ├──► [USB-TTL CH340 / CP2102] ──► PC Windows (`dashboard.py`, `test_stream.py`)
        ├──► [USB OTG Host Android]   ──► `UsbSerialManager.java` -> `BtBridge.java`
        └──► [Bluetooth SPP / BLE]    ──► `BtBridge.java` -> WebView `window.__onBtFrame(line)`
                                                │
                                                ▼
                                     [Android WebUI (`assets/www/app.js`)]
```

## 2. Giao Thức Keihin & Giải Mã Table `0x11`

- **Chuỗi khởi tạo:** Fast-Init (`PA9` LOW `70 ms`, HIGH `120 ms`) $\rightarrow$ `FE 04 72 8C` (Wakeup, kỳ vọng `0E 04 72 7C`) $\rightarrow$ `72 05 00 F0 99` (Init, kỳ vọng `02 04 00 FA`) $\rightarrow$ poll `72 05 71 11 07` (`< 2000 ms` giữa các gói).
- **Khung chuẩn ECU:** Bắt đầu bằng `0x02`, độ dài `len = ecu[1]`, checksum `(sum(ecu[0..len-1]) & 0xFF) == 0`.
- **Table `0x11` (`25` byte, `02 19 71 11 ...`):**
  - `ecu[4..5]`: `RPM = (ecu[4] << 8) | ecu[5]`
  - `ecu[6]`, `ecu[7]`: `TPS_V = ecu[6] * 5.0 / 256.0`, `TPS% = min(ecu[7] / 1.56, 100.0)`
  - `ecu[8]`, `ecu[9]`: `ECT_V = ecu[8] * 5.0 / 256.0`, `ECT_C = ecu[9] - 40`
  - `ecu[10]`, `ecu[11]`: `IAT_V = ecu[10] * 5.0 / 256.0`, `IAT_C = ecu[11] - 40`
  - `ecu[12]`, `ecu[13]`: `MAP_V = ecu[12] * 5.0 / 256.0`, `MAP = ecu[13]` kPa
  - `ecu[16]`: `VBAT = ecu[16] / 10.0` V
  - `ecu[17]`: `VSS = ecu[17]` km/h
  - `ecu[18..19]`: `INJ_ms = ((ecu[18] << 8) | ecu[19]) * 0.00390625`, `Duty% = min((RPM * INJ_ms) / 1200.0, 100.0)`
  - `ecu[20]`: `IGN = (ecu[20] - 128) * 0.5` ° BTDC
  - `ecu[21]`: `IACV = ecu[21]` steps
  - `ecu[23]`: `O2_V = ecu[23] / 256.0` V

## 3. Thuật Toán Cấp Số Ảo (Virtual Gear Estimator)

- Đứng yên hoặc tắt máy: `RPM < 350` $\rightarrow$ `--`; `VSS < 2` $\rightarrow$ `N`.
- Đang chạy: tính tỷ số $R = \text{RPM} / \text{VSS}$, so với bảng `GEAR_PRESETS` (`winner150`, `wave110`, `exciter150`, dung sai `±10%`).
- Chống nhảy số khi cắt côn: yêu cầu khớp liên tiếp `3` khung (`gear_confidence >= 3`), mất khớp quá `600 ms` mới về `--`.

## 4. Khoảng Cách Hiện Tại Giữa Host UI & Firmware

- `dashboard.py` và `app.js` hỗ trợ giải mã Table `0x00` (ECM ID), `0x73`/`0x74` (DTC), Service `0x60` (Clear DTC), và gửi các lệnh `READ_ECMID`, `READ_DTC`, `CLEAR_DTC`, `REQ_TABLE:XX`, `SCS_ON/OFF`.
- Tuy nhiên `firmware/stm32-legacy/Core/Src/main.c` hiện đang ở bản tối giản chỉ xử lý `WAKEUP` và Table `0x11` để đảm bảo không treo khi bấm đề nổ máy.
