// The free study planner: counts and checks against the cited minimums. No statistics here.
// Run: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../assets/planner-core.js");

const states = (r) => r.checks.map((c) => c.state);

test("Gage R&R: readings, AIAG example and time", () => {
  const r = P.grr({ parts: "10", operators: "3", trials: "3", seconds: "30" });
  assert.equal(r.value, 90);
  assert.equal(r.time, "45 minutes");
  assert.deepEqual(states(r), ["ok", "ok", "info"]);
  assert.match(r.checks[2].text, /Each operator takes 30 readings/);
  const small = P.grr({ parts: "5", operators: "1", trials: "2" });
  assert.deepEqual(states(small).slice(0, 2), ["warn", "warn"]);
  assert.equal(P.grr({ parts: "10", operators: "3", trials: "3", seconds: "120" }).time, "3 hours");
  assert.equal(P.grr({ parts: "x", operators: "3", trials: "3" }).ok, false);
  assert.equal(P.grr({ parts: "2.5", operators: "3", trials: "3" }).ok, false);
});

test("attribute: Ford's mix always adds up to the parts", () => {
  for (let n = 1; n <= 200; n++) {
    const mix = P.split(n);
    assert.equal(mix.reduce((a, m) => a + m.parts, 0), n, "n = " + n);
  }
  // 50 parts: 12.5 / 12.5 / 15 / 5 / 5; the two half parts go to the first two largest remainders.
  assert.deepEqual(P.split(50).map((m) => m.parts), [13, 12, 15, 5, 5]);
  const r = P.attribute({ design: "mix", parts: "50", appraisers: "3", trials: "3" });
  assert.equal(r.value, 450);
  assert.equal(r.checks[0].state, "ok");
  assert.match(r.checks[1].text, /about 10 out-of-spec parts/);
  const a = P.attribute({ design: "analytic", limits: "2" });
  assert.equal(a.value, 320);
});

test("Type 1: Bosch readings and the 5% resolution rule", () => {
  assert.deepEqual(states(P.type1({ readings: "50" })), ["ok", "info", "info"]);
  assert.equal(P.type1({ readings: "20" }).checks[0].state, "warn");
  const r = P.type1({ readings: "50", tolerance: "0.06", resolution: "0.001" });
  assert.ok(Math.abs(r.resolutionPct - 1.6667) < 1e-3);
  assert.equal(r.checks[1].state, "ok");
  assert.equal(P.type1({ readings: "50", tolerance: "0.06", resolution: "0.005" }).checks[1].state, "warn");
  assert.equal(P.type1({ readings: "50", tolerance: "-1", resolution: "0.005" }).checks[1].state, "warn");
});

test("capability: subgroups, readings per cavity, cavities", () => {
  const r = P.capability({ subgroups: "25", size: "5", cavities: "4" });
  assert.equal(r.value, 500);
  assert.deepEqual(states(r), ["ok", "ok", "ok", "info"]);
  assert.match(r.checks[2].text, /125 readings per cavity/);
  assert.equal(P.capability({ subgroups: "10", size: "5", cavities: "1" }).checks[2].state, "info");
  assert.equal(P.capability({ subgroups: "5", size: "5", cavities: "1" }).checks[2].state, "warn");
  assert.equal(P.capability({ subgroups: "25", size: "30", cavities: "1" }).checks[1].state, "warn");
});

test("reuse: any no means a new study; all yes means propose reuse", () => {
  assert.equal(P.reuse([]).state, "open");
  assert.equal(P.reuse([true, true, true, true, true]).state, "reuse");
  assert.equal(P.reuse([true, false, true, true, true]).state, "new");
  assert.equal(P.reuse([true, true]).value, "2 / 5");
});
