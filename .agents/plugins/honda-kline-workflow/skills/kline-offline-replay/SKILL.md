---
name: kline-offline-replay
description: >-
  Use this skill when developing or verifying Keihin Table 11 decoders, gear
  estimation, dashboard charts, or Android WebUI layouts offline using captured
  ECU logs without connecting to a motorcycle.
---

# Offline-First K-Line Replay Workflow

## Steps

1. **PC Workbench Verification**:
   - Check Python syntax:
     ```powershell
     python -m py_compile "software/pc-dashboard/dashboard.py"
     ```
   - Launch `python software/pc-dashboard/dashboard.py` and click **Phát lại Log** (`software/logs/kline_debug.log`) at `1x / 4x / 10x`.
   - Confirm both `NERDY (Bench)` (4 tabs + bottom raw strip) and `CASUAL` views update RPM, TPS, ECT, IAT, MAP, VBAT, INJ, IGN, O2, IACV, DFCO, and Gear without exceptions.
2. **Android Sample Frame Verification**:
   - Confirm `software/android-apk/assets/www/sample_frames.js` parses cleanly through `node software/android-apk/test_app.js`.
   - When adding new real bike captures to `sample_frames.js`, include only checksum-valid `02 19 71 11` 25-byte Table 11 frames `(sum & 0xFF) == 0`.
3. **Formula Parity Check**:
   - Compare `decode_kline_bytes()` and `calculate_gear()` in `software/pc-dashboard/dashboard.py` against `parseKlinePacket()` and `calculateGear()` in `software/android-apk/assets/www/app.js` whenever thresholds or gear presets change.
