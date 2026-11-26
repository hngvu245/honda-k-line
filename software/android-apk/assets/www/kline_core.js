(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KlineCore = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
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

  // Fallback reference ratios (6-speed Keihin baseline) used only before user pull-learning
  const DEFAULT_GEAR_RATIOS = [160.8, 107.5, 78.2, 62.6, 54.1, 47.4];
  // Normalized gear-step ratios relative to Gear 1 = 1.000 (for instant estimation after Gear 1 max-RPM pull)
  const STEP_FROM_GEAR1 = [1.0, 0.6685, 0.4863, 0.3893, 0.3364, 0.2948];

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
      const p = parts[i].trim().replace(/^0x/i, "");
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

  function median(vals) {
    if (!vals || !vals.length) return null;
    const s = vals.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return (s.length % 2 === 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Compute robust trimmed median ratio from pull samples [{ r, vss, rpm }]
  // Prioritizes higher-VSS frames to suppress integer 1 km/h quantization noise and clutch slip.
  function computeRobustRatio(samples) {
    if (!samples || samples.length < 3) return null;
    let maxVss = 0;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].vss > maxVss) maxVss = samples[i].vss;
    }
    const vssFloor = Math.max(6, maxVss * 0.45);
    let pool = samples.filter((s) => s.vss >= vssFloor);
    if (pool.length < 3) pool = samples.slice();

    const ratios = pool.map((s) => s.r);
    const med = median(ratios);
    if (!med) return null;

    const absDevs = ratios.map((x) => Math.abs(x - med));
    const mad = median(absDevs) || 0;
    const band = Math.max(med * 0.08, mad * 2.0);
    const clean = ratios.filter((x) => Math.abs(x - med) <= band);
    const finalVal = median(clean.length >= 2 ? clean : ratios);
    return Math.round(finalVal * 10) / 10;
  }

  // Build active descending gear ratio table + source metadata from learned values
  function normalizeGearModel(learnedRatios) {
    if (!Array.isArray(learnedRatios) || !learnedRatios.some((x) => typeof x === "number" && x > 10)) {
      return {
        ratios: DEFAULT_GEAR_RATIOS.slice(),
        sources: DEFAULT_GEAR_RATIOS.map(() => "default"),
        isCalibrated: false
      };
    }

    const ratios = [];
    const sources = [];
    const r1 = (typeof learnedRatios[0] === "number" && learnedRatios[0] > 10) ? learnedRatios[0] : null;
    let highestExplicit = 0;
    for (let i = 0; i < 6; i++) {
      if (typeof learnedRatios[i] === "number" && learnedRatios[i] > 10) highestExplicit = i + 1;
    }
    const targetCount = (highestExplicit === 1 && r1 !== null) ? 6 : Math.max(4, highestExplicit);

    for (let i = 0; i < targetCount; i++) {
      if (typeof learnedRatios[i] === "number" && learnedRatios[i] > 10) {
        ratios.push(Math.round(learnedRatios[i] * 10) / 10);
        sources.push("learned");
      } else if (r1 !== null) {
        ratios.push(Math.round(r1 * STEP_FROM_GEAR1[i] * 10) / 10);
        sources.push("derived");
      } else {
        ratios.push(DEFAULT_GEAR_RATIOS[i]);
        sources.push("default");
      }
    }
    return { ratios, sources, isCalibrated: true };
  }

  // Log-midpoint Voronoi matching with low-VSS quantization compensation
  function matchGearRatio(rpm, vss, ratios, currentGear) {
    if (!ratios || !ratios.length || vss < 2 || rpm < 380) return null;
    const r = rpm / vss;
    const n = ratios.length;
    const topBound = ratios[0] * (1.28 + 1.5 / Math.max(vss, 2));
    const botBound = ratios[n - 1] * 0.84;

    if (r > topBound || r < botBound) return null;

    // Low-speed quantization guard: if current gear fits within VSS +/- 0.7 km/h, keep it sticky
    if (vss < 15 && currentGear && currentGear !== "N" && currentGear !== "--") {
      const idxCur = parseInt(currentGear, 10) - 1;
      if (idxCur >= 0 && idxCur < n) {
        const rLo = rpm / (vss + 0.7);
        const rHi = rpm / Math.max(1, vss - 0.7);
        const hiBound = idxCur === 0 ? topBound : Math.sqrt(ratios[idxCur - 1] * ratios[idxCur]);
        const loBound = idxCur === n - 1 ? botBound : Math.sqrt(ratios[idxCur] * ratios[idxCur + 1]);
        if (rLo <= hiBound && rHi >= loBound) {
          return String(idxCur + 1);
        }
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const boundary = Math.sqrt(ratios[i] * ratios[i + 1]);
      if (r >= boundary) return String(i + 1);
    }
    return String(n);
  }

  function createGearTracker(learnedRatios) {
    let model = normalizeGearModel(learnedRatios);
    const state = {
      current: "N",
      candidate: "N",
      confidence: 0,
      lastShiftTs: 0,
      prevRpm: null,
      idleRpm: 1550,
      dropStreak: 0,
      throttleStreak: 0,
      dfcoStreak: 0,
      frozenByClutch: false
    };

    return {
      setModel(nextLearned) {
        model = normalizeGearModel(nextLearned);
      },
      getModel() {
        return model;
      },
      getState() {
        return state;
      },
      reset() {
        state.current = "N";
        state.candidate = "N";
        state.confidence = 0;
        state.lastShiftTs = 0;
        state.prevRpm = null;
        state.idleRpm = 1550;
        state.dropStreak = 0;
        state.throttleStreak = 0;
        state.dfcoStreak = 0;
        state.frozenByClutch = false;
      },
      update(rpm, vss, nowMs, tpsPct, injMs) {
        const now = typeof nowMs === "number" ? nowMs : Date.now();
        const hasTps = typeof tpsPct === "number" && !Number.isNaN(tpsPct);
        const hasInj = typeof injMs === "number" && !Number.isNaN(injMs);

        if (!rpm || rpm < 380) {
          state.current = "--";
          state.candidate = "--";
          state.confidence = 0;
          state.prevRpm = rpm || 0;
          state.dropStreak = 0;
          state.throttleStreak = 0;
          state.dfcoStreak = 0;
          state.frozenByClutch = false;
          return "--";
        }

        const dRpm = state.prevRpm !== null ? (rpm - state.prevRpm) : 0;
        state.prevRpm = rpm;

        if (!vss || vss < 2) {
          // Adaptive idle RPM EMA while bike is stationary with closed throttle
          if ((!hasTps || tpsPct <= 1.2) && rpm >= 450 && rpm <= 2400) {
            state.idleRpm = state.idleRpm * 0.85 + rpm * 0.15;
          }
          state.current = "N";
          state.candidate = "N";
          state.confidence = 0;
          state.dropStreak = 0;
          state.throttleStreak = 0;
          state.dfcoStreak = 0;
          state.frozenByClutch = false;
          return "N";
        }

        const idleCeil = state.idleRpm + 320;
        const throttleClosed = hasTps && tpsPct <= 2.5;
        const throttleOpen = hasTps && tpsPct > 3.5;
        const idleInjecting = !hasInj || injMs > 0.4;
        const isDfcoCoasting = throttleClosed && hasInj && injMs < 0.05 && rpm > (idleCeil + 300);
        const inGear = state.current !== "N" && state.current !== "--";

        state.throttleStreak = throttleOpen ? (state.throttleStreak + 1) : 0;
        state.dfcoStreak = isDfcoCoasting ? (state.dfcoStreak + 1) : 0;

        if (dRpm <= -110 && (!hasTps || throttleClosed)) {
          state.dropStreak += 1;
        } else {
          state.dropStreak = 0;
        }

        if (inGear && vss >= 4) {
          if (state.frozenByClutch) {
            // Re-engage only when throttle opens cleanly, RPM rises above idle, or genuine DFCO braking settles
            const reengaged = (hasTps && (state.throttleStreak >= 2 || (dRpm > 220 && rpm > idleCeil)))
              || state.dfcoStreak >= 3
              || (!hasTps && rpm > (idleCeil + 350) && dRpm >= -80 && state.throttleStreak === 0 && !idleInjecting);
            if (!reengaged) {
              state.confidence = 0;
              state.lastShiftTs = now;
              return state.current;
            }
            state.frozenByClutch = false;
          } else {
            // Layer A: sudden RPM drop on closed throttle; Layer B: settled idle plateau with injector active
            const dropCoast = hasTps
              ? (throttleClosed && (dRpm <= -220 || state.dropStreak >= 2))
              : (dRpm <= -450);
            const plateauCoast = (!hasTps || throttleClosed) && rpm <= idleCeil && idleInjecting;
            if (dropCoast || plateauCoast) {
              state.frozenByClutch = true;
              state.confidence = 0;
              state.lastShiftTs = now;
              return state.current;
            }
          }
        } else {
          state.frozenByClutch = false;
        }

        const matched = matchGearRatio(rpm, vss, model.ratios, state.current);
        if (matched !== null) {
          if (matched === state.current) {
            state.lastShiftTs = now;
            state.candidate = matched;
            state.confidence = 0;
            return state.current;
          }

          const curNum = parseInt(state.current, 10);
          const nextNum = parseInt(matched, 10);
          const isUpshift = inGear && !Number.isNaN(curNum) && !Number.isNaN(nextNum) && nextNum > curNum;

          // Layer C: block spurious upshifts when throttle is closed in low-RPM range
          if (isUpshift && throttleClosed && rpm < Math.max(2300, state.idleRpm + 650) && dRpm <= 0) {
            state.confidence = 0;
            return state.current;
          }

          const isSingleStep = (!inGear || Math.abs(nextNum - curNum) === 1);
          const reqFrames = isSingleStep ? 2 : 4;

          if (!isSingleStep && rpm < 1800) {
            state.confidence = 0;
            return state.current;
          }

          if (matched === state.candidate) {
            state.confidence += 1;
            if (state.confidence >= reqFrames) {
              state.current = matched;
              state.lastShiftTs = now;
              state.confidence = 0;
            }
          } else {
            state.candidate = matched;
            state.confidence = 1;
          }
        } else {
          state.confidence = 0;
          if (now - state.lastShiftTs > 1200) {
            state.current = "--";
          }
        }
        return state.current;
      }
    };
  }

  // Pull-based gear calibration engine:
  // - mode 'pull-1': into Gear 1, pull up toward max RPM -> learns R1 accurately & derives provisional 2..6
  // - mode 'auto-seq': pull 1 -> shift 2 -> ... -> 6 continuously, detecting ratio step-downs automatically
  // - mode 'single': calibrate one specific gear index (0..5)
  function createGearPullLearner(initialRatios) {
    let learned = Array.isArray(initialRatios) ? initialRatios.slice(0, 6) : [null, null, null, null, null, null];
    while (learned.length < 6) learned.push(null);

    let mode = "idle"; // idle | pull-1 | auto-seq | single
    let targetIdx = 0;
    let samples = [];
    let prevRpm = null;
    let maxRpmSeen = 0;
    let maxVssSeen = 0;
    let seqGears = []; // array of computed ratios for 1..N during auto-seq
    let shiftDropStreak = 0;
    let pendingShiftSamples = [];

    function resetSession() {
      samples = [];
      prevRpm = null;
      maxRpmSeen = 0;
      maxVssSeen = 0;
      seqGears = [];
      shiftDropStreak = 0;
      pendingShiftSamples = [];
    }

    return {
      getRatios() {
        return learned.slice();
      },
      setRatios(arr) {
        learned = Array.isArray(arr) ? arr.slice(0, 6) : [null, null, null, null, null, null];
        while (learned.length < 6) learned.push(null);
      },
      clearAll() {
        learned = [null, null, null, null, null, null];
        mode = "idle";
        resetSession();
      },
      startPull1() {
        mode = "pull-1";
        targetIdx = 0;
        resetSession();
      },
      startAutoSequence() {
        mode = "auto-seq";
        targetIdx = 0;
        resetSession();
      },
      startSingleGear(gearNum) {
        mode = "single";
        targetIdx = Math.max(0, Math.min(5, gearNum - 1));
        resetSession();
      },
      isActive() {
        return mode !== "idle";
      },
      getMode() {
        return mode;
      },
      getStatus() {
        const med = computeRobustRatio(samples);
        return {
          mode,
          activeGear: targetIdx + 1,
          sampleCount: samples.length,
          maxRpmSeen,
          maxVssSeen,
          liveRatio: med,
          seqLockedCount: seqGears.length,
          seqGears: seqGears.slice(),
          ready: samples.length >= 5 && med !== null
        };
      },
      feed(rpm, vss, tpsPct) {
        if (mode === "idle") return null;
        const dRpm = prevRpm !== null ? (rpm - prevRpm) : 0;
        prevRpm = rpm;

        // Engaged clutch filter: bike rolling >= 6 km/h, engine pulling >= 2200 RPM, throttle open >= 4%, not rapid clutch drop
        const engaged = vss >= 6 && rpm >= 2200 && (tpsPct === undefined || tpsPct >= 4) && dRpm >= -150;
        if (!engaged) {
          return this.getStatus();
        }

        const r = rpm / vss;
        if (r < 20 || r > 320) return this.getStatus();

        if (rpm > maxRpmSeen) maxRpmSeen = rpm;
        if (vss > maxVssSeen) maxVssSeen = vss;

        if (mode === "auto-seq" && samples.length >= 5) {
          const curMed = computeRobustRatio(samples);
          // Detect upshift: ratio drops >= 18% below current gear plateau consistently
          if (curMed && r <= curMed * 0.82 && targetIdx < 5) {
            shiftDropStreak += 1;
            pendingShiftSamples.push({ r, vss, rpm });
            if (shiftDropStreak >= 4) {
              seqGears[targetIdx] = curMed;
              learned[targetIdx] = curMed;
              targetIdx += 1;
              samples = pendingShiftSamples.slice();
              pendingShiftSamples = [];
              shiftDropStreak = 0;
            }
            return this.getStatus();
          } else {
            shiftDropStreak = 0;
            pendingShiftSamples = [];
          }
        }

        samples.push({ r, vss, rpm });
        if (samples.length > 180) samples.shift();
        return this.getStatus();
      },
      finish() {
        if (mode === "idle") return { ok: false, reason: "Chưa bắt đầu học số" };
        const finalR = computeRobustRatio(samples);
        if (mode === "pull-1") {
          mode = "idle";
          if (!finalR || samples.length < 5) {
            return { ok: false, reason: "Chưa đủ mẫu kéo số 1 (cần >= 5 nhịp ở >= 6 km/h, >= 2,200 RPM)" };
          }
          // Reset old explicit gears 2..6 so Gear 1 pull cleanly drives fresh bike estimation until 2..6 are learned
          learned = [finalR, null, null, null, null, null];
          return { ok: true, mode: "pull-1", gear: 1, ratio: finalR, samples: samples.length, ratios: learned.slice() };
        }
        if (mode === "auto-seq") {
          mode = "idle";
          if (finalR && samples.length >= 4) {
            seqGears[targetIdx] = finalR;
            learned[targetIdx] = finalR;
          }
          if (!seqGears.length) {
            return { ok: false, reason: "Chưa thu được dải số nào đạt chuẩn" };
          }
          // Trim any higher unused slots beyond learned count if >= 4 gears were recorded
          if (seqGears.length >= 4) {
            for (let i = seqGears.length; i < 6; i++) learned[i] = null;
          }
          return { ok: true, mode: "auto-seq", lockedCount: seqGears.length, ratios: learned.slice() };
        }
        if (mode === "single") {
          const gNum = targetIdx + 1;
          mode = "idle";
          if (!finalR || samples.length < 5) {
            return { ok: false, reason: "Chưa đủ mẫu cho Số " + gNum + " (cần >= 5 nhịp đang kéo ga)" };
          }
          learned[targetIdx] = finalR;
          return { ok: true, mode: "single", gear: gNum, ratio: finalR, samples: samples.length, ratios: learned.slice() };
        }
        mode = "idle";
        return { ok: false, reason: "Trạng thái không hợp lệ" };
      },
      cancel() {
        mode = "idle";
        resetSession();
      }
    };
  }

  function parseRecordedCsv(csvText) {
    if (!csvText || typeof csvText !== "string") return [];
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name.toLowerCase());
    const cTs = idx("timestamp");
    const cRpm = idx("rpm");
    const cTpsV = idx("tps_v");
    const cTpsP = idx("tps_pct");
    const cEct = idx("ect_c");
    const cIat = idx("iat_c");
    const cMap = idx("map_kpa");
    const cVbat = idx("vbat_v");
    const cVss = idx("vss_kmh");
    const cInj = idx("inj_ms");
    const cDuty = idx("duty_pct");
    const cIgn = idx("ign_deg");
    const cIacv = idx("iacv");
    const cO2 = idx("o2_v");
    const cAfr = idx("afr");
    const cDfco = idx("dfco");
    if (cRpm === -1) return [];

    const numAt = (cols, i, fallback) => {
      if (i < 0 || i >= cols.length) return fallback;
      const v = parseFloat(cols[i]);
      return Number.isFinite(v) ? v : fallback;
    };

    const frames = [];
    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split(",");
      if (cols.length < 4) continue;
      const rpm = Math.round(numAt(cols, cRpm, 0));
      const tpsPct = numAt(cols, cTpsP, 0);
      const tpsVolt = numAt(cols, cTpsV, 0.45 + (tpsPct / 100) * 4.0);
      const ectC = Math.round(numAt(cols, cEct, 80));
      const iatC = Math.round(numAt(cols, cIat, 32));
      const mapKpa = Math.round(numAt(cols, cMap, 36));
      const vbat = numAt(cols, cVbat, 13.8);
      const vssKmh = Math.round(numAt(cols, cVss, 0));
      const injMs = numAt(cols, cInj, 0);
      const injDuty = numAt(cols, cDuty, Math.min(Math.round(((rpm * injMs) / 1200.0) * 10) / 10, 100.0));
      const ignDeg = numAt(cols, cIgn, 15);
      const iacvStp = Math.round(numAt(cols, cIacv, 30));
      const o2Volt = numAt(cols, cO2, 0.5);
      const dfco = cDfco >= 0 ? (cols[cDfco].trim() === "1" || cols[cDfco].trim().toLowerCase() === "true") : false;
      const afrEst = cAfr >= 0 && cols[cAfr].trim() ? cols[cAfr].trim() : (dfco ? "CUT" : "--");

      frames.push({
        kind: "table11",
        timestamp: cTs >= 0 ? cols[cTs].trim() : "",
        rpm,
        tpsVolt,
        tpsPct,
        tpsRaw: Math.round(tpsPct * 1.56),
        ectVolt: 1.5,
        ectC,
        iatVolt: 2.0,
        iatC,
        mapVolt: Math.min(4.8, mapKpa / 25.0),
        mapKpa,
        vbat,
        vssKmh,
        injMs,
        injDuty,
        ignDeg,
        iacvStp,
        o2Volt,
        afrEst,
        dfco,
        rawHex: ""
      });
    }
    return frames;
  }

  return {
    HONDA_DTC_DICT,
    DEFAULT_GEAR_RATIOS,
    STEP_FROM_GEAR1,
    decodeDtcByte,
    parseKlinePacket,
    parseRecordedCsv,
    median,
    computeRobustRatio,
    normalizeGearModel,
    matchGearRatio,
    createGearTracker,
    createGearPullLearner
  };
}));
