const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const wwwDir = path.join(__dirname, "assets", "www");
const html = fs.readFileSync(path.join(wwwDir, "index.html"), "utf8");
const css = fs.readFileSync(path.join(wwwDir, "app.css"), "utf8");
const js = fs.readFileSync(path.join(wwwDir, "app.js"), "utf8");
const core = require(path.join(wwwDir, "kline_core.js"));

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  [PASS]", name);
    passed += 1;
  } catch (err) {
    console.error("  [FAIL]", name, "-", err.message);
    process.exitCode = 1;
  }
}

console.log("=== 1. DOM & Asset Integrity ===");

check("HTML has zero duplicate id attributes", () => {
  const idCounts = new Map();
  const re = /\bid\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    idCounts.set(m[1], (idCounts.get(m[1]) || 0) + 1);
  }
  const dups = [...idCounts.entries()].filter(([, c]) => c > 1);
  assert.deepStrictEqual(dups, [], "Duplicate IDs: " + JSON.stringify(dups));
});

check("Every $('id') reference in app.js exists in index.html", () => {
  const idSet = new Set();
  const idRe = /\bid\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = idRe.exec(html)) !== null) idSet.add(m[1]);

  const refRe = /\$\(\s*"([^"]+)"\s*\)/g;
  const missing = [];
  while ((m = refRe.exec(js)) !== null) {
    if (!idSet.has(m[1])) missing.push(m[1]);
  }
  assert.deepStrictEqual([...new Set(missing)], [], "Missing HTML IDs: " + missing.join(", "));
});

check("index.html loads kline_core.js before app.js and omits bike presets", () => {
  const corePos = html.indexOf("kline_core.js");
  const appPos = html.indexOf("app.js");
  assert(corePos !== -1 && appPos !== -1 && corePos < appPos, "kline_core.js must load before app.js");
  assert(!html.includes("gearBikePreset"), "No static bike preset selector allowed");
});

check("CSS resolves landscape conflict, keeps bottom touch toolbar, and loads Vietnamese 400-700 fonts", () => {
  const fontsCss = fs.readFileSync(path.join(wwwDir, "fonts.css"), "utf8");
  assert(!css.includes("max-height: 540px"), "Legacy 540px split breakpoint must not return");
  assert(css.includes("@media (orientation: landscape)"), "Landscape media query required");
  assert(css.includes(".lhud-toolbar {\n    position: fixed;\n    bottom: 10px;") ||
         css.includes(".lhud-toolbar {\r\n    position: fixed;\r\n    bottom: 10px;"),
         "Landscape toolbar must dock at bottom so it never blocks top replay bar");
  assert(fontsCss.includes("font-weight: 400;") && fontsCss.includes("barlow_0_vietnamese.woff2"),
         "Barlow Vietnamese 400 weight alias must exist");
});

check("Every window.__on* callback called by BtBridge.java is handled in app.js", () => {
  const bridgeJava = fs.readFileSync(path.join(__dirname, "src", "com", "kailc", "hondakline", "BtBridge.java"), "utf8");
  const cbRe = /window\.(__on\w+)/g;
  const missing = [];
  let m;
  while ((m = cbRe.exec(bridgeJava)) !== null) {
    if (!js.includes(m[1])) missing.push(m[1]);
  }
  assert.deepStrictEqual([...new Set(missing)], [], "Missing JS bridge callbacks: " + missing.join(", "));
});

console.log("=== 2. KlineCore Parser & Real Log Validation ===");

check("parseKlinePacket parses real Table 11 frame + rejects bad checksum", () => {
  const good = "02 19 71 11 06 4C 17 00 45 64 7D 4B 89 5D FF FF 89 00 02 95 8E 2C 14 A7 10";
  const pkt = core.parseKlinePacket(good);
  assert(pkt && pkt.kind === "table11");
  assert.strictEqual(pkt.rpm, 1612);
  assert.strictEqual(pkt.ectC, 60);

  const prefixed = core.parseKlinePacket("0x02 0x19 0x71 0x11 0x06 0x4C 0x17 0x00 0x45 0x64 0x7D 0x4B 0x89 0x5D 0xFF 0xFF 0x89 0x00 0x02 0x95 0x8E 0x2C 0x14 0xA7 0x10");
  assert(prefixed && prefixed.rpm === 1612);

  const badCs = "02 19 71 11 06 4C 17 00 45 64 7D 4B 89 5D FF FF 89 00 02 95 8E 2C 14 A7 11";
  assert.strictEqual(core.parseKlinePacket(badCs), null);
});

check("All sample_frames.js entries parse cleanly as Table 11", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(wwwDir, "sample_frames.js"), "utf8"), sandbox);
  const frames = sandbox.window.SAMPLE_FRAMES;
  assert(Array.isArray(frames) && frames.length > 50);
  for (const item of frames) {
    const p = core.parseKlinePacket(item.h);
    assert(p && p.kind === "table11", "Bad sample frame: " + item.h);
    assert.strictEqual(typeof p.rpm, "number");
    assert.strictEqual(typeof p.o2Volt, "number");
    assert.strictEqual(typeof p.afrEst, "string");
  }
});

check("parseRecordedCsv parses recorded REC CSV files for offline replay", () => {
  const csv = [
    "Timestamp,RPM,TPS_V,TPS_Pct,ECT_C,IAT_C,MAP_kPa,VBAT_V,VSS_kmh,Gear,INJ_ms,Duty_Pct,IGN_deg,IACV,O2_V,AFR,DFCO",
    "2026-11-25T06:00:00.000Z,6540,3.82,78,88,35,92,14.10,41,1,7.85,42.8,28,34,0.72,13.5,0",
    "2026-11-25T06:00:00.160Z,4800,0.45,0,88,35,24,14.20,58,3,0.00,0.0,15,28,0.12,CUT,1"
  ].join("\n");
  const parsed = core.parseRecordedCsv(csv);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].rpm, 6540);
  assert.strictEqual(parsed[0].vssKmh, 41);
  assert.strictEqual(parsed[0].afrEst, "13.5");
  assert.strictEqual(parsed[1].dfco, true);
  assert.strictEqual(parsed[1].afrEst, "CUT");
});

