/* Mensuro free Cp/Cpk calculator: the math.
   Runs entirely in the browser; nothing here sends data anywhere.
   The same file is loaded by tests/cpk.test.js, which checks it against published reference
   results (NIST/SEMATECH, Montgomery) and against the Mensuro engine (scipy/statsmodels).

   Definitions:
   - Within sigma (Cp, Cpk): R-bar / d2 for subgroups, MR-bar / 1.128 for individual readings
     (Montgomery, Introduction to SQC 6th ed., Sections 6.2 and 8.3; d2 from Appendix VI).
   - Overall sigma (Pp, Ppk): sample standard deviation, n - 1.
   - Cp = (USL - LSL) / 6 sigma; Cpk = min(USL - mean, mean - LSL) / 3 sigma (NIST e-Handbook 6.1.6).
   - Expected PPM assumes a normal distribution. Normality: Anderson-Darling with the
     D'Agostino-Stephens small-sample adjustment and p-value (same as statsmodels normal_ad).
   - Verdict: PPAP-style initial process study criteria on Ppk (or Cpk): above 1.67 acceptable,
     1.33 to 1.67 conditionally acceptable, below 1.33 not acceptable. */
(function (root) {
  "use strict";

  // d2 for subgroup sizes 2-25 (Montgomery 6th ed., Appendix VI)
  var D2 = {
    2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078,
    11: 3.173, 12: 3.258, 13: 3.336, 14: 3.407, 15: 3.472, 16: 3.532, 17: 3.588, 18: 3.640,
    19: 3.689, 20: 3.735, 21: 3.778, 22: 3.819, 23: 3.858, 24: 3.895, 25: 3.931
  };
  var D2_MOVING_RANGE = 1.128;
  var MINIMUM = 1.33;
  var TARGET = 1.67;

  function CalcError(message) { this.name = "CalcError"; this.message = message; }
  CalcError.prototype = Object.create(Error.prototype);

  /* Standard normal CDF, double precision in both tails (tails matter for PPM).
     |z| < 2: Hart (1968) algorithm 5666, as given by G. West, "Better approximations to
     cumulative normal functions", Wilmott (2005), Fig. 2.
     |z| >= 2: Laplace's continued fraction for the Mills ratio, 300 terms.
     Checked against scipy to 1e-12 relative from z = -9 to 9 in the tests. */
  function normCdf(x) {
    var xabs = Math.abs(x), e = Math.exp(-xabs * xabs / 2), b, c;
    if (xabs > 38) {
      c = 0;
    } else if (xabs < 2) {
      b = 3.52624965998911e-2 * xabs + 0.700383064443688;
      b = b * xabs + 6.37396220353165;
      b = b * xabs + 33.912866078383;
      b = b * xabs + 112.079291497871;
      b = b * xabs + 221.213596169931;
      b = b * xabs + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * xabs + 1.75566716318264;
      b = b * xabs + 16.064177579207;
      b = b * xabs + 86.7807322029461;
      b = b * xabs + 296.564248779674;
      b = b * xabs + 637.333633378831;
      b = b * xabs + 793.826512519948;
      b = b * xabs + 440.413735824752;
      c = c / b;
    } else {
      b = xabs;
      for (var k = 300; k >= 1; k--) { b = xabs + k / b; }
      c = e / b / 2.5066282746310002; // sqrt(2 pi)
    }
    return x > 0 ? 1 - c : c;
  }
  function normSf(x) { return normCdf(-x); }

  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) { s += a[i]; } return s / a.length; }
  function sampleSd(a, m) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (a.length - 1));
  }

  /* Split pasted text into readings. Accepts numbers separated by new lines, tabs, spaces,
     commas or semicolons (a column or row pasted from Excel). Decimal mark must be a period. */
  function parseReadings(text) {
    var tokens = String(text || "").split(/[\s,;]+/).filter(function (t) { return t !== ""; });
    var values = [];
    for (var i = 0; i < tokens.length; i++) {
      var v = Number(tokens[i]);
      if (!isFinite(v) || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tokens[i])) {
        throw new CalcError("“" + tokens[i] + "” (entry " + (i + 1) + ") isn't a number. Paste readings only, " +
          "without headers, and use a period as the decimal mark.");
      }
      values.push(v);
    }
    return values;
  }

  function parseLimit(text, name) {
    var t = String(text == null ? "" : text).trim();
    if (t === "") { return null; }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
      throw new CalcError("The " + name + " isn't a number. Use a period as the decimal mark.");
    }
    return Number(t);
  }

  function indicesFromSummary(m, sigma, lsl, usl) {
    var cpu = usl != null ? (usl - m) / (3 * sigma) : null;
    var cpl = lsl != null ? (m - lsl) / (3 * sigma) : null;
    var zU = usl != null ? (usl - m) / sigma : null;
    var zL = lsl != null ? (lsl - m) / sigma : null;
    var above = zU != null ? normSf(zU) * 1e6 : null;
    var below = zL != null ? normCdf(zL) * 1e6 : null;
    var sides = [cpu, cpl].filter(function (x) { return x != null; });
    return {
      sigma: sigma,
      cp: usl != null && lsl != null ? (usl - lsl) / (6 * sigma) : null,
      cpk: Math.min.apply(null, sides),
      cpu: cpu,
      cpl: cpl,
      zUsl: zU,
      zLsl: zL,
      ppmAbove: above,
      ppmBelow: below,
      ppmTotal: (above || 0) + (below || 0)
    };
  }

  /* Anderson-Darling normality test (estimated mean and sigma), as statsmodels normal_ad. */
  function andersonDarling(values) {
    var n = values.length, m = mean(values), s = sampleSd(values, m);
    var z = values.map(function (v) { return (v - m) / s; }).sort(function (a, b) { return a - b; });
    var sum = 0;
    for (var i = 0; i < n; i++) {
      sum += (2 * (i + 1) - 1) * (Math.log(normCdf(z[i])) + Math.log(normSf(z[n - 1 - i])));
    }
    var a2 = -n - sum / n;
    var a2a = a2 * (1 + 0.75 / n + 2.25 / (n * n));
    var p;
    if (a2a >= 0.6) { p = Math.exp(1.2937 - 5.709 * a2a + 0.0186 * a2a * a2a); }
    else if (a2a > 0.34) { p = Math.exp(0.9177 - 4.279 * a2a - 1.38 * a2a * a2a); }
    else if (a2a > 0.2) { p = 1 - Math.exp(-8.318 + 42.796 * a2a - 59.938 * a2a * a2a); }
    else { p = 1 - Math.exp(-13.436 + 101.14 * a2a - 223.73 * a2a * a2a); }
    return { a2: a2, a2Adjusted: a2a, p: p };
  }

  function classify(index, value) {
    var v = value.toFixed(2);
    if (value > TARGET) {
      return { verdict: "Acceptable", key: "pass", reason: index + " is " + v + ", above 1.67." };
    }
    if (value >= MINIMUM) {
      return { verdict: "Conditionally acceptable", key: "cond",
        reason: index + " is " + v + ", between 1.33 and 1.67. The process may be acceptable with customer approval." };
    }
    if (v === "1.33") { v = value.toFixed(3); }
    return { verdict: "Not acceptable", key: "fail", reason: index + " is " + v + ", below the 1.33 minimum." };
  }

  /* Full capability study.
     opts: { values: number[], subgroupSize: 1 (individuals) or 2-25, lsl, usl, verdictIndex: "Ppk" | "Cpk" } */
  function capability(opts) {
    var values = opts.values || [];
    var size = opts.subgroupSize || 1;
    var lsl = opts.lsl == null ? null : opts.lsl;
    var usl = opts.usl == null ? null : opts.usl;
    var index = opts.verdictIndex || "Ppk";

    if (lsl == null && usl == null) { throw new CalcError("Enter at least one specification limit (lower, upper, or both)."); }
    if (lsl != null && usl != null && !(lsl < usl)) { throw new CalcError("The lower specification limit must be below the upper one."); }
    for (var k = 0; k < values.length; k++) {
      if (typeof values[k] !== "number" || !isFinite(values[k])) { throw new CalcError("Some readings are blank or not numbers."); }
    }
    if (size !== 1 && !(size >= 2 && size <= 25 && Math.floor(size) === size)) {
      throw new CalcError("Subgroup size must be 1 (individual readings) or a whole number from 2 to 25.");
    }
    var n = values.length;
    if (n < 2) { throw new CalcError("Enter at least 2 readings; 30 or more are recommended."); }

    var notes = [];
    var sigmaWithin, withinMethod, k2 = null;
    if (size === 1) {
      var mr = 0;
      for (var i = 1; i < n; i++) { mr += Math.abs(values[i] - values[i - 1]); }
      sigmaWithin = (mr / (n - 1)) / D2_MOVING_RANGE;
      withinMethod = "MR-bar / d2, moving range of 2 consecutive readings (d2 = 1.128)";
    } else {
      if (n % size !== 0) {
        throw new CalcError(n + " readings don't divide into subgroups of " + size + ". Each subgroup must be complete, in order.");
      }
      k2 = n / size;
      if (k2 < 2) { throw new CalcError("Enter at least 2 subgroups."); }
      var rsum = 0;
      for (var g = 0; g < k2; g++) {
        var sub = values.slice(g * size, (g + 1) * size);
        rsum += Math.max.apply(null, sub) - Math.min.apply(null, sub);
      }
      sigmaWithin = (rsum / k2) / D2[size];
      withinMethod = "R-bar / d2, " + k2 + " subgroups of " + size + " (d2 = " + D2[size].toFixed(3) + ")";
    }

    var m = mean(values);
    var sOverall = sampleSd(values, m);
    if (sOverall === 0) { throw new CalcError("Every reading is identical, so capability can't be computed. Check the gage resolution."); }
    if (n < 30) { notes.push("Only " + n + " readings. Capability estimated from fewer than 30 readings is uncertain."); }

    var overall = indicesFromSummary(m, sOverall, lsl, usl);
    var within = sigmaWithin > 0 ? indicesFromSummary(m, sigmaWithin, lsl, usl) : null;
    if (!within) { notes.push("Within-subgroup variation is zero, so Cp and Cpk are not shown."); }

    var outside = 0;
    for (var j = 0; j < n; j++) {
      if ((lsl != null && values[j] < lsl) || (usl != null && values[j] > usl)) { outside++; }
    }

    var ad = null;
    if (n >= 8) {
      ad = andersonDarling(values);
      if (ad.p < 0.05) {
        notes.push("The data may not be normal (Anderson-Darling p = " + ad.p.toFixed(3) + "). The indices and " +
          "expected PPM assume a normal distribution, so treat them with caution.");
      }
    } else {
      notes.push("Normality isn't checked with fewer than 8 readings.");
    }

    if (index === "Cpk" && !within) { throw new CalcError("Cpk can't be used for the verdict because within-subgroup variation is zero."); }
    var indexValue = index === "Cpk" ? within.cpk : overall.cpk;

    return {
      n: n,
      subgroupSize: size,
      subgroups: k2,
      mean: m,
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      lsl: lsl,
      usl: usl,
      within: within,
      overall: overall,
      withinMethod: withinMethod,
      ppmObserved: outside / n * 1e6,
      outside: outside,
      normality: ad,
      verdictIndex: index,
      verdict: classify(index, indexValue),
      notes: notes
    };
  }

  // Example for the "Load example" button: simulated bore diameter (mm), 20 subgroups of 5,
  // generated with numpy (seed 42). tests/cpk.test.js checks it against the engine.
  var EXAMPLE = {
    label: "Simulated bore diameter (mm), 20 subgroups of 5",
    subgroupSize: 5,
    lsl: "11.975",
    usl: "12.035",
    readings: [
      "12.009", "11.997", "12.013", "12.014", "11.988", "11.994", "12.007", "12.003", "12.006", "11.998",
      "12.014", "12.013", "12.007", "12.016", "12.010", "11.998", "12.009", "11.997", "12.014", "12.006",
      "12.004", "12.000", "12.017", "12.005", "12.002", "12.003", "12.011", "12.009", "12.010", "12.010",
      "12.025", "12.002", "12.001", "11.999", "12.012", "12.016", "12.005", "11.998", "11.999", "12.012",
      "12.013", "12.011", "12.000", "12.008", "12.007", "12.008", "12.014", "12.008", "12.012", "12.007",
      "12.009", "12.012", "11.993", "12.003", "12.002", "12.000", "12.004", "12.019", "11.998", "12.015",
      "11.991", "12.003", "12.007", "12.011", "12.012", "12.013", "12.003", "12.002", "12.014", "12.004",
      "11.995", "11.996", "11.998", "12.010", "12.007", "12.012", "12.002", "12.007", "12.012", "12.003",
      "12.010", "12.000", "12.003", "12.003", "11.995", "12.010", "12.002", "12.006", "12.010", "12.010",
      "12.012", "12.005", "12.002", "12.005", "11.991", "11.993", "11.994", "11.997", "12.010", "11.998"
    ]
  };

  var api = {
    EXAMPLE: EXAMPLE,
    CalcError: CalcError,
    D2: D2,
    normCdf: normCdf,
    normSf: normSf,
    parseReadings: parseReadings,
    parseLimit: parseLimit,
    indicesFromSummary: indicesFromSummary,
    andersonDarling: andersonDarling,
    classify: classify,
    capability: capability
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; } else { root.MensuroCpk = api; }
})(this);
