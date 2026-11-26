#!/usr/bin/env python3
"""
Local Dev & Debug Workbench for Honda K-Line Android WebUI.
Serves software/android-apk/assets/www/ directly in Chrome/Edge (with DevTools & Phone Wi-Fi OTA APK install)
so WebUI, animations, Gear Pull-Learn, and live COM passthrough can be iterated without reinstalling the APK.
"""

import argparse
import functools
import http.server
import json
import mimetypes
import os
import queue
import socket
import socketserver
import threading
import time
from urllib.parse import urlparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WWW_DIR = os.path.join(SCRIPT_DIR, "assets", "www")
APK_PATH = os.path.join(SCRIPT_DIR, "honda-kline-racing.apk")

DEV_INJECT_SCRIPT = r"""
<script>
(function () {
  if (window.__KLINE_DEV_INJECTED__) return;
  window.__KLINE_DEV_INJECTED__ = true;

  // Mock native AndroidBT bridge when debugging in PC Chrome / Edge
  if (typeof window.AndroidBT === "undefined") {
    const devLogs = [];
    const DEV_FILES_KEY = "kline_dev_session_files";
    const loadFiles = () => {
      try { return JSON.parse(localStorage.getItem(DEV_FILES_KEY) || "{}"); } catch (_) { return {}; }
    };
    const saveFiles = (map) => {
      try { localStorage.setItem(DEV_FILES_KEY, JSON.stringify(map)); } catch (_) {}
    };
    window.AndroidBT = {
      hasPermissions: () => true,
      requestBtPermissions: () => {},
      isBluetoothEnabled: () => true,
      getPairedAndScan: () => {
        window.__onBtPaired && window.__onBtPaired(JSON.stringify([
          { name: "HC-05 K-LINE (DEV MOCK)", mac: "00:21:13:05:AA:BB" }
        ]));
      },
      connectSpp: (mac) => {
        window.__onBtStatus && window.__onBtStatus("connected", "Mock SPP · " + mac);
      },
      connectBle: (mac) => {
        window.__onBtStatus && window.__onBtStatus("connected", "Mock BLE · " + mac);
      },
      send: (txt) => {
        devLogs.push("[MOCK TX] " + String(txt).trim());
      },
      disconnect: () => {
        window.__onBtStatus && window.__onBtStatus("disconnected", "Mock Disconnected");
      },
      connectUsb: () => {
        window.__onBtStatus && window.__onBtStatus("connected", "Mock USB CH340 (115200)");
      },
      getUsbDevices: () => "[]",
      disconnectUsb: () => {
        window.__onBtStatus && window.__onBtStatus("disconnected", "Mock USB Ngắt kết nối");
      },
      sendWakeup: () => {},
      getUsbStatus: () => JSON.stringify({ isConnected: false }),
      getUsbDebugInfo: () => JSON.stringify({
        hasDevice: true, chipName: "CH340 (DEV MOCK)", vid: "0x1A86", pid: "0x7523",
        hasPermission: true, isConnected: false, rxBytes: 0, rxPackets: 0, lastRxPreview: "Dev Server"
      }),
      saveSessionCsv: (fname, content) => {
        const files = loadFiles();
        files[fname] = { content: String(content || ""), modifiedMs: Date.now() };
        saveFiles(files);
        devLogs.push("[SAVE] " + fname + " (" + String(content || "").length + " B)");
        return "DEV_MOCK://" + fname;
      },
      listSessionFiles: () => {
        const files = loadFiles();
        return JSON.stringify(Object.keys(files).map((name) => ({
          name,
          sizeBytes: files[name].content.length,
          modifiedMs: files[name].modifiedMs || Date.now(),
          kind: name.toLowerCase().endsWith(".csv") ? "rec" : "log"
        })).sort((a, b) => b.modifiedMs - a.modifiedMs));
      },
      readSessionFile: (fname) => {
        const files = loadFiles();
        return files[fname] ? files[fname].content : "";
      },
      deleteSessionFile: (fname) => {
        const files = loadFiles();
        if (!files[fname]) return false;
        delete files[fname];
        saveFiles(files);
        return true;
      },
      exportSessionToDownloads: (fname) => "DEV_DOWNLOAD://" + fname,
      logDebug: (lvl, msg) => { devLogs.push("[" + lvl + "] " + msg); },
      getAppDebugLogs: () => devLogs.join("\n")
    };
  }

  function encodeTable11(opts) {
    const rpm = Math.max(0, Math.round(opts.rpm || 0));
    const tpsPct = Math.max(0, Math.min(100, opts.tpsPct || 0));
    const tpsRaw = Math.min(255, Math.round(tpsPct * 1.56));
    const ectC = Math.round(opts.ectC ?? 84);
    const iatC = Math.round(opts.iatC ?? 34);
    const mapKpa = Math.round(opts.mapKpa ?? 38);
    const vbat = opts.vbat ?? 14.1;
    const vss = Math.max(0, Math.min(255, Math.round(opts.vssKmh || 0)));
    const injMs = opts.injMs ?? 2.3;
    const injRaw = Math.round(injMs / 0.00390625);
    const ignDeg = opts.ignDeg ?? 18;
    const iacv = Math.round(opts.iacv ?? 34);
    const o2V = opts.o2V ?? 0.65;

    const buf = new Array(25).fill(0);
    buf[0] = 0x02; buf[1] = 0x19; buf[2] = 0x71; buf[3] = 0x11;
    buf[4] = (rpm >> 8) & 0xFF; buf[5] = rpm & 0xFF;
    buf[6] = Math.min(255, Math.round((0.45 + (tpsPct / 100) * 4.0) * 256 / 5));
    buf[7] = tpsRaw;
    buf[8] = 70; buf[9] = Math.max(0, Math.min(255, ectC + 40));
    buf[10] = 100; buf[11] = Math.max(0, Math.min(255, iatC + 40));
    buf[12] = Math.min(255, Math.round((mapKpa / 25) * 256 / 5));
    buf[13] = mapKpa;
    buf[14] = 0xFF; buf[15] = 0xFF;
    buf[16] = Math.round(vbat * 10);
    buf[17] = vss;
    buf[18] = (injRaw >> 8) & 0xFF; buf[19] = injRaw & 0xFF;
    buf[20] = Math.max(0, Math.min(255, Math.round(ignDeg / 0.5 + 128)));
    buf[21] = iacv;
    buf[22] = 0x14;
    buf[23] = Math.min(255, Math.round(o2V * 256));
    let sum = 0;
    for (let i = 0; i < 24; i++) sum += buf[i];
    buf[24] = (256 - (sum & 0xFF)) & 0xFF;
    return buf.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  }

  window.__klineDev = {
    simTimer: null,
    sse: null,
    stopAll() {
      if (this.simTimer) { clearInterval(this.simTimer); this.simTimer = null; }
      if (this.sse) { this.sse.close(); this.sse = null; }
    },
    sendFrame(opts) {
      window.__onBtLine && window.__onBtLine(encodeTable11(opts));
    },
    runScenario(kind) {
      this.stopAll();
      let step = 0;
      window.__onBtStatus && window.__onBtStatus("connected", "DEV SIM · " + kind.toUpperCase());
      this.simTimer = setInterval(() => {
        step += 1;
        if (kind === "idle") {
          this.sendFrame({ rpm: 1450 + Math.sin(step * 0.4) * 65, tpsPct: 0, vssKmh: 0, ectC: 84, mapKpa: 34 });
        } else if (kind === "pull1") {
          const p = (step % 45) / 45;
          const rpm = 2600 + p * 7400;
          const vss = rpm / 184;
          this.sendFrame({ rpm, tpsPct: 88, vssKmh: vss, ectC: 88, mapKpa: 95, injMs: 8.6, ignDeg: 29 });
        } else if (kind === "ride1to6") {
          const ratios = [184, 124, 91, 73, 63, 55];
          const gearIdx = Math.min(5, Math.floor((step % 150) / 25));
          const subP = ((step % 25) / 25);
          const rpm = 4200 + subP * 5400;
          const vss = rpm / ratios[gearIdx];
          this.sendFrame({ rpm, tpsPct: 72, vssKmh: vss, ectC: 89, mapKpa: 89, injMs: 7.4, ignDeg: 27 });
        } else if (kind === "clutch") {
          const phase = step % 24;
          const rpm = phase < 10 ? 6400 : Math.max(1800, 6400 - (phase - 10) * 650);
          this.sendFrame({ rpm, tpsPct: phase < 10 ? 55 : 0, vssKmh: 46, ectC: 86, mapKpa: 45 });
        } else if (kind === "dfco") {
          this.sendFrame({ rpm: 5200, tpsPct: 0, vssKmh: 68, injMs: 0.0, ectC: 85, mapKpa: 22 });
        } else if (kind === "dtc") {
          this.sendFrame({ rpm: 1450, tpsPct: 0, vssKmh: 0, ectC: 92 });
          if (step === 2) window.__onBtLine && window.__onBtLine("02 07 71 73 08 11 FA");
        }
      }, 150);
    },
    connectLiveCom() {
      this.stopAll();
      this.sse = new EventSource("/api/stream");
      this.sse.onopen = () => window.__onBtStatus && window.__onBtStatus("connected", "LIVE COM STREAM");
      this.sse.onmessage = (ev) => { window.__onBtLine && window.__onBtLine(ev.data); };
      this.sse.onerror = () => window.__onBtStatus && window.__onBtStatus("disconnected", "COM Stream Closed");
    }
  };

  window.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.id = "klineDevToolbar";
    bar.style.cssText = "position:fixed;bottom:74px;left:10px;z-index:9999;font-family:sans-serif;font-size:11px;";
    bar.innerHTML = `
      <button id="klineDevToggle" type="button" style="background:#131824;color:#00E5FF;border:1px solid rgba(0,229,255,0.45);border-radius:999px;padding:5px 10px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.5);">DEV SIM</button>
      <div id="klineDevPanel" style="display:none;margin-top:6px;background:#0D111A;border:1px solid rgba(255,255,255,0.16);border-radius:12px;padding:8px;max-width:300px;box-shadow:0 12px 30px rgba(0,0,0,0.7);gap:5px;flex-wrap:wrap;">
        <button data-sim="idle" style="padding:4px 7px;background:#1a2232;color:#eee;border:0;border-radius:6px;cursor:pointer;">Idle</button>
        <button data-sim="pull1" style="padding:4px 7px;background:#FF4D1A;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:700;">Pull Số 1</button>
        <button data-sim="ride1to6" style="padding:4px 7px;background:#00E5FF;color:#000;border:0;border-radius:6px;cursor:pointer;font-weight:700;">Chạy 1→6</button>
        <button data-sim="clutch" style="padding:4px 7px;background:#1a2232;color:#eee;border:0;border-radius:6px;cursor:pointer;">Cắt côn</button>
        <button data-sim="dfco" style="padding:4px 7px;background:#1a2232;color:#eee;border:0;border-radius:6px;cursor:pointer;">DFCO</button>
        <button data-sim="dtc" style="padding:4px 7px;background:#1a2232;color:#ff8a96;border:0;border-radius:6px;cursor:pointer;">DTC Lỗi</button>
        <button id="devBtnLiveCom" style="padding:4px 7px;background:#00E676;color:#000;border:0;border-radius:6px;cursor:pointer;font-weight:700;">Live COM</button>
        <button id="devBtnStop" style="padding:4px 7px;background:#333;color:#ccc;border:0;border-radius:6px;cursor:pointer;">Stop</button>
      </div>`;
    document.body.appendChild(bar);
    const panel = document.getElementById("klineDevPanel");
    document.getElementById("klineDevToggle").onclick = () => {
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    };
    panel.querySelectorAll("[data-sim]").forEach((b) => {
      b.onclick = () => window.__klineDev.runScenario(b.dataset.sim);
    });
    document.getElementById("devBtnLiveCom").onclick = () => window.__klineDev.connectLiveCom();
    document.getElementById("devBtnStop").onclick = () => window.__klineDev.stopAll();

    const params = new URLSearchParams(window.location.search);
    if (params.get("hidebar") === "1") bar.style.display = "none";
    const autoPage = params.get("page");
    if (autoPage && window.__klineApp) window.__klineApp.syncModeAndPages(autoPage);
    const autoSim = params.get("sim");
    if (autoSim === "demo" && window.__klineApp) window.__klineApp.toggleDemo(true);
    else if (autoSim) window.__klineDev.runScenario(autoSim);
  });
})();
</script>
"""


