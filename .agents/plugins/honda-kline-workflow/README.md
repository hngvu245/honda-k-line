# Honda K-Line Workflow Plugin

Workspace Antigravity plugin bundling domain rules, specialized subagents, and reproducible build/verification skills for `honda_test`.

## Included Subagents (`agents/`)

- `kline-firmware-engineer` — STM32F103C8T6 + L9637D K-Line firmware and Keil MDK-ARM CLI builds.
- `telemetry-ui-sync` — Cross-platform Table 11 decoder, gear estimation, and UI parity across `dashboard.py` and `android-apk/assets/www/`.
- `kline-log-analyst` — Offline packet, checksum, EMI, and serial fault analysis on `software/logs/kline_debug.log`.
- `apk-release-qa` — Android Java USB/BT bridge, DOM/syntax checks, `build_apk.ps1`, and `apksigner` verification.

## Included Skills (`skills/`)

- `stm32-firmware-build`
- `android-apk-build`
- `kline-offline-replay`
- `repo-hygiene`
