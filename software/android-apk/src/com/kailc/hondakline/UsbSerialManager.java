package com.kailc.hondakline;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;

public class UsbSerialManager {
    public static final String ACTION_USB_PERMISSION = "com.kailc.hondakline.USB_PERMISSION";

    public interface DataListener {
        void onDataReceived(byte[] data, int len);
        void onStatusChanged(String state, String message);
    }

    private final Context context;
    private final UsbManager usbManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private DataListener listener;

    private UsbDevice currentDevice;
    private UsbDeviceConnection connection;
    private UsbInterface claimedInterface;
    private UsbEndpoint endpointIn;
    private UsbEndpoint endpointOut;

    private volatile boolean isRunning = false;
    private Thread readThread;
    private volatile long rxBytesTotal = 0;
    private volatile long rxPacketsTotal = 0;
    private volatile String lastRxPreview = "--";
    private volatile String lastErrorMsg = "";

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                synchronized (this) {
                    UsbDevice device = (Build.VERSION.SDK_INT >= 33)
                        ? intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class)
                        : intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    if (device == null) {
                        device = currentDevice;
                    }
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                        if (device != null) {
                            openDevice(device);
                        } else {
                            notifyStatus("error", "Không xác định được thiết bị USB sau khi cấp quyền");
                        }
                    } else {
                        notifyStatus("error", "Người dùng từ chối quyền truy cập cổng USB");
                    }
                }
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                UsbDevice device = (Build.VERSION.SDK_INT >= 33)
                    ? intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class)
                    : intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null) {
                    notifyStatus("connecting", "Phát hiện module USB-to-TTL (" + getChipName(device) + ")");
                    requestPermissionAndConnect(device);
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                UsbDevice device = (Build.VERSION.SDK_INT >= 33)
                    ? intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class)
                    : intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null && currentDevice != null && device.getDeviceId() == currentDevice.getDeviceId()) {
                    closeConnection();
                    notifyStatus("disconnected", "Đã rút cáp USB OTG");
                }
            }
        }
    };

    public UsbSerialManager(Context context, DataListener listener) {
        this.context = context;
        this.listener = listener;
        this.usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);

        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(usbReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            context.registerReceiver(usbReceiver, filter);
        }
    }

    private void notifyStatus(String state, String message) {
        if ("error".equals(state)) {
            lastErrorMsg = message;
        } else if ("connected".equals(state)) {
            lastErrorMsg = "";
        }
        mainHandler.post(() -> {
            if (listener != null) {
                listener.onStatusChanged(state, message);
            }
        });
    }

    public static String getChipName(UsbDevice d) {
        if (d == null) return "USB Device";
        int vid = d.getVendorId();
        if (vid == 0x1A86 || vid == 0x4348) return "CH340/CH341";
        if (vid == 0x10C4) return "CP2102/CP210x";
        if (vid == 0x0403) return "FTDI FT232R";
        if (vid == 0x067B) return "PL2303";
        if (vid == 0x0483) return "STM32 VCP (CDC)";
        if (vid == 0x303A) return "ESP32 USB (CDC)";
        if (d.getDeviceClass() == UsbConstants.USB_CLASS_COMM) return "CDC-ACM";
        return "USB UART (" + String.format("0x%04X:0x%04X", vid, d.getProductId()) + ")";
    }

    public JSONArray getConnectedDevicesJson() {
        JSONArray arr = new JSONArray();
        if (usbManager == null) return arr;
        HashMap<String, UsbDevice> map = usbManager.getDeviceList();
        if (map != null) {
            for (UsbDevice d : map.values()) {
                try {
                    JSONObject obj = new JSONObject();
                    obj.put("deviceId", d.getDeviceId());
                    obj.put("deviceName", d.getDeviceName());
                    obj.put("chipName", getChipName(d));
                    obj.put("vendorId", d.getVendorId());
                    obj.put("productId", d.getProductId());
                    obj.put("hasPermission", usbManager.hasPermission(d));
                    arr.put(obj);
                } catch (Exception ignored) {}
            }
        }
        return arr;
    }

    public JSONObject getDebugJson() {
        JSONObject obj = new JSONObject();
        try {
            boolean hasDev = currentDevice != null;
            if (!hasDev && usbManager != null) {
                HashMap<String, UsbDevice> map = usbManager.getDeviceList();
                if (map != null && !map.isEmpty()) {
                    for (UsbDevice d : map.values()) {
                        currentDevice = d;
                        hasDev = true;
                        break;
                    }
                }
            }
            obj.put("hasDevice", hasDev);
            if (hasDev && currentDevice != null) {
                obj.put("chipName", getChipName(currentDevice));
                obj.put("vid", String.format("0x%04X", currentDevice.getVendorId()));
                obj.put("pid", String.format("0x%04X", currentDevice.getProductId()));
                obj.put("hasPermission", usbManager != null && usbManager.hasPermission(currentDevice));
            } else {
                obj.put("chipName", "Chưa cắm USB OTG");
                obj.put("vid", "--");
                obj.put("pid", "--");
                obj.put("hasPermission", false);
            }
            obj.put("isConnected", isConnected());
            obj.put("hasEpOut", endpointOut != null);
            obj.put("rxBytes", rxBytesTotal);
            obj.put("rxPackets", rxPacketsTotal);
            obj.put("lastRxPreview", lastRxPreview != null ? lastRxPreview : "--");
            obj.put("lastError", lastErrorMsg != null ? lastErrorMsg : "");
        } catch (Exception ignored) {}
        return obj;
    }

    public void requestPermissionAndConnect(UsbDevice device) {
        if (device == null || usbManager == null) return;
        currentDevice = device;
        if (usbManager.hasPermission(device)) {
            openDevice(device);
        } else {
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            Intent permIntent = new Intent(ACTION_USB_PERMISSION);
            permIntent.setPackage(context.getPackageName());
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, permIntent, flags);
            usbManager.requestPermission(device, pi);
        }
    }

    public void connectFirstAvailable() {
        if (usbManager == null) {
            notifyStatus("error", "Thiết bị không hỗ trợ USB Host OTG");
            return;
        }
        HashMap<String, UsbDevice> map = usbManager.getDeviceList();
        if (map == null || map.isEmpty()) {
            notifyStatus("error", "Chưa cắm cáp USB-to-TTL OTG vào điện thoại");
            return;
        }
        UsbDevice target = null;
        for (UsbDevice d : map.values()) {
            target = d;
            break;
        }
        if (target != null) {
            requestPermissionAndConnect(target);
        }
    }

    public synchronized void openDevice(UsbDevice device) {
        closeConnection();
        if (device == null || usbManager == null) return;
        currentDevice = device;

        if (!usbManager.hasPermission(device)) {
            requestPermissionAndConnect(device);
            return;
        }

        UsbDeviceConnection conn = usbManager.openDevice(device);
        if (conn == null) {
            notifyStatus("error", "Không thể mở kết nối USB (Thử rút cáp cắm lại)");
            return;
        }
        this.connection = conn;

        // Claim all interfaces on device to ensure full access
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            try {
                conn.claimInterface(device.getInterface(i), true);
            } catch (Exception ignored) {}
        }

        // Find bulk endpoints
        UsbInterface intf = null;
        UsbEndpoint epIn = null;
        UsbEndpoint epOut = null;

        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface ci = device.getInterface(i);
            UsbEndpoint inCand = null;
            UsbEndpoint outCand = null;
            for (int j = 0; j < ci.getEndpointCount(); j++) {
                UsbEndpoint ep = ci.getEndpoint(j);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) {
                        inCand = ep;
                    } else if (ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                        outCand = ep;
                    }
                }
            }
            if (inCand != null) {
                intf = ci;
                epIn = inCand;
                epOut = outCand;
                break;
            }
        }

        if (intf == null || epIn == null) {
            conn.close();
            this.connection = null;
            notifyStatus("error", "Không tìm thấy cổng truyền nhận dữ liệu Bulk USB");
            return;
        }

        this.claimedInterface = intf;
        this.endpointIn = epIn;
        this.endpointOut = epOut;
        this.rxBytesTotal = 0;
        this.rxPacketsTotal = 0;
        this.lastRxPreview = "--";

        // Initialize chip parameters at 115200 8N1
        boolean initOk = configureChip(conn, device);
        if (!initOk) {
            notifyStatus("error", "Lỗi cấu hình baudrate 115200 cho chip " + getChipName(device));
            closeConnection();
            return;
        }

        isRunning = true;
        readThread = new Thread(this::readLoop, "UsbSerialReader");
        readThread.start();

        String chip = getChipName(device);
        notifyStatus("connected", "Đã kết nối USB OTG · " + chip + " (115200 8N1)");

        // Flush serial buffer briefly, then only trigger WAKEUP if STM32 isn't already streaming
        mainHandler.postDelayed(() -> {
            if (isRunning && isConnected()) write("\r\n".getBytes(StandardCharsets.US_ASCII));
        }, 150);
        mainHandler.postDelayed(() -> {
            if (isRunning && isConnected() && rxBytesTotal == 0) {
                write("WAKEUP\r\n".getBytes(StandardCharsets.US_ASCII));
            }
        }, 1000);
    }

    public synchronized void sendWakeup() {
        write("\r\nWAKEUP\r\n".getBytes());
    }

    public long getRxBytesTotal() {
        return rxBytesTotal;
    }

    public long getRxPacketsTotal() {
        return rxPacketsTotal;
    }

    public boolean isConnected() {
        return isRunning && connection != null;
    }

    private boolean configureChip(UsbDeviceConnection conn, UsbDevice dev) {
        int vid = dev.getVendorId();
        try {
            if (vid == 0x1A86 || vid == 0x4348) {
                // CH340 / CH341 Standard Linux/Android driver handshake matching mik3y / kernel
                byte[] buf = new byte[2];
                // 1. Check version / wake up
                conn.controlTransfer(0xC0, 0x5F, 0, 0, buf, 2, 1000);
                // 2. Serial init request
                conn.controlTransfer(0x40, 0xA1, 0, 0, null, 0, 1000);
                // 3. Set baud rate 115200 (val1 = 0xCC83, val2 = 0x0008)
                conn.controlTransfer(0x40, 0x9A, 0x1312, 0xCC83, null, 0, 1000);
                conn.controlTransfer(0x40, 0x9A, 0x0F2C, 0x0008, null, 0, 1000);
                // 4. Read checkState 0x2518
                conn.controlTransfer(0xC0, 0x95, 0x2518, 0, buf, 2, 1000);
                // 5. Line control: RX enable (0x80) | TX enable (0x40) | 8N1 (0x03) = 0x00C3
                conn.controlTransfer(0x40, 0x9A, 0x2518, 0x00C3, null, 0, 1000);
                // 6. Read checkState 0x0706
                conn.controlTransfer(0xC0, 0x95, 0x0706, 0, buf, 2, 1000);
                // 7. Release internal line reset
                conn.controlTransfer(0x40, 0xA1, 0x501F, 0xD90A, null, 0, 1000);
                // 8. Re-apply baud rate 115200
                conn.controlTransfer(0x40, 0x9A, 0x1312, 0xCC83, null, 0, 1000);
                conn.controlTransfer(0x40, 0x9A, 0x0F2C, 0x0008, null, 0, 1000);
                // 9. Modem control: pulse DTR/RTS then release to idle HIGH (0xFFFF) so reset pin is never held low
                conn.controlTransfer(0x40, 0xA4, 0xFF9F, 0, null, 0, 1000);
                try { Thread.sleep(80); } catch (Exception ignored) {}
                conn.controlTransfer(0x40, 0xA4, 0xFFFF, 0, null, 0, 1000); // released to idle RUN state
                // 10. Final state check
                conn.controlTransfer(0xC0, 0x95, 0x0706, 0, buf, 2, 1000);
                return true;
            } else if (vid == 0x10C4) {
                // Silicon Labs CP2102 / CP210x
                conn.controlTransfer(0x41, 0x00, 0x0001, 0, null, 0, 1000); // IFC_ENABLE
                // Baud 115200 = 0x0001C200 (Little Endian: 00 C2 01 00)
                byte[] baudData = new byte[] { (byte)0x00, (byte)0xC2, (byte)0x01, (byte)0x00 };
                conn.controlTransfer(0x41, 0x1E, 0, 0, baudData, 4, 1000);
                // 8 data bits, 1 stop bit, no parity (0x0800)
                conn.controlTransfer(0x41, 0x03, 0x0800, 0, null, 0, 1000);
                conn.controlTransfer(0x41, 0x07, 0x0303, 0, null, 0, 1000); // DTR/RTS
                return true;
            } else if (vid == 0x0403) {
                // FTDI FT232R
                conn.controlTransfer(0x40, 0, 0, 0, null, 0, 1000); // Reset
                conn.controlTransfer(0x40, 3, 0x001A, 0, null, 0, 1000); // 115200
                conn.controlTransfer(0x40, 4, 0x0008, 0, null, 0, 1000); // 8N1
                conn.controlTransfer(0x40, 1, 0x0303, 0, null, 0, 1000); // DTR/RTS
                return true;
            } else if (vid == 0x067B) {
                // Prolific PL2303
                conn.controlTransfer(0x40, 1, 0, 0, null, 0, 1000);
                byte[] lineCoding = new byte[] { (byte)0x00, (byte)0xC2, (byte)0x01, (byte)0x00, 0x00, 0x00, 0x08 };
                conn.controlTransfer(0x21, 0x20, 0, 0, lineCoding, 7, 1000);
                conn.controlTransfer(0x21, 0x22, 0x03, 0, null, 0, 1000);
                return true;
            } else {
                // CDC-ACM generic line coding: 115200 8N1
                byte[] lineCoding = new byte[] { (byte)0x00, (byte)0xC2, (byte)0x01, (byte)0x00, 0x00, 0x00, 0x08 };
                conn.controlTransfer(0x21, 0x20, 0, 0, lineCoding, 7, 1000);
                conn.controlTransfer(0x21, 0x22, 0x03, 0, null, 0, 1000);
                return true;
            }
        } catch (Exception e) {
            return false;
        }
    }

    private void readLoop() {
        byte[] buffer = new byte[1024];
        while (isRunning) {
            if (connection == null || endpointIn == null) break;
            int n = connection.bulkTransfer(endpointIn, buffer, buffer.length, 200);
            if (n > 0) {
                rxBytesTotal += n;
                rxPacketsTotal++;
                lastRxPreview = new String(buffer, 0, Math.min(n, 120), StandardCharsets.US_ASCII)
                    .replaceAll("[\\r\\n]+", " ");
                byte[] copy = new byte[n];
                System.arraycopy(buffer, 0, copy, 0, n);
                if (listener != null) {
                    listener.onDataReceived(copy, n);
                }
            } else if (n < 0 && isRunning) {
                try {
                    Thread.sleep(10);
                } catch (InterruptedException ignored) {
                    break;
                }
            }
        }
    }

    public synchronized void write(byte[] data) {
        if (connection == null || endpointOut == null || data == null || data.length == 0) return;
        new Thread(() -> {
            try {
                connection.bulkTransfer(endpointOut, data, data.length, 500);
            } catch (Exception ignored) {}
        }).start();
    }

    public synchronized void closeConnection() {
        isRunning = false;
        if (readThread != null) {
            readThread.interrupt();
            readThread = null;
        }
        if (connection != null) {
            if (claimedInterface != null) {
                try {
                    connection.releaseInterface(claimedInterface);
                } catch (Exception ignored) {}
                claimedInterface = null;
            }
            try {
                connection.close();
            } catch (Exception ignored) {}
            connection = null;
        }
        endpointIn = null;
        endpointOut = null;
    }

    public void destroy() {
        closeConnection();
        try {
            context.unregisterReceiver(usbReceiver);
        } catch (Exception ignored) {}
    }
}
