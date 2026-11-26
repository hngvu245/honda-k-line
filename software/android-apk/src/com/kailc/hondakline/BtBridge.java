package com.kailc.hondakline;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public class BtBridge {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    // Common BLE UART UUIDs (HM-10/JDY-23/AT-09 + Nordic NUS)
    private static final UUID HM10_CHAR = UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb");
    private static final UUID NUS_RX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID NUS_TX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");

    private final MainActivity activity;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final BluetoothAdapter adapter;

    private volatile boolean sppRunning = false;
    private volatile long connectSessionId = 0;
    private volatile String activeTransport = "NONE";
    private final ArrayDeque<String> debugLogs = new ArrayDeque<>();
    private BluetoothSocket sppSocket;
    private OutputStream sppOut;
    private Thread sppThread;

    private BluetoothLeScanner bleScanner;
    private ScanCallback bleScanCallback;
    private final Set<String> seenBleMacs = new HashSet<>();
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic bleWriteChar;

    private final ByteArrayOutputStream rxStreamBuf = new ByteArrayOutputStream();
    private final UsbSerialManager usbSerialManager;

    public BtBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        BluetoothManager bm = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        this.adapter = (bm != null) ? bm.getAdapter() : BluetoothAdapter.getDefaultAdapter();

        this.usbSerialManager = new UsbSerialManager(activity, new UsbSerialManager.DataListener() {
            @Override
            public void onDataReceived(byte[] data, int len) {
                processIncomingBytes(data, len);
            }

            @Override
            public void onStatusChanged(String state, String message) {
                emitStatus(state, message);
            }
        });
    }

    private void evalJs(String script) {
        mainHandler.post(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private void emitStatus(String state, String message) {
        logDebug("NATIVE_" + String.valueOf(state).toUpperCase(Locale.US), String.valueOf(message));
        evalJs("window.__onBtStatus && window.__onBtStatus("
            + JSONObject.quote(state) + ", " + JSONObject.quote(message) + ");");
    }

    @JavascriptInterface
    public void logDebug(String level, String message) {
        String ts = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        String line = "[" + ts + "] [" + (level != null ? level : "INFO") + "] " + (message != null ? message : "");
        synchronized (debugLogs) {
            debugLogs.addLast(line);
            while (debugLogs.size() > 160) {
                debugLogs.removeFirst();
            }
        }
    }

    @JavascriptInterface
    public String getAppDebugLogs() {
        synchronized (debugLogs) {
            StringBuilder sb = new StringBuilder();
            for (String s : debugLogs) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(s);
            }
            return sb.toString();
        }
    }

    @JavascriptInterface
    public boolean hasPermissions() {
        return activity.hasBtPermissions();
    }

    @JavascriptInterface
    public void requestBtPermissions() {
        mainHandler.post(activity::requestBtPermissions);
    }

    @JavascriptInterface
    public boolean isBluetoothEnabled() {
        return adapter != null && adapter.isEnabled();
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public void getPairedAndScan() {
        if (adapter == null) {
            emitStatus("error", "Thiết bị không hỗ trợ Bluetooth");
            return;
        }
        if (!activity.hasBtPermissions()) {
            requestBtPermissions();
            return;
        }
        if (!adapter.isEnabled()) {
            emitStatus("error", "Vui lòng bật Bluetooth trên điện thoại");
            return;
        }

        // 1. Paired Classic devices (HC-05, HC-06, JDY-31)
        JSONArray paired = new JSONArray();
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    JSONObject obj = new JSONObject();
                    obj.put("name", d.getName() != null ? d.getName() : "Unknown Device");
                    obj.put("mac", d.getAddress());
                    obj.put("type", "spp");
                    paired.put(obj);
                }
            }
        } catch (Exception e) {
            emitStatus("error", "Không đọc được danh sách thiết bị đã ghép nối: " + e.getMessage());
        }
        evalJs("window.__onPairedDevices && window.__onPairedDevices(" + JSONObject.quote(paired.toString()) + ");");

        // 2. Scan BLE devices (HM-10, JDY-23, ESP32) for 6 seconds
        stopBleScan();
        seenBleMacs.clear();
        bleScanner = adapter.getBluetoothLeScanner();
        if (bleScanner != null) {
            bleScanCallback = new ScanCallback() {
                @Override
                public void onScanResult(int callbackType, ScanResult result) {
                    try {
                        BluetoothDevice dev = result.getDevice();
                        if (dev == null) return;
                        String mac = dev.getAddress();
                        if (seenBleMacs.contains(mac)) return;
                        String name = dev.getName();
                        if (name == null || name.isEmpty()) {
                            if (result.getScanRecord() != null && result.getScanRecord().getDeviceName() != null) {
                                name = result.getScanRecord().getDeviceName();
                            } else {
                                return; // skip unnamed beacons to keep list minimalist & clean
                            }
                        }
                        seenBleMacs.add(mac);
                        JSONObject obj = new JSONObject();
                        obj.put("name", name);
                        obj.put("mac", mac);
                        obj.put("rssi", result.getRssi());
                        obj.put("type", "ble");
                        evalJs("window.__onBleDeviceFound && window.__onBleDeviceFound(" + JSONObject.quote(obj.toString()) + ");");
                    } catch (Exception ignored) {}
                }
            };
            try {
                bleScanner.startScan(bleScanCallback);
                mainHandler.postDelayed(this::stopBleScan, 6000);
            } catch (Exception ignored) {}
        }
    }

    @SuppressLint("MissingPermission")
    private void stopBleScan() {
        if (bleScanner != null && bleScanCallback != null) {
            try {
                bleScanner.stopScan(bleScanCallback);
            } catch (Exception ignored) {}
            bleScanCallback = null;
        }
        evalJs("window.__onBleScanDone && window.__onBleScanDone();");
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public void connectSpp(String mac) {
        if (!activity.hasBtPermissions()) {
            requestBtPermissions();
            return;
        }
        disconnect();
        stopBleScan();
        final long mySession = ++connectSessionId;
        activeTransport = "SPP";
        emitStatus("connecting", "Đang kết nối SPP " + mac + "...");

        sppRunning = true;
        sppThread = new Thread(() -> {
            BluetoothSocket sock = null;
            try {
                try { adapter.cancelDiscovery(); } catch (Exception ignored) {}
                BluetoothDevice dev = adapter.getRemoteDevice(mac);
                try {
                    sock = dev.createRfcommSocketToServiceRecord(SPP_UUID);
                    sock.connect();
                } catch (Exception primaryEx) {
                    try { if (sock != null) sock.close(); } catch (Exception ignored) {}
                    sock = dev.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    sock.connect();
                }

                if (connectSessionId != mySession) {
                    try { sock.close(); } catch (Exception ignored) {}
                    return;
                }

                sppSocket = sock;
                sppOut = sock.getOutputStream();
                InputStream in = sock.getInputStream();

                synchronized (rxStreamBuf) {
                    rxStreamBuf.reset();
                }
                emitStatus("connected", "Đã kết nối SPP · " + (dev.getName() != null ? dev.getName() : mac));
                try {
                    sppOut.write("WAKEUP\r\n".getBytes(StandardCharsets.US_ASCII));
                    sppOut.flush();
                } catch (Exception ignored) {}

                byte[] buf = new byte[512];
                while (sppRunning && connectSessionId == mySession) {
                    int n = in.read(buf);
                    if (n < 0) break;
                    if (n > 0) {
                        processIncomingBytes(buf, n);
                    }
                }
            } catch (Exception e) {
                if (sppRunning && connectSessionId == mySession) {
                    emitStatus("error", "Mất kết nối SPP: " + e.getMessage());
                }
            } finally {
                sppRunning = false;
                try { if (sock != null) sock.close(); } catch (Exception ignored) {}
                if (connectSessionId == mySession) {
                    sppSocket = null;
                    sppOut = null;
                    if ("SPP".equals(activeTransport)) activeTransport = "NONE";
                    emitStatus("disconnected", "Đã ngắt kết nối SPP");
                }
            }
        }, "BtSppReader");
        sppThread.start();
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public void connectBle(String mac) {
        if (!activity.hasBtPermissions()) {
            requestBtPermissions();
            return;
        }
        disconnect();
        stopBleScan();
        final long mySession = ++connectSessionId;
        activeTransport = "BLE";
        emitStatus("connecting", "Đang kết nối BLE " + mac + "...");

        try {
            BluetoothDevice dev = adapter.getRemoteDevice(mac);
            synchronized (rxStreamBuf) {
                rxStreamBuf.reset();
            }
            gatt = dev.connectGatt(activity, false, new BluetoothGattCallback() {
                @Override
                public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
                    if (connectSessionId != mySession) return;
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        emitStatus("connecting", "Đang đồng bộ GATT...");
                        try { g.requestMtu(185); } catch (Exception ignored) {}
                        g.discoverServices();
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        bleWriteChar = null;
                        if ("BLE".equals(activeTransport)) activeTransport = "NONE";
                        emitStatus("disconnected", "Đã ngắt kết nối BLE");
                    }
                }

                @Override
                public void onServicesDiscovered(BluetoothGatt g, int status) {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        emitStatus("error", "Không tìm thấy dịch vụ BLE UART");
                        return;
                    }
                    BluetoothGattCharacteristic notifyChar = null;
                    BluetoothGattCharacteristic writeCand = null;

                    List<BluetoothGattService> services = g.getServices();
                    for (BluetoothGattService svc : services) {
                        for (BluetoothGattCharacteristic ch : svc.getCharacteristics()) {
                            UUID u = ch.getUuid();
                            int props = ch.getProperties();
                            if (HM10_CHAR.equals(u)) {
                                notifyChar = ch;
                                writeCand = ch;
                            } else if (NUS_TX.equals(u)) {
                                notifyChar = ch;
                            } else if (NUS_RX.equals(u)) {
                                writeCand = ch;
                            } else {
                                if (notifyChar == null && (props & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0) {
                                    // Skip standard Generic Access/Attribute services (0x1800, 0x1801)
                                    String svcUuid = svc.getUuid().toString().toLowerCase();
                                    if (!svcUuid.startsWith("00001800") && !svcUuid.startsWith("00001801")) {
                                        notifyChar = ch;
                                    }
                                }
                                if (writeCand == null && (props & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0) {
                                    String svcUuid = svc.getUuid().toString().toLowerCase();
                                    if (!svcUuid.startsWith("00001800") && !svcUuid.startsWith("00001801")) {
                                        writeCand = ch;
                                    }
                                }
                            }
                        }
                    }

                    bleWriteChar = writeCand;
                    if (notifyChar != null) {
                        g.setCharacteristicNotification(notifyChar, true);
                        BluetoothGattDescriptor desc = notifyChar.getDescriptor(CCCD_UUID);
                        if (desc != null) {
                            writeDescriptorCompat(g, desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                        } else {
                            emitStatus("connected", "Đã kết nối BLE");
                            send("WAKEUP\r\n");
                        }
                    } else {
                        emitStatus("error", "Module BLE không có kênh UART Notify");
                    }
                }

                @Override
                public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
                    emitStatus("connected", "Đã kết nối BLE");
                    send("WAKEUP\r\n");
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch) {
                    byte[] val = ch.getValue();
                    if (val != null && val.length > 0) {
                        processIncomingBytes(val, val.length);
                    }
                }

                @Override
                public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic ch, byte[] value) {
                    if (value != null && value.length > 0) {
                        processIncomingBytes(value, value.length);
                    }
                }
            }, BluetoothDevice.TRANSPORT_LE);
        } catch (Exception e) {
            emitStatus("error", "Lỗi BLE: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private void writeDescriptorCompat(BluetoothGatt g, BluetoothGattDescriptor desc, byte[] val) {
        if (Build.VERSION.SDK_INT >= 33) {
            g.writeDescriptor(desc, val);
        } else {
            desc.setValue(val);
            g.writeDescriptor(desc);
        }
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    @JavascriptInterface
    public void send(String text) {
        if (text == null) return;
        byte[] payload = text.getBytes(StandardCharsets.US_ASCII);
        if ("USB".equals(activeTransport)) {
            if (usbSerialManager != null && usbSerialManager.isConnected()) {
                usbSerialManager.write(payload);
            }
            return;
        }
        if ("SPP".equals(activeTransport) && sppOut != null) {
            new Thread(() -> {
                try {
                    sppOut.write(payload);
                    sppOut.flush();
                } catch (Exception ignored) {}
            }).start();
            return;
        }
        if ("BLE".equals(activeTransport) && gatt != null && bleWriteChar != null) {
            try {
                int writeType = (bleWriteChar.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                if (Build.VERSION.SDK_INT >= 33) {
                    gatt.writeCharacteristic(bleWriteChar, payload, writeType);
                } else {
                    bleWriteChar.setWriteType(writeType);
                    bleWriteChar.setValue(payload);
                    gatt.writeCharacteristic(bleWriteChar);
                }
            } catch (Exception ignored) {}
        }
    }

    private void processIncomingBytes(byte[] chunk, int len) {
        synchronized (rxStreamBuf) {
            rxStreamBuf.write(chunk, 0, len);
            byte[] data = rxStreamBuf.toByteArray();

            // 1. Check for newline-delimited ASCII hex lines (matches STM32 UART2 output)
            int lastNewline = -1;
            int start = 0;
            for (int i = 0; i < data.length; i++) {
                if (data[i] == '\n') {
                    String line = new String(data, start, i - start, StandardCharsets.US_ASCII).trim();
                    if (!line.isEmpty()) {
                        emitFrame(line);
                    }
                    start = i + 1;
                    lastNewline = i;
                }
            }

            if (lastNewline >= 0) {
                rxStreamBuf.reset();
                if (start < data.length) {
                    rxStreamBuf.write(data, start, data.length - start);
                }
                data = rxStreamBuf.toByteArray();
            }

            // 2. Fallback: raw binary 25-byte Keihin Table 11 frame (0x02 0x19 0x71 0x11 ...)
            if (data.length >= 25) {
                for (int i = 0; i <= data.length - 25; i++) {
                    if ((data[i] & 0xFF) == 0x02
                        && (data[i + 1] & 0xFF) == 0x19
                        && (data[i + 2] & 0xFF) == 0x71
                        && (data[i + 3] & 0xFF) == 0x11) {
                        int sum = 0;
                        StringBuilder hex = new StringBuilder();
                        for (int j = 0; j < 25; j++) {
                            int v = data[i + j] & 0xFF;
                            sum += v;
                            if (j > 0) hex.append(' ');
                            if (v < 16) hex.append('0');
                            hex.append(Integer.toHexString(v).toUpperCase());
                        }
                        if ((sum & 0xFF) == 0) {
                            emitFrame(hex.toString());
                            int nextPos = i + 25;
                            rxStreamBuf.reset();
                            if (nextPos < data.length) {
                                rxStreamBuf.write(data, nextPos, data.length - nextPos);
                            }
                            break;
                        }
                    }
                }
            }

            // Prevent unbounded growth on noise
            if (rxStreamBuf.size() > 2048) {
                rxStreamBuf.reset();
            }
        }
    }

    private void emitFrame(String line) {
        evalJs("window.__onBtFrame && window.__onBtFrame(" + JSONObject.quote(line) + ");");
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    public void disconnect() {
        connectSessionId++;
        activeTransport = "NONE";
        sppRunning = false;
        if (sppSocket != null) {
            try { sppSocket.close(); } catch (Exception ignored) {}
            sppSocket = null;
        }
        sppOut = null;
        if (gatt != null) {
            try { gatt.disconnect(); gatt.close(); } catch (Exception ignored) {}
            gatt = null;
        }
        bleWriteChar = null;
        if (usbSerialManager != null) {
            usbSerialManager.closeConnection();
        }
    }

    @JavascriptInterface
    public void connectUsb() {
        disconnect();
        connectSessionId++;
        activeTransport = "USB";
        if (usbSerialManager != null) {
            usbSerialManager.connectFirstAvailable();
        }
    }

    public void connectUsbDevice(android.hardware.usb.UsbDevice device) {
        disconnect();
        connectSessionId++;
        activeTransport = "USB";
        if (usbSerialManager != null && device != null) {
            usbSerialManager.requestPermissionAndConnect(device);
        }
    }

    @JavascriptInterface
    public String getUsbDevices() {
        if (usbSerialManager != null) {
            return usbSerialManager.getConnectedDevicesJson().toString();
        }
        return "[]";
    }

    @JavascriptInterface
    public void disconnectUsb() {
        connectSessionId++;
        if ("USB".equals(activeTransport)) activeTransport = "NONE";
        if (usbSerialManager != null) {
            usbSerialManager.closeConnection();
        }
        emitStatus("disconnected", "Đã ngắt USB OTG");
    }

    @JavascriptInterface
    public void sendWakeup() {
        send("\r\nWAKEUP\r\n");
    }

    @JavascriptInterface
    public String getUsbStatus() {
        if (usbSerialManager != null) {
            return usbSerialManager.getDebugJson().toString();
        }
        return "{}";
    }

    @JavascriptInterface
    public String getUsbDebugInfo() {
        if (usbSerialManager != null) {
            return usbSerialManager.getDebugJson().toString();
        }
        return "{\"hasDevice\":false,\"isConnected\":false}";
    }

    private File getSessionDir() {
        File dir = activity.getExternalFilesDir(null);
        if (dir == null) {
            dir = activity.getFilesDir();
        }
        if (dir != null && !dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private String sanitizeFileName(String filename) {
        if (filename == null || filename.trim().isEmpty()) {
            return "kline_session.csv";
        }
        return filename.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    @JavascriptInterface
    public String saveSessionCsv(String filename, String csvContent) {
        try {
            File dir = getSessionDir();
            String safeName = sanitizeFileName(filename);
            File outFile = new File(dir, safeName);
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write((csvContent != null ? csvContent : "").getBytes(StandardCharsets.UTF_8));
            }
            String savedPath = outFile.getAbsolutePath();
            mainHandler.post(() -> Toast.makeText(activity, "Đã lưu file: " + safeName, Toast.LENGTH_SHORT).show());
            return savedPath;
        } catch (Exception e) {
            return "ERROR: " + e.getMessage();
        }
    }

    @JavascriptInterface
    public String listSessionFiles() {
        JSONArray arr = new JSONArray();
        try {
            File dir = getSessionDir();
            File[] files = (dir != null) ? dir.listFiles() : null;
            if (files == null) return "[]";
            Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (File f : files) {
                if (!f.isFile()) continue;
                String name = f.getName();
                String lower = name.toLowerCase(Locale.US);
                if (!lower.endsWith(".csv") && !lower.endsWith(".log") && !lower.endsWith(".txt")) continue;
                JSONObject obj = new JSONObject();
                obj.put("name", name);
                obj.put("sizeBytes", f.length());
                obj.put("modifiedMs", f.lastModified());
                obj.put("kind", lower.endsWith(".csv") ? "rec" : "log");
                arr.put(obj);
            }
        } catch (Exception e) {
            logDebug("FILE_LIST_ERR", e.getMessage());
        }
        return arr.toString();
    }

    @JavascriptInterface
    public String readSessionFile(String filename) {
        try {
            File dir = getSessionDir();
            String safeName = sanitizeFileName(filename);
            File target = new File(dir, safeName);
            if (!target.exists() || !target.isFile()) return "";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            try (FileInputStream fis = new FileInputStream(target)) {
                int n;
                while ((n = fis.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            logDebug("FILE_READ_ERR", e.getMessage());
            return "";
        }
    }

    @JavascriptInterface
    public boolean deleteSessionFile(String filename) {
        try {
            File dir = getSessionDir();
            String safeName = sanitizeFileName(filename);
            File target = new File(dir, safeName);
            return target.exists() && target.isFile() && target.delete();
        } catch (Exception e) {
            logDebug("FILE_DEL_ERR", e.getMessage());
            return false;
        }
    }

    @JavascriptInterface
    public String exportSessionToDownloads(String filename) {
        try {
            File dir = getSessionDir();
            String safeName = sanitizeFileName(filename);
            File src = new File(dir, safeName);
            if (!src.exists() || !src.isFile()) return "ERROR: Không tìm thấy file";
            String mime = safeName.toLowerCase(Locale.US).endsWith(".csv") ? "text/csv" : "text/plain";
            byte[] buf = new byte[4096];

            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = activity.getContentResolver();
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/HondaKline");
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return "ERROR: Không tạo được file trong Downloads";
                try (FileInputStream fis = new FileInputStream(src);
                     OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) return "ERROR: Không mở được luồng ghi Downloads";
                    int n;
                    while ((n = fis.read(buf)) > 0) {
                        os.write(buf, 0, n);
                    }
                }
            } else {
                File dlRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File dlDir = new File(dlRoot, "HondaKline");
                if (!dlDir.exists()) dlDir.mkdirs();
                File dst = new File(dlDir, safeName);
                try (FileInputStream fis = new FileInputStream(src);
                     FileOutputStream fos = new FileOutputStream(dst)) {
                    int n;
                    while ((n = fis.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                    }
                }
            }
            mainHandler.post(() -> Toast.makeText(activity, "Đã xuất Downloads/HondaKline/" + safeName, Toast.LENGTH_SHORT).show());
            return "Downloads/HondaKline/" + safeName;
        } catch (Exception e) {
            logDebug("EXPORT_ERR", e.getMessage());
            return "ERROR: " + e.getMessage();
        }
    }

    public void shutdown() {
        stopBleScan();
        disconnect();
        if (usbSerialManager != null) {
            usbSerialManager.destroy();
        }
    }
}
