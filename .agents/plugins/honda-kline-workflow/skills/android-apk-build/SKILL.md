---
name: android-apk-build
description: >-
  Use this skill when modifying or packaging the Android APK in software/android-apk/,
  running WebUI DOM/JS validation (test_app.js), compiling via build_apk.ps1, and
  verifying signatures with apksigner.
---

# Android APK Build & Verification Skill

## Steps

1. **Validate WebUI JS & DOM IDs**:
   ```powershell
   node --check "software/android-apk/assets/www/app.js"
   node "software/android-apk/test_app.js"
   ```
   Confirm `ALL DOM IDs MATCH PERFECTLY!` and all synthetic gear ratio tests print `PASS`.
2. **Check USB Filter & Manifest Consistency** (if USB OTG or permissions changed):
   - Verify `software/android-apk/res/xml/device_filter.xml` uses decimal `vendor-id` values matching `UsbSerialManager.java`.
   - Confirm `AndroidManifest.xml` `versionCode` / `versionName` and `minSdkVersion="24"`.
3. **Compile & Sign Offline APK** (all caches remain in `D:\kailc\.android-toolchain`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File "software/android-apk/build_apk.ps1"
   ```
4. **Verify APK v2/v3 Signature**:
   ```powershell
   $env:JAVA_HOME = 'D:\kailc\.android-toolchain\jdk'
   & "D:\kailc\.android-toolchain\sdk\build-tools\34.0.0\apksigner.bat" verify --verbose --min-sdk-version 24 "software\android-apk\honda-kline-racing.apk"
   ```
   Confirm `Verifies`, `v2 scheme: true`, and `v3 scheme: true` succeed with exit code `0`.