class SerialBroadcaster:
    def __init__(self, port=None, baud=115200):
        self.port = port
        self.baud = baud
        self.clients = []
        self.lock = threading.Lock()
        self.running = False

    def start(self):
        if not self.port:
            return
        try:
            import serial  # type: ignore
        except ImportError:
            print("[WARN] pyserial not installed; --port ignored.")
            return
        self.running = True
        t = threading.Thread(target=self._loop, args=(serial,), daemon=True)
        t.start()

    def _loop(self, serial_mod):
        while self.running:
            try:
                with serial_mod.Serial(self.port, self.baud, timeout=0.5) as ser:
                    print(f"[COM] Listening on {self.port} @ {self.baud}")
                    while self.running:
                        raw = ser.readline()
                        if raw:
                            line = raw.decode("ascii", errors="ignore").strip()
                            if line:
                                self.publish(line)
            except Exception as exc:
                print(f"[COM] Reconnecting {self.port}: {exc}")
                time.sleep(2.0)

    def subscribe(self):
        q = queue.Queue(maxsize=100)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def publish(self, line):
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(line)
                except queue.Full:
                    pass


class ThreadingHttpServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def make_handler(broadcaster):
    class DevRequestHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=WWW_DIR, **kwargs)

        def log_message(self, fmt, *args):
            pass

        def do_GET(self):
            parsed = urlparse(self.path)
            req_path = parsed.path

            if req_path in ("/", "/www", "/www/"):
                self.send_response(302)
                self.send_header("Location", "/www/index.html")
                self.end_headers()
                return

            if req_path == "/api/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "comPort": broadcaster.port}).encode("utf-8"))
                return

            if req_path == "/api/stream":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                q = broadcaster.subscribe()
                try:
                    while True:
                        line = q.get()
                        self.wfile.write(f"data: {line}\n\n".encode("utf-8"))
                        self.wfile.flush()
                except Exception:
                    pass
                finally:
                    broadcaster.unsubscribe(q)
                return

            if req_path == "/apk":
                if not os.path.isfile(APK_PATH):
                    self.send_error(404, "APK not built yet. Run build_apk.ps1 first.")
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.android.package-archive")
                self.send_header("Content-Disposition", 'attachment; filename="honda-kline-racing.apk"')
                self.send_header("Content-Length", str(os.path.getsize(APK_PATH)))
                self.end_headers()
                with open(APK_PATH, "rb") as fh:
                    while True:
                        chunk = fh.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                return

            if req_path.startswith("/www/"):
                rel = req_path[len("/www/"):]
            else:
                rel = req_path.lstrip("/")

            full_path = os.path.normpath(os.path.join(WWW_DIR, rel))
            if not full_path.startswith(os.path.normpath(WWW_DIR)) or not os.path.isfile(full_path):
                self.send_error(404, "Not found")
                return

            if os.path.basename(full_path) == "index.html":
                with open(full_path, "r", encoding="utf-8") as fh:
                    html = fh.read()
                injected = html.replace("</body>", DEV_INJECT_SCRIPT + "\n</body>")
                data = injected.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

            ctype, _ = mimetypes.guess_type(full_path)
            with open(full_path, "rb") as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return DevRequestHandler


def get_lan_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def main():
    parser = argparse.ArgumentParser(description="Honda K-Line Android WebUI Dev Server & Wi-Fi APK Distributor")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port (default 8765)")
    parser.add_argument("--com", default=None, help="Optional live COM port (e.g. COM4) for SSE passthrough")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baudrate (default 115200)")
    args = parser.parse_args()

    broadcaster = SerialBroadcaster(args.com, args.baud)
    broadcaster.start()

    server = ThreadingHttpServer((args.host, args.port), make_handler(broadcaster))
    print(f"\n[Honda K-Line Dev Server] Serving {WWW_DIR}")
    print(f"  Local UI  : http://127.0.0.1:{args.port}/www/index.html")
    for ip in get_lan_ips():
        print(f"  Phone UI  : http://{ip}:{args.port}/www/index.html")
        print(f"  Wi-Fi APK : http://{ip}:{args.port}/apk")
    print("  Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dev server...")
    finally:
        broadcaster.running = False
        server.server_close()


if __name__ == "__main__":
    main()
