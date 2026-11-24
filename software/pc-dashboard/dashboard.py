# d:/kailc/save/honda_test/software/pc-dashboard/dashboard.py
# Python / CustomTkinter Dual-Mode K-Line Engineering Workbench & Casual Telemetry / Windows

import csv
import datetime
import logging
import os
import threading
import time
import tkinter as tk
from collections import deque

import customtkinter as ctk
import serial
import serial.tools.list_ports

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGS_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "logs"))
os.makedirs(LOGS_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOGS_DIR, "kline_debug.log")
CSV_FILE = os.path.join(LOGS_DIR, "kline_telemetry.csv")

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.DEBUG,
    format="%(asctime)s - %(message)s",
    filemode="a",
)

# --- Honda Motorsport Design System ---
THEME = {
    "bg": "#090A0D",
    "surface": "#14161B",
    "surface_2": "#1B1E26",
    "line": "#242833",
    "ink": "#F4F6FA",
    "muted": "#7A8291",
    "accent": "#FF4D00",
    "accent_hover": "#E04400",
    "amber": "#FFA800",
    "redline": "#FF2A2A",
    "ok": "#22C55E",
    "cyan": "#00E5FF",
    "green_trace": "#22C55E",
    "zone_cool_dim": "#102830",
    "zone_mid_dim": "#1E222B",
    "zone_amber_dim": "#2B2112",
    "zone_red_dim": "#2E1316",
    "gear_n": "#00FF66",
    "gear_num": "#F4F6FA",
}

SHIFT_THRESHOLDS = [(i + 1) * 500 for i in range(26)]
MAX_RPM_SCALE = 13000
NUM_FONT = "Bahnschrift"  # Open unslashed 0 DIN 1451 typeface

GEAR_PRESETS = {
    "winner150": {
        "name": "Honda Winner X / CBR150 (6 số)",
        "gears": 6,
        "ratios": [160.8, 107.5, 78.2, 62.6, 54.1, 47.4],
        "tolerance": 0.10,
    },
    "wave110": {
        "name": "Honda Wave / Future (4 số)",
        "gears": 4,
        "ratios": [135.0, 82.0, 58.0, 44.0],
        "tolerance": 0.10,
    },
    "exciter150": {
        "name": "Yamaha Exciter 150 (5 số)",
        "gears": 5,
        "ratios": [145.0, 96.0, 72.0, 57.0, 48.0],
        "tolerance": 0.10,
    },
}

HONDA_DTC_DICT = {
    1: "Lỗi cảm biến áp suất cổ hút (MAP)",
    7: "Lỗi cảm biến nhiệt độ nước làm mát (ECT)",
    8: "Lỗi cảm biến vị trí bướm ga (TPS)",
    9: "Lỗi cảm biến nhiệt độ khí nạp (IAT)",
    11: "Lỗi cảm biến tốc độ xe (VSS)",
    12: "Lỗi mạch kim phun xăng (Injector)",
    21: "Lỗi cảm biến khí thải Oxy (O2)",
    23: "Lỗi mạch sấy cảm biến Oxy (O2 Heater)",
    29: "Lỗi van điều khiển cầm chừng (IACV)",
    33: "Lỗi bộ nhớ trong ECU (EEPROM)",
    54: "Lỗi cảm biến góc nghiêng xe (Bank Angle)",
}

RPM_BINS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]
TPS_BINS = [0, 10, 20, 35, 50, 65, 80, 95]

ctk.set_appearance_mode("Dark")


def _decode_honda_dtc_byte(b: int) -> dict:
    """Decode a Honda Keihin DTC byte (raw MIL or BCD) into Vietnamese description."""
    bcd = ((b >> 4) * 10 + (b & 0x0F)) if ((b >> 4) <= 9 and (b & 0x0F) <= 9) else b
    code_num = bcd if bcd in HONDA_DTC_DICT else (b if b in HONDA_DTC_DICT else bcd)
    desc = HONDA_DTC_DICT.get(code_num, HONDA_DTC_DICT.get(b, f"Mã lỗi hãng Honda #{code_num} (0x{b:02X})"))
    return {"code": code_num, "raw": f"0x{b:02X}", "desc": desc}


def decode_kline_bytes(data: list[int]) -> dict | None:
    """Decode any checksum-valid Keihin ECU 0x02 response packet (Table 11, 00, 73/74, 60, custom)."""
    n = len(data)
    for i in range(n - 3):
        if data[i] != 0x02:
            continue
        length = data[i + 1]
        if length < 4 or i + length > n:
            continue
        ecu = data[i : i + length]
        if (sum(ecu) & 0xFF) != 0:
            continue

        service = ecu[2]
        table = ecu[3]

        # Table 11 Live Telemetry (25 bytes)
        if service == 0x71 and table == 0x11 and length == 0x19:
            rpm = (ecu[4] << 8) | ecu[5]
            tps_volt = round(ecu[6] * 5.0 / 256.0, 2)
            tps_pct = min(round(ecu[7] / 1.56, 1), 100.0)
            ect_volt = round(ecu[8] * 5.0 / 256.0, 2)
            ect_c = ecu[9] - 40
            iat_volt = round(ecu[10] * 5.0 / 256.0, 2)
            iat_c = ecu[11] - 40
            map_volt = round(ecu[12] * 5.0 / 256.0, 2)
            map_kpa = ecu[13]
            vbat = round(ecu[16] / 10.0, 1)
            vss_kmh = ecu[17]
            inj_ms = round(((ecu[18] << 8) | ecu[19]) * 0.00390625, 2)
            ign_deg = round((ecu[20] - 128) * 0.5, 1)
            iacv_stp = ecu[21]
            o2_volt = round(ecu[23] / 256.0, 2)
            dfco = bool(rpm > 2200 and ecu[7] == 0 and inj_ms == 0.0)
            inj_duty = round(min((rpm * inj_ms) / 1200.0, 100.0), 1)
            if dfco:
                afr_est = "CUT"
            elif rpm == 0:
                afr_est = "--"
            else:
                afr_est = f"{max(11.8, min(16.5, round(16.2 - o2_volt * 3.8, 1))):.1f}"

            return {
                "kind": "table11",
                "rpm": rpm,
                "tps_volt": tps_volt,
                "tps_pct": tps_pct,
                "tps_raw": ecu[7],
                "ect_volt": ect_volt,
                "ect_c": ect_c,
                "ect_raw": ecu[9],
                "iat_volt": iat_volt,
                "iat_c": iat_c,
                "iat_raw": ecu[11],
                "map_volt": map_volt,
                "map_kpa": map_kpa,
                "map_raw": ecu[13],
                "vbat": vbat,
                "vbat_raw": ecu[16],
                "vss_kmh": vss_kmh,
                "inj_ms": inj_ms,
                "inj_duty": inj_duty,
                "inj_raw": f"{ecu[18]:02X}{ecu[19]:02X}",
                "ign_deg": ign_deg,
                "ign_raw": ecu[20],
                "iacv_stp": iacv_stp,
                "o2_volt": o2_volt,
                "o2_raw": ecu[23],
                "afr_est": afr_est,
                "dfco": dfco,
                "raw_hex": " ".join(f"{b:02X}" for b in ecu),
            }

        # Table 00 ECM ID
        if service == 0x71 and table == 0x00 and length >= 6:
            payload = ecu[4 : length - 1]
            return {
                "kind": "ecmid",
                "ecm_id": " ".join(f"{b:02X}" for b in payload),
                "raw_hex": " ".join(f"{b:02X}" for b in ecu),
            }

        # Table 73 Current DTC / Table 74 Past DTC
        if service == 0x71 and table in (0x73, 0x74):
            kind_lbl = "Hiện tại" if table == 0x73 else "Quá khứ"
            payload = ecu[4 : length - 1] if length > 5 else []
            faults = [_decode_honda_dtc_byte(b) for b in payload if b not in (0x00, 0xFF)]
            return {
                "kind": "dtc",
                "dtc_type": kind_lbl,
                "faults": faults,
                "raw_hex": " ".join(f"{b:02X}" for b in ecu),
            }

        # Clear DTC ACK (0x60)
        if service == 0x60:
            return {
                "kind": "clear_dtc_ack",
                "raw_hex": " ".join(f"{b:02X}" for b in ecu),
            }

        return {
            "kind": "custom",
            "service": f"0x{service:02X}",
            "table": f"0x{table:02X}",
            "raw_hex": " ".join(f"{b:02X}" for b in ecu),
        }
    return None


def parse_hex_line(line: str) -> dict | None:
    """Parse an ASCII hex line into a decoded Table 11 dict (backward-compatible helper) or any ECU packet."""
    pkt = parse_kline_packet(line)
    if pkt and pkt.get("kind") == "table11":
        return pkt
    return None


def parse_kline_packet(line: str) -> dict | None:
    """Parse an ASCII hex line from STM32 into any valid Keihin ECU packet."""
    cleaned = line.strip()
    if not cleaned:
        return None
    if "RAW:" in cleaned:
        cleaned = cleaned.split("RAW:", 1)[1].strip()
    if "Data khac:" in cleaned:
        cleaned = cleaned.replace("Data khac:", "").strip()
    if "T11:" in cleaned:
        cleaned = cleaned.split("T11:", 1)[1].strip()

    tokens = cleaned.split()
    if len(tokens) < 4:
        return None
    try:
        byte_vals = [int(tok, 16) for tok in tokens if len(tok) <= 2]
    except ValueError:
        return None
    if len(byte_vals) < 4:
        return None
    return decode_kline_bytes(byte_vals)


def load_log_frames(log_path: str = LOG_FILE) -> list[tuple[str, dict]]:
    """Load all valid Table 11 ECU frames from kline_debug.log for Replay Simulator."""
    frames: list[tuple[str, dict]] = []
    if not os.path.exists(log_path):
        return frames
    try:
        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if "02 19 71 11" not in line:
                    continue
                ts = line.split(" - ", 1)[0].strip() if " - " in line else "--:--:--"
                if " " in ts:
                    ts = ts.split(" ", 1)[1][:8]
                decoded = parse_hex_line(line)
                if decoded is not None:
                    frames.append((ts, decoded))
    except OSError:
        pass
    return frames


