---
name: repo-hygiene
description: >-
  Use this skill before finishing multi-file edits or debugging sessions to keep
  d:\kailc\save\honda_test free of ad-hoc forensic scripts, stray JSON dumps,
  and misplaced log files.
---

# Repository Hygiene Skill

## Directory Rules

- **Repo Root (`d:\kailc\save\honda_test\`)**: Only `AGENTS.md`, `PLAN.md`, `MEMORY.md`, `README.md`, `.gitignore`, `.agents/`, `.ai/`, `docs/`, `firmware/`, `software/`, `skills/`. Never place `.c` backups, `.json` step dumps, or `.log` files here.
- **Firmware (`firmware/stm32-legacy/`)**: Keep `Core/`, `Drivers/`, `MDK-ARM/`, and `honda_test.ioc` together. Do not duplicate `honda_test - Copy.*` Keil project files.
- **Software (`software/`)**:
  - `pc-dashboard/` — GUI & CLI telemetry readers (`dashboard.py`, `sniffer.py`, `read_rpm.py`).
  - `android-apk/` — Java source, resources, WebUI assets, `test_app.js`, `build_apk.ps1`, output `.apk`.
  - `logs/` — Runtime captures (`kline_debug.log`, `kline_telemetry.csv`). **Never delete `kline_debug.log`.**
- **Scratch Scripts**: One-off transcript extractors, COM port probes, or Win32 PID checks must run inline (`python -c "..."`) or live in Antigravity's scratch directory, never committed into `software/` or repo root.
