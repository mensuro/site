// The free Cp/Cpk calculator must match published reference results and the Mensuro engine.
// Run: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../assets/cpk.js");

const ref = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "reference", name), "utf8"));
const near = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, expected ${expected} within ${tol}`);
const rel = (actual, expected, r, label) =>
  near(actual, expected, Math.max(Math.abs(expected) * r, 1e-300), label);

// ------------------------------------------------------------ NIST/SEMATECH 6.1.6

test("NIST worked example: Cp, Cpk, Cpu, Cpl", () => {
  const e = ref("nist_6_1_6_capability.json").example;
  const ix = C.indicesFromSummary(e.mean, e.s, e.lsl, e.usl);
  near(ix.cp, e.cp, 0.00005, "Cp");
  near(ix.cpk, e.cpk, 0.00005, "Cpk");
  near(ix.cpu, e.cpu, 0.00005, "Cpu");
  near(ix.cpl, e.cpl, 0.00005, "Cpl");
});

test("NIST reject rates for a centered process", () => {
  for (const row of ref("nist_6_1_6_capability.json").rejects_centered) {
    const half = row.spec_width_sigma / 2;
    near(C.indicesFromSummary(0, 1, -half, half).ppmTotal, row.ppm, row.atol_ppm, `PPM at Cp ${row.cp}`);
  }
});

// ------------------------------------------------- Montgomery Example 6.1 (subgroups)

test("Montgomery 6.1 flow width: sigma within, Cp, z, fraction nonconforming", () => {
  const f = ref("montgomery_6e_example_6_1_flow_width.json");
  const r = C.capability({ values: f.values, subgroupSize: f.subgroup_size, lsl: f.spec.lsl, usl: f.spec.usl });
  near(r.within.sigma, f.expected.sigma_within, 0.00005, "sigma within");
  near(r.within.cp, f.expected.cp, 0.0005, "Cp");
  near(r.within.zLsl, f.expected.z_lsl, 0.001, "z LSL");
  near(r.within.zUsl, f.expected.z_usl, 0.001, "z USL");
  near(r.within.ppmTotal / 1e6, f.expected.fraction_nonconforming, 0.000005, "fraction nonconforming");
  assert.equal(r.subgroups, 25);
});

// --------------------------------------------- Montgomery Examples 8.1-8.2 (individuals)

test("Montgomery 8.1-8.2 bursting strength: mean, s, Cpl, fallout", () => {
  const b = ref("montgomery_6e_example_8_1_bursting_strength.json");
  const r = C.capability({ values: b.values, lsl: b.spec.lsl });
  near(r.mean, b.expected.mean, 0.005, "mean");
  near(r.overall.sigma, b.expected.s, 0.005, "s");
  near(r.overall.cpl, b.expected.cpl_overall, 0.005, "Cpl");
  near(r.overall.ppmBelow / 1e6, b.expected.fraction_below_lsl, 0.0005, "fraction below LSL");
  assert.equal(r.overall.cp, null);
  assert.equal(r.verdict.verdict, "Not acceptable");
});

// ------------------------------------------------------- parity with the engine

const parity = ref("engine_parity.json");

test("normal CDF and tail match scipy from z = -9 to 9 (every 0.05)", () => {
  for (const g of parity.normal) {
    rel(C.normCdf(g.z), g.cdf, 1e-12, `cdf(${g.z})`);
    rel(C.normSf(g.z), g.sf, 1e-12, `sf(${g.z})`);
  }
});

for (const c of parity.cases) {
  test(`engine parity: ${c.name}`, () => {
    const r = C.capability({ values: c.values, subgroupSize: c.subgroup_size, lsl: c.lsl, usl: c.usl });
    const e = c.engine;
    rel(r.mean, e.mean, 1e-12, "mean");
    for (const famName of ["within", "overall"]) {
      const a = r[famName], b = e[famName];
      rel(a.sigma, b.sigma, 1e-12, `${famName} sigma`);
      for (const k of ["cp", "cpk", "cpu", "cpl"]) {
        if (b[k] === null) { assert.equal(a[k], null, `${famName} ${k}`); } else { rel(a[k], b[k], 1e-11, `${famName} ${k}`); }
      }
      rel(a.ppmTotal, b.ppm_total, 1e-9, `${famName} PPM`);
    }
    near(r.ppmObserved, e.ppm_observed, 1e-9, "observed PPM");
    rel(r.normality.a2, e.ad, 1e-9, "Anderson-Darling A2");
    rel(r.normality.p, e.ad_p, 1e-9, "Anderson-Darling p");
    assert.equal(r.verdict.verdict, e.verdict);
  });
}

test("page example is the engine-checked dataset", () => {
  const c = parity.cases.find((x) => x.name.startsWith("calculator page example"));
  const values = C.parseReadings(C.EXAMPLE.readings.join("\n"));
  assert.deepEqual(values, c.values);
  assert.equal(C.EXAMPLE.subgroupSize, c.subgroup_size);
  assert.equal(Number(C.EXAMPLE.lsl), c.lsl);
  assert.equal(Number(C.EXAMPLE.usl), c.usl);
  assert.equal(C.capability({ values, subgroupSize: 5, lsl: c.lsl, usl: c.usl }).verdict.verdict, "Conditionally acceptable");
});

// ------------------------------------------------------------------ behavior

test("verdict bands", () => {
  assert.equal(C.classify("Ppk", 1.8).verdict, "Acceptable");
  assert.equal(C.classify("Ppk", 1.67).verdict, "Conditionally acceptable");
  assert.equal(C.classify("Ppk", 1.33).verdict, "Conditionally acceptable");
  assert.equal(C.classify("Ppk", 1.32).verdict, "Not acceptable");
  assert.equal(C.classify("Ppk", 1.3299).reason, "Ppk is 1.330, below the 1.33 minimum.");
});

test("Cpk can drive the verdict instead of Ppk", () => {
  const f = ref("montgomery_6e_example_6_1_flow_width.json");
  const r = C.capability({ values: f.values, subgroupSize: 5, lsl: 1, usl: 2, verdictIndex: "Cpk" });
  assert.equal(r.verdictIndex, "Cpk");
  assert.ok(r.verdict.reason.startsWith("Cpk is 1.18, below"));
});

test("pasted text: columns, rows, commas and tabs", () => {
  assert.deepEqual(C.parseReadings("1.2\n1.3\r\n 1.25 \n"), [1.2, 1.3, 1.25]);
  assert.deepEqual(C.parseReadings("1.2\t1.3\t1.4"), [1.2, 1.3, 1.4]);
  assert.deepEqual(C.parseReadings("1.2, 1.3; -0.5 2e-3"), [1.2, 1.3, -0.5, 0.002]);
  assert.throws(() => C.parseReadings("Diameter\n1.2"), /Diameter.*isn't a number/);
  assert.throws(() => C.parseReadings("1.2\n0x10"), /isn't a number/);
  assert.equal(C.parseLimit("  ", "upper limit"), null);
  assert.throws(() => C.parseLimit("1,5", "upper limit"), /period as the decimal mark/);
});

test("input checks", () => {
  assert.throws(() => C.capability({ values: [1, 2, 3] }), /at least one specification limit/);
  assert.throws(() => C.capability({ values: [1, 2, 3], lsl: 5, usl: 1 }), /must be below/);
  assert.throws(() => C.capability({ values: [1], usl: 5 }), /at least 2 measurements/);
  assert.throws(() => C.capability({ values: [2, 2, 2], usl: 5 }), /identical/);
  assert.throws(() => C.capability({ values: [1, 2, 3, 4, 5], subgroupSize: 2, usl: 9 }), /don't divide/);
  assert.throws(() => C.capability({ values: [1, 2, 3, 4], subgroupSize: 26, usl: 9 }), /Parts per group/);
});

test("notes for small samples and non-normal data", () => {
  const few = C.capability({ values: [1, 2, 3, 4, 5], usl: 10 });
  assert.ok(few.notes.some((n) => n.includes("Only 5 measurements")));
  assert.ok(few.notes.some((n) => n.includes("Normality isn't checked")));
  const skew = parity.cases.find((c) => c.name.startsWith("skewed"));
  const r = C.capability({ values: skew.values, usl: 200 });
  assert.ok(r.notes.some((n) => n.includes("may not be normal")));
});

// ------------------------------------------------------------ criteria and plain-English reading

const ex = () => ({ values: C.EXAMPLE.readings.map(Number), subgroupSize: 5, lsl: 11.975, usl: 12.035 });

test("criteria: launch (PPAP initial) is the default and unchanged", () => {
  const r = C.capability(ex());
  assert.equal(r.criteria.key, "initial");
  assert.deepEqual(C.capability({ ...ex(), criteria: { key: "initial" } }).verdict, r.verdict);
  assert.equal(r.verdict.verdict, "Conditionally acceptable");
});

test("criteria: ongoing production accepts 1.33 or more, on the value as shown", () => {
  const ongoing = { key: "ongoing" };
  assert.equal(C.classify("Ppk", 1.41, ongoing).verdict, "Acceptable");
  assert.equal(C.classify("Ppk", 1.33, ongoing).verdict, "Acceptable");
  assert.equal(C.classify("Ppk", 1.3349, ongoing).verdict, "Acceptable");
  assert.equal(C.classify("Ppk", 1.32, ongoing).verdict, "Not acceptable");
  assert.match(C.classify("Ppk", 1.41, ongoing).reason, /1\.33 minimum for ongoing production/);
  assert.equal(C.capability({ ...ex(), criteria: ongoing }).verdict.verdict, "Acceptable");
});

test("criteria: a customer's own minimum, validated", () => {
  const r = C.capability({ ...ex(), criteria: { key: "custom", minimum: 1.5 } });
  assert.equal(r.verdict.verdict, "Not acceptable");
  assert.match(r.verdict.reason, /your customer's 1\.50 minimum/);
  assert.equal(C.capability({ ...ex(), criteria: { key: "custom", minimum: 1.0 } }).verdict.verdict, "Acceptable");
  for (const bad of [NaN, 0.2, 4, undefined]) {
    assert.throws(() => C.capability({ ...ex(), criteria: { key: "custom", minimum: bad } }), /0\.50 to 3\.00/);
  }
  assert.throws(() => C.capability({ ...ex(), criteria: { key: "nope" } }), /Unknown criteria/);
});

test("explain: centred example restates the result's own numbers", () => {
  const r = C.capability(ex());
  const m = Object.fromEntries(C.explain(r).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(m), ["index", "centering", "ppm", "drift"]);
  assert.match(m.index.title, new RegExp("Ppk " + r.overall.cpk.toFixed(2)));
  assert.match(m.index.text, new RegExp((3 * r.overall.cpk).toFixed(1) + " standard deviations \\(long-term spread\\) inside the upper"));
  assert.match(m.index.text, /PPAP asks for more than 1\.67/);
  assert.equal(m.centering.title, "Well centred, so spread is the lever");
  assert.match(m.ppm.text, new RegExp("about " + r.overall.ppmTotal.toFixed(1) + " parts per million"));
  assert.doesNotMatch(m.ppm.text, /tables quote/); // both tails matter here
  assert.match(m.ppm.text, /None of your 100 measurements were outside/);
  assert.equal(m.drift.title, "Short-term and long-term agree");
});

test("explain: off-centre process, and the centred-table comparison", () => {
  const shifted = ex();
  shifted.values = shifted.values.map((v) => v + 0.012);
  const r = C.capability({ ...shifted, verdictIndex: "Cpk" });
  const m = Object.fromEntries(C.explain(r).map((x) => [x.key, x]));
  const w = r.within;
  assert.equal(m.centering.title, "Centering is the quick win");
  assert.match(m.centering.text, new RegExp("Centred, Cpk would rise to " + w.cp.toFixed(2)));
  assert.match(m.centering.text, /above the middle/);
  // The textbook figure for this Cpk is a centred process with the same index: both tails at 3 x Cpk.
  const sigma = w.sigma, mid = 12.005, half = 3 * w.cpk * sigma;
  const centred = C.indicesFromSummary(mid, sigma, mid - half, mid + half).ppmTotal;
  const quoted = centred < 100 ? centred.toFixed(1) : Math.round(centred).toLocaleString("en-US");
  assert.match(m.ppm.text, new RegExp("about " + quoted.replace(",", "\\,") + " PPM tables quote for Cpk " + w.cpk.toFixed(2)));
  assert.match(m.ppm.text, /beyond the upper limit/);
});

test("explain: ongoing and custom criteria change the bar, not the numbers", () => {
  const on = C.explain(C.capability({ ...ex(), criteria: { key: "ongoing" } }))[0];
  assert.match(on.text, /1\.33 \(4 standard deviations\) is the usual minimum/);
  const cu = C.explain(C.capability({ ...ex(), criteria: { key: "custom", minimum: 1.5 } }))[0];
  assert.match(cu.text, /minimum of 1\.50 means 4\.5 standard deviations/);
});

test("explain: drift and out-of-order flags", () => {
  // Groups that step upward: within-group spread small, overall spread large.
  const values = [];
  for (let g = 0; g < 20; g++) { for (let i = 0; i < 5; i++) { values.push(10 + g * 0.01 + [0, 0.002, -0.002, 0.001, -0.001][i]); } }
  const drift = C.explain(C.capability({ values, subgroupSize: 5, lsl: 9.5, usl: 10.7 })).find((x) => x.key === "drift");
  assert.equal(drift.title, "Something shifts over time");
  // Alternating readings: big moving ranges, modest overall spread.
  const alt = Array.from({ length: 40 }, (_, i) => (i % 2 ? 10.01 : 9.99) + (i % 7) * 0.0003);
  const flag = C.explain(C.capability({ values: alt, lsl: 9.9, usl: 10.1 })).find((x) => x.key === "drift");
  assert.equal(flag.title, "Ppk is higher than Cpk");
});

test("explain: an average outside the limit says so", () => {
  const values = Array.from({ length: 30 }, (_, i) => 10.2 + (i % 5) * 0.01);
  const first = C.explain(C.capability({ values, lsl: 9.9, usl: 10.1 }))[0];
  assert.match(first.text, /outside the upper spec limit/);
});