class HondaRacingDashboard(ctk.CTk):
    """Dual-mode Keihin K-Line Workbench: Raw Engineering Bench (NERDY) & Minimalist (CASUAL)."""

    def __init__(self):
        super().__init__()

        self.title("Keihin K-Line · Engineering Bench & Telemetry")
        self.geometry("1220x750")
        self.minsize(1040, 660)
        self.configure(fg_color=THEME["bg"])
        self.protocol("WM_DELETE_WINDOW", self.on_close)

        # Connection & Replay State
        self.serial_port: serial.Serial | None = None
        self.is_connected = False
        self.stop_event = threading.Event()
        self.read_thread: threading.Thread | None = None

        self.replay_frames: list[tuple[str, dict]] = load_log_frames(LOG_FILE)
        self.replay_running = False
        self.replay_index = 0
        self.replay_speed = 1
        self.replay_after_id = None

        self.csv_recording = False
        self.csv_file_handle = None
        self.csv_writer = None

        # Mode & Tab State (Laptop prioritizes raw NERDY bench)
        self.ui_mode = "NERDY"
        self.active_nerdy_tab = "LIVE BENCH"
        self.scs_active = False
        self.scope_frozen = False
        self.map_metric = "INJ"  # INJ | IGN | MAP
        self.hover_idx: int | None = None

        # Telemetry History & Statistics
        self.peak_rpm = 0
        self.max_tps = 0.0
        self.engine_run_sec = 0.0
        self.last_frame_ts = None
        self.prev_ect = None
        self.frame_count = 0
        self.strobe_phase = False
        self.ecm_id_str = "--"
        self.rate_times: deque[float] = deque(maxlen=30)

        self.scope_len = 160
        self.scope_history: deque[dict] = deque(maxlen=self.scope_len)

        self.minmax: dict[str, dict[str, float]] = {}
        self.map_cells: dict[tuple[int, int], list[float]] = {}  # (tps_row, rpm_col) -> [sum, count]
        self.active_cell: tuple[int, int] | None = None

        # Pull timer 4000 -> 9000 RPM
        self.pull_state = "IDLE"  # IDLE | ARMED | TIMING | DONE
        self.pull_t0 = 0.0
        self.last_pull_sec: float | None = None
        self.best_pull_sec: float | None = None

        # Shared StringVars (all gauges initialize cleanly to "--" before live signal)
        self.status_text_var = ctk.StringVar(value="Sẵn sàng")
        self.rate_var = ctk.StringVar(value="0.0 Hz · 0 PKTS")
        self.bottom_raw_var = ctk.StringVar(value="RAW: Chờ khung dữ liệu từ STM32...")
        self.rpm_var = ctk.StringVar(value="--")
        self.peak_var = ctk.StringVar(value="PEAK --")
        self.gear_var = ctk.StringVar(value="N")
        self.gear_sub_var = ctk.StringVar(value="MO / DUNG XE")
        self.active_gear_preset = "winner150"
        self.gear_current = "N"
        self.gear_candidate = "N"
        self.gear_confidence = 0
        self.gear_last_shift_ts = 0.0
        self.casual_banner_var = ctk.StringVar(value="Chờ dữ liệu từ ECU xe Honda...")
        self.casual_trip_var = ctk.StringVar(value="Nổ máy: 00:00  ·  Peak: -- RPM  ·  Max Ga: -- %  ·  Min Đề: -- V")

        # 10 Live Engineering Vars (val, sub, minmax)
        self.eng_vars: dict[str, tuple[ctk.StringVar, ctk.StringVar, ctk.StringVar]] = {}
        eng_keys = ["tps", "map", "inj", "ign", "o2", "iacv", "ect", "iat", "vbat", "vss"]
        for k in eng_keys:
            self.eng_vars[k] = (
                ctk.StringVar(value="--"),
                ctk.StringVar(value="0.00 V"),
                ctk.StringVar(value="MIN -- · MAX --"),
            )

        # Pull timer vars
        self.pull_status_var = ctk.StringVar(value="CHỜ (< 3,800 RPM để nạp)")
        self.pull_cur_var = ctk.StringVar(value="--.-- s")
        self.pull_best_var = ctk.StringVar(value="BEST: --.-- s")
        self.scope_cursor_var = ctk.StringVar(value="Rê chuột lên đồ thị để soi giá trị từng điểm")

        self.replay_pos_var = ctk.StringVar(
            value=f"0 / {len(self.replay_frames)} khung" if self.replay_frames else "Không có file log"
        )

        self._build_ui()
        self.refresh_ports()

    def _build_ui(self):
        # Top 3px Racing Accent Bar (#FF4A1F)
        ctk.CTkFrame(self, height=3, corner_radius=0, fg_color=THEME["accent"]).pack(fill="x", side="top")

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True)
        body.grid_columnconfigure(0, weight=0, minsize=256)
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(0, weight=1)

        self._build_sidebar(body)
        self._build_main_area(body)

    def _build_sidebar(self, parent):
        sidebar = ctk.CTkFrame(
            parent,
            width=256,
            corner_radius=0,
            fg_color=THEME["surface"],
            border_width=1,
            border_color=THEME["line"],
        )
        sidebar.grid(row=0, column=0, sticky="nsew")
        sidebar.grid_propagate(False)

        brand = ctk.CTkFrame(sidebar, fg_color="transparent")
        brand.pack(fill="x", padx=16, pady=(16, 10))
        ctk.CTkLabel(
            brand,
            text="Keihin K-Line",
            font=ctk.CTkFont(family="Segoe UI", size=20, weight="bold"),
            text_color=THEME["ink"],
            anchor="w",
        ).pack(anchor="w")
        ctk.CTkLabel(
            brand,
            text="HRC Workbench · 10.4 kbps",
            font=ctk.CTkFont(family="Consolas", size=11),
            text_color=THEME["muted"],
            anchor="w",
        ).pack(anchor="w", pady=(2, 0))

        # Mode Switch: NERDY (Default on Laptop) | CASUAL
        mode_wrap = ctk.CTkFrame(sidebar, fg_color="transparent")
        mode_wrap.pack(fill="x", padx=16, pady=(0, 10))
        ctk.CTkLabel(
            mode_wrap,
            text="CHẾ ĐỘ HIỂN THỊ",
            font=ctk.CTkFont(family="Consolas", size=10, weight="bold"),
            text_color=THEME["muted"],
        ).pack(anchor="w", pady=(0, 4))
        self.mode_seg = ctk.CTkSegmentedButton(
            mode_wrap,
            values=["NERDY (Bench)", "CASUAL"],
            height=30,
            corner_radius=4,
            fg_color=THEME["bg"],
            selected_color=THEME["accent"],
            selected_hover_color=THEME["accent_hover"],
            unselected_color=THEME["surface_2"],
            unselected_hover_color=THEME["line"],
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            command=self.on_mode_change,
        )
        self.mode_seg.set("NERDY (Bench)")
        self.mode_seg.pack(fill="x")

        # Status Pill
        status_row = ctk.CTkFrame(
            sidebar,
            fg_color=THEME["bg"],
            corner_radius=4,
            border_width=1,
            border_color=THEME["line"],
        )
        status_row.pack(fill="x", padx=16, pady=(0, 10))
        self.status_dot = ctk.CTkLabel(
            status_row, text="●", font=ctk.CTkFont(size=12), text_color=THEME["muted"], width=18
        )
        self.status_dot.pack(side="left", padx=(10, 4), pady=7)
        ctk.CTkLabel(
            status_row,
            textvariable=self.status_text_var,
            font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            text_color=THEME["ink"],
            anchor="w",
        ).pack(side="left", fill="x", expand=True, padx=(0, 8), pady=7)

        # COM / Bluetooth SPP Connection Card
        conn_card = ctk.CTkFrame(
            sidebar, fg_color=THEME["bg"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        conn_card.pack(fill="x", padx=16, pady=(0, 10))

        ctk.CTkLabel(
            conn_card,
            text="Cổng COM / Bluetooth SPP",
            font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            text_color=THEME["muted"],
        ).pack(anchor="w", padx=12, pady=(10, 6))

        self.port_menu = ctk.CTkOptionMenu(
            conn_card,
            values=["-- Đang quét --"],
            corner_radius=4,
            height=32,
            fg_color=THEME["surface_2"],
            button_color=THEME["line"],
            button_hover_color=THEME["surface"],
            dropdown_fg_color=THEME["surface"],
            dropdown_hover_color=THEME["surface_2"],
            text_color=THEME["ink"],
            font=ctk.CTkFont(family="Consolas", size=12),
        )
        self.port_menu.pack(fill="x", padx=12, pady=(0, 6))

        self.btn_refresh = ctk.CTkButton(
            conn_card,
            text="Quét lại cổng",
            corner_radius=4,
            height=30,
            fg_color="transparent",
            border_width=1,
            border_color=THEME["line"],
            hover_color=THEME["surface_2"],
            text_color=THEME["ink"],
            font=ctk.CTkFont(family="Segoe UI", size=12),
            command=self.refresh_ports,
        )
        self.btn_refresh.pack(fill="x", padx=12, pady=(0, 6))

        self.btn_connect = ctk.CTkButton(
            conn_card,
            text="Kết nối ECU",
            corner_radius=4,
            height=36,
            fg_color=THEME["accent"],
            hover_color=THEME["accent_hover"],
            text_color=THEME["ink"],
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
            command=self.toggle_connection,
        )
        self.btn_connect.pack(fill="x", padx=12, pady=(0, 10))

        # Replay Simulator Card
        replay_card = ctk.CTkFrame(
            sidebar, fg_color=THEME["bg"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        replay_card.pack(fill="x", padx=16, pady=(0, 10))

        r_head = ctk.CTkFrame(replay_card, fg_color="transparent")
        r_head.pack(fill="x", padx=12, pady=(10, 4))
        ctk.CTkLabel(
            r_head, text="Phát lại Log", font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"), text_color=THEME["muted"]
        ).pack(side="left")

        self.speed_seg = ctk.CTkSegmentedButton(
            r_head,
            values=["0.5x", "1x", "4x", "10x"],
            height=22,
            corner_radius=4,
            fg_color=THEME["surface_2"],
            selected_color=THEME["accent"],
            selected_hover_color=THEME["accent_hover"],
            unselected_color=THEME["surface_2"],
            unselected_hover_color=THEME["line"],
            font=ctk.CTkFont(family=NUM_FONT, size=10, weight="bold"),
            command=self.on_speed_change,
        )
        self.speed_seg.set("1x")
        self.speed_seg.pack(side="right")

        ctk.CTkLabel(
            replay_card,
            textvariable=self.replay_pos_var,
            font=ctk.CTkFont(family="Consolas", size=11),
            text_color=THEME["ink"],
            anchor="w",
        ).pack(fill="x", padx=12, pady=(2, 4))

        max_idx = max(len(self.replay_frames) - 1, 1)
        self.replay_slider = ctk.CTkSlider(
            replay_card,
            from_=0,
            to=max_idx,
            number_of_steps=max_idx,
            button_color=THEME["accent"],
            button_hover_color=THEME["accent_hover"],
            progress_color=THEME["accent"],
            fg_color=THEME["surface_2"],
            command=self.on_slider_scrub,
        )
        self.replay_slider.set(0)
        self.replay_slider.pack(fill="x", padx=12, pady=(2, 6))

        self.btn_replay = ctk.CTkButton(
            replay_card,
            text="Phát lại Log",
            corner_radius=4,
            height=32,
            fg_color=THEME["surface_2"],
            hover_color=THEME["line"],
            border_width=1,
            border_color=THEME["line"],
            text_color=THEME["ink"],
            font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
            command=self.toggle_replay,
        )
        self.btn_replay.pack(fill="x", padx=12, pady=(0, 10))
        if not self.replay_frames:
            self.btn_replay.configure(state="disabled")

        # Session Tools
        tools_card = ctk.CTkFrame(
            sidebar, fg_color=THEME["bg"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        tools_card.pack(fill="x", padx=16, pady=(0, 10))

        btn_row = ctk.CTkFrame(tools_card, fg_color="transparent")
        btn_row.pack(fill="x", padx=10, pady=10)
        btn_row.grid_columnconfigure((0, 1), weight=1)

        self.btn_csv = ctk.CTkButton(
            btn_row,
            text="Ghi CSV",
            corner_radius=4,
            height=30,
            fg_color="transparent",
            border_width=1,
            border_color=THEME["line"],
            hover_color=THEME["surface_2"],
            text_color=THEME["ink"],
            font=ctk.CTkFont(family="Segoe UI", size=12),
            command=self.toggle_csv,
        )
        self.btn_csv.grid(row=0, column=0, padx=(0, 4), sticky="ew")

        self.btn_peak = ctk.CTkButton(
            btn_row,
            text="Reset Stats",
            corner_radius=4,
            height=30,
            fg_color="transparent",
            border_width=1,
            border_color=THEME["line"],
            hover_color=THEME["surface_2"],
            text_color=THEME["ink"],
            font=ctk.CTkFont(family="Segoe UI", size=12),
            command=self.reset_stats,
        )
        self.btn_peak.grid(row=0, column=1, padx=(4, 0), sticky="ew")

        ctk.CTkLabel(
            sidebar,
            textvariable=self.rate_var,
            font=ctk.CTkFont(family="Consolas", size=11),
            text_color=THEME["muted"],
        ).pack(side="bottom", anchor="w", padx=16, pady=12)

    def _build_main_area(self, parent):
        self.main_wrap = ctk.CTkFrame(parent, fg_color="transparent")
        self.main_wrap.grid(row=0, column=1, padx=16, pady=14, sticky="nsew")
        self.main_wrap.grid_columnconfigure(0, weight=1)
        self.main_wrap.grid_rowconfigure(0, weight=1)

        # Build both CASUAL & NERDY frames and switch smoothly
        self.nerdy_frame = self._build_nerdy_view(self.main_wrap)
        self.casual_frame = self._build_casual_view(self.main_wrap)
        self.nerdy_frame.grid(row=0, column=0, sticky="nsew")

    # ==========================================================
    # CASUAL VIEW (Honda Motorsport Hierarchy + Separated Cards)
    # ==========================================================
    def _build_casual_view(self, parent):
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(2, weight=1)

        # Diagnostic Banner
        banner = ctk.CTkFrame(
            frame, fg_color=THEME["surface"], corner_radius=10, border_width=1, border_color=THEME["line"]
        )
        banner.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        self.casual_banner_dot = ctk.CTkLabel(
            banner, text="●", font=ctk.CTkFont(size=14), text_color=THEME["ok"], width=22
        )
        self.casual_banner_dot.pack(side="left", padx=(14, 6), pady=10)
        ctk.CTkLabel(
            banner,
            textvariable=self.casual_banner_var,
            font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
            text_color=THEME["ink"],
        ).pack(side="left", pady=10)

        # Tier 1: Hero RPM + TPS Cards
        hero_row = ctk.CTkFrame(frame, fg_color="transparent")
        hero_row.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        hero_row.grid_columnconfigure((0, 1), weight=1, uniform="chcol")

        rpm_card = ctk.CTkFrame(
            hero_row, fg_color=THEME["surface"], corner_radius=12, border_width=1, border_color=THEME["line"]
        )
        rpm_card.grid(row=0, column=0, padx=(0, 6), sticky="nsew")
        self.casual_shift_canvas = tk.Canvas(rpm_card, height=34, bg=THEME["surface"], highlightthickness=0)
        self.casual_shift_canvas.pack(fill="x", padx=16, pady=(12, 4))
        self.casual_shift_canvas.bind("<Configure>", lambda _e: self._draw_shift_bar(self.casual_shift_canvas, 0))
        r_hdr = ctk.CTkFrame(rpm_card, fg_color="transparent")
        r_hdr.pack(fill="x", padx=16)
        ctk.CTkLabel(r_hdr, text="VÒNG TUA MÁY · RPM", font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"), text_color=THEME["muted"]).pack(side="left")
        ctk.CTkLabel(r_hdr, textvariable=self.peak_var, font=ctk.CTkFont(family=NUM_FONT, size=12, weight="bold"), text_color=THEME["accent"]).pack(side="right")
        self.casual_rpm_lbl = ctk.CTkLabel(
            rpm_card, textvariable=self.rpm_var, font=ctk.CTkFont(family=NUM_FONT, size=66, weight="bold"), text_color=THEME["ink"]
        )
        self.casual_rpm_lbl.pack(anchor="w", padx=18, pady=(2, 10))

        cockpit_card = ctk.CTkFrame(
            hero_row, fg_color=THEME["surface"], corner_radius=12, border_width=1, border_color=THEME["line"]
        )
        cockpit_card.grid(row=0, column=1, padx=(6, 0), sticky="nsew")
        cockpit_card.grid_columnconfigure(0, weight=3)
        cockpit_card.grid_columnconfigure(1, weight=2)
        cockpit_card.grid_rowconfigure(0, weight=1)

        # Speed + TPS sub-pane
        speed_pane = ctk.CTkFrame(cockpit_card, fg_color="transparent")
        speed_pane.grid(row=0, column=0, padx=(14, 6), pady=12, sticky="nsew")

        s_hdr = ctk.CTkFrame(speed_pane, fg_color="transparent")
        s_hdr.pack(fill="x")
        ctk.CTkLabel(
            s_hdr, text="TỐC ĐỘ · VSS", font=ctk.CTkFont(family="Segoe UI", size=11, weight="bold"), text_color=THEME["muted"]
        ).pack(side="left")
        ctk.CTkLabel(
            s_hdr, textvariable=self.eng_vars["tps"][2], font=ctk.CTkFont(family=NUM_FONT, size=10), text_color=THEME["muted"]
        ).pack(side="right")

        speed_val_row = ctk.CTkFrame(speed_pane, fg_color="transparent")
        speed_val_row.pack(anchor="w", pady=(2, 4))
        self.casual_vss_lbl = ctk.CTkLabel(
            speed_val_row, textvariable=self.eng_vars["vss"][0], font=ctk.CTkFont(family=NUM_FONT, size=52, weight="bold"), text_color=THEME["cyan"]
        )
        self.casual_vss_lbl.pack(side="left")
        ctk.CTkLabel(
            speed_val_row, text=" km/h", font=ctk.CTkFont(family="Segoe UI", size=18, weight="bold"), text_color=THEME["muted"]
        ).pack(side="left", pady=(18, 0))

        tps_info_row = ctk.CTkFrame(speed_pane, fg_color="transparent")
        tps_info_row.pack(fill="x", pady=(0, 2))
        ctk.CTkLabel(
            tps_info_row, text="BƯỚM GA", font=ctk.CTkFont(family="Consolas", size=10, weight="bold"), text_color=THEME["muted"]
        ).pack(side="left")
        ctk.CTkLabel(
            tps_info_row, textvariable=self.eng_vars["tps"][0], font=ctk.CTkFont(family=NUM_FONT, size=11, weight="bold"), text_color=THEME["ink"]
        ).pack(side="right")
        self.casual_tps_bar = ctk.CTkProgressBar(
            speed_pane, height=8, corner_radius=4, fg_color=THEME["surface_2"], progress_color=THEME["accent"]
        )
        self.casual_tps_bar.pack(fill="x", pady=(2, 0))
        self.casual_tps_bar.set(0)

        # Right TFT Gear Box
        gear_frame = ctk.CTkFrame(
            cockpit_card, fg_color=THEME["surface_2"], corner_radius=10, border_width=1, border_color=THEME["line"]
        )
        gear_frame.grid(row=0, column=1, padx=(6, 14), pady=12, sticky="nsew")
        ctk.CTkLabel(
            gear_frame, text="CẤP SỐ · GEAR", font=ctk.CTkFont(family="Segoe UI", size=10, weight="bold"), text_color=THEME["muted"]
        ).pack(pady=(8, 0))
        self.casual_gear_lbl = ctk.CTkLabel(
            gear_frame, textvariable=self.gear_var, font=ctk.CTkFont(family=NUM_FONT, size=56, weight="bold"), text_color="#00FF66"
        )
        self.casual_gear_lbl.pack(expand=True)
        ctk.CTkLabel(
            gear_frame, textvariable=self.gear_sub_var, font=ctk.CTkFont(family="Consolas", size=9, weight="bold"), text_color=THEME["muted"]
        ).pack(pady=(0, 8))

        # Tier 2: 4 Separated Left-Aligned Secondary Metric Cards (2x2)
        sec_grid = ctk.CTkFrame(frame, fg_color="transparent")
        sec_grid.grid(row=2, column=0, sticky="nsew")
        sec_grid.grid_columnconfigure((0, 1), weight=1, uniform="cscol")
        sec_grid.grid_rowconfigure((0, 1), weight=1, uniform="csrow")

        self.casual_ect_lbl = self._make_casual_cell(sec_grid, 0, 0, "NHIỆT ĐỘ MÁY · ECT", self.eng_vars["ect"][0], "°C", self.eng_vars["ect"][2])
        self.casual_bat_lbl = self._make_casual_cell(sec_grid, 0, 1, "ĐIỆN BÌNH · VBAT", self.eng_vars["vbat"][0], "V", self.eng_vars["vbat"][2])
        self._make_casual_cell(sec_grid, 1, 0, "NHIỆT ĐỘ GIÓ · IAT", self.eng_vars["iat"][0], "°C", self.eng_vars["iat"][2])
        self._make_casual_cell(sec_grid, 1, 1, "TẢI ĐỘNG CƠ · MAP", self.eng_vars["map"][0], "kPa", self.eng_vars["map"][2])

        # Trip summary footer
        trip = ctk.CTkFrame(
            frame, fg_color=THEME["surface"], corner_radius=10, border_width=1, border_color=THEME["line"]
        )
        trip.grid(row=3, column=0, sticky="ew", pady=(10, 0))
        ctk.CTkLabel(
            trip,
            textvariable=self.casual_trip_var,
            font=ctk.CTkFont(family=NUM_FONT, size=12, weight="bold"),
            text_color=THEME["muted"],
        ).pack(padx=16, pady=10, anchor="w")

        return frame

    def _make_casual_cell(self, parent, row: int, col: int, label: str, var: ctk.StringVar, unit: str, sub_var: ctk.StringVar):
        cell = ctk.CTkFrame(parent, fg_color=THEME["surface"], corner_radius=12, border_width=1, border_color=THEME["line"])
        cell.grid(row=row, column=col, padx=(0 if col == 0 else 5, 5 if col == 0 else 0), pady=(0 if row == 0 else 5, 5 if row == 0 else 0), sticky="nsew")
        ctk.CTkLabel(
            cell, text=label, font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"), text_color=THEME["muted"]
        ).pack(anchor="nw", padx=16, pady=(12, 0))
        val_row = ctk.CTkFrame(cell, fg_color="transparent")
        val_row.pack(anchor="w", padx=16, pady=(4, 2), expand=True)
        num_lbl = ctk.CTkLabel(
            val_row, textvariable=var, font=ctk.CTkFont(family=NUM_FONT, size=40, weight="bold"), text_color=THEME["ink"]
        )
        num_lbl.pack(side="left")
        ctk.CTkLabel(
            val_row, text=f" {unit}", font=ctk.CTkFont(family="Segoe UI", size=17, weight="bold"), text_color=THEME["muted"]
        ).pack(side="left", pady=(12, 0))
        ctk.CTkLabel(
            cell, textvariable=sub_var, font=ctk.CTkFont(family=NUM_FONT, size=11), text_color=THEME["muted"]
        ).pack(anchor="w", padx=16, pady=(0, 10))
        return num_lbl

    # ==========================================================
    # NERDY VIEW (Raw Engineering Bench — 4 Tabs + Raw Strip)
    # ==========================================================
    def _build_nerdy_view(self, parent):
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.grid_columnconfigure(0, weight=1)
        frame.grid_rowconfigure(1, weight=1)

        # Tab Header
        tab_bar = ctk.CTkFrame(frame, fg_color="transparent")
        tab_bar.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        self.nerdy_tab_seg = ctk.CTkSegmentedButton(
            tab_bar,
            values=["LIVE BENCH", "SCOPE & PULL", "MAP TRACER (RPM×TPS)", "DTC & ECU LAB"],
            height=34,
            corner_radius=4,
            fg_color=THEME["surface"],
            selected_color=THEME["accent"],
            selected_hover_color=THEME["accent_hover"],
            unselected_color=THEME["surface"],
            unselected_hover_color=THEME["surface_2"],
            font=ctk.CTkFont(family="Consolas", size=12, weight="bold"),
            command=self.on_nerdy_tab_change,
        )
        self.nerdy_tab_seg.set("LIVE BENCH")
        self.nerdy_tab_seg.pack(side="left", fill="x", expand=True)

        # Tab Body Stack
        tab_host = ctk.CTkFrame(frame, fg_color="transparent")
        tab_host.grid(row=1, column=0, sticky="nsew")
        tab_host.grid_columnconfigure(0, weight=1)
        tab_host.grid_rowconfigure(0, weight=1)

        self.nerdy_tabs = {
            "LIVE BENCH": self._build_tab_live_bench(tab_host),
            "SCOPE & PULL": self._build_tab_scope(tab_host),
            "MAP TRACER (RPM×TPS)": self._build_tab_map(tab_host),
            "DTC & ECU LAB": self._build_tab_ecu_lab(tab_host),
        }
        self.nerdy_tabs["LIVE BENCH"].grid(row=0, column=0, sticky="nsew")

        # Persistent Bottom Raw Hex Monitor
        raw_bar = ctk.CTkFrame(
            frame, fg_color=THEME["surface"], corner_radius=4, border_width=1, border_color=THEME["line"]
        )
        raw_bar.grid(row=2, column=0, sticky="ew", pady=(10, 0))
        ctk.CTkLabel(
            raw_bar,
            textvariable=self.bottom_raw_var,
            font=ctk.CTkFont(family="Consolas", size=11),
            text_color=THEME["ink"],
            anchor="w",
        ).pack(fill="x", padx=12, pady=7)

        return frame

    def _build_tab_live_bench(self, parent):
        tab = ctk.CTkFrame(parent, fg_color="transparent")
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)

        # Top Shift-Light + Giant RPM Strip
        hero = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        hero.grid(row=0, column=0, sticky="ew", pady=(0, 10))

        self.nerdy_shift_canvas = tk.Canvas(hero, height=34, bg=THEME["surface"], highlightthickness=0)
        self.nerdy_shift_canvas.pack(fill="x", padx=16, pady=(10, 6))
        self.nerdy_shift_canvas.bind("<Configure>", lambda _e: self._draw_shift_bar(self.nerdy_shift_canvas, 0))

        rpm_row = ctk.CTkFrame(hero, fg_color="transparent")
        rpm_row.pack(fill="x", padx=16, pady=(0, 12))

        ctk.CTkLabel(
            rpm_row, text="RPM", font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"), text_color=THEME["muted"]
        ).pack(side="left", anchor="s", pady=(0, 12))
        self.nerdy_rpm_lbl = ctk.CTkLabel(
            rpm_row,
            textvariable=self.rpm_var,
            font=ctk.CTkFont(family=NUM_FONT, size=62, weight="bold"),
            text_color=THEME["ink"],
        )
        self.nerdy_rpm_lbl.pack(side="left", padx=(12, 20))

        meta_col = ctk.CTkFrame(rpm_row, fg_color="transparent")
        meta_col.pack(side="left", fill="y", pady=6)
        ctk.CTkLabel(
            meta_col, textvariable=self.peak_var, font=ctk.CTkFont(family="Consolas", size=12, weight="bold"), text_color=THEME["accent"]
        ).pack(anchor="w")
        self.dfco_badge = ctk.CTkLabel(
            meta_col,
            text="DFCO CUT",
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            fg_color=THEME["surface_2"],
            text_color=THEME["muted"],
            corner_radius=4,
            width=82,
            height=22,
        )
        self.dfco_badge.pack(anchor="w", pady=(6, 0))

        self.nerdy_gear_box = ctk.CTkFrame(
            rpm_row, fg_color=THEME["surface_2"], corner_radius=6, border_width=1, border_color=THEME["line"], width=78, height=62
        )
        self.nerdy_gear_box.pack(side="right", padx=(12, 0), pady=2)
        self.nerdy_gear_box.pack_propagate(False)
        ctk.CTkLabel(self.nerdy_gear_box, text="GEAR", font=ctk.CTkFont(family="Consolas", size=10, weight="bold"), text_color=THEME["muted"]).pack(pady=(4, 0))
        self.nerdy_gear_lbl = ctk.CTkLabel(self.nerdy_gear_box, textvariable=self.gear_var, font=ctk.CTkFont(family=NUM_FONT, size=32, weight="bold"), text_color="#00FF66")
        self.nerdy_gear_lbl.pack(pady=(0, 2))

        ctk.CTkLabel(
            rpm_row,
            textvariable=self.pull_best_var,
            font=ctk.CTkFont(family="Consolas", size=12, weight="bold"),
            text_color=THEME["muted"],
        ).pack(side="right", anchor="s", pady=(0, 8), padx=(0, 10))

        # 10 Raw Engineering Cells (2 rows x 5 columns)
        grid = ctk.CTkFrame(tab, fg_color="transparent")
        grid.grid(row=1, column=0, sticky="nsew")
        grid.grid_columnconfigure((0, 1, 2, 3, 4), weight=1, uniform="ecol")
        grid.grid_rowconfigure((0, 1), weight=1, uniform="erow")

        specs = [
            (0, 0, "tps", "BƯỚM GA · TPS", "%"),
            (0, 1, "map", "ÁP SUẤT · MAP", "kPa"),
            (0, 2, "inj", "KIM PHUN · INJ", "ms"),
            (0, 3, "ign", "ĐÁNH LỬA · IGN", "°"),
            (0, 4, "o2", "KHÍ THẢI · O2", "V"),
            (1, 0, "iacv", "VAN GIÓ · IACV", "stp"),
            (1, 1, "ect", "NƯỚC MÁT · ECT", "°C"),
            (1, 2, "iat", "KHÍ NẠP · IAT", "°C"),
            (1, 3, "vbat", "ĐIỆN ÁP · VBAT", "V"),
            (1, 4, "vss", "TỐC ĐỘ · VSS", "km/h"),
        ]
        self.eng_val_labels: dict[str, ctk.CTkLabel] = {}
        self.nerdy_tps_bar = None
        for r, c, key, title, unit in specs:
            cell = ctk.CTkFrame(
                grid, fg_color=THEME["surface"], corner_radius=10, border_width=1, border_color=THEME["line"]
            )
            cell.grid(row=r, column=c, padx=(0, 0 if c == 4 else 8), pady=(0, 8 if r == 0 else 0), sticky="nsew")
            ctk.CTkLabel(
                cell, text=title, font=ctk.CTkFont(family="Segoe UI", size=11, weight="bold"), text_color=THEME["muted"]
            ).pack(anchor="w", padx=12, pady=(10, 2))
            v_row = ctk.CTkFrame(cell, fg_color="transparent")
            v_row.pack(anchor="w", padx=12, pady=(2, 2))
            v_lbl = ctk.CTkLabel(
                v_row,
                textvariable=self.eng_vars[key][0],
                font=ctk.CTkFont(family=NUM_FONT, size=28, weight="bold"),
                text_color=THEME["ink"],
                anchor="w",
            )
            v_lbl.pack(side="left")
            ctk.CTkLabel(
                v_row,
                text=f" {unit}",
                font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
                text_color=THEME["muted"],
            ).pack(side="left", pady=(7, 0))
            self.eng_val_labels[key] = v_lbl
            if key == "tps":
                self.nerdy_tps_bar = ctk.CTkProgressBar(
                    cell, height=5, corner_radius=2, fg_color=THEME["surface_2"], progress_color=THEME["accent"]
                )
                self.nerdy_tps_bar.pack(fill="x", padx=12, pady=(2, 2))
                self.nerdy_tps_bar.set(0)
            ctk.CTkLabel(
                cell,
                textvariable=self.eng_vars[key][1],
                font=ctk.CTkFont(family="Consolas", size=11),
                text_color=THEME["cyan"],
                anchor="w",
            ).pack(anchor="w", padx=12)
            ctk.CTkLabel(
                cell,
                textvariable=self.eng_vars[key][2],
                font=ctk.CTkFont(family="Consolas", size=10),
                text_color=THEME["muted"],
                anchor="w",
            ).pack(side="bottom", anchor="w", padx=12, pady=(0, 10))

        return tab

    def _build_tab_scope(self, parent):
        tab = ctk.CTkFrame(parent, fg_color="transparent")
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)

        # Toolbar + Pull Timer
        ctrl = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        ctrl.grid(row=0, column=0, sticky="ew", pady=(0, 10))

        self.chk_rpm = ctk.CTkCheckBox(ctrl, text="RPM", font=ctk.CTkFont(family="Consolas", size=11), fg_color=THEME["accent"], command=self._draw_scope)
        self.chk_rpm.select()
        self.chk_rpm.pack(side="left", padx=(12, 8), pady=10)

        self.chk_tps = ctk.CTkCheckBox(ctrl, text="TPS %", font=ctk.CTkFont(family="Consolas", size=11), fg_color=THEME["accent"], command=self._draw_scope)
        self.chk_tps.select()
        self.chk_tps.pack(side="left", padx=8, pady=10)

        self.chk_map = ctk.CTkCheckBox(ctrl, text="MAP", font=ctk.CTkFont(family="Consolas", size=11), fg_color=THEME["cyan"], command=self._draw_scope)
        self.chk_map.select()
        self.chk_map.pack(side="left", padx=8, pady=10)

        self.chk_inj = ctk.CTkCheckBox(ctrl, text="INJ ms", font=ctk.CTkFont(family="Consolas", size=11), fg_color=THEME["amber"], command=self._draw_scope)
        self.chk_inj.pack(side="left", padx=8, pady=10)

        self.chk_o2 = ctk.CTkCheckBox(ctrl, text="O2 V", font=ctk.CTkFont(family="Consolas", size=11), fg_color=THEME["green_trace"], command=self._draw_scope)
        self.chk_o2.pack(side="left", padx=8, pady=10)

        self.btn_freeze = ctk.CTkButton(
            ctrl,
            text="Đóng băng (Freeze)",
            width=130,
            height=28,
            corner_radius=4,
            fg_color=THEME["surface_2"],
            border_width=1,
            border_color=THEME["line"],
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            command=self.toggle_freeze,
        )
        self.btn_freeze.pack(side="right", padx=12, pady=8)

        # Scope Canvas Frame
        scope_box = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        scope_box.grid(row=1, column=0, sticky="nsew", pady=(0, 10))
        ctk.CTkLabel(
            scope_box,
            textvariable=self.scope_cursor_var,
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            text_color=THEME["ink"],
            anchor="w",
        ).pack(fill="x", padx=14, pady=(10, 4))

        self.scope_canvas = tk.Canvas(scope_box, bg=THEME["bg"], highlightthickness=0)
        self.scope_canvas.pack(fill="both", expand=True, padx=14, pady=(0, 14))
        self.scope_canvas.bind("<Configure>", lambda _e: self._draw_scope())
        self.scope_canvas.bind("<Motion>", self._on_scope_hover)
        self.scope_canvas.bind("<Leave>", lambda _e: (setattr(self, "hover_idx", None), self._draw_scope()))

        # Pull Timer 4000 -> 9000 RPM Panel
        pull_box = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        pull_box.grid(row=2, column=0, sticky="ew")
        ctk.CTkLabel(
            pull_box,
            text="PULL TIMER (4,000 → 9,000 RPM):",
            font=ctk.CTkFont(family="Consolas", size=12, weight="bold"),
            text_color=THEME["muted"],
        ).pack(side="left", padx=14, pady=12)
        ctk.CTkLabel(
            pull_box, textvariable=self.pull_status_var, font=ctk.CTkFont(family="Consolas", size=12), text_color=THEME["ink"]
        ).pack(side="left", padx=8)
        ctk.CTkLabel(
            pull_box, textvariable=self.pull_cur_var, font=ctk.CTkFont(family="Consolas", size=18, weight="bold"), text_color=THEME["accent"]
        ).pack(side="left", padx=16)
        ctk.CTkButton(
            pull_box,
            text="Reset Pull",
            width=90,
            height=28,
            corner_radius=4,
            fg_color="transparent",
            border_width=1,
            border_color=THEME["line"],
            command=self.reset_pull_timer,
        ).pack(side="right", padx=12, pady=8)
        ctk.CTkLabel(
            pull_box, textvariable=self.pull_best_var, font=ctk.CTkFont(family="Consolas", size=13, weight="bold"), text_color=THEME["ok"]
        ).pack(side="right", padx=12)

        return tab

    def _build_tab_map(self, parent):
        tab = ctk.CTkFrame(parent, fg_color="transparent")
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)

        head = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        head.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        ctk.CTkLabel(
            head,
            text="BẢNG DÒ ECU MAP (RPM × TPS) · TỰ ĐIỀN TRUNG BÌNH KHI CHẠY",
            font=ctk.CTkFont(family="Consolas", size=12, weight="bold"),
            text_color=THEME["ink"],
        ).pack(side="left", padx=14, pady=10)

        ctk.CTkButton(
            head,
            text="Xóa bảng Map",
            width=100,
            height=28,
            corner_radius=4,
            fg_color="transparent",
            border_width=1,
            border_color=THEME["line"],
            command=self.clear_map_tracer,
        ).pack(side="right", padx=12, pady=8)

        self.map_metric_seg = ctk.CTkSegmentedButton(
            head,
            values=["INJ ms", "IGN °", "MAP kPa"],
            height=28,
            corner_radius=4,
            fg_color=THEME["bg"],
            selected_color=THEME["accent"],
            selected_hover_color=THEME["accent_hover"],
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            command=self.on_map_metric_change,
        )
        self.map_metric_seg.set("INJ ms")
        self.map_metric_seg.pack(side="right", padx=8, pady=8)

        canvas_wrap = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        canvas_wrap.grid(row=1, column=0, sticky="nsew")
        self.map_canvas = tk.Canvas(canvas_wrap, bg=THEME["bg"], highlightthickness=0)
        self.map_canvas.pack(fill="both", expand=True, padx=12, pady=12)
        self.map_canvas.bind("<Configure>", lambda _e: self._draw_map_matrix())
        return tab

    def _build_tab_ecu_lab(self, parent):
        tab = ctk.CTkFrame(parent, fg_color="transparent")
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(2, weight=1)

        # Command Toolbar
        cmd_card = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        cmd_card.grid(row=0, column=0, sticky="ew", pady=(0, 10))

        row1 = ctk.CTkFrame(cmd_card, fg_color="transparent")
        row1.pack(fill="x", padx=12, pady=(10, 6))
        for label, cmd_txt, is_pri in [
            ("Đọc ECM ID", "READ_ECMID\r\n", False),
            ("Đọc Lỗi DTC", "READ_DTC\r\n", True),
            ("Xóa Lỗi DTC", "CLEAR_DTC\r\n", False),
            ("Ép Wakeup", "WAKEUP\r\n", False),
        ]:
            ctk.CTkButton(
                row1,
                text=label,
                height=32,
                corner_radius=4,
                fg_color=THEME["accent"] if is_pri else THEME["surface_2"],
                hover_color=THEME["accent_hover"] if is_pri else THEME["line"],
                border_width=0 if is_pri else 1,
                border_color=THEME["line"],
                font=ctk.CTkFont(family="Segoe UI", size=12, weight="bold"),
                command=lambda c=cmd_txt: self.send_serial_cmd(c),
            ).pack(side="left", padx=(0, 8))

        self.btn_scs = ctk.CTkButton(
            row1,
            text="SCS (PB0): Tắt",
            height=32,
            corner_radius=4,
            fg_color="transparent",
            border_width=1,
            border_color=THEME["line"],
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            command=self.toggle_scs,
        )
        self.btn_scs.pack(side="right")

        row2 = ctk.CTkFrame(cmd_card, fg_color="transparent")
        row2.pack(fill="x", padx=12, pady=(0, 10))
        ctk.CTkLabel(
            row2, text="Thử Table ID (Hex):", font=ctk.CTkFont(family="Consolas", size=12), text_color=THEME["muted"]
        ).pack(side="left", padx=(0, 8))
        self.custom_table_entry = ctk.CTkEntry(
            row2, width=70, height=30, corner_radius=4, fg_color=THEME["bg"], border_color=THEME["line"], font=ctk.CTkFont(family="Consolas", size=12)
        )
        self.custom_table_entry.insert(0, "17")
        self.custom_table_entry.pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            row2,
            text="Gửi REQ_TABLE",
            height=30,
            corner_radius=4,
            fg_color=THEME["surface_2"],
            border_width=1,
            border_color=THEME["line"],
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            command=self.send_custom_table,
        ).pack(side="left")

        # Decoded DTC Box
        dtc_card = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        dtc_card.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        ctk.CTkLabel(
            dtc_card,
            text="KẾT QUẢ CHẨN ĐOÁN / ECM ID",
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            text_color=THEME["muted"],
        ).pack(anchor="w", padx=12, pady=(8, 2))
        self.dtc_text = ctk.CTkTextbox(
            dtc_card, height=95, fg_color=THEME["bg"], text_color=THEME["ink"], font=ctk.CTkFont(family="Consolas", size=12)
        )
        self.dtc_text.pack(fill="x", padx=12, pady=(0, 10))
        self.dtc_text.insert("1.0", "Chưa truy vấn mã lỗi. Kết nối ECU và bấm 'Đọc Lỗi DTC' hoặc 'Đọc ECM ID'.\n")
        self.dtc_text.configure(state="disabled")

        # Raw Terminal Console
        term_card = ctk.CTkFrame(
            tab, fg_color=THEME["surface"], corner_radius=6, border_width=1, border_color=THEME["line"]
        )
        term_card.grid(row=2, column=0, sticky="nsew")
        ctk.CTkLabel(
            term_card,
            text="RAW K-LINE TERMINAL LOG",
            font=ctk.CTkFont(family="Consolas", size=11, weight="bold"),
            text_color=THEME["muted"],
        ).pack(anchor="w", padx=12, pady=(8, 2))
        self.terminal_box = ctk.CTkTextbox(
            term_card, fg_color=THEME["bg"], text_color=THEME["ink"], font=ctk.CTkFont(family="Consolas", size=11)
        )
        self.terminal_box.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        self.terminal_box.configure(state="disabled")

        return tab

    # ==========================================================
    # VIEW SWITCHING
    # ==========================================================
    def on_mode_change(self, val: str):
        self.ui_mode = "CASUAL" if "CASUAL" in val else "NERDY"
        if self.ui_mode == "CASUAL":
            self.nerdy_frame.grid_remove()
            self.casual_frame.grid(row=0, column=0, sticky="nsew")
            self._draw_shift_bar(self.casual_shift_canvas, self.scope_history[-1]["rpm"] if self.scope_history else 0)
        else:
            self.casual_frame.grid_remove()
            self.nerdy_frame.grid(row=0, column=0, sticky="nsew")
            self._redraw_active_nerdy_tab()

    def on_nerdy_tab_change(self, val: str):
        for k, frm in self.nerdy_tabs.items():
            if k == val:
                frm.grid(row=0, column=0, sticky="nsew")
            else:
                frm.grid_remove()
        self.active_nerdy_tab = val
        self._redraw_active_nerdy_tab()

    def _redraw_active_nerdy_tab(self):
        rpm = self.scope_history[-1]["rpm"] if self.scope_history else 0
        if self.active_nerdy_tab == "LIVE BENCH":
            self._draw_shift_bar(self.nerdy_shift_canvas, rpm)
        elif self.active_nerdy_tab == "SCOPE & PULL":
            self._draw_scope()
        elif self.active_nerdy_tab == "MAP TRACER (RPM×TPS)":
            self._draw_map_matrix()

    # ==========================================================
    # CANVAS RENDERERS
    # ==========================================================
    def _draw_shift_bar(self, canvas: tk.Canvas, rpm: int):
        w = canvas.winfo_width()
        h = canvas.winfo_height()
        if w < 50:
            return
        canvas.delete("all")
        count = len(SHIFT_THRESHOLDS)
        gap = 2
        seg_w = (w - gap * (count - 1)) / count
        bar_bottom = max(10, h - 16)
        if rpm >= 9200:
            self.strobe_phase = not self.strobe_phase
        else:
            self.strobe_phase = False

        peak_idx = -1
        if self.peak_rpm > 300:
            for idx, thresh in enumerate(SHIFT_THRESHOLDS):
                if self.peak_rpm >= thresh:
                    peak_idx = idx

        for idx, thresh in enumerate(SHIFT_THRESHOLDS):
            x0 = idx * (seg_w + gap)
            x1 = x0 + seg_w
            lit = rpm >= thresh
            if not lit:
                if idx >= 20:
                    fill = THEME["zone_red_dim"]
                elif idx >= 13:
                    fill = THEME["zone_amber_dim"]
                elif idx < 6:
                    fill = THEME["zone_cool_dim"]
                else:
                    fill = THEME["zone_mid_dim"]
            elif idx >= 20:
                fill = THEME["zone_red_dim"] if self.strobe_phase else THEME["redline"]
            elif idx >= 13:
                fill = THEME["amber"]
            elif idx < 6:
                fill = THEME["cyan"]
            else:
                fill = THEME["ink"]

            outline = THEME["line"]
            ow = 1
            if idx == peak_idx:
                fill = THEME["accent"]
                outline = THEME["ink"]
                ow = 1
            canvas.create_rectangle(x0, 2, x1, bar_bottom, fill=fill, outline=outline, width=ow)

        # Draw 0..13 RPM scale ticks aligned to the 26 segments (2 segments = 1000 RPM)
        tick_y0 = bar_bottom + 2
        tick_y1 = bar_bottom + 5
        lbl_y = min(h - 5, bar_bottom + 11)
        for k in range(14):
            tx = (k / 13.0) * w
            anchor = "center"
            if k == 0:
                tx = 1
                anchor = "w"
            elif k == 13:
                tx = w - 1
                anchor = "e"
            major = k in (0, 6, 10, 13)
            tcol = THEME["redline"] if k >= 10 else (THEME["ink"] if major else THEME["muted"])
            canvas.create_line(tx, tick_y0, tx, tick_y1, fill=THEME["line"], width=1)
            canvas.create_text(
                tx,
                lbl_y,
                text=str(k),
                anchor=anchor,
                fill=tcol,
                font=(NUM_FONT, 8, "bold" if major else "normal"),
            )

    def _draw_scope(self):
        c = self.scope_canvas
        w = c.winfo_width()
        h = c.winfo_height()
        if w < 60 or h < 40:
            return
        c.delete("all")

        for frac, lbl in ((0.25, "75%"), (0.5, "50%"), (0.75, "25%")):
            y = h * frac
            c.create_line(0, y, w, y, fill=THEME["line"], width=1)
            c.create_text(8, y - 8, text=lbl, anchor="w", fill=THEME["muted"], font=("Consolas", 9))

        pts = list(self.scope_history)
        if len(pts) < 2:
            return
        step = w / (self.scope_len - 1)
        x_offset = (self.scope_len - len(pts)) * step

        channels = [
            (self.chk_map.get() == 1, "map_kpa", 120.0, THEME["cyan"], 1.5),
            (self.chk_inj.get() == 1, "inj_ms", 12.0, THEME["amber"], 1.5),
            (self.chk_o2.get() == 1, "o2_volt", 1.2, THEME["green_trace"], 1.5),
            (self.chk_tps.get() == 1, "tps_pct", 100.0, THEME["accent"], 1.7),
            (self.chk_rpm.get() == 1, "rpm", float(MAX_RPM_SCALE), THEME["ink"], 2.0),
        ]
        for enabled, key, max_v, color, width in channels:
            if not enabled:
                continue
            coords = []
            for idx, item in enumerate(pts):
                x = x_offset + idx * step
                val = max(0.0, min(float(item[key]), max_v))
                y = h - 6 - (val / max_v) * (h - 12)
                coords.extend((x, y))
            c.create_line(*coords, fill=color, width=width)

        if self.hover_idx is not None and 0 <= self.hover_idx < len(pts):
            hx = x_offset + self.hover_idx * step
            c.create_line(hx, 0, hx, h, fill=THEME["accent"], dash=(3, 3), width=1)
            s = pts[self.hover_idx]
            self.scope_cursor_var.set(
                f"SOI ĐIỂM #{self.hover_idx + 1}:  RPM={s['rpm']:,}  |  TPS={s['tps_pct']:.1f}%  |  MAP={s['map_kpa']}kPa  |  INJ={s['inj_ms']:.2f}ms  |  O2={s['o2_volt']:.2f}V"
            )

    def _on_scope_hover(self, event):
        pts = self.scope_history
        w = self.scope_canvas.winfo_width()
        if not pts or w < 40:
            return
        step = w / (self.scope_len - 1)
        x_offset = (self.scope_len - len(pts)) * step
        idx = int(round((event.x - x_offset) / step))
        if 0 <= idx < len(pts):
            self.hover_idx = idx
            self._draw_scope()

    def _draw_map_matrix(self):
        c = self.map_canvas
        w = c.winfo_width()
        h = c.winfo_height()
        if w < 200 or h < 140:
            return
        c.delete("all")

        cols = len(RPM_BINS)
        rows = len(TPS_BINS)
        left_pad = 64
        top_pad = 32
        cell_w = (w - left_pad - 8) / cols
        cell_h = (h - top_pad - 8) / rows

        # Headers
        for j, r_bin in enumerate(RPM_BINS):
            cx = left_pad + j * cell_w + cell_w / 2
            c.create_text(cx, 16, text=f"{r_bin // 1000}k", fill=THEME["muted"], font=("Consolas", 10, "bold"))

        for i, t_bin in enumerate(TPS_BINS):
            # TPS rows from bottom (0%) to top (95%)
            draw_r = rows - 1 - i
            cy = top_pad + draw_r * cell_h + cell_h / 2
            c.create_text(32, cy, text=f"{t_bin}%", fill=THEME["muted"], font=("Consolas", 10, "bold"))

            for j in range(cols):
                x0 = left_pad + j * cell_w
                y0 = top_pad + draw_r * cell_h
                x1 = x0 + cell_w - 2
                y1 = y0 + cell_h - 2

                entry = self.map_cells.get((i, j))
                is_active = self.active_cell == (i, j)
                fill = THEME["surface"] if not entry else THEME["surface_2"]
                outline = THEME["accent"] if is_active else THEME["line"]
                width = 2 if is_active else 1

                c.create_rectangle(x0, y0, x1, y1, fill=fill, outline=outline, width=width)
                if entry and entry[1] > 0:
                    avg = entry[0] / entry[1]
                    if self.map_metric == "INJ":
                        txt = f"{avg:.2f}"
                    elif self.map_metric == "IGN":
                        txt = f"{avg:+.1f}"
                    else:
                        txt = f"{avg:.0f}"
                    c.create_text(
                        (x0 + x1) / 2,
                        (y0 + y1) / 2,
                        text=txt,
                        fill=THEME["accent"] if is_active else THEME["ink"],
                        font=("Consolas", 10, "bold"),
                    )

    def toggle_freeze(self):
        self.scope_frozen = not self.scope_frozen
        self.btn_freeze.configure(
            text="ĐANG ĐÓNG BĂNG" if self.scope_frozen else "Đóng băng (Freeze)",
            fg_color=THEME["accent"] if self.scope_frozen else THEME["surface_2"],
        )

    def on_map_metric_change(self, val: str):
        self.map_metric = "INJ" if "INJ" in val else ("IGN" if "IGN" in val else "MAP")
        self.map_cells.clear()
        for s in self.scope_history:
            self._record_map_cell(s)
        self._draw_map_matrix()

    def clear_map_tracer(self):
        self.map_cells.clear()
        self.active_cell = None
        self._draw_map_matrix()

    # ==========================================================
    # SERIAL & COMMAND HANDLING
    # ==========================================================
    def refresh_ports(self):
        ports = serial.tools.list_ports.comports()
        port_list = []
        best_port = None
        for p in ports:
            port_list.append(p.device)
            desc = (p.description or "").upper()
            if best_port is None and ("CH340" in desc or "USB" in desc or "SERIAL" in desc):
                best_port = p.device

        if not port_list:
            port_list = ["-- Không có cổng --"]

        self.port_menu.configure(values=port_list)
        self.port_menu.set(best_port if best_port else port_list[0])

    def toggle_connection(self):
        if not self.is_connected:
            port = self.port_menu.get()
            if not port or "Không có cổng" in port:
                self.status_text_var.set("Chưa chọn cổng")
                self.status_dot.configure(text_color=THEME["amber"])
                return
            if self.replay_running:
                self.toggle_replay()
            try:
                self.serial_port = serial.Serial(port, 115200, timeout=0.2)
                self.stop_event.clear()
                self.is_connected = True
                self.btn_connect.configure(
                    text="Ngắt kết nối", fg_color=THEME["surface_2"], hover_color=THEME["line"], border_width=1, border_color=THEME["accent"]
                )
                self.status_text_var.set(f"Đang kết nối {port}")
                self.status_dot.configure(text_color=THEME["amber"])

                self.read_thread = threading.Thread(target=self._serial_loop, daemon=True)
                self.read_thread.start()
            except Exception as exc:
                logging.error(f"Open port {port} error: {exc}")
                self.status_text_var.set("Lỗi mở cổng")
                self.status_dot.configure(text_color=THEME["accent"])
        else:
            self._disconnect_serial()

    def _on_serial_disconnected(self):
        self._disconnect_serial()
        self.status_text_var.set("Mất kết nối COM")
        self.status_dot.configure(text_color=THEME["accent"])
        self._append_terminal("!! MẤT KẾT NỐI CỔNG SERIAL / RÚT CÁP USB !!")

    def _disconnect_serial(self):
        self.is_connected = False
        self.stop_event.set()
        if self.serial_port:
            try:
                self.serial_port.close()
            except Exception:
                pass
            self.serial_port = None
        self.btn_connect.configure(
            text="Kết nối ECU", fg_color=THEME["accent"], hover_color=THEME["accent_hover"], border_width=0
        )
        self.status_text_var.set("Đã ngắt kết nối")
        self.status_dot.configure(text_color=THEME["muted"])

    def send_serial_cmd(self, cmd: str):
        self._append_terminal(f">> TX: {cmd.strip()}")
        if not self.is_connected or self.serial_port is None or not self.serial_port.is_open:
            self._append_dtc_msg("Chưa kết nối STM32 (chỉ gửi được lệnh khi đang cắm COM/Bluetooth).")
            return
        try:
            self.serial_port.write(cmd.encode("ascii"))
        except Exception as exc:
            self._append_terminal(f"!! TX ERROR: {exc}")

    def toggle_scs(self):
        self.scs_active = not self.scs_active
        self.btn_scs.configure(
            text="SCS (PB0): Bật" if self.scs_active else "SCS (PB0): Tắt",
            border_color=THEME["accent"] if self.scs_active else THEME["line"],
        )
        self.send_serial_cmd("SCS_ON\r\n" if self.scs_active else "SCS_OFF\r\n")

    def send_custom_table(self):
        val = self.custom_table_entry.get().strip().upper().replace("0X", "")
        if len(val) == 1:
            val = "0" + val
        if len(val) == 2 and all(ch in "0123456789ABCDEF" for ch in val):
            self.send_serial_cmd(f"REQ_TABLE:{val}\r\n")
        else:
            self._append_dtc_msg("Table ID không hợp lệ (nhập 2 ký tự Hex, ví dụ 17 hoặc 20).")

    def _serial_loop(self):
        while self.is_connected and not self.stop_event.is_set():
            ser = self.serial_port
            if ser is None or not ser.is_open:
                break
            try:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                self.after(0, lambda l=line: self._handle_incoming_line(l))
            except (serial.SerialException, OSError) as exc:
                logging.error(f"Serial disconnected: {exc}")
                self.after(0, self._on_serial_disconnected)
                break
            except Exception as exc:
                logging.error(f"Serial read error: {exc}")
                time.sleep(0.05)

    def _handle_incoming_line(self, line: str):
        self._append_terminal(line)
        if "MCU_BOOT:" in line:
            logging.info(f"STM32 RESET DETECTED: {line}")
            self.status_text_var.set("MCU Vừa Reset")
            self.status_dot.configure(text_color=THEME["redline"])
            self.bottom_raw_var.set(line)
            return

        if any(k in line for k in ("Dang danh thuc", "Gui ma", "Hoan tat", "Tu dong ket noi", "SCS:")):
            self.status_text_var.set(line.split("...")[0][:24])
            self.status_dot.configure(text_color=THEME["amber"])
            self.bottom_raw_var.set(f"STM32: {line}")
            return

        pkt = parse_kline_packet(line)
        if pkt is None:
            return

        kind = pkt["kind"]
        if kind == "table11":
            self.status_text_var.set("Đang nhận ECU")
            self.status_dot.configure(text_color=THEME["ok"])
            self.apply_frame(pkt)
        elif kind == "ecmid":
            self.ecm_id_str = pkt["ecm_id"]
            self._append_dtc_msg(f"[ECM ID] {self.ecm_id_str}")
        elif kind == "dtc":
            faults = pkt["faults"]
            if not faults:
                self._append_dtc_msg(f"[Lỗi {pkt['dtc_type']}] Không có mã lỗi nào (ECU Sạch).")
            else:
                for flt in faults:
                    self._append_dtc_msg(f"[Lỗi {pkt['dtc_type']}] MIL #{flt['code']} ({flt['raw']}): {flt['desc']}")
        elif kind == "clear_dtc_ack":
            self._append_dtc_msg("[XÓA LỖI] ECU đã xác nhận xóa sạch bộ nhớ lỗi DTC!")
        elif kind == "custom":
            self._append_dtc_msg(f"[Table {pkt['table']}] {pkt['raw_hex']}")

    def _append_dtc_msg(self, msg: str):
        self.dtc_text.configure(state="normal")
        self.dtc_text.insert("end", msg + "\n")
        self.dtc_text.see("end")
        self.dtc_text.configure(state="disabled")

    def _append_terminal(self, msg: str):
        self.terminal_box.configure(state="normal")
        self.terminal_box.insert("end", msg + "\n")
        lines = int(self.terminal_box.index("end-1c").split(".")[0])
        if lines > 220:
            self.terminal_box.delete("1.0", "25.0")
        self.terminal_box.see("end")
        self.terminal_box.configure(state="disabled")

    # ==========================================================
    # REPLAY, CSV & STATS RESET
    # ==========================================================
    def on_speed_change(self, value: str):
        self.replay_speed = float(value.replace("x", ""))

    def on_slider_scrub(self, value: float):
        if not self.replay_frames:
            return
        idx = max(0, min(int(round(value)), len(self.replay_frames) - 1))
        self.replay_index = idx
        ts, frame = self.replay_frames[idx]
        self.replay_pos_var.set(f"{idx + 1} / {len(self.replay_frames)} · {ts}")
        self.apply_frame(frame)

    def toggle_replay(self):
        if not self.replay_frames:
            return
        if self.replay_running:
            self.replay_running = False
            if self.replay_after_id is not None:
                self.after_cancel(self.replay_after_id)
                self.replay_after_id = None
            self.btn_replay.configure(text="Phát lại Log", fg_color=THEME["surface_2"])
            if not self.is_connected:
                self.status_text_var.set("Tạm dừng Replay")
                self.status_dot.configure(text_color=THEME["muted"])
        else:
            if self.is_connected:
                self._disconnect_serial()
            if self.replay_index >= len(self.replay_frames) - 1:
                self.replay_index = 0
            self.replay_running = True
            self.btn_replay.configure(text="Tạm dừng Replay", fg_color=THEME["accent"])
            self.status_text_var.set("Chế độ Replay Log")
            self.status_dot.configure(text_color=THEME["ok"])
            self._step_replay()

    def _step_replay(self):
        if not self.replay_running or not self.replay_frames:
            return
        ts, frame = self.replay_frames[self.replay_index]
        self.replay_slider.set(self.replay_index)
        self.replay_pos_var.set(f"{self.replay_index + 1} / {len(self.replay_frames)} · {ts}")
        self.apply_frame(frame)

        self.replay_index = (self.replay_index + 1) % len(self.replay_frames)
        delay_ms = max(18, int(100 / self.replay_speed))
        self.replay_after_id = self.after(delay_ms, self._step_replay)

    def toggle_csv(self):
        if not self.csv_recording:
            try:
                is_new = not os.path.exists(CSV_FILE)
                self.csv_file_handle = open(CSV_FILE, "a", newline="", encoding="utf-8")
                self.csv_writer = csv.writer(self.csv_file_handle)
                if is_new:
                    self.csv_writer.writerow([
                        "timestamp", "rpm", "tps_pct", "tps_volt", "map_kpa", "map_volt",
                        "ect_c", "ect_volt", "iat_c", "iat_volt", "vbat",
                        "inj_ms", "inj_duty", "ign_deg", "iacv_stp", "o2_volt", "afr_est", "vss_kmh"
                    ])
                self.csv_recording = True
                self.btn_csv.configure(text="Đang ghi CSV", border_color=THEME["accent"], text_color=THEME["accent"])
            except OSError as exc:
                logging.error(f"CSV open error: {exc}")
        else:
            self._close_csv()

    def _close_csv(self):
        self.csv_recording = False
        if self.csv_file_handle:
            try:
                self.csv_file_handle.close()
            except Exception:
                pass
            self.csv_file_handle = None
            self.csv_writer = None
        self.btn_csv.configure(text="Ghi CSV", border_color=THEME["line"], text_color=THEME["ink"])

    def reset_stats(self):
        self.peak_rpm = 0
        self.max_tps = 0.0
        self.engine_run_sec = 0.0
        self.prev_ect = None
        self.minmax.clear()
        self.rpm_var.set("--")
        self.peak_var.set("PEAK --")
        self.gear_current = "N"
        self.gear_candidate = "N"
        self.gear_confidence = 0
        self.gear_var.set("N")
        self.gear_sub_var.set("MO / DUNG XE")
        if hasattr(self, "casual_gear_lbl"):
            self.casual_gear_lbl.configure(text_color=THEME["gear_n"])
        if hasattr(self, "nerdy_gear_lbl"):
            self.nerdy_gear_lbl.configure(text_color=THEME["gear_n"])
        self.casual_rpm_lbl.configure(text_color=THEME["ink"])
        self.casual_ect_lbl.configure(text_color=THEME["ink"])
        self.casual_bat_lbl.configure(text_color=THEME["ink"])
        self.casual_tps_bar.set(0)
        self.casual_banner_var.set("Chờ dữ liệu từ ECU xe Honda...")
        self.casual_banner_dot.configure(text_color=THEME["muted"])
        self.casual_trip_var.set("Nổ máy: 00:00  ·  Peak: -- RPM  ·  Max Ga: -- %  ·  Min Đề: -- V")
        for key, (v_var, _sub_var, mm_var) in self.eng_vars.items():
            v_var.set("--")
            mm_var.set("PKT #0" if key == "vss" else "MIN -- · MAX --")
        self._draw_shift_bar(
            self.casual_shift_canvas if self.ui_mode == "CASUAL" else self.nerdy_shift_canvas,
            0,
        )
        self.reset_pull_timer()

    def reset_pull_timer(self):
        self.pull_state = "IDLE"
        self.last_pull_sec = None
        self.best_pull_sec = None
        self.pull_status_var.set("CHỜ (< 3,800 RPM để nạp)")
        self.pull_cur_var.set("--.-- s")
        self.pull_best_var.set("BEST: --.-- s")

    def calculate_gear(self, rpm: int, vss: int, now: float) -> str:
        if not rpm or rpm < 350:
            self.gear_current = "--"
            return "--"
        if not vss or vss < 2:
            self.gear_current = "N"
            self.gear_candidate = "N"
            self.gear_confidence = 0
            return "N"

        r = rpm / vss
        cfg = GEAR_PRESETS.get(self.active_gear_preset, GEAR_PRESETS["winner150"])
        ratios = cfg["ratios"]
        tolerance = cfg["tolerance"]

        matched = None
        min_err = 999.0
        for i, target in enumerate(ratios):
            err = abs(r - target) / target
            if err < tolerance and err < min_err:
                min_err = err
                matched = str(i + 1)

        if matched is not None:
            if matched == self.gear_candidate:
                self.gear_confidence += 1
                if self.gear_confidence >= 3:
                    self.gear_current = matched
                    self.gear_last_shift_ts = now
            else:
                self.gear_candidate = matched
                self.gear_confidence = 1
        else:
            self.gear_confidence = 0
            if now - self.gear_last_shift_ts > 0.6:
                self.gear_current = "--"
        return self.gear_current

    # ==========================================================
    # CORE FRAME APPLICATION
    # ==========================================================
    def _update_minmax(self, key: str, val: float, fmt: str = "{:.1f}") -> str:
        rec = self.minmax.get(key)
        if rec is None:
            rec = {"min": val, "max": val}
            self.minmax[key] = rec
        else:
            if val < rec["min"]:
                rec["min"] = val
            if val > rec["max"]:
                rec["max"] = val
        return f"MIN {fmt.format(rec['min'])} · MAX {fmt.format(rec['max'])}"

    def _record_map_cell(self, d: dict):
        rpm = d["rpm"]
        tps = d["tps_pct"]
        if rpm < 600:
            self.active_cell = None
            return
        r_idx = min(range(len(RPM_BINS)), key=lambda i: abs(RPM_BINS[i] - rpm))
        t_idx = min(range(len(TPS_BINS)), key=lambda i: abs(TPS_BINS[i] - tps))
        self.active_cell = (t_idx, r_idx)

        val = d["inj_ms"] if self.map_metric == "INJ" else (d["ign_deg"] if self.map_metric == "IGN" else float(d["map_kpa"]))
        cur = self.map_cells.get((t_idx, r_idx))
        if cur is None:
            self.map_cells[(t_idx, r_idx)] = [val, 1.0]
        else:
            cur[0] += val
            cur[1] += 1.0

    def _update_pull_timer(self, rpm: int, now: float):
        if rpm < 3800 and self.pull_state in ("IDLE", "DONE"):
            self.pull_state = "ARMED"
            self.pull_status_var.set("SẴN SÀNG! Thốc ga vượt 4,000 RPM")
        elif self.pull_state == "ARMED" and rpm >= 4000:
            self.pull_state = "TIMING"
            self.pull_t0 = now
            self.pull_status_var.set("ĐANG ĐO 4,000 → 9,000 RPM...")
        elif self.pull_state == "TIMING":
            elapsed = now - self.pull_t0
            self.pull_cur_var.set(f"{elapsed:.2f} s")
            if rpm >= 9000:
                self.pull_state = "DONE"
                self.last_pull_sec = elapsed
                if self.best_pull_sec is None or elapsed < self.best_pull_sec:
                    self.best_pull_sec = elapsed
                self.pull_status_var.set("HOÀN TẤT 4k→9k")
                self.pull_best_var.set(f"BEST: {self.best_pull_sec:.2f} s")
            elif rpm < 3500:
                self.pull_state = "ARMED"
                self.pull_cur_var.set("--.-- s")
                self.pull_status_var.set("HỦY · SẴN SÀNG LẠI")

    def apply_frame(self, d: dict):
        now = time.perf_counter()
        if self.last_frame_ts is not None and d["rpm"] > 300:
            dt_run = min(now - self.last_frame_ts, 1.0)
            self.engine_run_sec += dt_run
        self.last_frame_ts = now

        self.rate_times.append(now)
        self.frame_count += 1
        hz = 0.0
        if len(self.rate_times) >= 2:
            dt = self.rate_times[-1] - self.rate_times[0]
            if dt > 0:
                hz = (len(self.rate_times) - 1) / dt

        rpm = d["rpm"]
        if rpm > self.peak_rpm:
            self.peak_rpm = rpm
            self.peak_var.set(f"PEAK {self.peak_rpm:,} RPM")
        if d["tps_pct"] > self.max_tps:
            self.max_tps = d["tps_pct"]

        self.rpm_var.set(f"{rpm:,}")
        rpm_color = THEME["redline"] if rpm >= 8200 else THEME["ink"]
        self.nerdy_rpm_lbl.configure(text_color=rpm_color)
        self.casual_rpm_lbl.configure(text_color=rpm_color)
        self.rate_var.set(f"{hz:.1f} Hz · {self.frame_count} PKTS")
        self.bottom_raw_var.set(f"RAW [{hz:.1f} Hz · ECM {self.ecm_id_str}]: {d['raw_hex']}")

        self.dfco_badge.configure(
            fg_color=THEME["accent"] if d["dfco"] else THEME["surface_2"],
            text_color=THEME["ink"] if d["dfco"] else THEME["muted"],
        )

        # Update 10 Engineering Cards (numeric strings only; muted units live beside them)
        tps_frac = min(max(d["tps_pct"] / 100.0, 0.0), 1.0)
        self.casual_tps_bar.set(tps_frac)
        if self.nerdy_tps_bar is not None:
            self.nerdy_tps_bar.set(tps_frac)

        self.eng_vars["tps"][0].set(f"{d['tps_pct']:.1f}")
        self.eng_vars["tps"][1].set(f"{d['tps_volt']:.2f} V · 0x{d['tps_raw']:02X}")
        self.eng_vars["tps"][2].set(self._update_minmax("tps", d["tps_pct"], "{:.1f}%"))

        self.eng_vars["map"][0].set(f"{d['map_kpa']}")
        self.eng_vars["map"][1].set(f"{d['map_volt']:.2f} V · 0x{d['map_raw']:02X}")
        self.eng_vars["map"][2].set(self._update_minmax("map", float(d["map_kpa"]), "{:.0f} kPa"))

        self.eng_vars["inj"][0].set(f"{d['inj_ms']:.2f}")
        self.eng_vars["inj"][1].set(f"Duty {d['inj_duty']:.1f}% · 0x{d['inj_raw']}")
        self.eng_vars["inj"][2].set(self._update_minmax("inj", d["inj_ms"], "{:.2f} ms"))
        self.eng_val_labels["inj"].configure(text_color=THEME["accent"] if d["inj_duty"] >= 85 else THEME["ink"])

        ign_sign = "+" if d["ign_deg"] > 0 else ""
        self.eng_vars["ign"][0].set(f"{ign_sign}{d['ign_deg']:.1f}")
        self.eng_vars["ign"][1].set(f"BTDC · 0x{d['ign_raw']:02X}")
        self.eng_vars["ign"][2].set(self._update_minmax("ign", d["ign_deg"], "{:.1f}°"))

        self.eng_vars["o2"][0].set(f"{d['o2_volt']:.2f}")
        self.eng_vars["o2"][1].set(f"AFR ~ {d['afr_est']}:1 · 0x{d['o2_raw']:02X}")
        self.eng_vars["o2"][2].set(self._update_minmax("o2", d["o2_volt"], "{:.2f}V"))

        self.eng_vars["iacv"][0].set(f"{d['iacv_stp']}")
        self.eng_vars["iacv"][1].set(f"Bước van · 0x{d['iacv_stp']:02X}")
        self.eng_vars["iacv"][2].set(self._update_minmax("iacv", float(d["iacv_stp"]), "{:.0f}"))

        ect = d["ect_c"]
        if self.prev_ect is None:
            ect_trend = "→"
        elif ect > self.prev_ect:
            ect_trend = "↑"
        elif ect < self.prev_ect:
            ect_trend = "↓"
        else:
            ect_trend = "→"
        self.prev_ect = ect

        if ect > 105:
            ect_col = THEME["redline"]
        elif ect < 55:
            ect_col = THEME["cyan"]
        elif ect <= 98:
            ect_col = THEME["ok"]
        else:
            ect_col = THEME["amber"]
        ect_mm = self._update_minmax("ect", float(ect), "{:.0f}°")
        self.eng_vars["ect"][0].set(f"{ect}")
        self.eng_vars["ect"][1].set(f"{d['ect_volt']:.2f} V · 0x{d['ect_raw']:02X}")
        self.eng_vars["ect"][2].set(f"Xu hướng {ect_trend} · {ect_mm}")
        self.eng_val_labels["ect"].configure(text_color=ect_col)
        self.casual_ect_lbl.configure(text_color=ect_col)

        self.eng_vars["iat"][0].set(f"{d['iat_c']}")
        self.eng_vars["iat"][1].set(f"{d['iat_volt']:.2f} V · 0x{d['iat_raw']:02X}")
        self.eng_vars["iat"][2].set(self._update_minmax("iat", float(d["iat_c"]), "{:.0f}°"))

        vbat = d["vbat"]
        low_bat = rpm > 1000 and vbat < 11.8
        if vbat < 11.8:
            bat_col = THEME["redline"] if low_bat else THEME["amber"]
        elif vbat >= 13.3:
            bat_col = THEME["ok"]
        else:
            bat_col = THEME["ink"]
        self._update_minmax("vbat", vbat, "{:.1f}V")
        min_v = self.minmax["vbat"]["min"]
        max_v = self.minmax["vbat"]["max"]
        self.eng_vars["vbat"][0].set(f"{vbat:.1f}")
        self.eng_vars["vbat"][1].set("Đang sạc" if vbat >= 13.3 else ("Yếu bình!" if vbat < 11.8 else "Ắc quy nghỉ"))
        self.eng_vars["vbat"][2].set(f"Min Đề {min_v:.1f}V · Max {max_v:.1f}V")
        self.eng_val_labels["vbat"].configure(text_color=bat_col)
        self.casual_bat_lbl.configure(text_color=bat_col)

        self.eng_vars["vss"][0].set(f"{d['vss_kmh']}")
        self.eng_vars["vss"][1].set("CSUM OK")
        self.eng_vars["vss"][2].set(f"PKT #{self.frame_count}")

        # Virtual Gear Estimator Calculation & Visual Update
        gear_val = self.calculate_gear(rpm, d["vss_kmh"], now)
        self.gear_var.set(gear_val)
        if gear_val == "N":
            gear_col = THEME["gear_n"]
            self.gear_sub_var.set("MO / DUNG XE")
        elif gear_val == "--":
            gear_col = THEME["muted"]
            self.gear_sub_var.set("CAT CON / SANG SO")
        else:
            gear_col = THEME["gear_num"]
            self.gear_sub_var.set(f"CAP SO {gear_val}")

        if hasattr(self, "casual_gear_lbl"):
            self.casual_gear_lbl.configure(text_color=gear_col)
        if hasattr(self, "nerdy_gear_lbl"):
            self.nerdy_gear_lbl.configure(text_color=gear_col)

        # Casual diagnostic banner & trip summary (contextual insight without duplicating numbers)
        if ect > 105:
            self.casual_banner_var.set("CẢNH BÁO QUÁ NHIỆT MÁY · Dừng xe kiểm tra nước mát ngay")
            self.casual_banner_dot.configure(text_color=THEME["redline"])
        elif low_bat:
            self.casual_banner_var.set("ĐIỆN SẠC YẾU · Kiểm tra sạc hoặc ắc quy khi đang nổ máy")
            self.casual_banner_dot.configure(text_color=THEME["amber"])
        elif rpm == 0:
            bat_note = "Điện bình ổn, sẵn sàng nổ máy" if vbat >= 12.0 else "Bình hơi yếu, chú ý lúc bấm đề"
            self.casual_banner_var.set(f"Bật khóa chờ đề · {bat_note}")
            self.casual_banner_dot.configure(text_color=THEME["muted"])
        elif ect < 55:
            self.casual_banner_var.set("Máy đang nguội · Chạy nhẹ ga cho máy ấm đều")
            self.casual_banner_dot.configure(text_color=THEME["cyan"])
        else:
            chg_note = "Hệ thống sạc khỏe" if vbat >= 13.3 else "Đang nổ máy"
            self.casual_banner_var.set(f"Vận hành ổn định · {chg_note} · Nhiệt đạt chuẩn")
            self.casual_banner_dot.configure(text_color=THEME["ok"])

        mins = int(self.engine_run_sec // 60)
        secs = int(self.engine_run_sec % 60)
        self.casual_trip_var.set(
            f"Nổ máy: {mins:02d}:{secs:02d}  ·  Peak: {self.peak_rpm:,} RPM  ·  Max Ga: {self.max_tps:.1f}%  ·  Min Đề: {min_v:.1f}V"
        )

        # Scope & Map & Pull updates
        if not self.scope_frozen:
            self.scope_history.append(d)
        self._record_map_cell(d)
        self._update_pull_timer(rpm, now)

        # Redraw visible canvas
        if self.ui_mode == "CASUAL":
            self._draw_shift_bar(self.casual_shift_canvas, rpm)
        else:
            if self.active_nerdy_tab == "LIVE BENCH":
                self._draw_shift_bar(self.nerdy_shift_canvas, rpm)
            elif self.active_nerdy_tab == "SCOPE & PULL":
                self._draw_scope()
            elif self.active_nerdy_tab == "MAP TRACER (RPM×TPS)":
                self._draw_map_matrix()

        if self.csv_recording and self.csv_writer:
            ts_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            self.csv_writer.writerow([
                ts_str, rpm, d["tps_pct"], d["tps_volt"], d["map_kpa"], d["map_volt"],
                ect, d["ect_volt"], d["iat_c"], d["iat_volt"], vbat,
                d["inj_ms"], d["inj_duty"], d["ign_deg"], d["iacv_stp"], d["o2_volt"], d["afr_est"], d["vss_kmh"],
            ])

    def on_close(self):
        self.replay_running = False
        if self.replay_after_id is not None:
            try:
                self.after_cancel(self.replay_after_id)
            except Exception:
                pass
        self._disconnect_serial()
        self._close_csv()
        self.destroy()


if __name__ == "__main__":
    app = HondaRacingDashboard()
    app.mainloop()
