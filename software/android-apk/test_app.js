const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'assets/www/index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'assets/www/app.js'), 'utf8');

// Regex for $("someId") or $('someId')
const idRegex = /\$\(["']([a-zA-Z0-9_\-]+)["']\)/g;
let m;
const used = new Set();
while ((m = idRegex.exec(js)) !== null) {
  used.add(m[1]);
}

const missing = [...used].filter(id => !html.includes(`id="${id}"`) && !html.includes(`id='${id}'`));
console.log('Checked DOM IDs in app.js:', used.size);
if (missing.length > 0) {
  console.error('Missing IDs in index.html:', missing);
  process.exit(1);
} else {
  console.log('ALL DOM IDs MATCH PERFECTLY!');
}

// Extract parseKlinePacket and calculateGear for standalone test
global.window = {};
const sampleFrames = require('./assets/www/sample_frames.js');
const frames = window.SAMPLE_FRAMES || [];

const GEAR_PRESETS = {
  winner150: {
    name: "Honda Winner X / CBR150 (6 số)",
    gears: 6,
    ratios: [160.8, 107.5, 78.2, 62.6, 54.1, 47.4],
    tolerance: 0.10
  }
};

let gearState = {
  current: "N",
  candidate: "N",
  confidence: 0,
  lastShiftTs: 0
};

function calculateGear(rpm, vss, now = Date.now()) {
  if (!rpm || rpm < 350) {
    gearState.current = "--";
    return "--";
  }
  if (!vss || vss < 2) {
    gearState.current = "N";
    gearState.candidate = "N";
    gearState.confidence = 0;
    return "N";
  }

  const r = rpm / vss;
  const cfg = GEAR_PRESETS.winner150;
  const ratios = cfg.ratios;

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

// Function to parse packet
function parseKlinePacket(line) {
  if (!line || typeof line !== "string") return null;
  let cleaned = line.trim();
  if (cleaned.includes("RAW:")) cleaned = cleaned.split("RAW:")[1].trim();
  if (cleaned.includes("Data khac:")) cleaned = cleaned.replace("Data khac:", "").trim();
  if (cleaned.includes("T11:")) cleaned = cleaned.split("T11:")[1].trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length < 4) return null;
  const bytes = [];
  for (let i = 0; i < parts.length; i++) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(parts[i])) return null;
    bytes.push(parseInt(parts[i], 16));
  }

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
      const vssKmh = ecu[17];
      return { rpm, vssKmh };
    }
  }
  return null;
}

let parsed = 0;
let gears = { 'N': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '--': 0 };
let simulatedTs = 1000;

for (const item of frames) {
  const raw = item.h || item;
  const f = parseKlinePacket(raw);
  if (f) {
    parsed++;
    simulatedTs += 100; // 10Hz
    const g = calculateGear(f.rpm, f.vssKmh, simulatedTs);
    gears[g] = (gears[g] || 0) + 1;
  }
}

console.log('Parsed sample frames successfully:', parsed);
console.log('Gear distribution across sample log:', gears);

// Synthetic gear test
console.log('\n--- Synthetic Ratio Test for Winner X ---');
const tests = [
  { rpm: 1400, vss: 0, expect: 'N' },
  { rpm: 4800, vss: 30, expect: '1' }, // 4800/30 = 160 (Gear 1: 160.8)
  { rpm: 5350, vss: 50, expect: '2' }, // 5350/50 = 107 (Gear 2: 107.5)
  { rpm: 6240, vss: 80, expect: '3' }, // 6240/80 = 78 (Gear 3: 78.2)
  { rpm: 6260, vss: 100, expect: '4' }, // 6260/100 = 62.6 (Gear 4: 62.6)
  { rpm: 5410, vss: 100, expect: '5' }, // 5410/100 = 54.1 (Gear 5: 54.1)
  { rpm: 5688, vss: 120, expect: '6' }, // 5688/120 = 47.4 (Gear 6: 47.4)
];

for (const t of tests) {
  let res;
  for (let step = 0; step < 3; step++) { // 3 debounce frames
    simulatedTs += 100;
    res = calculateGear(t.rpm, t.vss, simulatedTs);
  }
  console.log(`RPM: ${t.rpm}, VSS: ${t.vss} km/h -> Gear: ${res} (Expected: ${t.expect}) => ${res === t.expect ? 'PASS' : 'FAIL'}`);
}
