---
name: stm32-firmware-build
description: >-
  Use this skill when building, verifying, or flashing the STM32F103C8T6 K-Line
  firmware in firmware/stm32-legacy/ via Keil uVision CLI (UV4.exe) and preparing
  for bench or motorcycle testing.
---

# STM32 Firmware Build & Pre-Flight Skill

## Steps

1. **Release COM & Serial Locks**: Check for lingering Python telemetry scripts before building or opening ST-Link / Keil download:
   ```powershell
   Get-Process python -ErrorAction SilentlyContinue
   Stop-Process -Name python -Force -ErrorAction SilentlyContinue
   ```
2. **Verify SWD / EMI Mode**: Check `firmware/stm32-legacy/Core/Src/stm32f1xx_hal_msp.c` inside `HAL_MspInit()`:
   - Bench / ST-Link flashing uses `__HAL_AFIO_REMAP_SWJ_NOJTAG();`.
   - Motorcycle ignition noise isolation uses `__HAL_AFIO_REMAP_SWJ_DISABLE();` (disables SWD `PA13`/`PA14` until BOOT0/Under-Reset flash).
3. **Build via Keil CLI**:
   ```powershell
   & "D:\kailc\UV4\UV4.exe" -b "firmware\stm32-legacy\MDK-ARM\honda_test.uvprojx" -j0
   ```
4. **Validate Output**:
   - Read `firmware/stm32-legacy/MDK-ARM/honda_test/honda_test.build_log.htm` and confirm `0 Error(s)`.
   - Verify `firmware/stm32-legacy/MDK-ARM/honda_test/honda_test.hex` timestamp updated.
5. **Pre-Bike Hardware Check**:
   - Buck output verified at `5.0V` before connecting STM32 `5V`, L9637D `VCC (Pin 3)`, or Bluetooth module.
   - `510 Ω (0.5W)` pull-up between L9637D `Pin 6 (K)` and `Pin 7 (VS)`.
   - Bluetooth module configured to `115200 bps` to match `USART2`.
