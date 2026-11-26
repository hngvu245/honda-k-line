# Quy Trình Dev & Debug Nhanh (Không Cần Cài Lại APK Liên Tục)

Tài liệu này mô tả luồng làm việc **nhanh nhất** khi chỉnh sửa giao diện WebUI, kiểm thử thuật toán Tự Học Số và debug phần cứng Android trong `software/android-apk/`.

---

## 1. Test Logic & DOM tự động (< 1 giây)
Chạy mỗi khi sửa `index.html`, `app.css`, `app.js`, hoặc `kline_core.js`:

```powershell
node --check software/android-apk/assets/www/kline_core.js
node --check software/android-apk/assets/www/app.js
node software/android-apk/test_app.js
```

Bộ test tự kiểm tra:
- Không trùng `id` trong `index.html` (tránh lỗi ID ma trên UI).
- Mọi `$("id")` trong `app.js` đều tồn tại trong `index.html`.
- Độ ổn định của parser Table `0x11`, **Gear 1 Max-RPM Pull-Learn**, tự suy ra số `2..6`, chống nhiễu vận tốc thấp (`VSS <= 12`), và giữ số khi cắt côn (`clutch-in freeze`).

---

## 2. Preview & Debug Giao Diện Trực Tiếp Trên Trình Duyệt PC (`dev_server.py`)
Thay vì build + copy + cài lại APK cho mỗi lần sửa CSS/JS, chạy dev server ngay tại thư mục `software/android-apk/`:

```powershell
python software/android-apk/dev_server.py
```

Hoặc nối thẳng cổng COM STM32 đang cắm trên PC vào WebUI qua SSE:

```powershell
python software/android-apk/dev_server.py --com COM4
```

Sau khi chạy:
1. Mở **Chrome / Edge** tại `http://127.0.0.1:8765/www/index.html`.
2. Nhấn **`F12`** $\rightarrow$ bật **Toggle Device Toolbar (`Ctrl+Shift+M`)**:
   - Kiểm tra **Portrait** (`390 × 844`) và **Landscape** (`844 × 390`) mượt mà trên cùng một tab.
   - Bấm nút **`DEV SIM`** (góc trái dưới) để bắn ngay kịch bản thật (`Pull Số 1`, `Chạy 1→6`, `Cắt côn`, `DFCO`, `DTC Lỗi`) hoặc `Live COM` xem trực tiếp animation `60fps` & đồ thị.
3. Sửa xong file CSS/JS $\rightarrow$ nhấn **`Ctrl+R`**, thấy kết quả ngay lập tức!

> **Lưu ý:** Server chỉ inject `DEV SIM` & mock `AndroidBT` khi chạy qua `dev_server.py` (HTTP). Bản APK chính thức dùng thẳng file thuần trong `assets/www/`, hoàn toàn sạch.

---

## 3. Chrome Inspect Từ Xa Khi Cắm USB Vào Điện Thoại
`MainActivity.java` đã bật `WebView.setWebContentsDebuggingEnabled(true)`:
1. Cắm điện thoại bật **USB Debugging**.
2. Mở Chrome trên PC $\rightarrow$ vào địa chỉ **`chrome://inspect/#devices`**.
3. Nhấn **`inspect`** dưới mục `com.kailc.hondakline` để xem trực tiếp Console JS, CSS Box Model, FPS và network trên màn hình xe máy thật.

---

## 4. Cài APK Nhanh Qua Wi-Fi + Đọc Debug Log Nội Bộ (Không Cần Cáp)
1. Biên dịch APK mới:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "software/android-apk/build_apk.ps1"
   ```
2. Xác thực chữ ký APK:
   ```powershell
   $env:JAVA_HOME='D:\kailc\.android-toolchain\jdk'
   & "D:\kailc\.android-toolchain\sdk\build-tools\34.0.0\apksigner.bat" verify --verbose --min-sdk-version 24 "software\android-apk\honda-kline-racing.apk"
   ```
3. Mở `dev_server.py` trên PC $\rightarrow$ dùng trình duyệt trên điện thoại cùng Wi-Fi truy cập `http://<IP-PC>:8765/apk` để tải & cài đặt trực tiếp.
4. Khi test ngoài đường gặp lỗi UI/USB/BT: vào tab **ECU Lab $\rightarrow$ APP DEBUG LOG (JS + USB/BT)** $\rightarrow$ nhấn **Làm mới** hoặc **Xuất file** để lưu trọn vẹn stack lỗi JS và trạng thái USB OTG ra bộ nhớ máy (`Android/data/com.kailc.hondakline/files/`).
