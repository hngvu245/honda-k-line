"""
Standalone Console Telemetry Monitor for Honda K-Line (No GUI overhead).
Use this to verify STM32 firmware on bike before opening dashboard.py.
"""
import sys
import time
import serial
import serial.tools.list_ports as lp

def find_ch340_port():
    for p in lp.comports():
        if "1A86:7523" in p.hwid or "CH340" in p.description:
            return p.device
    return None

def main():
    port = sys.argv[1] if len(sys.argv) > 1 else find_ch340_port()
    if not port:
        print("ERROR: Khong tim thay cong CH340! Hay kiem tra cap USB.")
        sys.exit(1)

    print(f"--- Dang mo cong {port} (115200 bps) ---")
    print("Nhan Ctrl+C de dung.")
    try:
        ser = serial.Serial(port, 115200, timeout=1.0)
    except Exception as e:
        print(f"ERROR: Khong mo duoc {port}: {e}")
        sys.exit(1)

    t0 = time.time()
    pkt_count = 0
    t11_count = 0
    err_count = 0

    try:
        while True:
            line_bytes = ser.readline()
            if not line_bytes:
                continue
            line = line_bytes.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            now = time.time() - t0
            pkt_count += 1

            if "MCU_BOOT" in line or "Dang danh thuc" in line or "Tu dong ket noi" in line:
                print(f"[{now:06.2f}s] [TRANG THAI] {line}")
                continue

            if "Data khac:" in line:
                raw_hex = line.replace("Data khac:", "").strip()
                tokens = raw_hex.split()
                if len(tokens) >= 4:
                    try:
                        bytes_val = [int(x, 16) for x in tokens]
                    except ValueError:
                        print(f"[{now:06.2f}s] [HEX ERROR] {line}")
                        continue

                    # Find 0x02 header
                    idx = -1
                    for i in range(len(bytes_val) - 3):
                        if bytes_val[i] == 0x02:
                            flen = bytes_val[i+1]
                            if i + flen <= len(bytes_val) and (sum(bytes_val[i:i+flen]) & 0xFF) == 0:
                                idx = i
                                break

                    if idx != -1:
                        ecu = bytes_val[idx:idx+bytes_val[idx+1]]
                        if ecu[2] == 0x71 and ecu[3] == 0x11 and len(ecu) == 25:
                            t11_count += 1
                            rpm = (ecu[4] << 8) | ecu[5]
                            tps = ecu[7] / 1.56
                            ect = ecu[9] - 40
                            vbat = ecu[16] / 10.0
                            hz = t11_count / now if now > 0 else 0
                            print(f"[{now:06.2f}s] T11 OK #{t11_count:04d} | {hz:4.1f} Hz | RPM: {rpm:5d} | TPS: {tps:4.1f}% | ECT: {ect:3d}C | VBAT: {vbat:4.1f}V")
                        else:
                            print(f"[{now:06.2f}s] ECU TABLE 0x{ecu[3]:02X} OK: {raw_hex}")
                    else:
                        err_count += 1
                        print(f"[{now:06.2f}s] [RAW CSUM ERR #{err_count}] {line}")
                else:
                    print(f"[{now:06.2f}s] [NGAN] {line}")
            else:
                print(f"[{now:06.2f}s] {line}")

    except KeyboardInterrupt:
        print("\n--- Dung bo doc ---")
    finally:
        ser.close()

if __name__ == "__main__":
    main()
