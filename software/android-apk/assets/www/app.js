(function () {
  "use strict";

  const Core = window.KlineCore;
  if (!Core) {
    throw new Error("KlineCore module missing (kline_core.js must load before app.js)");
  }

  const $ = (id) => document.getElementById(id);
  const hasBridge = () => typeof window.AndroidBT !== "undefined" && window.AndroidBT !== null;

  const LS_KEYS = {
    redline: "kline_redline_rpm",
    oilKm: "kline_oil_km",
    odoKm: "kline_odo_km",
    learnedRatios: "kline_learned_ratios_v2"
  };

  /* ── IN-APP DEBUG LOG RING BUFFER ── */
  const jsDebugBuffer = [];
  function logAppDebug(level, msg) {
    const ts = new Date().toTimeString().slice(0, 8);
    const line = `[${ts}] [${level}] ${msg}`;
    jsDebugBuffer.push(line);
    if (jsDebugBuffer.length > 120) jsDebugBuffer.shift();
    if (hasBridge() && typeof window.AndroidBT.logDebug === "function") {
      try { window.AndroidBT.logDebug(level, String(msg)); } catch (_) {}
    }
    const page = document.body.dataset.page;
    if (page === "nerdy-lab") renderDebugConsole();
  }

  window.addEventListener("error", (ev) => {
    logAppDebug("JS_ERR", `${ev.message} (${ev.filename || "app"}:${ev.lineno || 0})`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    logAppDebug("PROMISE_ERR", String(ev.reason || "Unknown rejection"));
  });

  /* ── PERSISTENCE HELPERS ── */
  function loadNum(key, fallback) {
    try {
      const v = parseFloat(localStorage.getItem(key));
      return Number.isFinite(v) ? v : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function saveVal(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (_) {}
  }
  function loadLearnedGearModel() {
    try {
      const raw = localStorage.getItem(LS_KEYS.learnedRatios);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.ratios) && parsed.ratios.length === 6 ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  function saveLearnedGearModel(ratios, sources) {
    try {
      localStorage.setItem(LS_KEYS.learnedRatios, JSON.stringify({
        ratios,
        sources: sources || ratios.map((_, i) => (i === 0 ? "learned" : "derived")),
        savedAt: new Date().toISOString()
      }));
    } catch (_) {}
  }

  /* ── STATE ── */
  const savedModel = loadLearnedGearModel();
  const gearTracker = Core.createGearTracker(savedModel ? savedModel.ratios : null);
  if (savedModel && savedModel.sources) {
    gearTracker.getModel().sources.splice(0, 6, ...savedModel.sources);
  }
  const gearLearner = Core.createGearPullLearner(savedModel ? savedModel.ratios : null);

  let redlineRpm = loadNum(LS_KEYS.redline, 10500);
  let uiMode = "casual";
  let currentPage = "casual-overview";
  let connState = "disconnected";
  let hasLiveData = false;
  let lastFrame = null;
  let lastFramePerf = 0;

  let peakRpm = 0;
  let peakTps = 0;
  let lastGearChar = "-";
  let faultCount = 0;
  let activeEcmId = "-- -- -- -- --";

  let odoKm = loadNum(LS_KEYS.odoKm, 0);
  let oilKm = loadNum(LS_KEYS.oilKm, 0);
  let tripMeters = 0;
  let lastSpeedIntegrateMs = 0;

  const tripStats = {
    startMs: Date.now(),
    engineRunSec: 0,
    lastRunTickMs: 0,
    peakRpm: 0,
    peakTps: 0,
    peakVss: 0,
    minVbat: null,
    maxVbat: null,
    warnCount: 0,
    warnBannerActive: false
  };

  const bounds = {
    tps: [null, null], map: [null, null], inj: [null, null], ign: [null, null], o2: [null, null],
    iacv: [null, null], ect: [null, null], iat: [null, null], vbat: [null, null], vss: [null, null]
  };

  const history = [];
  const HISTORY_MAX = 180;
  const hexLines = [];

  /* Recording & Replay / Demo */
  let isRecording = false;
  let csvRows = [];
  let hexPaused = false;
  let hudToolbarTimer = null;
  let demoActive = false;
  let demoPlaying = true;
  let demoIdx = 0;
  let demoSpeed = 1;
  let demoTimer = null;
  let replayFrames = [];
  let replaySourceLabel = "DEMO";

  /* Oscilloscope & Tuning */
  const scopeEnabled = { rpm: true, tps: true, inj: true, ign: true };
  let scopeFrozen = false;
  let scopeCursorIdx = null;
  let activeMapMetric = "inj";
  const mapCells = {};
  const pullTimer = { state: "idle", t0: 0, cur: 0, best: null };
  let scsActive = false;

  /* Smooth 60fps Interpolated Values */
  const anim = {
    targetRpm: 0,
    targetVss: 0,
    targetTps: 0,
    dispRpm: 0,
    dispVss: 0,
    dispTps: 0,
    rafId: 0,
    lastRafMs: 0,
    lastUiTextMs: 0
  };

  const isLandscape = () => window.innerWidth > window.innerHeight;

  /* ── SHIFT LED RAIL SETUP ── */
  const ledEls = { pCasual: [], pNerdy: [], lHud: [] };
  function buildTachRail(ledsId, scaleId, targetArr) {
    const ledsEl = $(ledsId);
    const scaleEl = $(scaleId);
    if (!ledsEl || !scaleEl) return;
    ledsEl.innerHTML = "";
    scaleEl.innerHTML = "";
    targetArr.length = 0;

    for (let i = 0; i < 14; i++) {
      const s = document.createElement("div");
      s.className = "sled";
      ledsEl.appendChild(s);
      targetArr.push(s);

      const tk = document.createElement("div");
      const rpmVal = Math.round(((i + 1) / 14) * (redlineRpm / 1000));
      const isRed = i >= 11;
      tk.className = "scale-tick" + (i === 0 ? " is-first" : i === 13 ? " is-last" : "") + (isRed ? " is-red" : "");
      tk.textContent = i % 2 === 0 || i === 13 ? String(rpmVal) : "";
      scaleEl.appendChild(tk);
    }
  }

  function rebuildAllTachRails() {
    buildTachRail("pCasualLeds", "pCasualScale", ledEls.pCasual);
    buildTachRail("pNerdyLeds", "pNerdyScale", ledEls.pNerdy);
    buildTachRail("lShiftLeds", "lShiftScale", ledEls.lHud);
  }

  function updateLeds(rpm) {
    const ratio = Math.max(0, Math.min(1, rpm / redlineRpm));
    const litCount = Math.round(ratio * 14);
    const allSets = [ledEls.pCasual, ledEls.pNerdy, ledEls.lHud];
    for (let s = 0; s < allSets.length; s++) {
      const arr = allSets[s];
      for (let i = 0; i < arr.length; i++) {
        let cls = "sled";
        if (i < litCount) {
          if (i >= 11) cls += " lit-r";
          else if (i >= 8) cls += " lit-a";
          else cls += " lit-c";
        }
        if (arr[i].className !== cls) arr[i].className = cls;
      }
    }
  }

  /* ── GPU BAR / TRANSFORM HELPERS ── */
  function setScaleX(id, norm01) {
    const el = $(id);
    if (!el) return;
    const clamped = Math.max(0, Math.min(1, norm01 || 0));
    el.style.transform = `scaleX(${clamped.toFixed(4)})`;
  }

  /* ── 60FPS INTERPOLATION LOOP ── */
  function stepAnimationFrame(nowMs) {
    anim.rafId = 0;
    if (document.hidden) return;

    const dt = anim.lastRafMs > 0 ? Math.min(0.08, (nowMs - anim.lastRafMs) / 1000) : 0.016;
    anim.lastRafMs = nowMs;
    const alpha = 1 - Math.exp(-dt * 14.5);

    anim.dispRpm += (anim.targetRpm - anim.dispRpm) * alpha;
    anim.dispVss += (anim.targetVss - anim.dispVss) * alpha;
    anim.dispTps += (anim.targetTps - anim.dispTps) * alpha;

    if (Math.abs(anim.targetRpm - anim.dispRpm) < 6) anim.dispRpm = anim.targetRpm;
    if (Math.abs(anim.targetVss - anim.dispVss) < 0.25) anim.dispVss = anim.targetVss;
    if (Math.abs(anim.targetTps - anim.dispTps) < 0.3) anim.dispTps = anim.targetTps;

    const r = Math.round(anim.dispRpm);
    const v = Math.round(anim.dispVss);
    const t = Math.max(0, Math.min(100, anim.dispTps));

    const rpmNorm = r / Math.max(1000, redlineRpm);
    const tpsNorm = t / 100;

    setScaleX("cRpmSweep", rpmNorm);
    setScaleX("lcRpmSweep", rpmNorm);
    setScaleX("cTpsBgSweep", tpsNorm);
    setScaleX("cTpsFill", tpsNorm);
    setScaleX("nTpsFill", tpsNorm);
    setScaleX("lcTpsBgSweep", tpsNorm);
    setScaleX("lcTpsFill", tpsNorm);
    setScaleX("lnTpsBgSweep", tpsNorm);
    setScaleX("lnTpsFill", tpsNorm);

    updateLeds(r);

    // Throttle DOM numeric text updates lightly while bars stay locked at display refresh
    if (nowMs - anim.lastUiTextMs >= 32) {
      anim.lastUiTextMs = nowMs;
      const isRed = r >= redlineRpm * 0.92;
      const rpmStr = r.toLocaleString("en-US");
      const vssStr = String(v);
      const tpsStr = Math.round(t) + "%";

      const cRpmEl = $("cRpm");
      if (cRpmEl) {
        cRpmEl.textContent = rpmStr;
        cRpmEl.className = "hero-rpm-val" + (isRed ? " redline" : "");
      }
      const lcRpmEl = $("lcRpm");
      if (lcRpmEl) {
        lcRpmEl.textContent = rpmStr;
        lcRpmEl.className = "tft-rpm-val" + (isRed ? " redline" : "");
      }
      const nRpmEl = $("nRpm");
      if (nRpmEl) {
        nRpmEl.textContent = rpmStr;
        nRpmEl.className = "hero-rpm-val" + (isRed ? " redline" : "");
      }
      const lnRpmEl = $("lnRpm");
      if (lnRpmEl) {
        lnRpmEl.textContent = rpmStr;
        lnRpmEl.className = "lhud-nerdy-rpm" + (isRed ? " redline" : "");
      }

      if ($("cSpeedNum")) $("cSpeedNum").textContent = vssStr;
      if ($("lcSpeedNum")) $("lcSpeedNum").textContent = vssStr;
      if ($("nVssNum")) $("nVssNum").textContent = vssStr;

      if ($("cTpsNum")) $("cTpsNum").textContent = tpsStr;
      if ($("lcTpsNum")) $("lcTpsNum").textContent = tpsStr;
      if ($("nTpsNum")) $("nTpsNum").textContent = String(Math.round(t));
      if ($("lnTpsNum")) $("lnTpsNum").textContent = tpsStr;
    }

    const stillMoving =
      Math.abs(anim.targetRpm - anim.dispRpm) >= 6 ||
      Math.abs(anim.targetVss - anim.dispVss) >= 0.25 ||
      Math.abs(anim.targetTps - anim.dispTps) >= 0.3;

    if (stillMoving) {
      anim.rafId = requestAnimationFrame(stepAnimationFrame);
    }
  }

  function kickAnimLoop() {
    if (!anim.rafId && !document.hidden) {
      anim.lastRafMs = performance.now();
      anim.rafId = requestAnimationFrame(stepAnimationFrame);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kickAnimLoop();
  });

  /* ── IDLE & RESET RENDERERS ── */
  function renderIdleState() {
    hasLiveData = false;
    anim.targetRpm = 0;
    anim.targetVss = 0;
    anim.targetTps = 0;
    kickAnimLoop();

    if ($("cHeroCard")) $("cHeroCard").classList.add("is-idle");
    if ($("nHeroCard")) $("nHeroCard").classList.add("is-idle");
    if ($("cEmptyChecklist")) $("cEmptyChecklist").classList.remove("hidden");
    if ($("cChartCard")) $("cChartCard").classList.add("hidden");

    const cGear = $("cGearVal");
    if (cGear) {
      cGear.textContent = "-";
      cGear.className = "gear-cap-val gear-N";
    }
    const lcGear = $("lcGearVal");
    if (lcGear) {
      lcGear.textContent = "-";
      lcGear.className = "tft-gear-digit gear-N";
    }

    const modelState = gearTracker.getModel();
    const gLabel = modelState.isCalibrated ? "Đã học" : "Mặc định";
    if ($("cGearSub")) $("cGearSub").textContent = gLabel;
    if ($("lcGearSub")) $("lcGearSub").textContent = gLabel;

    if ($("cEctNum")) { $("cEctNum").textContent = "--"; $("cEctNum").className = "metric-val"; }
    if ($("cEctSub")) $("cEctSub").textContent = "Chờ ECU";
    setScaleX("cEctFill", 0);
    setScaleX("lcEctFill", 0);

    if ($("cVbatNum")) { $("cVbatNum").textContent = "--"; $("cVbatNum").className = "metric-val"; }
    if ($("cVbatSub")) $("cVbatSub").textContent = "Chờ ECU";
    setScaleX("cVbatFill", 0);
    setScaleX("lcBatFill", 0);

    if ($("cIatNum")) $("cIatNum").textContent = "--";
    if ($("cMapWord")) $("cMapWord").textContent = "--";
    if ($("cMapKpaSub")) $("cMapKpaSub").textContent = "kPa";
    if ($("cMapSub")) $("cMapSub").textContent = "Cổ hút";

    if ($("lcEctNum")) { $("lcEctNum").textContent = "--"; $("lcEctNum").className = "lhud-mini-val"; }
    if ($("lcEctSub")) $("lcEctSub").textContent = "Chờ";
    if ($("lcBatNum")) { $("lcBatNum").textContent = "--"; $("lcBatNum").className = "lhud-mini-val"; }
    if ($("lcBatSub")) $("lcBatSub").textContent = "Chờ";
    if ($("lcIatNum")) $("lcIatNum").textContent = "--";
    if ($("lcMapWord")) $("lcMapWord").textContent = "--";
    if ($("lcMapSub")) $("lcMapSub").textContent = "--";

    if ($("casualBanner")) $("casualBanner").className = "status-banner ok";
    if ($("cHealthDot")) $("cHealthDot").className = "status-dot";
    if ($("cHealthText")) $("cHealthText").textContent = "CHỜ TÍN HIỆU ECU...";
    if ($("lBannerTxt")) $("lBannerTxt").textContent = "K-LINE READY";
  }

  /* ── NAVIGATION & MODE SYNC ── */
  function syncModeAndPages(targetPage) {
    if (targetPage) currentPage = targetPage;
    uiMode = currentPage.startsWith("nerdy-") ? "nerdy" : "casual";

    document.body.dataset.page = currentPage;
    document.body.classList.toggle("mode-nerdy", uiMode === "nerdy");
    document.body.classList.toggle("mode-casual", uiMode === "casual");

    document.querySelectorAll(".page").forEach((p) => {
      p.classList.toggle("active", p.id === "page-" + currentPage);
    });

    document.querySelectorAll(".bnav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.page === currentPage);
    });

    const isNerdy = uiMode === "nerdy";
    if ($("lGridCasual")) $("lGridCasual").classList.toggle("hidden", isNerdy);
    if ($("lGridNerdy")) $("lGridNerdy").classList.toggle("hidden", !isNerdy);
    if ($("lcModeBadge")) $("lcModeBadge").textContent = isNerdy ? "NERDY" : "CASUAL";

    const modeTxt = isNerdy ? "CASUAL" : "RACE";
    if ($("pBtnModeCycle")) $("pBtnModeCycle").textContent = modeTxt;
    if ($("lBtnModeCycle")) $("lBtnModeCycle").textContent = modeTxt;

    if (currentPage === "casual-overview") drawOverviewChart();
    if (currentPage === "casual-trip") renderSessionFiles();
    if (currentPage === "nerdy-tuning") {
      drawScope();
      renderMapTable();
    }
    if (currentPage === "nerdy-lab") {
      renderGearLearnerUi();
      renderDebugConsole();
    }
  }

  function updateConnIndicators(state, message) {
    connState = state || "disconnected";
    const mapTxt = {
      connected: "ĐÃ KẾT NỐI",
      connecting: "ĐANG KẾT NỐI...",
      disconnected: "CHƯA KẾT NỐI"
    };
    const dotCls = state === "connected" ? "ok" : state === "connecting" ? "warn" : "";
    const txt = message && message.length <= 28 ? message : mapTxt[connState] || "CHƯA KẾT NỐI";

    if ($("pConnDot")) $("pConnDot").className = "conn-dot " + dotCls;
    if ($("lConnDot")) $("lConnDot").className = "conn-dot " + dotCls;
    if ($("pConnText")) $("pConnText").textContent = txt;
    if ($("lConnText")) $("lConnText").textContent = txt;
    if ($("btModalStatus")) $("btModalStatus").textContent = message || txt;

    const btCls = state === "connected" ? " is-ok" : state === "connecting" ? " is-warn" : "";
    if ($("pBtnBt")) $("pBtnBt").className = "top-chip link-chip" + btCls;
    if ($("lBtnBt")) $("lBtnBt").className = "lhud-link-pill" + btCls;

    if ($("chkBtDot")) $("chkBtDot").className = "chk-dot " + dotCls;
    if ($("chkBtTxt")) {
      $("chkBtTxt").textContent = state === "connected"
        ? "1. Đã kết nối K-Line Hardware (" + txt + ")"
        : "1. Kết nối bộ đọc K-Line (USB OTG hoặc Bluetooth)";
    }

    const fiVisible = faultCount > 0;
    if ($("pBtnFi")) {
      $("pBtnFi").classList.toggle("hidden", !fiVisible);
      $("pBtnFi").classList.toggle("has-fault", fiVisible);
    }
    if ($("lBtnFi")) {
      $("lBtnFi").classList.toggle("hidden", !fiVisible);
      $("lBtnFi").classList.toggle("has-fault", fiVisible);
    }
  }

  /* ── MIN/MAX & 3D MAP & PULL TIMER ── */
  function updateBound(key, val, unit, dec, dotId, lblId) {
    if (!Number.isFinite(val)) return;
    const b = bounds[key];
    if (b[0] === null || val < b[0]) b[0] = val;
    if (b[1] === null || val > b[1]) b[1] = val;
    const f = (n) => (dec === 0 ? String(Math.round(n)) : n.toFixed(dec));
    const el = $(lblId);
    if (el) el.textContent = `${f(b[0])} / ${f(b[1])}`;
    const dot = $(dotId);
    if (dot) dot.className = "mm-dot ok";
  }

  function recordMapCell(d) {
    const rBin = Math.min(7, Math.max(0, Math.floor(d.rpm / 1500)));
    const tBin = Math.min(5, Math.max(0, Math.floor(d.tpsPct / 17)));
    const key = rBin + "_" + tBin;
    if (!mapCells[key]) mapCells[key] = { n: 0, injSum: 0, ignSum: 0, o2Sum: 0 };
    const c = mapCells[key];
    c.n += 1;
    c.injSum += d.injMs;
    c.ignSum += d.ignDeg;
    c.o2Sum += d.o2Volt;
  }

  function renderMapTable() {
    const tbl = $("mapTable");
    if (!tbl) return;
    const tCols = ["0%", "17%", "34%", "51%", "68%", "85%"];
    let html = "<thead><tr><th>RPM\\TPS</th>";
    for (let t = 0; t < 6; t++) html += `<th>${tCols[t]}</th>`;
    html += "</tr></thead><tbody>";

    for (let r = 0; r < 8; r++) {
      html += `<tr><th>${(r * 1.5).toFixed(1)}k</th>`;
      for (let t = 0; t < 6; t++) {
        const c = mapCells[r + "_" + t];
        let txt = "--";
        let cls = "map-cell";
        if (c && c.n > 0) {
          const avg = activeMapMetric === "inj"
            ? c.injSum / c.n
            : activeMapMetric === "ign"
              ? c.ignSum / c.n
              : c.o2Sum / c.n;
          txt = avg.toFixed(activeMapMetric === "ign" ? 0 : 1);
          if (activeMapMetric === "inj") cls += avg > 9 ? " hot" : avg > 5.5 ? " warm" : avg > 2.5 ? " mid" : " cool";
          else if (activeMapMetric === "ign") cls += avg > 32 ? " hot" : avg > 22 ? " warm" : " mid";
          else cls += avg < 0.35 ? " warm" : avg > 0.7 ? " cool" : " mid";
        }
        html += `<td class="${cls}">${txt}</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody>";
    tbl.innerHTML = html;
  }

  function updatePullTimer(vss) {
    const now = performance.now();
    if (pullTimer.state === "idle") {
      if (vss >= 38 && vss <= 44) {
        pullTimer.state = "armed";
        pullTimer.t0 = now;
      }
    } else if (pullTimer.state === "armed") {
      if (vss >= 40) {
        pullTimer.state = "running";
        pullTimer.t0 = now;
      } else if (vss < 34) {
        pullTimer.state = "idle";
      }
    } else if (pullTimer.state === "running") {
      pullTimer.cur = (now - pullTimer.t0) / 1000;
      if (vss >= 100) {
        pullTimer.state = "done";
        if (pullTimer.best === null || pullTimer.cur < pullTimer.best) pullTimer.best = pullTimer.cur;
      } else if (vss < 25) {
        pullTimer.state = "idle";
        pullTimer.cur = 0;
      }
    } else if (pullTimer.state === "done" && vss < 30) {
      pullTimer.state = "idle";
    }

    const lblMap = { idle: "CHỜ 40 KM/H", armed: "SẴN SÀNG", running: "ĐANG ĐO!", done: "HOÀN TẤT" };
    if ($("pullStateTxt")) $("pullStateTxt").textContent = lblMap[pullTimer.state] || "CHỜ";
    if ($("pullCurTxt")) $("pullCurTxt").textContent = pullTimer.cur.toFixed(2) + "s";
    if ($("pullBestTxt")) $("pullBestTxt").textContent = pullTimer.best !== null ? pullTimer.best.toFixed(2) + "s" : "--";
  }

  /* ── TRIP STATS RENDERER ── */
  function formatClock(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function renderTripStats() {
    const runSec = Math.round(tripStats.engineRunSec);
    if ($("tRunTime")) $("tRunTime").textContent = formatClock(runSec);
    if ($("lcTimeTxt")) $("lcTimeTxt").textContent = formatClock(runSec);
    if ($("tPeakRpm")) $("tPeakRpm").innerHTML = `${Math.round(tripStats.peakRpm)} <small>RPM</small>`;
    if ($("tMaxTpsNum")) $("tMaxTpsNum").innerHTML = `${Math.round(tripStats.peakTps)} <small>%</small>`;
    if ($("tWarnCount")) $("tWarnCount").textContent = String(tripStats.warnCount);

    const tripKm = tripMeters / 1000;
    if ($("lcTripTxt")) $("lcTripTxt").textContent = tripKm.toFixed(1) + " km";
    if ($("lcOdoTxt")) $("lcOdoTxt").textContent = Math.round(odoKm) + " km";
    if ($("tOilText")) $("tOilText").textContent = `${Math.round(oilKm)} / 1500 km`;
    setScaleX("tOilFill", Math.min(1, oilKm / 1500));

    if ($("tMinBat")) $("tMinBat").textContent = tripStats.minVbat !== null ? tripStats.minVbat.toFixed(1) + " V" : "-- V";
    if ($("tMaxBat")) $("tMaxBat").textContent = tripStats.maxVbat !== null ? tripStats.maxVbat.toFixed(1) + " V" : "-- V";

    const vEl = $("tBatVerdict");
    if (vEl) {
      if (tripStats.maxVbat === null) {
        vEl.textContent = "CHỜ DỮ LIỆU";
        vEl.className = "pill-tag";
      } else if (tripStats.minVbat < 10.5) {
        vEl.textContent = "BÌNH YẾU KHI ĐỀ";
        vEl.className = "pill-tag warn";
      } else if (tripStats.maxVbat > 15.1) {
        vEl.textContent = "QUÁ ÁP SẠC";
        vEl.className = "pill-tag warn";
      } else if (tripStats.maxVbat >= 13.4) {
        vEl.textContent = "SẠC & BÌNH TỐT";
        vEl.className = "pill-tag ok";
      } else {
        vEl.textContent = "BÌNH CHỜ";
        vEl.className = "pill-tag";
      }
    }
  }

  /* ── CANVAS CHARTS (HiDPI Crisp) ── */
  function resizeCanvasDpr(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawOverviewChart() {
    const canvas = $("pOverviewChart");
    const box = resizeCanvasDpr(canvas);
    if (!box) return;
    const { ctx, w, h } = box;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (history.length < 2) return;
    const pts = history.slice(-100);
    const n = pts.length;

    const plotSeries = (getter, maxVal, color, lw) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h - 6 - Math.max(0, Math.min(1, getter(pts[i]) / maxVal)) * (h - 12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    plotSeries((p) => p.rpm, redlineRpm, "#00E5FF", 2);
    plotSeries((p) => p.tpsPct, 100, "#FF4D1A", 1.7);
  }

  function drawScope() {
    const canvas = $("nScopeCanvas");
    const box = resizeCanvasDpr(canvas);
    if (!box) return;
    const { ctx, w, h } = box;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const pts = history.slice(-140);
    if (pts.length < 2) return;

    const channels = [
      { key: "rpm", get: (p) => p.rpm / redlineRpm, color: "#00E5FF" },
      { key: "tps", get: (p) => p.tpsPct / 100, color: "#FF4D1A" },
      { key: "inj", get: (p) => p.injMs / 18, color: "#00E676" },
      { key: "ign", get: (p) => Math.max(0, p.ignDeg + 5) / 50, color: "#FFB300" }
    ];

    channels.forEach((ch) => {
      if (!scopeEnabled[ch.key]) return;
      ctx.beginPath();
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 1.7;
      for (let i = 0; i < pts.length; i++) {
        const x = (i / (pts.length - 1)) * w;
        const y = h - 8 - Math.max(0, Math.min(1, ch.get(pts[i]))) * (h - 16);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    if (scopeCursorIdx !== null && pts[scopeCursorIdx]) {
      const idx = Math.max(0, Math.min(pts.length - 1, scopeCursorIdx));
      const x = (idx / (pts.length - 1)) * w;
      const p = pts[idx];
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      if ($("scopeCursorReadout")) {
        $("scopeCursorReadout").textContent =
          `RPM ${p.rpm} | TPS ${Math.round(p.tpsPct)}% | INJ ${p.injMs.toFixed(1)}ms | IGN ${p.ignDeg}°`;
      }
    }
  }

  /* ── GEAR PULL-LEARN UI RENDERER ── */
  function renderGearLearnerUi() {
    const st = gearLearner.getStatus();
    const model = gearTracker.getModel();

    const modeLabels = {
      idle: "SẴN SÀNG",
      "pull-1": "ĐANG HỌC SỐ 1",
      "auto-seq": `ĐANG HỌC SỐ ${st.activeGear}`,
      single: `CHỈNH SỐ ${st.activeGear}`
    };

    let statusText = 'Chọn "Học Số 1 (Kéo Max Tua)" rồi vào số 1 kéo ga đều.';
    if (st.mode === "pull-1") {
      statusText = st.ready
        ? `Đủ mẫu sạch (${st.sampleCount}) · Peak ${st.maxRpmSeen} RPM. Nhấn "Chốt Ratio & Lưu" để tự tính số 2–6!`
        : `Vào số 1 & kéo lên tua cao (> 2200 RPM, > 6 km/h)... Hiện có ${st.sampleCount} mẫu.`;
    } else if (st.mode === "auto-seq") {
      statusText = `Chạy lần lượt số 1→6 (${st.seqLockedCount}/6 số đã ghi nhận, Ratio hiện tại: ${st.liveRatio ? st.liveRatio.toFixed(1) : "--"}).`;
    } else if (st.mode === "single") {
      statusText = `Chạy ổn định ở số ${st.activeGear} (Ratio hiện tại: ${st.liveRatio ? st.liveRatio.toFixed(1) : "--"}), xong nhấn Chốt.`;
    }

    const metaText = `N=${st.sampleCount} · Peak ${st.maxRpmSeen} RPM · R=${st.liveRatio ? st.liveRatio.toFixed(1) : "--"}`;

    if ($("learnLiveBanner")) $("learnLiveBanner").classList.toggle("is-learning", st.mode !== "idle");
    if ($("learnModeBadge")) $("learnModeBadge").textContent = modeLabels[st.mode] || "SẴN SÀNG";
    if ($("learnStatusTxt")) $("learnStatusTxt").textContent = statusText;
    if ($("learnSampleMeta")) $("learnSampleMeta").textContent = metaText;
    if ($("learnConfirmRow")) $("learnConfirmRow").classList.toggle("hidden", st.mode === "idle");

    if ($("mLearnBadge")) $("mLearnBadge").textContent = modeLabels[st.mode] || "SẴN SÀNG";
    if ($("mLearnStatus")) $("mLearnStatus").textContent = statusText;
    if ($("mLearnMeta")) $("mLearnMeta").textContent = metaText;
    if ($("mLearnConfirmRow")) $("mLearnConfirmRow").classList.toggle("hidden", st.mode === "idle");

    document.querySelectorAll(".gear-learn-btn").forEach((btn) => {
      const g = parseInt(btn.dataset.learnGear, 10);
      btn.classList.toggle("active", st.mode !== "idle" && st.activeGear === g);
    });

    const grid = $("gearRatiosGrid");
    if (grid) {
      grid.innerHTML = model.ratios.map((ratio, idx) => {
        const src = model.sources[idx] || "default";
        const tag = src === "learned" ? "ĐÃ HỌC" : src === "derived" ? "TỪ SỐ 1" : "MẶC ĐỊNH";
        const cls = src === "learned" ? "locked" : src === "derived" ? "derived" : "";
        return `<div class="learn-ratio-pill ${cls}"><strong>G${idx + 1} · ${ratio.toFixed(1)}</strong><span>${tag}</span></div>`;
      }).join("");
    }
  }

  /* ── DEBUG CONSOLE RENDERER ── */
  function renderDebugConsole() {
    const out = $("lAppDebugOut");
    if (!out) return;
    let lines = [...jsDebugBuffer];
    if (hasBridge() && typeof window.AndroidBT.getAppDebugLogs === "function") {
      try {
        const nativeLogs = window.AndroidBT.getAppDebugLogs();
        if (nativeLogs) lines = nativeLogs.split("\n").concat(lines).slice(-140);
      } catch (_) {}
    }
    out.textContent = lines.length ? lines.join("\n") : "Chưa có log lỗi nào (hệ thống ổn định).";
    out.scrollTop = out.scrollHeight;
  }

  /* ── APPLY LIVE TELEMETRY FRAME ── */
  function applyFrame(d) {
    lastFrame = d;
    lastFramePerf = performance.now();

    if (!hasLiveData) {
      hasLiveData = true;
      if ($("cHeroCard")) $("cHeroCard").classList.remove("is-idle");
      if ($("nHeroCard")) $("nHeroCard").classList.remove("is-idle");
      if ($("cEmptyChecklist")) $("cEmptyChecklist").classList.add("hidden");
      if ($("cChartCard")) $("cChartCard").classList.remove("hidden");
      if ($("chkEcuDot")) $("chkEcuDot").className = "chk-dot ok";
      if ($("chkEcuTxt")) $("chkEcuTxt").textContent = "2. ECU đang gửi dữ liệu Table 11";
      requestAnimationFrame(() => drawOverviewChart());
    }

    const nowMs = Date.now();
    if (d.rpm > 400) {
      if (tripStats.lastRunTickMs > 0) {
        const deltaSec = Math.min(2.0, (nowMs - tripStats.lastRunTickMs) / 1000);
        tripStats.engineRunSec += deltaSec;
      }
      tripStats.lastRunTickMs = nowMs;
    } else {
      tripStats.lastRunTickMs = 0;
    }

    if (lastSpeedIntegrateMs > 0 && d.vssKmh > 0) {
      const dtHrs = Math.min(2.0, (nowMs - lastSpeedIntegrateMs) / 1000) / 3600;
      const dKm = d.vssKmh * dtHrs;
      tripMeters += dKm * 1000;
      odoKm += dKm;
      oilKm += dKm;
      saveVal(LS_KEYS.odoKm, odoKm.toFixed(3));
      saveVal(LS_KEYS.oilKm, oilKm.toFixed(3));
    }
    lastSpeedIntegrateMs = nowMs;

    if (d.rpm > peakRpm) peakRpm = d.rpm;
    if (d.tpsPct > peakTps) peakTps = d.tpsPct;
    if (d.rpm > tripStats.peakRpm) tripStats.peakRpm = d.rpm;
    if (d.tpsPct > tripStats.peakTps) tripStats.peakTps = d.tpsPct;
    if (d.vssKmh > tripStats.peakVss) tripStats.peakVss = d.vssKmh;
    if (d.vbat > 4.0) {
      if (tripStats.minVbat === null || d.vbat < tripStats.minVbat) tripStats.minVbat = d.vbat;
      if (tripStats.maxVbat === null || d.vbat > tripStats.maxVbat) tripStats.maxVbat = d.vbat;
    }

    /* Drive 60fps smooth targets */
    anim.targetRpm = d.rpm;
    anim.targetVss = d.vssKmh;
    anim.targetTps = d.tpsPct;
    kickAnimLoop();

    /* Peak Badges */
    const peakTxt = "PEAK " + Math.round(peakRpm);
    if ($("cPeakHold")) $("cPeakHold").textContent = peakTxt;
    if ($("nPeakRpm")) $("nPeakRpm").textContent = peakTxt;
    if ($("lcPeak")) $("lcPeak").textContent = peakTxt;
    if ($("lnPeak")) $("lnPeak").textContent = peakTxt;
    if ($("cTpsMaxChip")) $("cTpsMaxChip").textContent = "MAX " + Math.round(peakTps) + "%";
    if ($("lcTpsMax")) $("lcTpsMax").textContent = "MAX " + Math.round(peakTps) + "%";

    /* Gear Pull-Learner & Virtual Gear v2 */
    if (gearLearner.isActive()) {
      gearLearner.feed(d.rpm, d.vssKmh, d.tpsPct);
      renderGearLearnerUi();
    }
    const gGear = gearTracker.update(d.rpm, d.vssKmh, nowMs, d.tpsPct, d.injMs);
    const gModel = gearTracker.getModel();
    const gState = gearTracker.getState();
    let gSubLabel = "Chờ ECU";
    if (gGear === "N") gSubLabel = "Số Mo (0 km/h)";
    else if (gGear === "--") gSubLabel = "Chờ chuyển động";
    else {
      const idx = parseInt(gGear, 10) - 1;
      const src = gModel.sources[idx] || "default";
      gSubLabel = gState.frozenByClutch ? "Âm côn · trôi" : (src === "learned" ? "Đã học" : src === "derived" ? "Từ số 1" : "Mặc định");
    }

    const gearChanged = gGear !== lastGearChar;
    lastGearChar = gGear;

    const gearClsSuffix = " gear-" + (gGear >= "1" && gGear <= "6" ? gGear : "N") + (gearChanged ? " gear-pop" : "");
    if ($("cGearVal")) {
      $("cGearVal").textContent = gGear;
      $("cGearVal").className = "gear-cap-val" + gearClsSuffix;
    }
    if ($("lcGearVal")) {
      $("lcGearVal").textContent = gGear;
      $("lcGearVal").className = "tft-gear-digit" + gearClsSuffix;
    }
    if ($("cGearSub")) $("cGearSub").textContent = gSubLabel;
    if ($("lcGearSub")) $("lcGearSub").textContent = gSubLabel;

    /* Health & Warnings */
    const warnings = [];
    let bannerSeverity = "ok";
    if (faultCount > 0) { warnings.push(`CÓ ${faultCount} MÃ LỖI FI`); bannerSeverity = "danger"; }
    if (d.ectC >= 108) { warnings.push(`QUÁ NHIỆT ${d.ectC}°C`); bannerSeverity = "danger"; }
    else if (d.ectC >= 98) { warnings.push(`NƯỚC NÓNG ${d.ectC}°C`); if (bannerSeverity === "ok") bannerSeverity = "warn"; }
    if (d.vbat > 0.5 && d.vbat < 11.4) { warnings.push(`BÌNH YẾU ${d.vbat.toFixed(1)}V`); if (bannerSeverity === "ok") bannerSeverity = "warn"; }
    else if (d.vbat > 15.2) { warnings.push(`QUÁ ÁP ${d.vbat.toFixed(1)}V`); bannerSeverity = "danger"; }

    if (bannerSeverity !== "ok" && !tripStats.warnBannerActive) {
      tripStats.warnCount += 1;
      tripStats.warnBannerActive = true;
    } else if (bannerSeverity === "ok") {
      tripStats.warnBannerActive = false;
    }

    if ($("casualBanner")) $("casualBanner").className = "status-banner " + bannerSeverity;
    if ($("cHealthDot")) $("cHealthDot").className = "status-dot";
    const healthTxt = warnings.length ? warnings.join(" · ") : (d.rpm > 400 ? "ĐỘNG CƠ HOẠT ĐỘNG ỔN ĐỊNH" : "KHÓA ON · SẴN SÀNG ĐỀ MÁY");
    if ($("cHealthText")) $("cHealthText").textContent = healthTxt;
    if ($("lBannerTxt")) $("lBannerTxt").textContent = healthTxt;

    /* Secondary Casual Gauges (Zero duplicate IDs!) */
    const ectCls = d.ectC >= 106 ? "danger" : d.ectC >= 96 ? "warn" : d.ectC >= 55 ? "ok" : "";
    const ectSub = d.ectC < 50 ? "Máy nguội" : d.ectC >= 106 ? "Nóng quá!" : "Bình thường";
    const ectNorm = Math.max(0, Math.min(1, (d.ectC - 20) / 100));
    setScaleX("cEctFill", ectNorm);
    setScaleX("lcEctFill", ectNorm);
    if ($("cEctNum")) { $("cEctNum").textContent = String(d.ectC); $("cEctNum").className = "metric-val " + ectCls; }
    if ($("cEctSub")) $("cEctSub").textContent = ectSub;
    if ($("lcEctNum")) { $("lcEctNum").textContent = String(d.ectC); $("lcEctNum").className = "lhud-mini-val " + ectCls; }
    if ($("lcEctSub")) $("lcEctSub").textContent = ectSub;

    const batCls = d.vbat < 11.5 || d.vbat > 15.1 ? "danger" : d.vbat < 12.2 ? "warn" : "ok";
    const batSub = d.vbat >= 13.4 ? "Đang sạc" : d.vbat < 11.8 ? "Sạc yếu" : "Ổn định";
    const batNorm = Math.max(0, Math.min(1, (d.vbat - 10) / 5.5));
    setScaleX("cVbatFill", batNorm);
    setScaleX("lcBatFill", batNorm);
    if ($("cVbatNum")) { $("cVbatNum").textContent = d.vbat.toFixed(1); $("cVbatNum").className = "metric-val " + batCls; }
    if ($("cVbatSub")) $("cVbatSub").textContent = batSub;
    if ($("lcBatNum")) { $("lcBatNum").textContent = d.vbat.toFixed(1); $("lcBatNum").className = "lhud-mini-val " + batCls; }
    if ($("lcBatSub")) $("lcBatSub").textContent = batSub;

    if ($("cIatNum")) $("cIatNum").textContent = String(d.iatC);
    if ($("lcIatNum")) $("lcIatNum").textContent = String(d.iatC);

    const mapWord = d.mapKpa > 82 ? "GA LỚN" : d.mapKpa > 48 ? "TẢI VỪA" : "KHÔNG TẢI";
    if ($("cMapWord")) $("cMapWord").textContent = mapWord;
    if ($("cMapKpaSub")) $("cMapKpaSub").textContent = d.mapKpa + " kPa";
    if ($("cMapSub")) $("cMapSub").textContent = d.mapVolt.toFixed(2) + " V";
    if ($("lcMapWord")) $("lcMapWord").textContent = mapWord;
    if ($("lcMapSub")) $("lcMapSub").textContent = d.mapKpa + " kPa";

    /* Nerdy Telemetry Deck */
    if ($("nDfcoPill")) $("nDfcoPill").className = "pill-tag" + (d.dfco ? " active" : "");
    if ($("nDfcoPill")) $("nDfcoPill").textContent = d.dfco ? "DFCO CUT" : "INJ ACTIVE";
    if ($("nDutyTop")) $("nDutyTop").textContent = d.injDuty.toFixed(1) + "%";
    if ($("lnDuty")) $("lnDuty").textContent = d.injDuty.toFixed(1) + "%";

    if ($("nTpsVolt")) $("nTpsVolt").textContent = d.tpsVolt.toFixed(2) + "V";
    if ($("lnTpsVolt")) $("lnTpsVolt").textContent = d.tpsVolt.toFixed(2) + "V";
    if ($("nMapNum")) $("nMapNum").textContent = String(d.mapKpa);
    if ($("nMapSub")) $("nMapSub").textContent = d.mapVolt.toFixed(2) + "V";
    if ($("lnMapNum")) $("lnMapNum").textContent = d.mapKpa + " kPa";

    if ($("nInjNum")) {
      $("nInjNum").textContent = d.injMs.toFixed(2);
      $("nInjNum").className = "sensor-val" + (d.injDuty >= 85 ? " warn" : "");
    }
    if ($("nInjSub")) $("nInjSub").textContent = "Duty " + d.injDuty.toFixed(1) + "%";
    if ($("lnInjNum")) $("lnInjNum").textContent = d.injMs.toFixed(2) + "ms";

    if ($("nIgnNum")) $("nIgnNum").textContent = String(d.ignDeg);
    if ($("lnIgnNum")) $("lnIgnNum").textContent = d.ignDeg + "°";

    if ($("nO2Num")) $("nO2Num").textContent = d.o2Volt.toFixed(2);
    const afrTxt = typeof d.afrEst === "number" ? d.afrEst.toFixed(1) : String(d.afrEst || "--");
    if ($("nO2Sub")) $("nO2Sub").textContent = "AFR " + afrTxt;
    if ($("lnAfrNum")) $("lnAfrNum").textContent = d.o2Volt.toFixed(2) + "V/" + afrTxt;

    if ($("nIacvNum")) $("nIacvNum").textContent = String(d.iacvStp);
    if ($("lnIacvNum")) $("lnIacvNum").textContent = String(d.iacvStp);

    if ($("nEctNum")) { $("nEctNum").textContent = String(d.ectC); $("nEctNum").className = "sensor-val " + ectCls; }
    if ($("nEctSub")) $("nEctSub").textContent = d.ectVolt.toFixed(2) + "V";
    if ($("lnEctNum")) $("lnEctNum").textContent = d.ectC + "°C";

    if ($("nIatNum")) $("nIatNum").textContent = String(d.iatC);
    if ($("nIatSub")) $("nIatSub").textContent = d.iatVolt.toFixed(2) + "V";
    if ($("lnIatNum")) $("lnIatNum").textContent = d.iatC + "°C";

    if ($("nVbatNum")) { $("nVbatNum").textContent = d.vbat.toFixed(1); $("nVbatNum").className = "sensor-val " + batCls; }
    if ($("lnBatNum")) $("lnBatNum").textContent = d.vbat.toFixed(1) + "V";

    updateBound("tps", d.tpsPct, "%", 0, "mmDotTps", "mmLblTps");
    updateBound("map", d.mapKpa, "", 0, "mmDotMap", "mmLblMap");
    updateBound("inj", d.injMs, "", 1, "mmDotInj", "mmLblInj");
    updateBound("ign", d.ignDeg, "", 0, "mmDotIgn", "mmLblIgn");
    updateBound("o2", d.o2Volt, "", 2, "mmDotO2", "mmLblO2");
    updateBound("iacv", d.iacvStp, "", 0, "mmDotIacv", "mmLblIacv");
    updateBound("ect", d.ectC, "", 0, "mmDotEct", "mmLblEct");
    updateBound("iat", d.iatC, "", 0, "mmDotIat", "mmLblIat");
    updateBound("vbat", d.vbat, "", 1, "mmDotVbat", "mmLblVbat");
    updateBound("vss", d.vssKmh, "", 0, "mmDotVss", "mmLblVss");

    if ($("lnEctMax") && bounds.ect[1] !== null) $("lnEctMax").textContent = Math.round(bounds.ect[1]) + "°";
    if ($("lnBatMin") && bounds.vbat[0] !== null) $("lnBatMin").textContent = bounds.vbat[0].toFixed(1) + "V";

    history.push(d);
    if (history.length > HISTORY_MAX) history.shift();
    recordMapCell(d);
    updatePullTimer(d.vssKmh);
    renderTripStats();

    if (currentPage === "casual-overview") drawOverviewChart();
    if (currentPage === "nerdy-tuning") {
      if (!scopeFrozen) drawScope();
      renderMapTable();
    }

    if (isRecording) {
      csvRows.push([
        new Date().toISOString(),
        d.rpm, d.tpsVolt.toFixed(2), Math.round(d.tpsPct), d.ectC, d.iatC,
        d.mapKpa, d.vbat.toFixed(2), d.vssKmh, gGear,
        d.injMs.toFixed(2), d.injDuty.toFixed(1), d.ignDeg, d.iacvStp,
        d.o2Volt.toFixed(2), (typeof d.afrEst === "number" ? d.afrEst.toFixed(1) : String(d.afrEst || "--")), d.dfco ? 1 : 0
      ].join(","));
    }
  }

  /* ── HARDWARE PACKET HANDLER ── */
  function appendHexConsole(line) {
    if (hexPaused) return;
    hexLines.push(line);
    if (hexLines.length > 75) hexLines.shift();
    const el = $("lHexConsole");
    if (el) {
      el.textContent = hexLines.join("\n");
      el.scrollTop = el.scrollHeight;
    }
  }

  window.__onBtLine = function (rawLine) {
    const clean = String(rawLine || "").trim();
    if (!clean) return;
    if (clean.startsWith("[") || clean.includes("ERR") || clean.includes("TIMEOUT")) {
      appendHexConsole(clean);
      if (clean.includes("ERR") || clean.includes("TIMEOUT")) logAppDebug("ECU", clean);
    }

    const pkt = Core.parseKlinePacket(clean);
    if (!pkt) return;
    if (pkt.kind !== "table11" || currentPage === "nerdy-lab") {
      appendHexConsole(pkt.rawHex || clean);
    }

    if (pkt.kind === "table11") {
      applyFrame(pkt);
    } else if (pkt.kind === "ecmid") {
      activeEcmId = pkt.ecmId;
      if ($("cEcmId")) $("cEcmId").textContent = pkt.ecmId;
      if ($("lEcmId")) $("lEcmId").textContent = pkt.ecmId;
      if ($("fiModalEcm")) $("fiModalEcm").textContent = pkt.ecmId;
    } else if (pkt.kind === "dtc") {
      if (pkt.dtcType === "Hiện tại" || pkt.dtcType === "0x72") faultCount = pkt.faults.length;
      updateConnIndicators(connState, null);
      const html = pkt.faults.length === 0
        ? `<div class="dtc-card ok"><strong>Lỗi ${pkt.dtcType}: Không phát hiện mã lỗi</strong><div>Động cơ &amp; cảm biến hoạt động bình thường.</div></div>`
        : pkt.faults.map((f) => `<div class="dtc-card"><strong>Mã #${f.code} (${f.raw}) · ${pkt.dtcType}</strong><div>${f.desc}</div></div>`).join("");
      if ($("cDtcList")) $("cDtcList").innerHTML = html;
      if ($("mDtcList")) $("mDtcList").innerHTML = html;
      if ($("lDtcOut")) $("lDtcOut").innerHTML = html;
    } else if (pkt.kind === "clear_dtc_ack") {
      faultCount = 0;
      updateConnIndicators(connState, null);
      const okHtml = '<div class="dtc-card ok"><strong>Đã xóa bộ nhớ lỗi ECU thành công</strong></div>';
      if ($("cDtcList")) $("cDtcList").innerHTML = okHtml;
      if ($("mDtcList")) $("mDtcList").innerHTML = okHtml;
      if ($("lDtcOut")) $("lDtcOut").innerHTML = okHtml;
    } else if (pkt.kind === "custom") {
      if ($("lDtcOut")) $("lDtcOut").textContent = `Table ${pkt.table}: ${pkt.rawHex}`;
    }
  };
  window.__onBtFrame = window.__onBtLine;

  window.__onBtStatus = function (state, message) {
    updateConnIndicators(state, message);
    logAppDebug("LINK", `${state}: ${message}`);
    refreshUsbDiag();
  };

  window.__onBtPaired = function (jsonStr) {
    const listEl = $("pairedList");
    if (!listEl) return;
    try {
      const list = JSON.parse(jsonStr || "[]");
      if (!list.length) {
        listEl.innerHTML = '<div class="muted-note">Chưa có HC-05 / SPP nào ghép đôi.</div>';
        return;
      }
      listEl.innerHTML = "";
      list.forEach((dev) => {
        const row = document.createElement("div");
        row.className = "dev-item";
        row.innerHTML = `<div><div class="dev-name">${dev.name || "Unknown"}</div><div class="dev-mac">${dev.mac}</div></div>`;
        const btn = document.createElement("button");
        btn.className = "btn btn-cyan btn-sm";
        btn.textContent = "Kết nối";
        btn.addEventListener("click", () => {
          updateConnIndicators("connecting", "Đang nối " + (dev.name || dev.mac));
          if (hasBridge()) window.AndroidBT.connectSpp(dev.mac);
        });
        row.appendChild(btn);
        listEl.appendChild(row);
      });
    } catch (e) {
      logAppDebug("BT_JSON", String(e));
    }
  };
  window.__onPairedDevices = window.__onBtPaired;

  window.__onBtBleFound = function (jsonStr) {
    const listEl = $("bleList");
    if (!listEl) return;
    try {
      const dev = JSON.parse(jsonStr);
      if (listEl.querySelector(".muted-note")) listEl.innerHTML = "";
      const row = document.createElement("div");
      row.className = "dev-item";
      row.innerHTML = `<div><div class="dev-name">${dev.name || "BLE Device"}</div><div class="dev-mac">${dev.mac} · ${dev.rssi || ""} dBm</div></div>`;
      const btn = document.createElement("button");
      btn.className = "btn btn-cyan btn-sm";
      btn.textContent = "BLE";
      btn.addEventListener("click", () => {
        updateConnIndicators("connecting", "BLE " + (dev.name || dev.mac));
        if (hasBridge()) window.AndroidBT.connectBle(dev.mac);
      });
      row.appendChild(btn);
      listEl.appendChild(row);
    } catch (e) {
      logAppDebug("BLE_JSON", String(e));
    }
  };
  window.__onBleDeviceFound = window.__onBtBleFound;
  window.__onBleScanDone = function () {
    const listEl = $("bleList");
    if (listEl && !listEl.children.length) {
      listEl.innerHTML = '<div class="muted-note">Không tìm thấy thiết bị BLE xung quanh.</div>';
    }
  };

  /* ── HARDWARE & MODAL ACTIONS ── */
  function sendCmd(cmd) {
    if (hasBridge()) {
      window.AndroidBT.send(cmd + "\r\n");
    } else if (demoActive) {
      logAppDebug("DEMO_CMD", "Simulated TX: " + cmd);
      appendHexConsole("[DEMO TX] " + cmd);
    }
  }

  function refreshUsbDiag() {
    const box = $("usbDiagBox");
    if (!box) return;
    if (!hasBridge()) {
      box.textContent = "Trình duyệt Desktop / Dev Server · Mock AndroidBT sẵn sàng.";
      return;
    }
    try {
      const dbg = typeof window.AndroidBT.getUsbDebugInfo === "function" ? window.AndroidBT.getUsbDebugInfo() : "{}";
      const info = JSON.parse(dbg || "{}");
      const lines = [];
      lines.push(`Thiết bị USB: ${info.hasDevice ? `${info.chipName} (${info.vid}:${info.pid})` : "Chưa cắm cáp OTG"}`);
      lines.push(`Quyền Host: ${info.hasPermission ? "Đã cấp" : "Chưa cấp"} · Trạng thái: ${info.isConnected ? "ĐANG KẾT NỐI" : "Ngắt kết nối"}`);
      if (info.isConnected || info.rxPackets > 0) {
        lines.push(`RX: ${info.rxPackets || 0} gói (${info.rxBytes || 0} B) · Mẫu: ${info.lastRxPreview || "--"}`);
      }
      if (info.lastError) lines.push(`Lỗi cuối: ${info.lastError}`);
      box.textContent = lines.join("\n");
      if ($("btnDisconnectUsb")) $("btnDisconnectUsb").classList.toggle("hidden", !info.isConnected);
      if ($("btnDisconnectBt")) $("btnDisconnectBt").classList.toggle("hidden", connState !== "connected" || !!info.isConnected);
    } catch (e) {
      box.textContent = "Lỗi kiểm tra USB OTG: " + e;
    }
  }

  function openBtModal() {
    if ($("btModal")) $("btModal").classList.remove("hidden");
    refreshUsbDiag();
    if (hasBridge() && typeof window.AndroidBT.hasPermissions === "function" && window.AndroidBT.hasPermissions()) {
      window.AndroidBT.getPairedAndScan();
    }
  }

  function openFiModal() {
    if ($("fiModal")) $("fiModal").classList.remove("hidden");
    if (hasBridge() || demoActive) sendCmd("DTC");
  }

  /* ── OFFLINE DEMO / CSV REPLAY & HỘP ĐEN FILE MANAGER ── */
  function openHudToolbar() {
    const tb = $("lhudOverlayToolbar");
    if (!tb) return;
    tb.classList.add("is-open");
    if (hudToolbarTimer) clearTimeout(hudToolbarTimer);
    hudToolbarTimer = setTimeout(closeHudToolbar, 5500);
  }

  function closeHudToolbar() {
    if (hudToolbarTimer) { clearTimeout(hudToolbarTimer); hudToolbarTimer = null; }
    const tb = $("lhudOverlayToolbar");
    if (tb) tb.classList.remove("is-open");
  }

  function applyReplayIndex(idx) {
    if (!replayFrames.length) return;
    const item = replayFrames[idx];
    if (!item) return;
    if (item.kind === "table11") {
      applyFrame(item);
    } else if (item.h) {
      const pkt = Core.parseKlinePacket(item.h);
      if (pkt && pkt.kind === "table11") applyFrame(pkt);
    }
    if ($("replaySlider")) $("replaySlider").value = String(idx);
    if ($("replayTimeTxt")) $("replayTimeTxt").textContent = `${idx + 1} / ${replayFrames.length}`;
  }

  function stepDemoTick() {
    if (!demoActive || !demoPlaying || !replayFrames.length) return;
    if (demoIdx >= replayFrames.length) demoIdx = 0;
    applyReplayIndex(demoIdx);
    demoIdx += 1;
  }

  function startReplay(frames, badgeLabel, statusLabel) {
    if (!frames || !frames.length) return;
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    replayFrames = frames;
    replaySourceLabel = badgeLabel || "DEMO";
    demoActive = true;
    demoIdx = 0;
    demoPlaying = true;

    if ($("replaySourceBadge")) $("replaySourceBadge").textContent = replaySourceLabel;
    if ($("sharedReplayBar")) $("sharedReplayBar").classList.remove("hidden");
    if ($("pBtnDemo")) $("pBtnDemo").classList.toggle("is-active", replaySourceLabel === "DEMO");
    if ($("lBtnDemo")) $("lBtnDemo").classList.toggle("is-active", replaySourceLabel === "DEMO");
    if ($("replaySlider")) {
      $("replaySlider").max = String(Math.max(0, frames.length - 1));
      $("replaySlider").value = "0";
    }
    if ($("replayPlayBtn")) $("replayPlayBtn").innerHTML = "&#10074;&#10074;";

    applyReplayIndex(0);
    demoIdx = frames.length > 1 ? 1 : 0;
    demoTimer = setInterval(stepDemoTick, Math.round(160 / demoSpeed));
    updateConnIndicators("connected", statusLabel || "DEMO LOG XE THẬT");
  }

  function stopReplay() {
    demoActive = false;
    replayFrames = [];
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    if ($("sharedReplayBar")) $("sharedReplayBar").classList.add("hidden");
    if ($("pBtnDemo")) $("pBtnDemo").classList.remove("is-active");
    if ($("lBtnDemo")) $("lBtnDemo").classList.remove("is-active");
    renderIdleState();
    updateConnIndicators("disconnected", "CHƯA KẾT NỐI");
  }

  function toggleDemo(forceState) {
    const next = typeof forceState === "boolean" ? forceState : !demoActive;
    if (next) {
      const frames = window.SAMPLE_FRAMES || [];
      if (!frames.length) return;
      startReplay(frames, "DEMO", "DEMO LOG XE THẬT");
    } else {
      stopReplay();
    }
  }

  const FALLBACK_FILES_KEY = "kline_local_session_files";
  function readSessionFileText(filename) {
    if (hasBridge() && typeof window.AndroidBT.readSessionFile === "function") {
      return window.AndroidBT.readSessionFile(filename) || "";
    }
    try {
      const map = JSON.parse(localStorage.getItem(FALLBACK_FILES_KEY) || "{}");
      return map[filename] ? map[filename].content : "";
    } catch (_) {
      return "";
    }
  }

  function saveLocalFallbackFile(filename, content) {
    try {
      const map = JSON.parse(localStorage.getItem(FALLBACK_FILES_KEY) || "{}");
      map[filename] = { content, modifiedMs: Date.now() };
      const keys = Object.keys(map).sort((a, b) => (map[b].modifiedMs || 0) - (map[a].modifiedMs || 0));
      keys.slice(12).forEach((k) => delete map[k]);
      localStorage.setItem(FALLBACK_FILES_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function renderSessionFiles() {
    const listEl = $("recFilesList");
    const metaEl = $("recFilesMeta");
    if (!listEl) return;

    let items = [];
    if (hasBridge() && typeof window.AndroidBT.listSessionFiles === "function") {
      try { items = JSON.parse(window.AndroidBT.listSessionFiles() || "[]"); } catch (_) {}
    } else {
      try {
        const map = JSON.parse(localStorage.getItem(FALLBACK_FILES_KEY) || "{}");
        items = Object.keys(map).map((name) => ({
          name,
          sizeBytes: String(map[name].content || "").length,
          modifiedMs: map[name].modifiedMs || Date.now(),
          kind: name.toLowerCase().endsWith(".csv") ? "rec" : "log"
        })).sort((a, b) => b.modifiedMs - a.modifiedMs);
      } catch (_) {}
    }

    if (!items.length) {
      listEl.innerHTML = '<div class="muted-note">Chưa có file ghi nào. Bấm REC để ghi chuyến đi hoặc mở file CSV có sẵn.</div>';
      if (metaEl) metaEl.textContent = "Chọn file đã ghi để phát lại tua máy, số ảo & Scope.";
      return;
    }

    if (metaEl) metaEl.textContent = `Đang lưu ${items.length} file trong hộp đen.`;
    listEl.innerHTML = "";
    items.forEach((f) => {
      const row = document.createElement("div");
      row.className = "rec-file-item";
      const dt = f.modifiedMs ? new Date(f.modifiedMs).toLocaleString("vi-VN") : "";
      const kb = f.sizeBytes >= 1024 ? `${(f.sizeBytes / 1024).toFixed(1)} KB` : `${f.sizeBytes} B`;

      const info = document.createElement("div");
      info.className = "rec-file-info";
      info.innerHTML = `<div class="rec-file-name">${f.name}</div><div class="rec-file-sub">${kb} · ${dt}</div>`;

      const acts = document.createElement("div");
      acts.className = "rec-file-actions";

      const isCsv = f.kind === "rec" || f.name.toLowerCase().endsWith(".csv");
      const primaryBtn = document.createElement("button");
      primaryBtn.className = isCsv ? "btn btn-cyan btn-xs" : "btn btn-ghost btn-xs";
      primaryBtn.textContent = isCsv ? "Phát lại" : "Xem";
      primaryBtn.addEventListener("click", () => {
        const content = readSessionFileText(f.name);
        if (!content) return;
        if (isCsv) {
          const parsed = Core.parseRecordedCsv(content);
          if (!parsed.length) {
            if (metaEl) metaEl.textContent = `File ${f.name} chưa có dòng dữ liệu hợp lệ.`;
            return;
          }
          startReplay(parsed, "REC", `PHÁT LẠI · ${f.name}`);
          syncModeAndPages("casual-overview");
        } else {
          if ($("fileViewTitle")) $("fileViewTitle").textContent = f.name;
          if ($("fileViewMeta")) $("fileViewMeta").textContent = `${kb} · ${dt}`;
          if ($("fileViewBody")) $("fileViewBody").textContent = content;
          if ($("fileViewModal")) $("fileViewModal").classList.remove("hidden");
        }
      });
      acts.appendChild(primaryBtn);

      const dlBtn = document.createElement("button");
      dlBtn.className = "btn btn-ghost btn-xs";
      dlBtn.textContent = "Tải";
      dlBtn.addEventListener("click", () => {
        if (hasBridge() && typeof window.AndroidBT.exportSessionToDownloads === "function") {
          const msg = window.AndroidBT.exportSessionToDownloads(f.name);
          if (metaEl) metaEl.textContent = `Đã xuất: ${msg}`;
        } else {
          const content = readSessionFileText(f.name);
          const blob = new Blob([content], { type: isCsv ? "text/csv" : "text/plain" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = f.name;
          a.click();
        }
      });
      acts.appendChild(dlBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-xs";
      delBtn.textContent = "Xóa";
      delBtn.addEventListener("click", () => {
        if (hasBridge() && typeof window.AndroidBT.deleteSessionFile === "function") {
          window.AndroidBT.deleteSessionFile(f.name);
        } else {
          try {
            const map = JSON.parse(localStorage.getItem(FALLBACK_FILES_KEY) || "{}");
            delete map[f.name];
            localStorage.setItem(FALLBACK_FILES_KEY, JSON.stringify(map));
          } catch (_) {}
        }
        renderSessionFiles();
      });
      acts.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(acts);
      listEl.appendChild(row);
    });
  }

  function toggleRec() {
    isRecording = !isRecording;
    if ($("pBtnRec")) $("pBtnRec").classList.toggle("is-recording", isRecording);
    if ($("lBtnRec")) $("lBtnRec").classList.toggle("is-recording", isRecording);
    if (isRecording) {
      csvRows = ["Timestamp,RPM,TPS_V,TPS_Pct,ECT_C,IAT_C,MAP_kPa,VBAT_V,VSS_kmh,Gear,INJ_ms,Duty_Pct,IGN_deg,IACV,O2_V,AFR,DFCO"];
      if ($("pRecTxt")) $("pRecTxt").textContent = "STOP";
      if ($("lRecTxt")) $("lRecTxt").textContent = "STOP";
      logAppDebug("REC", "Bắt đầu ghi CSV chuyến đi");
    } else {
      if ($("pRecTxt")) $("pRecTxt").textContent = "REC";
      if ($("lRecTxt")) $("lRecTxt").textContent = "REC";
      const fname = `kline_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      const content = csvRows.join("\n");
      if (hasBridge() && typeof window.AndroidBT.saveSessionCsv === "function") {
        const res = window.AndroidBT.saveSessionCsv(fname, content);
        logAppDebug("CSV", `Saved ${csvRows.length - 1} rows -> ${res}`);
      } else {
        saveLocalFallbackFile(fname, content);
      }
      renderSessionFiles();
    }
  }

  /* ── BIND ALL EVENTS ── */
  function bindEvents() {
    document.querySelectorAll(".bnav-btn").forEach((btn) => {
      btn.addEventListener("click", () => syncModeAndPages(btn.dataset.page));
    });

    const cycleMode = () => {
      const target = uiMode === "casual" ? "nerdy-telemetry" : "casual-overview";
      syncModeAndPages(target);
      closeHudToolbar();
    };
    if ($("pBtnModeCycle")) $("pBtnModeCycle").addEventListener("click", cycleMode);
    if ($("lBtnModeCycle")) $("lBtnModeCycle").addEventListener("click", cycleMode);

    if ($("pBtnDemo")) $("pBtnDemo").addEventListener("click", () => toggleDemo());
    if ($("lBtnDemo")) $("lBtnDemo").addEventListener("click", () => { toggleDemo(); closeHudToolbar(); });
    if ($("cBtnEmptyDemo")) $("cBtnEmptyDemo").addEventListener("click", () => toggleDemo(true));

    if ($("pBtnRec")) $("pBtnRec").addEventListener("click", toggleRec);
    if ($("lBtnRec")) $("lBtnRec").addEventListener("click", () => { toggleRec(); closeHudToolbar(); });

    if ($("pBtnBt")) $("pBtnBt").addEventListener("click", openBtModal);
    if ($("lBtnBt")) $("lBtnBt").addEventListener("click", openBtModal);
    if ($("lBtnToolbarConnect")) $("lBtnToolbarConnect").addEventListener("click", () => { closeHudToolbar(); openBtModal(); });
    if ($("btnCloseModal")) $("btnCloseModal").addEventListener("click", () => $("btModal").classList.add("hidden"));

    if ($("pBtnFi")) $("pBtnFi").addEventListener("click", openFiModal);
    if ($("lBtnFi")) $("lBtnFi").addEventListener("click", () => { closeHudToolbar(); openFiModal(); });
    if ($("btnCloseFiModal")) $("btnCloseFiModal").addEventListener("click", () => $("fiModal").classList.add("hidden"));

    /* Landscape HUD bottom toolbar toggle + auto-dismiss */
    const toggleHudMenu = (e) => {
      if (e) e.stopPropagation();
      const tb = $("lhudOverlayToolbar");
      if (tb && tb.classList.contains("is-open")) closeHudToolbar();
      else openHudToolbar();
    };
    if ($("lBtnHudMenu")) $("lBtnHudMenu").addEventListener("click", toggleHudMenu);
    const hudDeck = document.querySelector(".lhud-top-deck");
    if (hudDeck) hudDeck.addEventListener("click", toggleHudMenu);
    if ($("btnCloseToolbar")) $("btnCloseToolbar").addEventListener("click", closeHudToolbar);

    const lHudEl = $("landscapeHud");
    if (lHudEl) {
      lHudEl.addEventListener("click", (e) => {
        const tb = $("lhudOverlayToolbar");
        if (!tb || !tb.classList.contains("is-open")) return;
        if (!tb.contains(e.target) && (!hudDeck || !hudDeck.contains(e.target))) {
          closeHudToolbar();
        }
      });
    }
    window.addEventListener("orientationchange", closeHudToolbar);
    window.addEventListener("resize", closeHudToolbar);

    /* Jump / Open Gear Pull-Learn */
    if ($("cGearBtn")) {
      $("cGearBtn").addEventListener("click", () => {
        syncModeAndPages("nerdy-lab");
        setTimeout(() => { if ($("gearLearnCard")) $("gearLearnCard").scrollIntoView({ behavior: "smooth" }); }, 60);
      });
    }
    if ($("lcGearBtn")) $("lcGearBtn").addEventListener("click", () => { closeHudToolbar(); $("gearLearnHudModal").classList.remove("hidden"); renderGearLearnerUi(); });
    if ($("lBtnLearnHud")) $("lBtnLearnHud").addEventListener("click", () => { closeHudToolbar(); $("gearLearnHudModal").classList.remove("hidden"); renderGearLearnerUi(); });
    if ($("mBtnCloseLearnHud")) $("mBtnCloseLearnHud").addEventListener("click", () => $("gearLearnHudModal").classList.add("hidden"));

    /* Gear Pull-Learn Actions */
    const onStartPull1 = () => { gearLearner.startPull1(); renderGearLearnerUi(); };
    const onStartSeq = () => { gearLearner.startAutoSequence(); renderGearLearnerUi(); };
    const onFinishLearn = () => {
      const res = gearLearner.finish();
      if (res.ok && res.ratios) {
        gearTracker.setModel(res.ratios);
        saveLearnedGearModel(res.ratios, gearTracker.getModel().sources);
        logAppDebug("GEAR_LEARN", `Saved model (${res.mode}): ${res.ratios.map((x) => x.toFixed(1)).join(", ")}`);
      } else {
        logAppDebug("GEAR_LEARN", `Finish skipped: ${res.reason || "insufficient"}`);
        if ($("learnStatusTxt")) $("learnStatusTxt").textContent = "Chưa đủ mẫu (cần >= 4 mẫu tốc độ > 5 km/h & > 2200 RPM).";
      }
      renderGearLearnerUi();
    };
    const onCancelLearn = () => { gearLearner.cancel(); renderGearLearnerUi(); };

    if ($("btnLearnPull1")) $("btnLearnPull1").addEventListener("click", onStartPull1);
    if ($("mBtnLearnPull1")) $("mBtnLearnPull1").addEventListener("click", onStartPull1);
    if ($("btnLearnSeq")) $("btnLearnSeq").addEventListener("click", onStartSeq);
    if ($("mBtnLearnSeq")) $("mBtnLearnSeq").addEventListener("click", onStartSeq);
    if ($("btnFinishLearn")) $("btnFinishLearn").addEventListener("click", onFinishLearn);
    if ($("mBtnLearnFinish")) $("mBtnLearnFinish").addEventListener("click", onFinishLearn);
    if ($("btnCancelLearn")) $("btnCancelLearn").addEventListener("click", onCancelLearn);
    if ($("mBtnLearnCancel")) $("mBtnLearnCancel").addEventListener("click", onCancelLearn);

    if ($("btnResetGearModel")) {
      $("btnResetGearModel").addEventListener("click", () => {
        gearLearner.clearAll();
        gearTracker.setModel(null);
        try { localStorage.removeItem(LS_KEYS.learnedRatios); } catch (_) {}
        renderGearLearnerUi();
      });
    }

    document.querySelectorAll(".gear-learn-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        gearLearner.startSingleGear(parseInt(btn.dataset.learnGear, 10));
        renderGearLearnerUi();
      });
    });

    /* Replay Bar & Blackbox File Controls */
    if ($("replayPlayBtn")) {
      $("replayPlayBtn").addEventListener("click", () => {
        demoPlaying = !demoPlaying;
        $("replayPlayBtn").innerHTML = demoPlaying ? "&#10074;&#10074;" : "&#9654;";
      });
    }
    if ($("replayCloseBtn")) {
      $("replayCloseBtn").addEventListener("click", stopReplay);
    }
    if ($("replaySlider")) {
      $("replaySlider").addEventListener("input", (e) => {
        demoIdx = parseInt(e.target.value, 10) || 0;
        applyReplayIndex(demoIdx);
      });
    }
    if ($("btnRefreshRecFiles")) $("btnRefreshRecFiles").addEventListener("click", renderSessionFiles);
    if ($("btnImportRecFile") && $("recFileInput")) {
      $("btnImportRecFile").addEventListener("click", () => $("recFileInput").click());
      $("recFileInput").addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          if (file.name.toLowerCase().endsWith(".csv")) {
            const frames = Core.parseRecordedCsv(text);
            if (frames.length) {
              if (hasBridge() && typeof window.AndroidBT.saveSessionCsv === "function") {
                window.AndroidBT.saveSessionCsv(file.name, text);
              } else {
                saveLocalFallbackFile(file.name, text);
              }
              renderSessionFiles();
              startReplay(frames, "CSV", `PHÁT LẠI · ${file.name}`);
              syncModeAndPages("casual-overview");
            } else if ($("recFilesMeta")) {
              $("recFilesMeta").textContent = `Không đọc được cột RPM từ ${file.name}.`;
            }
          } else {
            if ($("fileViewTitle")) $("fileViewTitle").textContent = file.name;
            if ($("fileViewMeta")) $("fileViewMeta").textContent = `${file.size} B`;
            if ($("fileViewBody")) $("fileViewBody").textContent = text;
            if ($("fileViewModal")) $("fileViewModal").classList.remove("hidden");
          }
          e.target.value = "";
        };
        reader.readAsText(file);
      });
    }
    if ($("btnCloseFileView")) {
      $("btnCloseFileView").addEventListener("click", () => $("fileViewModal").classList.add("hidden"));
    }
    document.querySelectorAll("#sharedReplayBar .speed-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#sharedReplayBar .speed-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        demoSpeed = parseInt(b.dataset.speed, 10) || 1;
        if (demoActive) {
          clearInterval(demoTimer);
          demoTimer = setInterval(stepDemoTick, Math.round(160 / demoSpeed));
        }
      });
    });

    /* Trip & Min/Max Resets */
    if ($("btnResetTrip")) {
      $("btnResetTrip").addEventListener("click", () => {
        tripStats.startMs = Date.now();
        tripStats.engineRunSec = 0;
        tripStats.lastRunTickMs = 0;
        tripStats.peakRpm = 0;
        tripStats.peakTps = 0;
        tripStats.peakVss = 0;
        tripStats.minVbat = null;
        tripStats.maxVbat = null;
        tripStats.warnCount = 0;
        tripStats.warnBannerActive = false;
        tripMeters = 0;
        peakRpm = 0;
        peakTps = 0;
        pullTimer.best = null;
        pullTimer.cur = 0;
        pullTimer.state = "idle";
        renderTripStats();
      });
    }

    if ($("btnResetOil")) {
      $("btnResetOil").addEventListener("click", () => {
        oilKm = 0;
        saveVal(LS_KEYS.oilKm, "0");
        renderTripStats();
      });
    }

    if ($("nBtnResetBounds")) {
      $("nBtnResetBounds").addEventListener("click", () => {
        Object.keys(bounds).forEach((k) => { bounds[k] = [null, null]; });
      });
    }

    /* Scope & 3D Map */
    document.querySelectorAll(".chip").forEach((c) => {
      c.addEventListener("click", () => {
        const k = c.dataset.ch;
        scopeEnabled[k] = !scopeEnabled[k];
        c.classList.toggle("active", scopeEnabled[k]);
        drawScope();
      });
    });
    if ($("btnScopeFreeze")) {
      $("btnScopeFreeze").addEventListener("click", () => {
        scopeFrozen = !scopeFrozen;
        $("btnScopeFreeze").classList.toggle("is-active", scopeFrozen);
      });
    }
    if ($("nScopeCanvas")) {
      $("nScopeCanvas").addEventListener("click", (e) => {
        const rect = e.target.getBoundingClientRect();
        const pts = history.slice(-140);
        if (pts.length < 2) return;
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        scopeCursorIdx = Math.round(frac * (pts.length - 1));
        drawScope();
      });
    }

    document.querySelectorAll("#mapMetricGroup .speed-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#mapMetricGroup .speed-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        activeMapMetric = b.dataset.metric || "inj";
        renderMapTable();
      });
    });
    if ($("btnClearMap")) {
      $("btnClearMap").addEventListener("click", () => {
        Object.keys(mapCells).forEach((k) => delete mapCells[k]);
        renderMapTable();
      });
    }
    if ($("btnResetPull")) {
      $("btnResetPull").addEventListener("click", () => {
        pullTimer.state = "idle";
        pullTimer.cur = 0;
        pullTimer.best = null;
        updatePullTimer(0);
      });
    }

    /* ECU Lab Commands & Redline */
    if ($("cBtnReadDtc")) $("cBtnReadDtc").addEventListener("click", () => sendCmd("DTC"));
    if ($("cBtnClearDtc")) $("cBtnClearDtc").addEventListener("click", () => sendCmd("CLEARDTC"));
    if ($("mBtnReadDtc")) $("mBtnReadDtc").addEventListener("click", () => sendCmd("DTC"));
    if ($("mBtnClearDtc")) $("mBtnClearDtc").addEventListener("click", () => sendCmd("CLEARDTC"));
    if ($("lBtnReadDtc")) $("lBtnReadDtc").addEventListener("click", () => sendCmd("DTC"));
    if ($("lBtnClearDtc")) $("lBtnClearDtc").addEventListener("click", () => sendCmd("CLEARDTC"));
    if ($("lBtnReadEcmId")) $("lBtnReadEcmId").addEventListener("click", () => sendCmd("ECMID"));
    if ($("lBtnWakeup")) $("lBtnWakeup").addEventListener("click", () => sendCmd("WAKEUP"));
    if ($("lBtnScs")) {
      $("lBtnScs").addEventListener("click", () => {
        scsActive = !scsActive;
        $("lBtnScs").classList.toggle("is-active", scsActive);
        sendCmd("SCS");
      });
    }
    if ($("lBtnProbeTable")) {
      $("lBtnProbeTable").addEventListener("click", () => {
        const hex = ($("lTableInput").value || "11").trim().toUpperCase();
        sendCmd("PROBE " + hex);
      });
    }
    if ($("lRedlineSlider")) {
      $("lRedlineSlider").value = String(redlineRpm);
      if ($("lRedlineVal")) $("lRedlineVal").textContent = redlineRpm + " RPM";
      $("lRedlineSlider").addEventListener("input", (e) => {
        redlineRpm = parseInt(e.target.value, 10) || 10500;
        if ($("lRedlineVal")) $("lRedlineVal").textContent = redlineRpm + " RPM";
        saveVal(LS_KEYS.redline, redlineRpm);
        rebuildAllTachRails();
        updateLeds(anim.dispRpm);
      });
    }
    if ($("lBtnPauseHex")) {
      $("lBtnPauseHex").addEventListener("click", () => {
        hexPaused = !hexPaused;
        $("lBtnPauseHex").textContent = hexPaused ? "Tiếp tục" : "Tạm dừng";
        $("lBtnPauseHex").classList.toggle("is-active", hexPaused);
      });
    }
    if ($("lBtnClearHex")) {
      $("lBtnClearHex").addEventListener("click", () => {
        hexLines.length = 0;
        if ($("lHexConsole")) $("lHexConsole").textContent = "Đã xóa log console.";
      });
    }
    if ($("lBtnRefreshDebug")) $("lBtnRefreshDebug").addEventListener("click", renderDebugConsole);
    if ($("lBtnOpenRecManager")) {
      $("lBtnOpenRecManager").addEventListener("click", () => {
        syncModeAndPages("casual-trip");
        setTimeout(() => { if ($("recFilesCard")) $("recFilesCard").scrollIntoView({ behavior: "smooth" }); }, 60);
      });
    }
    if ($("lBtnSaveDebug")) {
      $("lBtnSaveDebug").addEventListener("click", () => {
        renderDebugConsole();
        const txt = $("lAppDebugOut") ? $("lAppDebugOut").textContent : "";
        const fname = `kline_debug_${Date.now()}.log`;
        if (hasBridge() && typeof window.AndroidBT.saveSessionCsv === "function") {
          const msg = window.AndroidBT.saveSessionCsv(fname, txt);
          if ($("lDtcOut")) $("lDtcOut").textContent = "Đã lưu: " + msg;
        } else {
          saveLocalFallbackFile(fname, txt);
          if ($("lDtcOut")) $("lDtcOut").textContent = "Đã lưu log: " + fname;
        }
        renderSessionFiles();
      });
    }

    /* USB & BT Modal Buttons */
    if ($("btnConnectUsb")) {
      $("btnConnectUsb").addEventListener("click", () => {
        if (hasBridge()) window.AndroidBT.connectUsb();
        refreshUsbDiag();
      });
    }
    if ($("btnWakeupUsb")) {
      $("btnWakeupUsb").addEventListener("click", () => {
        if (hasBridge()) window.AndroidBT.sendWakeup();
        else sendCmd("WAKEUP");
      });
    }
    if ($("btnDisconnectUsb")) {
      $("btnDisconnectUsb").addEventListener("click", () => {
        if (hasBridge()) window.AndroidBT.disconnectUsb();
        refreshUsbDiag();
      });
    }
    if ($("btnScanBt")) {
      $("btnScanBt").addEventListener("click", () => {
        if ($("pairedList")) $("pairedList").innerHTML = '<div class="muted-note">Đang tải thiết bị đã ghép đôi...</div>';
        if ($("bleList")) $("bleList").innerHTML = '<div class="muted-note">Đang quét BLE...</div>';
        if (hasBridge()) {
          if (!window.AndroidBT.hasPermissions()) window.AndroidBT.requestBtPermissions();
          else window.AndroidBT.getPairedAndScan();
        }
      });
    }
    if ($("btnDisconnectBt")) {
      $("btnDisconnectBt").addEventListener("click", () => {
        if (hasBridge()) window.AndroidBT.disconnect();
      });
    }
  }

  /* ── INIT & WATCHERS ── */
  function init() {
    rebuildAllTachRails();
    renderIdleState();
    renderTripStats();
    renderMapTable();
    renderGearLearnerUi();
    bindEvents();
    syncModeAndPages("casual-overview");
    updateConnIndicators("disconnected", "CHƯA KẾT NỐI");

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (currentPage === "casual-overview") drawOverviewChart();
        if (currentPage === "nerdy-tuning") drawScope();
      });
      if ($("pOverviewChart")) ro.observe($("pOverviewChart"));
      if ($("nScopeCanvas")) ro.observe($("nScopeCanvas"));
    }

    // Stale live-frame watchdog: reset to idle glow if ECU drops > 4s (outside Demo)
    setInterval(() => {
      if (hasLiveData && !demoActive && lastFramePerf > 0 && performance.now() - lastFramePerf > 4200) {
        if ($("cHealthText")) $("cHealthText").textContent = "MẤT TÍN HIỆU ECU (> 4s)";
        if ($("lBannerTxt")) $("lBannerTxt").textContent = "MẤT TÍN HIỆU ECU";
      }
    }, 1000);

    // Expose dev debug helpers
    window.__klineApp = {
      gearTracker,
      gearLearner,
      applyFrame,
      syncModeAndPages,
      toggleDemo,
      startReplay,
      stopReplay,
      openHudToolbar,
      closeHudToolbar,
      renderSessionFiles,
      getAppDebugLogs: () => jsDebugBuffer.slice()
    };
  }

  init();
})();
