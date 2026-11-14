/* Mensuro study planner: the arithmetic behind each plan.
   Only counting and comparisons against cited minimums; no statistics are computed here.
   Runs in the browser and in tests/planner.test.js; nothing here sends data anywhere. */
(function (root) {
  "use strict";

  function count(v) { var n = Number(String(v == null ? "" : v).trim()); return Number.isInteger(n) && n > 0 ? n : null; }
  function positive(v) {
    var s = String(v == null ? "" : v).trim().replace(",", ".");
    if (!s) { return null; }
    var n = Number(s);
    return isFinite(n) && n > 0 ? n : NaN;
  }
  function check(state, text) { return { state: state, text: text }; }
  function minutes(readings, seconds) {
    if (!seconds || isNaN(seconds)) { return null; }
    var m = Math.round(readings * seconds / 60);
    return m < 90 ? m + " minutes" : (Math.round(m / 6) / 10) + " hours";
  }
  function invalid(text) { return { ok: false, message: text }; }

  // Ford's attribute part mix (Specifics for PPAP, Jan 2025, 2.2.8), split into whole parts
  // with the largest remainders, so the parts always add up to the total.
  var MIX = [["near the lower limit", 25], ["near the upper limit", 25], ["across the process variation", 30],
             ["outside the lower limit", 10], ["outside the upper limit", 10]];
  function split(n) {
    var raw = MIX.map(function (m) { return n * m[1] / 100; });
    var base = raw.map(Math.floor);
    var left = n - base.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (r, i) { return [r - base[i], i]; })
      .sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; })
      .slice(0, left).forEach(function (x) { base[x[1]] += 1; });
    return MIX.map(function (m, i) { return { label: m[0], percent: m[1], parts: base[i] }; });
  }

  function grr(i) {
    var p = count(i.parts), o = count(i.operators), t = count(i.trials), sec = positive(i.seconds);
    if (!p || !o || !t) { return invalid("Enter whole numbers for parts, operators and trials."); }
    var n = p * o * t, full = p >= 10 && o >= 3 && t >= 3, time = minutes(n, sec);
    var checks = [
      check(full ? "ok" : "warn", full
        ? p + " × " + o + " × " + t + " matches or beats the AIAG example (10 × 3 × 3)"
        : p + " × " + o + " × " + t + " is smaller than the AIAG example (10 × 3 × 3), which many customers treat as the minimum"),
      check(o >= 2 && t >= 2 ? "ok" : "warn", o >= 2 && t >= 2
        ? "Enough repeats to separate the gage's own scatter from operator differences"
        : "Needs at least 2 operators and 2 trials to separate gage scatter from operator differences"),
      check("info", "Each operator takes " + p * t + " readings; shuffle the part order every trial")
    ];
    if (sec !== null && isNaN(sec)) { checks.push(check("warn", "Seconds per reading must be a positive number")); }
    return { ok: true, value: n, unit: "readings", sub: p + " parts × " + o + " operators × " + t + " trials",
             time: time, checks: checks };
  }

  function attribute(i) {
    if (i.design === "analytic") {
      var lim = Number(i.limits) === 2 ? 2 : 1;
      return { ok: true, value: 8 * 20 * lim, unit: "checks", sub: 8 * lim + " reference parts × 20 checks each",
        checks: [
          check("info", 8 * lim + " parts with known values around " + (lim === 1 ? "the limit" : "each limit") + " (8 per limit), each checked 20 times"),
          check("info", "Only " + lim + (lim === 1 ? " part" : " parts") + " must be rejected every time: the one furthest beyond " + (lim === 1 ? "the limit" : "each limit")),
          check("ok", "Far fewer bad parts than a 50-part agreement study")
        ] };
    }
    var p = count(i.parts), o = count(i.appraisers), t = count(i.trials);
    if (!p || !o || !t) { return invalid("Enter whole numbers for parts, appraisers and trials."); }
    var full = p >= 50 && o >= 3 && t >= 3, mix = split(p);
    return { ok: true, value: p * o * t, unit: "judgements", sub: p + " parts × " + o + " appraisers × " + t + " trials",
      checks: [
        check(full ? "ok" : "warn", full
          ? p + " × " + o + " × " + t + " matches or beats the AIAG example (50 × 3 × 3)"
          : p + " × " + o + " × " + t + " is smaller than the AIAG example (50 × 3 × 3), which many customers treat as the minimum"),
        check("info", "You'll need about " + (mix[3].parts + mix[4].parts) + " out-of-spec parts, measured and labelled first")
      ],
      mix: mix };
  }

  function type1(i) {
    var n = count(i.readings), tol = positive(i.tolerance), res = positive(i.resolution);
    if (!n) { return invalid("Enter the number of readings as a whole number."); }
    var checks = [check(n >= 25 ? "ok" : "warn",
      n >= 50 ? "Meets Bosch's 50 readings" : n >= 25 ? "Meets Bosch's minimum of 25 (50 recommended)" : "Below Bosch's minimum of 25 readings")];
    var resolutionPct = null;
    if (tol && res && !isNaN(tol) && !isNaN(res)) {
      resolutionPct = 100 * res / tol;
      checks.push(check(resolutionPct <= 5 ? "ok" : "warn", "Resolution is " + (Math.round(resolutionPct * 10) / 10) +
        "% of the tolerance " + (resolutionPct <= 5 ? "(5% or finer needed)" : "(5% or finer needed: use a finer gage)")));
    } else if (isNaN(tol) || isNaN(res)) {
      checks.push(check("warn", "Tolerance and resolution must be positive numbers"));
    } else {
      checks.push(check("info", "Add the tolerance and gage resolution to check the 5% resolution rule"));
    }
    checks.push(check("info", "One operator, one reference part, loaded and unloaded between readings"));
    return { ok: true, value: n, unit: "readings", sub: "of one reference part", checks: checks, resolutionPct: resolutionPct };
  }

  function capability(i) {
    var k = count(i.subgroups), size = count(i.size), cav = count(i.cavities);
    if (!k || !size || !cav) { return invalid("Enter whole numbers for subgroups, parts per subgroup and cavities."); }
    var per = k * size;
    var checks = [
      check(k >= 25 ? "ok" : "warn", k >= 25 ? k + " subgroups: enough to set control limits and judge stability"
        : "Only " + k + " subgroups; 25 or more is the usual basis for control limits"),
      check(size >= 2 && size <= 25 ? "ok" : "warn", size >= 2 && size <= 25 ? "Subgroups of " + size + " work for an x̄–R chart"
        : "x̄–R charts need subgroups of 2 to 25"),
      per >= 125 ? check("ok", per + " readings per " + (cav > 1 ? "cavity" : "study") + ", at or above the common 25 × 5 = 125")
        : per >= 30 ? check("info", per + " readings per " + (cav > 1 ? "cavity" : "study") + ", below the common 25 × 5 = 125")
          : check("warn", "Only " + per + " readings per " + (cav > 1 ? "cavity" : "study") + "; fewer than 30 makes capability uncertain")
    ];
    if (cav > 1) {
      checks.push(check("info", "Judge each of the " + cav + " cavities on its own, and record the cavity with every reading"));
    }
    return { ok: true, value: per * cav, unit: cav > 1 ? "readings in all" : "readings",
             sub: k + " subgroups × " + size + " parts" + (cav > 1 ? " × " + cav + " cavities" : ""), checks: checks };
  }

  var REUSE_CHECKS = [
    "Same gage, fixture and measurement method as the original study",
    "Same type of feature, of a similar size, as the original part",
    "The study's parts cover the range the new part's process will produce",
    "Same location and conditions (temperature, operators, training)",
    "The gage hasn't been repaired, modified or re-programmed since"
  ];
  function reuse(answers) {
    var yes = 0, no = 0;
    REUSE_CHECKS.forEach(function (_, k) { if (answers[k] === true) { yes++; } else if (answers[k] === false) { no++; } });
    var state = no ? "new" : yes === REUSE_CHECKS.length ? "reuse" : "open";
    return { ok: true, value: yes + " / " + REUSE_CHECKS.length, unit: "confirmed", state: state,
      sub: state === "new" ? "A \"no\" usually means a new study" : state === "reuse"
        ? "Reasonable to propose reuse, with the evidence" : "Answer each question below",
      checks: [check(state === "new" ? "warn" : state === "reuse" ? "ok" : "info",
        state === "new" ? "Plan a new study for the new part, or ask the customer before reusing"
          : state === "reuse" ? "Recheck the verdict at the new part's tolerance before you submit"
            : (REUSE_CHECKS.length - yes - no) + " still to answer")] };
  }

  var api = { count: count, positive: positive, split: split, grr: grr, attribute: attribute, type1: type1,
              capability: capability, reuse: reuse, REUSE_CHECKS: REUSE_CHECKS, MIX: MIX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; } else { root.MensuroPlanner = api; }
})(this);
