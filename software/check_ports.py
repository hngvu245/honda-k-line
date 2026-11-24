import serial.tools.list_ports

ports = serial.tools.list_ports.comports()
print("Found ports:", len(ports))
for p in ports:
    print(f"Port: {p.device}, Description: {p.description}, HWID: {p.hwid}")
