# Honda K-Line Workflow Routing Rules

Follow the **3-File Workflow** in root `AGENTS.md`: read `MEMORY.md` at start, write a brief design + `- [ ]` checklist into `PLAN.md` and wait for confirmation before editing `> 2` files, check off `[x]` after running lint/tests, and update `MEMORY.md` + `Bài học cần tránh` (and `.ai/memory/`) at session close.

Route specialized tasks to the matching skill or subagent inside `honda-kline-workflow`:

- **STM32 C / CubeMX / Keil build / Fast-Init / UART IRQ**: Load `stm32-firmware-build` or invoke `kline-firmware-engineer`. Always verify `firmware/stm32-legacy/` paths and check whether `SWJ_NOJTAG` vs `SWJ_DISABLE` is active in `stm32f1xx_hal_msp.c`.
- **Telemetry decoding, Gear Estimator, PC Dashboard <-> Android WebUI parity**: Load `kline-offline-replay` or invoke `telemetry-ui-sync`. Keep `dashboard.py`, `app.js`, and `docs/kline-protocol.md` aligned.
- **Android Java USB OTG / Bluetooth SPP/BLE / APK build**: Load `android-apk-build` or invoke `apk-release-qa`. Run `node software/android-apk/test_app.js` before `build_apk.ps1`.
- **Log inspection (`kline_debug.log`, COM errors, bit flips)**: Invoke `kline-log-analyst`. Never leave temporary `.py`, `.c`, or `.json` dumps in the repo root or `software/` root (`repo-hygiene`).