console.log("=== 3. Virtual Gear v2 & Gear 1 Pull-Learn Math ===");

check("Pull-Learn Gear 1 (kéo max tua) locks G1 & extrapolates G2..G6 accurately", () => {
  const learner = core.createGearPullLearner();
  learner.startPull1();

  // Simulate Gear 1 acceleration 3000 -> 9600 RPM at true ratio ~185 RPM/(km/h)
  const trueR1 = 185.0;
  for (let rpm = 3000; rpm <= 9600; rpm += 550) {
    const vss = Math.round(rpm / trueR1);
    learner.feed(rpm, vss, 85);
  }
  // Inject a clutch slip outlier + decel zero-TPS outlier that learner must reject
  learner.feed(9800, 10, 90);
  learner.feed(4000, 35, 0);

  const res = learner.finish();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.gear, 1);
  assert(Math.abs(res.ratio - trueR1) < 6, `Expected G1 ~${trueR1}, got ${res.ratio}`);
  const norm = core.normalizeGearModel(res.ratios);
  assert.strictEqual(norm.ratios.length, 6);
  assert(norm.ratios[5] < norm.ratios[1] && norm.ratios[1] < norm.ratios[0], "Normalized ratios must descend strictly G1 > G2 > .. > G6");
});

check("Continuous 1->6 Pull-Learn detects upshifts automatically", () => {
  const learner = core.createGearPullLearner();
  learner.startAutoSequence();
  const simRatios = [192, 138, 107, 87, 74, 65];
  simRatios.forEach((r) => {
    for (let rpm = 4200; rpm <= 7800; rpm += 600) {
      learner.feed(rpm, Math.round(rpm / r), 60);
    }
  });
  const res = learner.finish();
  assert.strictEqual(res.ok, true);
  assert(res.lockedCount >= 5, "Should detect >=5 gears, got " + res.lockedCount);
});

check("GearTracker: low-VSS guard + clutch-in freeze + hysteresis work properly", () => {
  const tracker = core.createGearTracker([185, 133, 104, 84, 72, 63]);
  // Move into Gear 1 smoothly
  let gear;
  for (let i = 0; i < 4; i++) {
    gear = tracker.update(5550, 30, 1000 + i * 160);
  }
  assert.strictEqual(gear, "1");

  // Sudden clutch-in RPM drop at speed should hold "1" momentarily instead of snapping to N
  gear = tracker.update(2800, 29, 1700);
  assert.strictEqual(gear, "1");
  assert.strictEqual(tracker.getState().frozenByClutch, true);

  // Low-speed quantization at 4->5 km/h: without VSS+/-0.7 guard, ratio drops 185->148 (<156.9 midpoint) and would falsely upshift to G2
  const slowTracker = core.createGearTracker([185, 133, 104, 84, 72, 63]);
  slowTracker.update(740, 4, 5000);
  slowTracker.update(740, 4, 5160);
  assert.strictEqual(slowTracker.update(740, 5, 5320), "1");
  assert.strictEqual(slowTracker.update(740, 5, 5480), "1");
});

check("GearTracker v3: anti-coasting locks Gear 1 when âm côn (~1610 RPM, TPS=0%) & unlocks on real upshift", () => {
  const tracker = core.createGearTracker([185, null, null, null, null, null]);
  // 1. Learn adaptive idle RPM around 1610 RPM while stopped
  for (let i = 0; i < 8; i++) {
    assert.strictEqual(tracker.update(1610, 0, i * 160, 0, 2.26), "N");
  }
  assert(Math.abs(tracker.getState().idleRpm - 1610) < 30);

  // 2. Accelerate in Gear 1 with throttle open
  for (let i = 0; i < 4; i++) {
    tracker.update(5550, 30, 2000 + i * 160, 45, 5.2);
  }
  assert.strictEqual(tracker.update(5550, 30, 2700, 45, 5.2), "1");

  // 3. User pulls clutch to coast (âm côn để xe trôi): TPS=0%, INJ=2.2ms idle, RPM drops across G2..G5 ratios while VSS stays 28..22 km/h
  const coastProfile = [
    [4100, 29], [3100, 28], [2350, 27], [1850, 26],
    [1640, 25], [1615, 24], [1610, 23], [1605, 22], [1610, 21]
  ];
  coastProfile.forEach(([rpm, vss], idx) => {
    const g = tracker.update(rpm, vss, 3000 + idx * 160, 0, 2.25);
    assert.strictEqual(g, "1", `Must hold Gear 1 while coasting at ${rpm} RPM / ${vss} km/h, got ${g}`);
    assert.strictEqual(tracker.getState().frozenByClutch, true);
  });

  // 4. Release clutch and open throttle cleanly into Gear 2 (RPM 4200, VSS 34 -> ratio ~123.5)
  tracker.update(4200, 34, 5000, 38, 4.8);
  tracker.update(4300, 35, 5160, 42, 5.0);
  tracker.update(4420, 36, 5320, 45, 5.2);
  const nextGear = tracker.update(4540, 37, 5480, 48, 5.4);
  assert.strictEqual(nextGear, "2");
  assert.strictEqual(tracker.getState().frozenByClutch, false);
});

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
console.log(`\nALL ${passed} TESTS PASSED.`);
