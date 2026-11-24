import serial
import serial.tools.list_ports
import time

def find_stm32_port():
    """Tự động tìm kiếm các cổng COM đang khả dụng"""
    ports = serial.tools.list_ports.comports()
    for port in ports:
        print(f"Tim thay cong: {port.device} - {port.description}")
    
    if len(ports) == 0:
        print("Khong tim thay cong COM nao. Vui long kiem tra lai ket noi!")
        return None
        
    # Ưu tiên chọn cổng USB/CH340 (thường là mạch nạp hoặc mạch chuyển đổi USB-UART)
    for port in ports:
        if "CH340" in port.description or "USB" in port.description:
            print(f"-> Tu dong chon cong: {port.device}")
            return port.device
            
    # Nếu không thấy USB, mới lấy cổng đầu tiên
    return ports[0].device

def parse_and_display_rpm(hex_str):
    """Phân tích chuỗi Hex và tính toán RPM"""
    try:
        # Xóa khoảng trắng 2 đầu và tách các byte
        hex_list = hex_str.strip().split()
        
        # Chuyển đổi sang mảng số nguyên
        data = [int(h, 16) for h in hex_list if h]
        
        # Kiểm tra xem đây có phải là gói tin trả về của Table 11 không
        # Header = 02, Query = 71, Table = 11
        if len(data) >= 12 and data[0] == 0x02 and data[2] == 0x71 and data[3] == 0x11:
            # Trong chuẩn Keihin, RPM thường nằm ở byte số 9 và 10 (tính từ 0)
            # Tùy dòng xe có thể dịch đi 1-2 byte, bạn có thể tự tinh chỉnh ở đây
            rpm_high = data[9]
            rpm_low = data[10]
            
            rpm = (rpm_high * 256) + rpm_low
            
            print(f"[Table 11] Raw: {' '.join(hex_list)}")
            print(f"👉 VONG TUA (RPM): {rpm} v/p\n")
            
        elif len(data) > 0:
            # Nếu không phải Table 11 (Ví dụ: thông báo Init), cứ in ra bình thường
            print(f"Data khac: {hex_str.strip()}")
            
    except Exception as e:
        print(f"Loi parse data: {e} - Raw: {hex_str}")

def main():
    print("=== TOOL TEST RPM HONDA KEIHIN ===")
    port_name = find_stm32_port()
    
    if not port_name:
        return
        
    # Cấu hình baudrate bằng 115200 (Khớp với cấu hình USART2 của STM32)
    baudrate = 115200 
    
    try:
        # Kết nối tới cổng COM
        ser = serial.Serial(port_name, baudrate, timeout=1)
        print(f"Da ket noi thanh cong vao {port_name} tai baudrate {baudrate}!\n")
        print("Dang cho du lieu tu STM32...")
        
        while True:
            # Đọc từng dòng từ Serial (STM32 kết thúc dòng bằng \r\n)
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore')
                if line:
                    # Bỏ qua các dòng chỉ chứa \r\n
                    if line.strip() == "":
                        continue
                        
                    # Nếu là dòng chữ bình thường (Log quá trình Init)
                    if "Dang danh thuc" in line or "Gui ma" in line or "Hoan tat" in line:
                        print(f"STM32 Log: {line.strip()}")
                    else:
                        # Phân tích dữ liệu Hex
                        parse_and_display_rpm(line)
                        
    except serial.SerialException as e:
        print(f"\n[Loi] Khong the mo cong Serial {port_name}. Vui long kiem tra lai!")
        print("Loi chi tiet:", e)
    except KeyboardInterrupt:
        print("\nDa dung chuong trinh.")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()
            print("Da dong cong Serial.")

if __name__ == '__main__':
    main()
