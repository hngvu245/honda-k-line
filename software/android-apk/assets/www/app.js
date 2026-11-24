(function () {
  "use strict";

  const HONDA_DTC_DICT = {
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
    54: "Lỗi cảm biến góc nghiêng xe (Bank Angle)"
  };

  const RPM_BINS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
  const TPS_BINS = [0, 10, 20, 35, 50, 65, 80, 95];
  const LED_COUNT = 26;
  const MAX_RPM_SCALE = 13000;
  const MAX_SCOPE = 140;

  // Virtual Gear Estimator Configuration & State
  const GEAR_PRESETS = {
    winner150: {
      name: "Honda Winner X / CBR150 (6 số)",
      gears: 6,
      ratios: [160.8, 107.5, 78.2, 62.6, 54.1, 47.4],
      tolerance: 0.10
    },
    wave110: {
      name: "Honda Wave / Future (4 số)",
      gears: 4,
      ratios: [135.0, 82.0, 58.0, 44.0],
      tolerance: 0.10
    },
    exciter150: {
      name: "Yamaha Exciter 150 (5 số)",
      gears: 5,
      ratios: [145.0, 96.0, 72.0, 57.0, 48.0],
      tolerance: 0.10
    }
  };

  let activeGearPreset = localStorage.getItem("kline_gear_preset") || "winner150";
  let customRatios = null;
  try {
    customRatios = JSON.parse(localStorage.getItem("kline_custom_ratios"));
  } catch (_e) {}

  let gearState = {
    current: "N",
    candidate: "N",
    confidence: 0,
    lastShiftTs: 0
  };

  function calculateGear(rpm, vss) {
    if (!rpm || rpm < 350) {
      gearState.current = "--";
      return "--";
    }
    // Standstill (VSS < 2 km/h) with engine running -> Neutral
    if (!vss || vss < 2) {
      gearState.current = "N";
      gearState.candidate = "N";
      gearState.confidence = 0;
      return "N";
    }

    const r = rpm / vss;
    const cfg = GEAR_PRESETS[activeGearPreset] || GEAR_PRESETS.winner150;
    const ratios = (customRatios && Array.isArray(customRatios)) ? customRatios : cfg.ratios;

    let matched = null;
    let minErr = Infinity;
    for (let i = 0; i < ratios.length; i++) {
      const target = ratios[i];
      const err = Math.abs(r - target) / target;
      if (err < cfg.tolerance && err < minErr) {
        minErr = err;
        matched = String(i + 1);
      }
    }

    const now = performance.now();
    if (matched !== null) {
      if (matched === gearState.candidate) {
        gearState.confidence++;
        if (gearState.confidence >= 3) {
          gearState.current = matched;
          gearState.lastShiftTs = now;
        }
      } else {
        gearState.candidate = matched;
        gearState.confidence = 1;
      }
    } else {
      gearState.confidence = 0;
      if (now - gearState.lastShiftTs > 600) {
        gearState.current = "--";
      }
    }
    return gearState.current;
  }

  // Odometer & Trip Computer
  let odoMeters = parseFloat(localStorage.getItem("kline_odo_m") || "506000");
  let tripMeters = parseFloat(localStorage.getItem("kline_trip_m") || "0");
  let lastOdoTs = null;

  function updateOdometer(vssKmh) {
    const now = performance.now();
    if (lastOdoTs !== null && vssKmh > 0) {
      const dtSec = Math.min(2.0, (now - lastOdoTs) / 1000.0);
      const deltaMeters = (vssKmh * 1000.0 / 3600.0) * dtSec;
      odoMeters += deltaMeters;
      tripMeters += deltaMeters;
    }
    lastOdoTs = now;
  }

  let uiMode = localStorage.getItem("kline_ui_mode") || "casual";
  let activeCasualTab = "overview";
  let activeNerdyTab = "sensors";
  let redlineRpm = parseInt(localStorage.getItem("kline_redline") || "9000", 10);

  let trip = loadTrip();
  let oilHoursBase = parseFloat(localStorage.getItem("kline_oil_sec") || "0");

  // Signal / Connection State (-- everywhere until live frame arrives)
  let hasLiveSignal = false;
  let sweepActive = false;
  let sweepStartTs = 0;
  let latestFrame = null;
  let btConnected = false;
  let usbConnected = false;

  let frameCount = 0;
  let lastFrameTs = null;
  let prevEct = null;
  let maxEctSession = null;
  const scopeHistory = [];
  const scopeEnabled = { rpm: true, tps: true, map: true, inj: false, o2: false };
  let scopeFrozen = false;
  let scopeHoverIdx = null;
  let strobePhase = false;
  let scsActive = false;
  let faultCount = 0;

  const minmax = {};
  const mapCells = {};
  let activeCellKey = null;
  let mapMetric = "INJ";

  let pullState = "IDLE";
  let pullT0 = 0;
  let pullBest = null;

  // CSV REC Session Logger
  let isRecording = false;
  let recStartMs = 0;
  let recRows = [];

  const sampleFrames = Array.isArray(window.SAMPLE_FRAMES) ? window.SAMPLE_FRAMES : [];
  let replayRunning = false;
  let replayIndex = 0;
  let replaySpeed = 1;
  let replayTimer = null;

  function loadTrip() {
    try {
      const s = JSON.parse(localStorage.getItem("kline_trip_v2") || "{}");
      return {
        runSec: s.runSec || 0,
        peakRpm: s.peakRpm || 0,
        peakVss: s.peakVss || 0,
        maxTps: s.maxTps || 0,
        warnCount: s.warnCount || 0,
        minBat: s.minBat || null,
        maxBat: s.maxBat || null
      };
    } catch (_e) {
      return { runSec: 0, peakRpm: 0, peakVss: 0, maxTps: 0, warnCount: 0, minBat: null, maxBat: null };
    }
  }

  function saveTrip() {
    try {
      localStorage.setItem("kline_trip_v2", JSON.stringify(trip));
      localStorage.setItem("kline_oil_sec", String(oilHoursBase));
      localStorage.setItem("kline_odo_m", odoMeters.toFixed(1));
      localStorage.setItem("kline_trip_m", tripMeters.toFixed(1));
    } catch (_e) {}
  }

  function decodeDtcByte(b) {
    const hi = b >> 4;
    const lo = b & 0x0F;
    const bcd = (hi <= 9 && lo <= 9) ? (hi * 10 + lo) : b;
    const code = HONDA_DTC_DICT[bcd] ? bcd : (HONDA_DTC_DICT[b] ? b : bcd);
    const desc = HONDA_DTC_DICT[code] || ("Mã lỗi Honda #" + code + " (0x" + b.toString(16).toUpperCase().padStart(2, "0") + ")");
    return { code, raw: "0x" + b.toString(16).toUpperCase().padStart(2, "0"), desc };
  }

  function parseKlinePacket(line) {
    if (!line || typeof line !== "string") return null;
    let cleaned = line.trim();
    if (cleaned.includes("RAW:")) cleaned = cleaned.split("RAW:")[1].trim();
    if (cleaned.includes("Data khac:")) cleaned = cleaned.replace("Data khac:", "").trim();
    if (cleaned.includes("T11:")) cleaned = cleaned.split("T11:")[1].trim();

    const parts = cleaned.split(/\s+/);
    const bytes = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (/^[0-9a-fA-F]{1,2}$/.test(p)) {
        bytes.push(parseInt(p, 16));
      }
    }
    if (bytes.length < 4) return null;

    for (let i = 0; i <= bytes.length - 4; i++) {
      if (bytes[i] !== 0x02) continue;
      const len = bytes[i + 1];
      if (len < 4 || i + len > bytes.length) continue;

      let sum = 0;
      for (let j = 0; j < len; j++) sum += bytes[i + j];
      if ((sum & 0xFF) !== 0) continue;

      const ecu = bytes.slice(i, i + len);
      const svc = ecu[2];
      const tbl = ecu[3];

      if (svc === 0x71 && tbl === 0x11 && len === 0x19) {
        const rpm = (ecu[4] << 8) | ecu[5];
        const tpsVolt = (ecu[6] * 5.0) / 256.0;
        const tpsPct = Math.min(Math.round((ecu[7] / 1.56) * 10) / 10, 100.0);
        const ectVolt = (ecu[8] * 5.0) / 256.0;
        const ectC = ecu[9] - 40;
        const iatVolt = (ecu[10] * 5.0) / 256.0;
        const iatC = ecu[11] - 40;
        const mapVolt = (ecu[12] * 5.0) / 256.0;
        const mapKpa = ecu[13];
        const vbat = Math.round((ecu[16] / 10.0) * 10) / 10;
        const vssKmh = ecu[17];
        const injMs = ((ecu[18] << 8) | ecu[19]) * 0.00390625;
        const ignDeg = (ecu[20] - 128) * 0.5;
        const iacvStp = ecu[21];
        const o2Volt = ecu[23] / 256.0;
        const dfco = rpm > 2200 && ecu[7] === 0 && injMs < 0.01;
        const injDuty = Math.min(Math.round(((rpm * injMs) / 1200.0) * 10) / 10, 100.0);
        const afrEst = dfco ? "CUT" : (rpm === 0 ? "--" : Math.max(11.8, Math.min(16.5, 16.2 - o2Volt * 3.8)).toFixed(1));

        return {
          kind: "table11",
          rpm, tpsVolt, tpsPct, tpsRaw: ecu[7],
          ectVolt, ectC, iatVolt, iatC, mapVolt, mapKpa,
          vbat, vssKmh, injMs, injDuty, ignDeg, iacvStp, o2Volt, afrEst, dfco,
          rawHex: ecu.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")
        };
      }

      if (svc === 0x71 && tbl === 0x00 && len >= 6) {
        return {
          kind: "ecmid",
          ecmId: ecu.slice(4, len - 1).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")
        };
      }

      if (svc === 0x71 && (tbl === 0x73 || tbl === 0x74)) {
        const dtcType = tbl === 0x73 ? "Hiện tại" : "Quá khứ";
        const faults = [];
        for (let k = 4; k < len - 1; k++) {
          if (ecu[k] !== 0x00 && ecu[k] !== 0xFF) faults.push(decodeDtcByte(ecu[k]));
        }
        return { kind: "dtc", dtcType, faults };
      }

      if (svc === 0x60) return { kind: "clear_dtc_ack" };

      return {
        kind: "custom",
        table: "0x" + tbl.toString(16).toUpperCase().padStart(2, "0"),
        rawHex: ecu.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")
      };
    }
    return null;
  }

  function parseTable11Line(line) {
    const p = parseKlinePacket(line);
    return p && p.kind === "table11" ? p : null;
  }

  if (typeof document === "undefined") {
    return;
  }

  const $ = (id) => document.getElementById(id);

  // Build 26 slanted segments (500 RPM each) + mathematical 0..13 tick marks
  function buildTach(ledsEl, scaleEl) {
    const arr = [];
    for (let i = 0; i < LED_COUNT; i++) {
      const s = document.createElement("div");
      s.className = "sled";
      ledsEl.appendChild(s);
      arr.push(s);
    }
    for (let k = 0; k <= 13; k++) {
      const tk = document.createElement("div");
      const isRed = k >= 10;
      tk.className = "scale-tick" + (k === 0 ? " is-first" : (k === 13 ? " is-last" : "")) + (isRed ? " is-redline" : "");
      tk.style.left = ((k / 13) * 100).toFixed(4) + "%";
      tk.innerHTML = "<i></i><span>" + k + "</span>";
      scaleEl.appendChild(tk);
    }
    return arr;
  }

  const ledsCasual = buildTach($("pCasualLeds"), $("pCasualScale"));
  const ledsNerdy = buildTach($("pNerdyLeds"), $("pNerdyScale"));
  const ledsLand = buildTach($("lShiftLeds"), $("lShiftScale"));

  function updateLeds(arr, rpm, peak) {
    if (rpm >= redlineRpm + 800) strobePhase = !strobePhase;
    else strobePhase = false;
    const litCount = Math.min(LED_COUNT, Math.floor((rpm / MAX_RPM_SCALE) * LED_COUNT));
    const redStart = Math.max(20, Math.floor((redlineRpm / MAX_RPM_SCALE) * LED_COUNT));
    const amberStart = Math.max(13, Math.floor((6500 / MAX_RPM_SCALE) * LED_COUNT));
    const peakSeg = peak > 300 ? Math.min(LED_COUNT - 1, Math.floor((peak / MAX_RPM_SCALE) * LED_COUNT)) : -1;

    for (let i = 0; i < LED_COUNT; i++) {
      let cls = "sled";
      if (i >= redStart) cls += " zone-red";
      else if (i >= amberStart) cls += " zone-amber";

      if (i < litCount) {
        if (i >= redStart) cls += strobePhase ? "" : " on-red";
        else if (i >= amberStart) cls += " on-amber";
        else if (i < 6) cls += " on-cool";
        else cls += " on-mid";
      }
      if (i === peakSeg && !sweepActive) cls += " peak-hold";
      arr[i].className = cls;
    }
  }

  function renderIdleState() {
    hasLiveSignal = false;
    sweepActive = false;
    latestFrame = null;

    ["cHeroCard", "cSecGrid", "nHeroCard", "nerdySensorGrid", "lGridCasual", "lGridNerdy"].forEach((id) => {
      $(id).classList.add("is-idle");
    });

    $("cEmptyChecklist").hidden = false;
    $("cChartCard").hidden = true;

    ["cRpm", "cPeakHold", "cTpsNum", "cEctNum", "cVbatNum", "cIatNum", "cMapWord",
     "lcRpm", "lcPeak", "lcTpsNum", "lcEctNum", "lcBatNum", "lcIatNum", "lcMapWord",
     "nRpm", "nPeakRpm", "nDutyTop", "nTpsNum", "nMapNum", "nInjNum", "nIgnNum",
     "nO2Num", "nIacvNum", "nEctNum", "nIatNum", "nVbatNum", "nVssNum",
     "lnRpm", "lnPeak", "lnTpsNum", "lnDuty", "lnInjNum", "lnIgnNum", "lnEctNum",
     "lnBatNum", "lnMapNum", "lnAfrNum", "lnIacvNum", "lnIatNum"].forEach((id) => {
      $(id).textContent = "--";
    });
    $("cSpeedNum").textContent = "0";
    $("lcSpeedNum").textContent = "0";
    $("lcVssPeak").textContent = "--";
    $("cGearVal").textContent = "N";
    $("cGearVal").className = "gear-val is-neutral";
    $("lcGearVal").textContent = "N";
    $("lcGearVal").className = "gear-val is-neutral";
    $("cGearSub").textContent = "MO · NEUTRAL";
    $("lcGearSub").textContent = "MO · NEUTRAL";
    $("cEctFill").style.width = "0%";
    $("lcEctFill").style.width = "0%";
    $("cVbatFill").style.width = "0%";
    $("lcBatFill").style.width = "0%";
    if ($("lcFuelFill")) $("lcFuelFill").style.width = "71%";
    if ($("lcFuelNum")) $("lcFuelNum").textContent = "71";
    if ($("lcRpmSweep")) $("lcRpmSweep").style.width = "0%";
    if ($("lcModeBadge")) $("lcModeBadge").textContent = replayRunning ? "SIM" : (btConnected ? (usbConnected ? "USB" : "LIVE") : "IDLE");
    const dNow = new Date();
    const timeStr = String(dNow.getHours()).padStart(2, "0") + ":" + String(dNow.getMinutes()).padStart(2, "0");
    $("lcTimeTxt").textContent = timeStr;
    $("lcTripTxt").textContent = (tripMeters / 1000).toFixed(1);
    $("lcOdoTxt").textContent = Math.floor(odoMeters / 1000).toLocaleString("en-US");

    $("cTpsMaxChip").textContent = "Max --%";
    $("lcTpsMax").textContent = "Max --%";
    $("cEctSub").textContent = "Chờ tín hiệu";
    $("cVbatSub").textContent = "Min đề: -- V";
    $("cMapKpaSub").textContent = "";
    $("cMapSub").textContent = "Áp suất cổ hút";
    $("lcEctSub").textContent = "Chờ tín hiệu";
    $("lcBatSub").textContent = "Min đề: -- V";
    $("lcMapSub").textContent = "";
    $("nTpsVolt").textContent = "-- V";
    $("lnTpsVolt").textContent = "-- V";
    $("cTpsFill").style.width = "0%";
    $("cTpsBgSweep").style.width = "0%";
    $("lcTpsFill").style.width = "0%";
    $("lcTpsBgSweep").style.width = "0%";
    $("nTpsFill").style.width = "0%";
    $("lnTpsFill").style.width = "0%";
    $("lnTpsBgSweep").style.width = "0%";

    $("cHealthDot").className = "conn-dot";
    $("cHealthText").textContent = "Sẵn sàng kết nối · Bật khóa xe hoặc chạy Demo";
    $("lBannerTxt").textContent = "Bật khóa xe hoặc chạy Demo";

    updateLeds(ledsCasual, 0, 0);
    updateLeds(ledsNerdy, 0, 0);
    updateLeds(ledsLand, 0, 0);
  }

  // Startup Gauge Sweep Animation (0 -> 12,000 -> live)
  function startGaugeSweep(targetFrame) {
    sweepActive = true;
    sweepStartTs = performance.now();
    const duration = 650;

    function tick(now) {
      if (!hasLiveSignal || !sweepActive) return;
      const t = Math.min(1, (now - sweepStartTs) / duration);
      let sRpm = 0;
      let sTps = 0;
      const liveRpm = latestFrame ? latestFrame.rpm : targetFrame.rpm;
      const liveTps = latestFrame ? latestFrame.tpsPct : targetFrame.tpsPct;
      if (t < 0.5) {
        const p = t / 0.5;
        sRpm = Math.round(p * MAX_RPM_SCALE);
        sTps = Math.round(p * 100);
      } else {
        const p = (t - 0.5) / 0.5;
        sRpm = Math.round(MAX_RPM_SCALE - p * (MAX_RPM_SCALE - liveRpm));
        sTps = Math.round(100 - p * (100 - liveTps));
      }

      const rpmS = sRpm.toLocaleString("en-US");
      const tpsW = sTps + "%";
      $("cRpm").textContent = rpmS;
      $("lcRpm").textContent = rpmS;
      $("nRpm").textContent = rpmS;
      $("lnRpm").textContent = rpmS;
      $("cTpsNum").textContent = String(sTps);
      $("lcTpsNum").textContent = String(sTps);
      $("cTpsFill").style.width = tpsW;
      $("cTpsBgSweep").style.width = tpsW;
      $("lcTpsFill").style.width = tpsW;
      $("lcTpsBgSweep").style.width = tpsW;
      updateLeds(ledsCasual, sRpm, 0);
      updateLeds(ledsNerdy, sRpm, 0);
      updateLeds(ledsLand, sRpm, 0);

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        sweepActive = false;
        if (latestFrame) applyFrame(latestFrame);
      }
    }
    requestAnimationFrame(tick);
  }

  function syncModeAndTabs() {
    localStorage.setItem("kline_ui_mode", uiMode);
    const label = uiMode === "nerdy" ? "NERDY" : "CASUAL";
    [$("pBtnModeCycle"), $("lBtnModeCycle")].forEach((b) => {
      b.textContent = label;
      b.classList.toggle("is-nerdy", uiMode === "nerdy");
    });

    const targetTab = uiMode === "casual" ? activeCasualTab : activeNerdyTab;
    document.querySelectorAll(".page").forEach((p) => {
      p.hidden = !(p.dataset.mode === uiMode && p.dataset.tab === targetTab);
    });
    document.querySelectorAll(".bnav-btn").forEach((b) => {
      const isMode = b.dataset.mode === uiMode;
      b.hidden = !isMode;
      b.classList.toggle("active", isMode && b.dataset.tab === targetTab);
    });

    $("lGridCasual").hidden = uiMode !== "casual";
    $("lGridNerdy").hidden = uiMode !== "nerdy";

    if (uiMode === "casual" && activeCasualTab === "overview" && hasLiveSignal) drawOverviewChart();
    if (uiMode === "nerdy" && activeNerdyTab === "scope") drawScope();
    if (uiMode === "nerdy" && activeNerdyTab === "dyno") renderMapTable();
  }

  function toggleMode() {
    uiMode = uiMode === "casual" ? "nerdy" : "casual";
    syncModeAndTabs();
  }
  $("pBtnModeCycle").addEventListener("click", toggleMode);
  $("lBtnModeCycle").addEventListener("click", toggleMode);

  document.querySelectorAll(".bnav-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.mode === "casual") activeCasualTab = b.dataset.tab;
      else activeNerdyTab = b.dataset.tab;
      syncModeAndTabs();
    });
  });

  function setStatus(dotClass, text) {
    $("pConnDot").className = "conn-dot " + dotClass;
    $("lConnDot").className = "conn-dot " + dotClass;
    $("pConnText").textContent = text;
    $("lConnText").textContent = text;
  }

  function setBtBtnState(kind) {
    [$("pBtnBt"), $("lBtnBt")].forEach((b) => {
      b.className = "btn btn--touch btn--bt" + (kind ? " is-" + kind : "");
    });
  }

  function updateFiLamp() {
    [$("pBtnFi"), $("lBtnFi")].forEach((b) => {
      b.classList.toggle("has-fault", faultCount > 0);
    });
  }

  function openFiDiagnostics() {
    const isLandscape = window.innerWidth > window.innerHeight && window.innerHeight <= 540;
    if (!isLandscape) {
      if (uiMode === "casual") activeCasualTab = "dtc";
      else activeNerdyTab = "lab";
      syncModeAndTabs();
    } else {
      $("fiModal").hidden = false;
    }
  }
  $("pBtnFi").addEventListener("click", openFiDiagnostics);
  $("lBtnFi").addEventListener("click", openFiDiagnostics);
  $("btnCloseFiModal").addEventListener("click", () => { $("fiModal").hidden = true; });

  function updateMinMax(key, val, fmtFn, dotId, lblId, loBound, hiBound) {
    if (!minmax[key]) minmax[key] = { min: val, max: val };
    else {
      if (val < minmax[key].min) minmax[key].min = val;
      if (val > minmax[key].max) minmax[key].max = val;
    }
    const r = minmax[key];
    const span = r.max > r.min ? (r.max - r.min) : Math.max(1, hiBound - loBound);
    const base = r.max > r.min ? r.min : loBound;
    const pct = Math.max(0, Math.min(100, ((val - base) / span) * 100));
    $(dotId).style.left = pct.toFixed(0) + "%";
    $(lblId).textContent = "MIN " + fmtFn(r.min) + " · MAX " + fmtFn(r.max);
  }

  function recordMapCell(d) {
    if (d.rpm < 600) {
      activeCellKey = null;
      return;
    }
    let bestR = 0;
    let bestT = 0;
    for (let i = 1; i < RPM_BINS.length; i++) {
      if (Math.abs(RPM_BINS[i] - d.rpm) < Math.abs(RPM_BINS[bestR] - d.rpm)) bestR = i;
    }
    for (let i = 1; i < TPS_BINS.length; i++) {
      if (Math.abs(TPS_BINS[i] - d.tpsPct) < Math.abs(TPS_BINS[bestT] - d.tpsPct)) bestT = i;
    }
    activeCellKey = bestT + "_" + bestR;
    const val = mapMetric === "INJ" ? d.injMs : (mapMetric === "IGN" ? d.ignDeg : d.mapKpa);
    if (!mapCells[activeCellKey]) mapCells[activeCellKey] = [val, 1];
    else {
      mapCells[activeCellKey][0] += val;
      mapCells[activeCellKey][1] += 1;
    }
  }

  function renderMapTable() {
    const tbl = $("mapTable");
    let html = "<tr><th>TPS\\R</th>";
    for (let j = 0; j < RPM_BINS.length; j++) html += "<th>" + (RPM_BINS[j] / 1000) + "k</th>";
    html += "</tr>";
    for (let i = TPS_BINS.length - 1; i >= 0; i--) {
      html += "<tr><th>" + TPS_BINS[i] + "%</th>";
      for (let j = 0; j < RPM_BINS.length; j++) {
        const key = i + "_" + j;
        const entry = mapCells[key];
        const isAct = key === activeCellKey;
        const cls = (entry ? "has-data" : "") + (isAct ? " is-active" : "");
        let txt = "·";
        if (entry) {
          const avg = entry[0] / entry[1];
          txt = mapMetric === "INJ" ? avg.toFixed(1) : avg.toFixed(0);
        }
        html += '<td class="' + cls + '">' + txt + "</td>";
      }
      html += "</tr>";
    }
    tbl.innerHTML = html;
  }

  function updatePullTimer(rpm, now) {
    if (rpm < 3800 && (pullState === "IDLE" || pullState === "DONE")) {
      pullState = "ARMED";
      $("pullStateTxt").textContent = "SẴN SÀNG! Thốc ga vượt 4,000 RPM";
    } else if (pullState === "ARMED" && rpm >= 4000) {
      pullState = "TIMING";
      pullT0 = now;
      $("pullStateTxt").textContent = "ĐANG ĐO 4,000 → 9,000 RPM...";
    } else if (pullState === "TIMING") {
      const elSec = (now - pullT0) / 1000;
      $("pullCurTxt").textContent = elSec.toFixed(2) + " s";
      if (rpm >= 9000) {
        pullState = "DONE";
        if (pullBest === null || elSec < pullBest) pullBest = elSec;
        $("pullStateTxt").textContent = "HOÀN TẤT 4k → 9k";
        $("pullBestTxt").textContent = "BEST " + pullBest.toFixed(2) + " s";
      } else if (rpm < 3500) {
        pullState = "ARMED";
        $("pullCurTxt").textContent = "--.-- s";
        $("pullStateTxt").textContent = "HỦY · SẴN SÀNG LẠI";
      }
    }
  }

  function drawOverviewChart() {
    const c = $("pOverviewChart");
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const w = Math.max(180, Math.floor(rect.width));
    const h = Math.max(70, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
      const y = Math.round(h * f) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    if (scopeHistory.length < 2) return;

    const pts = scopeHistory.slice(-90);
    const maxPts = 90;
    const step = w / (maxPts - 1);
    const xOff = (maxPts - pts.length) * step;

    ctx.strokeStyle = "#FF4D00";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = xOff + i * step;
      const y = h - 4 - (Math.max(0, Math.min(pts[i].tpsPct, 100)) / 100) * (h - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = xOff + i * step;
      const y = h - 4 - (Math.max(0, Math.min(pts[i].rpm, MAX_RPM_SCALE)) / MAX_RPM_SCALE) * (h - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(xOff, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(0, 229, 255, 0.16)");
    grad.addColorStop(1, "rgba(0, 229, 255, 0.00)");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function drawScope() {
    const c = $("nScopeCanvas");
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const w = Math.max(200, Math.floor(rect.width));
    const h = Math.max(160, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
      const y = Math.round(h * f) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    if (scopeHistory.length < 2) return;
    const step = w / (MAX_SCOPE - 1);
    const xOff = (MAX_SCOPE - scopeHistory.length) * step;

    const chs = [
      [scopeEnabled.map, "mapKpa", 120, "#38BDF8", 1.5],
      [scopeEnabled.inj, "injMs", 12, "#FFA800", 1.5],
      [scopeEnabled.o2, "o2Volt", 1.2, "#22C55E", 1.5],
      [scopeEnabled.tps, "tpsPct", 100, "#FF4D00", 1.8],
      [scopeEnabled.rpm, "rpm", MAX_RPM_SCALE, "#00E5FF", 2.0]
    ];
    for (const [on, key, maxV, col, lw] of chs) {
      if (!on) continue;
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let i = 0; i < scopeHistory.length; i++) {
        const x = xOff + i * step;
        const y = h - 6 - (Math.max(0, Math.min(scopeHistory[i][key], maxV)) / maxV) * (h - 12);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (scopeHoverIdx !== null && scopeHoverIdx >= 0 && scopeHoverIdx < scopeHistory.length) {
      const hx = xOff + scopeHoverIdx * step;
      ctx.strokeStyle = "#FF4D00";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
      const s = scopeHistory[scopeHoverIdx];
      $("scopeCursorReadout").textContent =
        "RPM " + s.rpm + " | TPS " + s.tpsPct.toFixed(0) + "% | MAP " + s.mapKpa + " | INJ " + s.injMs.toFixed(2) + "ms | O2 " + s.o2Volt.toFixed(2) + "V";
    }
  }

  function scrubScopeAt(clientX) {
    if (!scopeHistory.length) return;
    const rect = $("nScopeCanvas").getBoundingClientRect();
    const step = rect.width / (MAX_SCOPE - 1);
    const xOff = (MAX_SCOPE - scopeHistory.length) * step;
    const idx = Math.round((clientX - rect.left - xOff) / step);
    if (idx >= 0 && idx < scopeHistory.length) {
      scopeHoverIdx = idx;
      drawScope();
    }
  }

  const sc = $("nScopeCanvas");
  sc.addEventListener("touchstart", (e) => { e.preventDefault(); scrubScopeAt(e.touches[0].clientX); }, { passive: false });
  sc.addEventListener("touchmove", (e) => { e.preventDefault(); scrubScopeAt(e.touches[0].clientX); }, { passive: false });
  sc.addEventListener("mousedown", (e) => scrubScopeAt(e.clientX));
  sc.addEventListener("mousemove", (e) => { if (e.buttons) scrubScopeAt(e.clientX); });

  function ectSemanticClass(ect) {
    if (ect > 105) return "hot";
    if (ect < 55) return "cold";
    if (ect <= 98) return "ok";
    return "warn";
  }

  function batSemanticClass(vbat, rpm) {
    if (vbat < 11.8) return rpm > 1000 ? "hot" : "warn";
    if (vbat >= 13.3) return "ok";
    return "";
  }

  function applyFrame(d) {
    latestFrame = d;
    if (!hasLiveSignal) {
      hasLiveSignal = true;
      ["cHeroCard", "cSecGrid", "nHeroCard", "nerdySensorGrid", "lGridCasual", "lGridNerdy"].forEach((id) => {
        $(id).classList.remove("is-idle");
      });
      $("cEmptyChecklist").hidden = true;
      $("cChartCard").hidden = false;
      $("chkEcuDot").className = "conn-dot ok";
      $("chkEcuTxt").textContent = "Đang nhận dữ liệu ECU";
      startGaugeSweep(d);
    }

    const now = performance.now();
    if (lastFrameTs !== null && d.rpm > 300) {
      const dtRun = Math.min((now - lastFrameTs) / 1000, 1.0);
      trip.runSec += dtRun;
      oilHoursBase += dtRun;
    }
    lastFrameTs = now;
    frameCount += 1;

    if (d.rpm > trip.peakRpm) trip.peakRpm = d.rpm;
    if (d.tpsPct > trip.maxTps) trip.maxTps = d.tpsPct;
    if (trip.minBat === null || d.vbat < trip.minBat) trip.minBat = d.vbat;
    if (trip.maxBat === null || d.vbat > trip.maxBat) trip.maxBat = d.vbat;
    if (maxEctSession === null || d.ectC > maxEctSession) maxEctSession = d.ectC;

    const ectTrend = prevEct === null ? "→" : (d.ectC > prevEct ? "↑" : (d.ectC < prevEct ? "↓" : "→"));
    prevEct = d.ectC;

    const lowBat = d.rpm > 1000 && d.vbat < 11.8;
    if (d.ectC > 105 || lowBat) trip.warnCount += 1;
    if (frameCount % 10 === 0) saveTrip();

    // Non-redundant contextual insight banner (no repeated numbers)
    let bannerTxt = "Động cơ & hệ thống sạc đang hoạt động ổn định";
    let bannerDot = "ok";
    if (d.ectC > 105) { bannerTxt = "Cảnh báo quá nhiệt động cơ! Giảm tải kiểm tra nước mát"; bannerDot = "err"; }
    else if (lowBat) { bannerTxt = "Hệ thống sạc yếu khi nổ máy — Kiểm tra sạc/bình"; bannerDot = "warn"; }
    else if (d.rpm === 0) {
      bannerTxt = d.vbat >= 12.0 ? "Bật khóa chờ đề · Điện bình khỏe, sẵn sàng nổ máy" : "Bật khóa chờ đề · Bình hơi yếu, nên kiểm tra sạc";
      bannerDot = d.vbat >= 12.0 ? "" : "warn";
    }
    else if (d.ectC < 55) { bannerTxt = "Động cơ còn nguội — Giữ ga đều chờ ấm máy"; bannerDot = "cold"; }

    $("cHealthDot").className = "conn-dot " + bannerDot;
    $("cHealthText").textContent = bannerTxt;
    $("lBannerTxt").textContent = bannerTxt;

    const rpmTxt = d.rpm.toLocaleString("en-US");
    const peakTxt = trip.peakRpm.toLocaleString("en-US");
    const tpsInt = d.tpsPct.toFixed(0);
    const tpsW = Math.min(100, Math.max(0, d.tpsPct)).toFixed(1) + "%";
    const ectCls = ectSemanticClass(d.ectC);
    const batCls = batSemanticClass(d.vbat, d.rpm);
    const isRed = d.rpm >= redlineRpm;
    const minBatTxt = (trip.minBat !== null ? trip.minBat.toFixed(1) : d.vbat.toFixed(1));
    const ectBadge = d.ectC > 105 ? "Nóng!" : (d.ectC < 55 ? "Nguội" : "Chuẩn");
    const batBadge = d.vbat >= 13.3 ? "Sạc tốt" : (d.vbat < 11.8 ? "Yếu" : "Khá");
    const loadWord = d.rpm === 0 ? "Nghỉ" : (d.mapKpa >= 75 ? "Nặng" : (d.mapKpa >= 48 ? "Vừa" : "Nhẹ"));

    if (!sweepActive) {
      $("cRpm").textContent = rpmTxt;
      $("cRpm").className = "hero-num" + (isRed ? " redline" : "");
      $("lcRpm").textContent = rpmTxt;
      $("lcRpm").className = "hero-num hero-num--hud" + (isRed ? " redline" : "");
      $("nRpm").textContent = rpmTxt;
      $("nRpm").className = "hero-num hero-num--sm" + (isRed ? " redline" : "");
      $("lnRpm").textContent = rpmTxt;
      $("lnRpm").className = "hero-num hero-num--hud-sm" + (isRed ? " redline" : "");

      $("cTpsNum").textContent = tpsInt;
      $("cTpsFill").style.width = tpsW;
      $("cTpsBgSweep").style.width = tpsW;
      $("lcTpsNum").textContent = tpsInt;
      $("lcTpsFill").style.width = tpsW;
      $("lcTpsBgSweep").style.width = tpsW;

      updateLeds(ledsCasual, d.rpm, trip.peakRpm);
      updateLeds(ledsNerdy, d.rpm, trip.peakRpm);
      updateLeds(ledsLand, d.rpm, trip.peakRpm);
    }

    // Casual Portrait + Landscape Plain Vietnamese Metrics
    $("cPeakHold").textContent = peakTxt;
    $("cTpsMaxChip").textContent = "Max " + trip.maxTps.toFixed(0) + "%";
    $("cEctNum").textContent = String(d.ectC);
    $("cEctNum").className = "num " + ectCls;
    $("cEctSub").textContent = ectBadge + " " + ectTrend + " · Đỉnh " + maxEctSession + "°C";
    $("cVbatNum").textContent = d.vbat.toFixed(1);
    $("cVbatNum").className = "num " + batCls;
    $("cVbatSub").textContent = batBadge + " · Min đề " + minBatTxt + "V";
    $("cIatNum").textContent = String(d.iatC);
    $("cMapWord").textContent = loadWord;
    $("cMapKpaSub").textContent = d.mapKpa + " kPa";
    $("cMapSub").textContent = d.rpm === 0 ? "Áp suất khí quyển" : "Chân không cổ hút";

    $("lcPeak").textContent = peakTxt;
    $("lcTpsMax").textContent = "Max " + trip.maxTps.toFixed(0) + "%";
    $("lcEctNum").textContent = String(d.ectC);
    $("lcEctNum").className = "num num--sm " + ectCls;
    $("lcEctSub").textContent = ectBadge + " " + ectTrend + " · Đỉnh " + maxEctSession + "°";
    $("lcBatNum").textContent = d.vbat.toFixed(1);
    $("lcBatNum").className = "num num--sm " + batCls;
    $("lcBatSub").textContent = "Min đề " + minBatTxt + "V";
    $("lcIatNum").textContent = String(d.iatC);
    $("lcMapWord").textContent = loadWord;
    $("lcMapSub").textContent = d.mapKpa + " kPa";

    // TFT Motorsport Cockpit Updates (Speedometer & Gear Box & Dual Gauge Bars)
    const speedKmh = Math.round(d.vssKmh || 0);
    if (!trip.peakVss || d.vssKmh > trip.peakVss) trip.peakVss = d.vssKmh;
    const gearStr = calculateGear(d.rpm, d.vssKmh);

    $("cSpeedNum").textContent = String(speedKmh);
    $("lcSpeedNum").textContent = String(speedKmh);
    $("lcVssPeak").textContent = String(Math.round(trip.peakVss || d.vssKmh));

    $("cGearVal").textContent = gearStr;
    $("lcGearVal").textContent = gearStr;

    let gearClass = "gear-val";
    let gearSubText = "MO · NEUTRAL";
    if (gearStr === "N") {
      gearClass += " is-neutral";
      gearSubText = "MO · NEUTRAL";
    } else if (gearStr === "--") {
      gearClass += " is-waiting";
      gearSubText = "BÓP CÔN / CHỜ";
    } else {
      gearClass += " is-gear";
      gearSubText = "SỐ " + gearStr;
    }
    $("cGearVal").className = gearClass;
    $("lcGearVal").className = gearClass;
    $("cGearSub").textContent = gearSubText;
    $("lcGearSub").textContent = gearSubText;

    const ectPct = Math.max(0, Math.min(100, ((d.ectC - 40) / 80) * 100));
    const batPct = Math.max(0, Math.min(100, ((d.vbat - 10.5) / 4.0) * 100));
    $("cEctFill").style.width = ectPct.toFixed(1) + "%";
    $("lcEctFill").style.width = ectPct.toFixed(1) + "%";
    $("cVbatFill").style.width = batPct.toFixed(1) + "%";
    $("lcBatFill").style.width = batPct.toFixed(1) + "%";

    const rpmSweepPct = Math.min(100, Math.max(0, (d.rpm / MAX_RPM_SCALE) * 100));
    if ($("lcRpmSweep")) $("lcRpmSweep").style.width = rpmSweepPct.toFixed(1) + "%";
    const fuelPct = Math.max(10, Math.min(100, Math.round(((d.vbat - 11.2) / 1.6) * 100)));
    if ($("lcFuelFill")) $("lcFuelFill").style.width = fuelPct + "%";
    if ($("lcFuelNum")) $("lcFuelNum").textContent = String(fuelPct);
    if ($("lcModeBadge")) $("lcModeBadge").textContent = replayRunning ? "SIM" : (usbConnected ? "USB" : "LIVE");

    updateOdometer(d.vssKmh);
    const dNow = new Date();
    const timeStr = String(dNow.getHours()).padStart(2, "0") + ":" + String(dNow.getMinutes()).padStart(2, "0");
    $("lcTimeTxt").textContent = timeStr;
    $("lcTripTxt").textContent = (tripMeters / 1000).toFixed(1);
    $("lcOdoTxt").textContent = Math.floor(odoMeters / 1000).toLocaleString("en-US");

    // Casual Trip Tab
    const m = Math.floor(trip.runSec / 60);
    const s = Math.floor(trip.runSec % 60);
    $("tRunTime").textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    $("tPeakRpm").textContent = peakTxt;
    $("tMaxTpsNum").textContent = trip.maxTps.toFixed(0);
    $("tWarnCount").textContent = String(trip.warnCount);
    $("tMinBat").textContent = minBatTxt + " V";
    $("tMaxBat").textContent = (trip.maxBat !== null ? trip.maxBat.toFixed(1) : d.vbat.toFixed(1)) + " V";
    $("tBatVerdict").textContent = trip.minBat !== null && trip.minBat < 9.5 ? "Sụt sâu lúc đề (kiểm tra bình)" : "Bình & sạc ổn định";
    const oilHrs = oilHoursBase / 3600;
    $("tOilText").textContent = oilHrs.toFixed(1) + " / 25.0 giờ";
    $("tOilFill").style.width = Math.min(100, (oilHrs / 25) * 100).toFixed(1) + "%";

    // Nerdy Portrait Sensors
    $("nPeakRpm").textContent = peakTxt;
    $("nDutyTop").textContent = d.injDuty.toFixed(1) + "%";
    $("nDfcoPill").className = "pill-tag" + (d.dfco ? " active" : "");

    $("nTpsNum").textContent = d.tpsPct.toFixed(1);
    $("nTpsFill").style.width = tpsW;
    $("nTpsVolt").textContent = d.tpsVolt.toFixed(2) + " V";
    updateMinMax("tps", d.tpsPct, (v) => v.toFixed(0) + "%", "mmDotTps", "mmLblTps", 0, 100);

    $("nMapNum").textContent = String(d.mapKpa);
    $("nMapSub").textContent = d.mapVolt.toFixed(2) + " V";
    updateMinMax("map", d.mapKpa, (v) => v.toFixed(0), "mmDotMap", "mmLblMap", 20, 110);

    $("nInjNum").textContent = d.injMs.toFixed(2);
    $("nInjNum").className = "num num--sm" + (d.injDuty >= 85 ? " accent" : "");
    $("nInjSub").textContent = "Duty " + d.injDuty.toFixed(1) + "%";
    updateMinMax("inj", d.injMs, (v) => v.toFixed(2), "mmDotInj", "mmLblInj", 0, 10);

    const ignS = d.ignDeg > 0 ? "+" : "";
    $("nIgnNum").textContent = ignS + d.ignDeg.toFixed(1);
    updateMinMax("ign", d.ignDeg, (v) => v.toFixed(1) + "°", "mmDotIgn", "mmLblIgn", 0, 65);

    $("nO2Num").textContent = d.o2Volt.toFixed(2);
    $("nO2Sub").textContent = "AFR " + d.afrEst + ":1";
    updateMinMax("o2", d.o2Volt, (v) => v.toFixed(2), "mmDotO2", "mmLblO2", 0, 1.0);

    $("nIacvNum").textContent = String(d.iacvStp);
    updateMinMax("iacv", d.iacvStp, (v) => v.toFixed(0), "mmDotIacv", "mmLblIacv", 20, 70);

    $("nEctNum").textContent = String(d.ectC);
    $("nEctNum").className = "num num--sm " + ectCls;
    $("nEctSub").textContent = d.ectVolt.toFixed(2) + " V · " + ectTrend;
    updateMinMax("ect", d.ectC, (v) => v.toFixed(0) + "°", "mmDotEct", "mmLblEct", 25, 115);

    $("nIatNum").textContent = String(d.iatC);
    $("nIatSub").textContent = d.iatVolt.toFixed(2) + " V";
    updateMinMax("iat", d.iatC, (v) => v.toFixed(0) + "°", "mmDotIat", "mmLblIat", 20, 60);

    $("nVbatNum").textContent = d.vbat.toFixed(1);
    $("nVbatNum").className = "num num--sm " + batCls;
    $("nVbatSub").textContent = "Đề " + minBatTxt + "V";
    updateMinMax("vbat", d.vbat, (v) => v.toFixed(1) + "V", "mmDotVbat", "mmLblVbat", 8, 15);

    $("nVssNum").textContent = String(d.vssKmh);
    $("mmLblVss").textContent = "PKT #" + frameCount;

    // Landscape Nerdy HUD
    $("lnPeak").textContent = peakTxt;
    $("lnTpsVolt").textContent = d.tpsVolt.toFixed(2) + " V";
    $("lnTpsNum").textContent = tpsInt;
    $("lnTpsFill").style.width = tpsW;
    $("lnTpsBgSweep").style.width = tpsW;
    $("lnDuty").textContent = d.injDuty.toFixed(0) + "%";
    $("lnInjNum").textContent = d.injMs.toFixed(2);
    $("lnIgnNum").textContent = ignS + d.ignDeg.toFixed(0);
    $("lnEctNum").textContent = String(d.ectC);
    $("lnEctNum").className = "num num--xs " + ectCls;
    $("lnEctMax").textContent = "Max " + maxEctSession + "°";
    $("lnBatNum").textContent = d.vbat.toFixed(1);
    $("lnBatNum").className = "num num--xs " + batCls;
    $("lnBatMin").textContent = "Đề " + minBatTxt + "V";
    $("lnMapNum").textContent = String(d.mapKpa);
    $("lnAfrNum").textContent = d.afrEst;
    $("lnIacvNum").textContent = String(d.iacvStp);
    $("lnIatNum").textContent = String(d.iatC);

    if (!scopeFrozen) {
      scopeHistory.push(d);
      if (scopeHistory.length > MAX_SCOPE) scopeHistory.shift();
    }
    recordMapCell(d);
    updatePullTimer(d.rpm, now);

    if (isRecording) {
      recRows.push([
        new Date().toISOString(), d.rpm, d.tpsPct, d.tpsVolt.toFixed(2), d.mapKpa,
        d.ectC, d.iatC, d.vbat, d.injMs.toFixed(2), d.injDuty, d.ignDeg, d.iacvStp, d.o2Volt.toFixed(2), d.vssKmh
      ].join(","));
      const sec = Math.floor((Date.now() - recStartMs) / 1000);
      const tStr = String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
      $("pRecTxt").textContent = tStr;
      $("lRecTxt").textContent = tStr;
    }

    if (uiMode === "casual" && activeCasualTab === "overview") drawOverviewChart();
    if (uiMode === "nerdy" && activeNerdyTab === "scope") drawScope();
    if (uiMode === "nerdy" && activeNerdyTab === "dyno") renderMapTable();
  }

  // REC Session Logger
  function toggleRec() {
    if (!isRecording) {
      isRecording = true;
      recStartMs = Date.now();
      recRows = ["timestamp,rpm,tps_pct,tps_volt,map_kpa,ect_c,iat_c,vbat,inj_ms,inj_duty,ign_deg,iacv_stp,o2_volt,vss_kmh"];
      $("pBtnRec").classList.add("is-recording");
      $("lBtnRec").classList.add("is-recording");
      $("pRecTxt").textContent = "00:00";
      $("lRecTxt").textContent = "00:00";
    } else {
      isRecording = false;
      $("pBtnRec").classList.remove("is-recording");
      $("lBtnRec").classList.remove("is-recording");
      $("pRecTxt").textContent = "REC";
      $("lRecTxt").textContent = "REC";
      if (recRows.length > 1) {
        const fname = "kline_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
        const content = recRows.join("\n") + "\n";
        if (window.AndroidBT && window.AndroidBT.saveSessionCsv) {
          window.AndroidBT.saveSessionCsv(fname, content);
        }
      }
      recRows = [];
    }
  }
  $("pBtnRec").addEventListener("click", toggleRec);
  $("lBtnRec").addEventListener("click", toggleRec);

  // Replay Controls (Shared Timeline)
  function fmtSec(secTotal) {
    const m = Math.floor(secTotal / 60);
    const s = Math.floor(secTotal % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function renderReplayAt(idx) {
    if (!sampleFrames.length) return;
    replayIndex = Math.max(0, Math.min(idx, sampleFrames.length - 1));
    const item = sampleFrames[replayIndex];
    $("replaySlider").value = String(replayIndex);
    const curSec = Math.floor(replayIndex * 0.1);
    const totSec = Math.floor(sampleFrames.length * 0.1);
    $("replayTimeTxt").textContent = fmtSec(curSec) + " / " + fmtSec(totSec);
    const pkt = parseKlinePacket(item.h);
    if (pkt && pkt.kind === "table11") applyFrame(pkt);
  }

  function stepReplay() {
    if (!replayRunning) return;
    renderReplayAt(replayIndex);
    replayIndex = (replayIndex + 1) % sampleFrames.length;
    replayTimer = setTimeout(stepReplay, Math.max(18, Math.floor(100 / replaySpeed)));
  }

  // Replay Bar Auto-hide Timer in Landscape Mode
  let replayAutoHideTimer = null;
  function triggerReplayAutoHide() {
    const isLandscape = window.innerWidth > window.innerHeight;
    if (!isLandscape) return;
    if (replayAutoHideTimer) clearTimeout(replayAutoHideTimer);
    replayAutoHideTimer = setTimeout(() => {
      if (replayRunning && $("sharedReplayBar")) {
        $("sharedReplayBar").hidden = true;
      }
    }, 4500);
  }

  function toggleDemo() {
    if (!sampleFrames.length) return;
    if (replayRunning || !$("sharedReplayBar").hidden) {
      replayRunning = false;
      if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
      if (replayAutoHideTimer) { clearTimeout(replayAutoHideTimer); replayAutoHideTimer = null; }
      $("sharedReplayBar").hidden = true;
      $("pBtnDemo").textContent = "Demo";
      $("lBtnDemo").textContent = "Demo";
      $("pBtnDemo").classList.remove("is-active");
      $("lBtnDemo").classList.remove("is-active");
      setStatus(btConnected ? "ok" : "", btConnected ? (usbConnected ? "USB Online" : "BT Online") : "Chưa kết nối");
      if ($("lcModeBadge")) $("lcModeBadge").textContent = btConnected ? (usbConnected ? "USB" : "LIVE") : "IDLE";
      if (!btConnected) renderIdleState();
    } else {
      replayRunning = true;
      if ($("lcModeBadge")) $("lcModeBadge").textContent = "SIM";
      $("sharedReplayBar").hidden = false;
      $("replayPlayBtn").textContent = "Dừng";
      $("replaySlider").max = String(sampleFrames.length - 1);
      $("pBtnDemo").textContent = "Thoát";
      $("lBtnDemo").textContent = "Thoát";
      $("pBtnDemo").classList.add("is-active");
      $("lBtnDemo").classList.add("is-active");
      setStatus("ok", "Phát mẫu");
      stepReplay();
      triggerReplayAutoHide();
    }
  }

  $("pBtnDemo").addEventListener("click", toggleDemo);
  $("lBtnDemo").addEventListener("click", toggleDemo);
  $("cBtnEmptyDemo").addEventListener("click", toggleDemo);

  // Landscape Toolbar & Replay Bar Overlay Toggle & Auto-hide
  let toolbarAutoHideTimer = null;
  function openOverlayToolbar() {
    const bar = $("lhudOverlayToolbar");
    if (!bar) return;
    bar.hidden = false;
    if (toolbarAutoHideTimer) clearTimeout(toolbarAutoHideTimer);
    toolbarAutoHideTimer = setTimeout(() => {
      bar.hidden = true;
    }, 5000);
  }
  function closeOverlayToolbar() {
    const bar = $("lhudOverlayToolbar");
    if (bar) bar.hidden = true;
    if (toolbarAutoHideTimer) {
      clearTimeout(toolbarAutoHideTimer);
      toolbarAutoHideTimer = null;
    }
  }
  if ($("lcModeBadge")) {
    $("lcModeBadge").addEventListener("click", () => {
      // If replay is running and hidden, tapping SIM restores the replay bar
      if (replayRunning && $("sharedReplayBar") && $("sharedReplayBar").hidden) {
        $("sharedReplayBar").hidden = false;
        triggerReplayAutoHide();
        return;
      }
      const bar = $("lhudOverlayToolbar");
      if (bar) {
        if (bar.hidden) openOverlayToolbar();
        else closeOverlayToolbar();
      }
    });
  }
  if ($("btnCloseToolbar")) {
    $("btnCloseToolbar").addEventListener("click", closeOverlayToolbar);
  }

  // Keep replay bar visible while interacting with it
  ["touchstart", "pointerdown", "input"].forEach((evt) => {
    $("sharedReplayBar").addEventListener(evt, triggerReplayAutoHide, { passive: true });
  });

  $("replayPlayBtn").addEventListener("click", () => {
    if (replayRunning) {
      replayRunning = false;
      if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
      $("replayPlayBtn").textContent = "Chạy";
      setStatus("warn", "Tạm dừng");
    } else {
      replayRunning = true;
      $("replayPlayBtn").textContent = "Dừng";
      setStatus("ok", "Phát mẫu");
      stepReplay();
    }
  });
  $("replaySlider").addEventListener("input", () => renderReplayAt(parseInt($("replaySlider").value, 10)));
  document.querySelectorAll("#sharedReplayBar .speed-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#sharedReplayBar .speed-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      replaySpeed = parseFloat(b.dataset.speed) || 1;
    });
  });

  // Scope / Dyno / Lab Controls
  document.querySelectorAll(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      const k = c.dataset.ch;
      scopeEnabled[k] = !scopeEnabled[k];
      c.classList.toggle("active", scopeEnabled[k]);
      drawScope();
    });
  });
  $("btnScopeFreeze").addEventListener("click", () => {
    scopeFrozen = !scopeFrozen;
    $("btnScopeFreeze").textContent = scopeFrozen ? "Tiếp tục" : "Đóng băng";
    $("btnScopeFreeze").classList.toggle("is-active", scopeFrozen);
  });
  $("nBtnResetBounds").addEventListener("click", () => {
    for (const k in minmax) delete minmax[k];
    trip.peakRpm = 0;
    maxEctSession = latestFrame ? latestFrame.ectC : null;
  });
  $("btnResetTrip").addEventListener("click", () => {
    trip = { runSec: 0, peakRpm: 0, maxTps: 0, warnCount: 0, minBat: null, maxBat: null };
    saveTrip();
  });
  $("btnResetOil").addEventListener("click", () => {
    oilHoursBase = 0;
    saveTrip();
    $("tOilText").textContent = "0.0 / 25.0 giờ";
    $("tOilFill").style.width = "0%";
  });
  $("btnResetPull").addEventListener("click", () => {
    pullState = "IDLE";
    pullBest = null;
    $("pullStateTxt").textContent = "CHỜ (< 3,800 RPM để nạp)";
    $("pullCurTxt").textContent = "--.-- s";
    $("pullBestTxt").textContent = "BEST --.-- s";
  });
  document.querySelectorAll("#mapMetricGroup .speed-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#mapMetricGroup .speed-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      mapMetric = b.dataset.metric;
      for (const k in mapCells) delete mapCells[k];
      scopeHistory.forEach(recordMapCell);
      renderMapTable();
    });
  });
  $("btnClearMap").addEventListener("click", () => {
    for (const k in mapCells) delete mapCells[k];
    renderMapTable();
  });

  $("lRedlineSlider").value = String(redlineRpm);
  $("lRedlineVal").textContent = redlineRpm.toLocaleString("en-US") + " RPM";
  $("lRedlineSlider").addEventListener("input", () => {
    redlineRpm = parseInt($("lRedlineSlider").value, 10);
    localStorage.setItem("kline_redline", String(redlineRpm));
    $("lRedlineVal").textContent = redlineRpm.toLocaleString("en-US") + " RPM";
  });

  function sendBtCmd(cmd) {
    appendHexLog(">> TX: " + cmd.trim());
    if (window.AndroidBT) {
      window.AndroidBT.send(cmd);
    } else {
      $("lDtcOut").textContent = "Chỉ gửi được lệnh khi kết nối Bluetooth với STM32.";
    }
  }

  function triggerReadDtc() { sendBtCmd("READ_ECMID\r\n"); setTimeout(() => sendBtCmd("READ_DTC\r\n"), 120); }
  $("cBtnReadDtc").addEventListener("click", triggerReadDtc);
  $("mBtnReadDtc").addEventListener("click", triggerReadDtc);
  $("cBtnClearDtc").addEventListener("click", () => sendBtCmd("CLEAR_DTC\r\n"));
  $("mBtnClearDtc").addEventListener("click", () => sendBtCmd("CLEAR_DTC\r\n"));
  $("lBtnReadDtc").addEventListener("click", () => sendBtCmd("READ_DTC\r\n"));
  $("lBtnReadEcmId").addEventListener("click", () => sendBtCmd("READ_ECMID\r\n"));
  $("lBtnClearDtc").addEventListener("click", () => sendBtCmd("CLEAR_DTC\r\n"));
  $("lBtnWakeup").addEventListener("click", () => sendBtCmd("WAKEUP\r\n"));
  $("lBtnScs").addEventListener("click", () => {
    scsActive = !scsActive;
    $("lBtnScs").textContent = scsActive ? "SCS: Bật" : "SCS: Tắt";
    $("lBtnScs").classList.toggle("is-active", scsActive);
    sendBtCmd(scsActive ? "SCS_ON\r\n" : "SCS_OFF\r\n");
  });
  $("lBtnProbeTable").addEventListener("click", () => {
    const val = $("lTableInput").value.trim().toUpperCase().replace("0X", "").padStart(2, "0");
    if (/^[0-9A-F]{2}$/.test(val)) sendBtCmd("REQ_TABLE:" + val + "\r\n");
  });
  $("lBtnClearHex").addEventListener("click", () => { $("lHexConsole").textContent = ""; });

  function appendHexLog(txt) {
    const el = $("lHexConsole");
    const lines = el.textContent ? el.textContent.split("\n") : [];
    lines.push(txt);
    if (lines.length > 80) lines.splice(0, lines.length - 80);
    el.textContent = lines.join("\n");
    el.scrollTop = el.scrollHeight;
  }

  // Bluetooth Modal & Bridge
  function renderDev(dev, container) {
    const row = document.createElement("div");
    row.className = "dev-item";
    row.innerHTML = '<div><div class="dev-name">' + (dev.name || "Unknown") + '</div><div class="dev-mac">' + dev.mac + (dev.rssi ? " · " + dev.rssi + " dBm" : "") + "</div></div>";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--mini";
    btn.textContent = dev.type === "ble" ? "BLE" : "SPP";
    btn.addEventListener("click", () => {
      if (replayRunning) toggleDemo();
      $("btModal").hidden = true;
      if (window.AndroidBT) {
        if (dev.type === "ble") window.AndroidBT.connectBle(dev.mac);
        else window.AndroidBT.connectSpp(dev.mac);
      }
    });
    row.appendChild(btn);
    container.appendChild(row);
  }

  function refreshUsbDiag() {
    if (!window.AndroidBT || !window.AndroidBT.getUsbDebugInfo) return;
    try {
      const raw = window.AndroidBT.getUsbDebugInfo();
      const d = JSON.parse(raw);
      const box = $("usbDiagBox");
      if (!box) return;
      if (!d.hasDevice) {
        box.innerHTML = 'Phần cứng: <span style="color:#F59E0B">Chưa thấy cáp OTG</span><br><small style="color:#94A3B8">Hãy cắm cáp OTG & module CH340 vào máy (Nếu Meizu chưa nhận: vào Cài đặt -> bật OTG)</small>';
      } else {
        const permColor = d.hasPermission ? "#10B981" : "#EF4444";
        const permTxt = d.hasPermission ? "ĐÃ CẤP" : "CHƯA CẤP (Bấm 'Kết nối USB')";
        const connColor = d.isConnected ? "#10B981" : "#F59E0B";
        const connTxt = d.isConnected ? "ĐÃ MỞ CỔNG" : "CHƯA MỞ";
        let diagHint = "";
        const preview = d.lastRxPreview || "";
        if (preview.includes("72 05 71 11") && !preview.includes("02 19")) {
          diagHint = `<br><span style="color:#F59E0B">⚠️ Đã nhận echo từ STM32 nhưng ECU chưa trả lời. Hãy BẬT KHÓA ĐIỆN XE và kiểm tra dây Mass (GND cọc âm) & trở kéo 510Ω.</span>`;
        } else if (preview.includes("02 19 71 11")) {
          diagHint = `<br><span style="color:#10B981">✅ Đang nhận gói Table 11 từ ECU!</span>`;
        }
        box.innerHTML = `Chip: <b>${d.chipName}</b> (${d.vid}:${d.pid})<br>`
          + `Quyền USB: <b style="color:${permColor}">${permTxt}</b> · Cổng: <b style="color:${connColor}">${connTxt}</b><br>`
          + `Đã nhận: <b style="color:#00E5FF">${d.rxBytes} Bytes (${d.rxPackets} gói)</b><br>`
          + `Dữ liệu gần nhất: <span style="color:#E2E8F0; word-break:break-all;">${d.lastRxPreview || "--"}</span>`
          + diagHint
          + (d.lastError ? `<br><span style="color:#EF4444">Lỗi: ${d.lastError}</span>` : "");
      }
    } catch (_e) {}
  }

  function scanBt() {
    refreshUsbDiag();
    if (!window.AndroidBT) {
      $("btModalStatus").textContent = "Đang chạy trên trình duyệt PC — Dùng nút Demo để test.";
      return;
    }
    if (!window.AndroidBT.hasPermissions()) {
      window.AndroidBT.requestBtPermissions();
      return;
    }
    $("pairedList").innerHTML = '<div class="muted-note">Đang tải thiết bị đã ghép nối...</div>';
    $("bleList").innerHTML = '<div class="muted-note">Đang quét BLE (6s)...</div>';
    window.AndroidBT.getPairedAndScan();
  }

  let usbPollTimer = null;
  $("pBtnBt").addEventListener("click", () => { $("btModal").hidden = false; scanBt(); startUsbPoll(); });
  $("lBtnBt").addEventListener("click", () => { $("btModal").hidden = false; scanBt(); startUsbPoll(); });
  if ($("lBtnToolbarConnect")) {
    $("lBtnToolbarConnect").addEventListener("click", () => {
      closeOverlayToolbar();
      $("btModal").hidden = false;
      scanBt();
      startUsbPoll();
    });
  }
  $("btnCloseModal").addEventListener("click", () => { $("btModal").hidden = true; stopUsbPoll(); });

  function startUsbPoll() {
    stopUsbPoll();
    refreshUsbDiag();
    usbPollTimer = setInterval(refreshUsbDiag, 1000);
  }

  function stopUsbPoll() {
    if (usbPollTimer) {
      clearInterval(usbPollTimer);
      usbPollTimer = null;
    }
  }
  $("btnScanBt").addEventListener("click", scanBt);
  $("btnDisconnectBt").addEventListener("click", () => {
    if (window.AndroidBT) window.AndroidBT.disconnect();
    btConnected = false;
    usbConnected = false;
    setBtBtnState("");
    setStatus("", "Chưa kết nối");
    if ($("lcModeBadge")) $("lcModeBadge").textContent = "IDLE";
    renderIdleState();
  });

  if ($("btnConnectUsb")) {
    $("btnConnectUsb").addEventListener("click", () => {
      if (replayRunning) toggleDemo();
      $("btModal").hidden = true;
      if (window.AndroidBT && window.AndroidBT.connectUsb) {
        window.AndroidBT.connectUsb();
      } else {
        $("btModalStatus").textContent = "Chỉ khả dụng trên điện thoại Android khi cắm cáp OTG";
      }
    });
  }

  if ($("btnWakeupUsb")) {
    $("btnWakeupUsb").addEventListener("click", () => {
      if (window.AndroidBT && window.AndroidBT.sendWakeup) {
        window.AndroidBT.sendWakeup();
        setStatus("warn", "Đang gửi lệnh WAKEUP...");
        if ($("btModalStatus")) $("btModalStatus").textContent = "Đã gửi lệnh WAKEUP đánh thức ECU!";
      }
    });
  }

  if ($("btnDisconnectUsb")) {
    $("btnDisconnectUsb").addEventListener("click", () => {
      if (window.AndroidBT && window.AndroidBT.disconnectUsb) {
        window.AndroidBT.disconnectUsb();
      }
      btConnected = false;
      usbConnected = false;
      setBtBtnState("");
      setStatus("", "Đã ngắt USB");
      if ($("lcModeBadge")) $("lcModeBadge").textContent = "IDLE";
      renderIdleState();
    });
  }

  window.__onBtPermissions = (ok) => { if (ok) scanBt(); };
  window.__onPairedDevices = (jsonStr) => {
    try {
      const list = JSON.parse(jsonStr);
      $("pairedList").innerHTML = "";
      if (!list.length) $("pairedList").innerHTML = '<div class="muted-note">Chưa có HC-05 / HC-06 nào ghép nối.</div>';
      else list.forEach((d) => renderDev(d, $("pairedList")));
    } catch (_e) {}
  };
  let bleCnt = 0;
  window.__onBleDeviceFound = (jsonStr) => {
    try {
      const dev = JSON.parse(jsonStr);
      if (bleCnt === 0) $("bleList").innerHTML = "";
      bleCnt += 1;
      renderDev(dev, $("bleList"));
    } catch (_e) {}
  };
  window.__onBleScanDone = () => {
    if (bleCnt === 0) $("bleList").innerHTML = '<div class="muted-note">Không thấy thiết bị BLE xung quanh.</div>';
    bleCnt = 0;
  };
  window.__onBtStatus = (st, msg) => {
    $("btModalStatus").textContent = msg || st;
    const isUsb = Boolean(msg && (msg.includes("USB") || msg.includes("OTG")));
    if (st === "connected") {
      btConnected = true;
      usbConnected = isUsb;
      setBtBtnState("ok");
      setStatus("ok", isUsb ? "USB Online" : "BT Online");
      if ($("lBannerTxt")) $("lBannerTxt").textContent = msg || (isUsb ? "USB Online · Chờ tín hiệu ECU" : "BT Online");
      if ($("lcModeBadge")) $("lcModeBadge").textContent = isUsb ? "USB" : "LIVE";
      $("chkBtDot").className = "conn-dot ok";
      $("chkBtTxt").textContent = isUsb ? "Đã kết nối USB OTG" : "Đã kết nối Bluetooth";
      if (isUsb && $("lConnSvgWrap")) {
        $("lConnSvgWrap").innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00FF66" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><path d="M12 2v8M12 14v8M5 10l7-5 7 5"/></svg>';
      }
    } else if (st === "connecting") {
      setBtBtnState("warn");
      setStatus("warn", "Đồng bộ");
      if ($("lBannerTxt")) $("lBannerTxt").textContent = msg || "Đang kết nối...";
      if ($("lcModeBadge")) $("lcModeBadge").textContent = "SYNC";
    } else if (st === "error") {
      btConnected = false;
      usbConnected = false;
      setBtBtnState("err");
      setStatus("err", "Lỗi");
      if ($("lBannerTxt")) $("lBannerTxt").textContent = msg || "Lỗi kết nối";
      if ($("lcModeBadge")) {
        $("lcModeBadge").textContent = "ERR";
        $("lcModeBadge").classList.add("is-err");
      }
    } else {
      btConnected = false;
      usbConnected = false;
      setBtBtnState("");
      setStatus("", "Chưa kết nối");
      if ($("lBannerTxt")) $("lBannerTxt").textContent = msg || "Bật khóa xe hoặc chạy Demo";
      if ($("lcModeBadge")) {
        $("lcModeBadge").textContent = replayRunning ? "SIM" : "IDLE";
        $("lcModeBadge").classList.remove("is-err");
      }
      $("chkBtDot").className = "conn-dot";
      $("chkBtTxt").textContent = "Chưa kết nối";
      if ($("lConnSvgWrap")) {
        $("lConnSvgWrap").innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg>';
      }
      if (!replayRunning) renderIdleState();
    }
  };

  window.__onBtFrame = (line) => {
    appendHexLog(line);
    if (!line || typeof line !== "string") return;

    // 0. STM32 Reset / Brownout Diagnostic detection
    if (line.includes("MCU_BOOT:")) {
      const rstReason = line.replace("MCU_BOOT:", "").trim();
      setStatus("warn", "STM32 Boot: " + rstReason);
      $("chkEcuDot").className = "conn-dot warn";
      $("chkEcuTxt").textContent = "Cảnh báo Reset: " + rstReason;
      if ($("lBannerTxt")) $("lBannerTxt").textContent = "Cảnh báo Reset MCU: " + rstReason;
      if ($("cHealthText")) $("cHealthText").textContent = "Cảnh báo Reset MCU: " + rstReason;
      return;
    }

    // 1. STM32 FastInit / Handshake status messages
    if (line.includes("Dang danh thuc") || line.includes("Gui ma") || line.includes("Hoan tat") || line.includes("Tu dong ket noi")) {
      const isDone = line.includes("Hoan tat");
      const shortMsg = isDone ? "Đã khởi tạo (Chờ ECU...)" : line.split("...")[0].slice(0, 24);
      setStatus("warn", shortMsg);
      $("chkEcuDot").className = "conn-dot warn";
      $("chkEcuTxt").textContent = line;
      if ($("lBannerTxt")) $("lBannerTxt").textContent = line;
      if ($("cHealthText")) $("cHealthText").textContent = line;
      return;
    }

    // 2. Parse any Keihin ECU response
    const pkt = parseKlinePacket(line);
    if (!pkt) {
      // Detect STM32 TX query echo (72 05 71 11) when ECU has not replied with 02 19
      if (line.includes("72 05 71 11") || line.includes("72 05")) {
        setStatus("warn", "Chờ phản hồi ECU");
        $("chkEcuDot").className = "conn-dot warn";
        const waitNotice = "STM32 phát lệnh OK · Đang chờ ECU (Kiểm tra chìa khóa/GND Mass)";
        $("chkEcuTxt").textContent = waitNotice;
        if ($("lBannerTxt")) $("lBannerTxt").textContent = waitNotice;
        if ($("cHealthText")) $("cHealthText").textContent = waitNotice;
      }
      return;
    }

    if (pkt.kind === "table11") {
      setStatus("ok", "ECU Online");
      applyFrame(pkt);
      const onlineMsg = `ECU Online · RPM ${pkt.rpm} · ${pkt.vbat}V · ECT ${pkt.ectC}°C`;
      if ($("lBannerTxt")) $("lBannerTxt").textContent = onlineMsg;
      if ($("cHealthText")) $("cHealthText").textContent = onlineMsg;
    } else if (pkt.kind === "ecmid") {
      $("cEcmId").textContent = pkt.ecmId;
      $("lEcmId").textContent = pkt.ecmId;
      $("fiModalEcm").textContent = "ECM ID: " + pkt.ecmId;
    } else if (pkt.kind === "dtc") {
      faultCount = pkt.faults.length;
      updateFiLamp();
      const htmlList = !pkt.faults.length
        ? '<div class="dtc-card ok"><strong>Lỗi ' + pkt.dtcType + ': Không phát hiện mã lỗi</strong><div class="muted-note">Hệ thống PGM-FI hoạt động bình thường.</div></div>'
        : pkt.faults.map((f) => '<div class="dtc-card"><strong>Mã #' + f.code + " (" + f.raw + ") · " + pkt.dtcType + '</strong><div class="muted-note">' + f.desc + "</div></div>").join("");
      $("cDtcList").innerHTML = htmlList;
      $("mDtcList").innerHTML = htmlList;
      $("lDtcOut").textContent = !pkt.faults.length
        ? "[" + pkt.dtcType + "] Sạch lỗi (0 DTC)."
        : pkt.faults.map((f) => "[" + pkt.dtcType + "] #" + f.code + ": " + f.desc).join("\n");
    } else if (pkt.kind === "clear_dtc_ack") {
      faultCount = 0;
      updateFiLamp();
      const okHtml = '<div class="dtc-card ok"><strong>Đã xóa bộ nhớ lỗi ECU thành công</strong></div>';
      $("cDtcList").innerHTML = okHtml;
      $("mDtcList").innerHTML = okHtml;
      $("lDtcOut").textContent = "ECU đã xác nhận xóa sạch bộ nhớ lỗi.";
    } else if (pkt.kind === "custom") {
      $("lDtcOut").textContent = "Table " + pkt.table + ": " + pkt.rawHex;
    }
  };

  window.addEventListener("resize", () => {
    if (uiMode === "casual" && activeCasualTab === "overview" && hasLiveSignal) drawOverviewChart();
    if (uiMode === "nerdy" && activeNerdyTab === "scope") drawScope();
  });

  syncModeAndTabs();
  renderMapTable();
  renderIdleState();
})();
