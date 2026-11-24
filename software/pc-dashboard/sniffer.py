import serial
import serial.tools.list_ports
import time

def find_ch340():
    ports = serial.tools.list_ports.comports()
    for p in ports:
        if "CH340" in p.description or "USB" in p.description:
            return p.device
    return "COM8"

def run_sniffer():
    port = find_ch340()
    print(f"=== K-LINE RAW PACKET SNIFFER (115200 bps) ===")
    print(f"Ket noi toi cong: {port}")
    try:
        ser = serial.Serial(port, 115200, timeout=0.1)
        print("Da mo cong. Hay bam nut RESET tren STM32 hoac vặn chìa khoa xe...\n")
        
        while True:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                t_stamp = time.strftime("%H:%M:%S")
                print(f"[{t_stamp}] {line}")
    except KeyboardInterrupt:
        print("\nDa dung sniffer.")
        ser.close()
    except Exception as e:
        print(f"Loi: {e}")

if __name__ == "__main__":
    run_sniffer()
