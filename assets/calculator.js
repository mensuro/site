/* Mensuro free Cp/Cpk calculator: the page. All math is in cpk.js.
   Nothing on this page sends or stores the readings: no network requests, no storage. */
(function () {
  "use strict";
  var C = window.MensuroCpk;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("calc-form"), readingsEl = $("readings"), lslEl = $("lsl"), uslEl = $("usl"), sgEl = $("subgroup");
  var errorEl = $("calc-error"), countEl = $("count"), output = $("output"), empty = $("empty");
  var last = null;

  function decimalsOf(text) {
    var max = 0;
    String(text).split(/[\s,;]+/).forEach(function (t) {
      var m = /\.(\d+)/.exec(t);
      if (m && m[1].length > max) { max = m[1].length; }
    });
    return Math.min(max, 8);
  }

  function fixed(v, d) { return v == null ? "–" : v.toFixed(d); }
  function idx(v) { return v == null ? "–" : v.toFixed(2); }
  function ppm(v) {
    if (v == null) { return "–"; }
    if (v === 0) { return "0"; }
    if (v < 0.01) { return "< 0.01"; }
    if (v < 100) { return v.toFixed(v < 1 ? 3 : 1); }
    return Math.round(v).toLocaleString("en-US");
  }

  function updateCount() {
    try {
      var n = C.parseReadings(readingsEl.value).length;
      countEl.textContent = n === 0 ? "No readings yet" : n + (n === 1 ? " reading" : " readings");
    } catch (e) {
      countEl.textContent = "Some entries aren't numbers";
    }
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function calculate() {
    errorEl.hidden = true;
    try {
      var values = C.parseReadings(readingsEl.value);
      var size = Number(sgEl.value || "1");
      var idxChoice = form.querySelector('input[name="index"]:checked').value;
      var res = C.capability({
        values: values,
        subgroupSize: size,
        lsl: C.parseLimit(lslEl.value, "lower spec limit"),
        usl: C.parseLimit(uslEl.value, "upper spec limit"),
        verdictIndex: idxChoice
      });
      last = { res: res, values: values, dec: decimalsOf(readingsEl.value + " " + lslEl.value + " " + uslEl.value) };
      render();
      // On narrow screens the results sit below the form; bring them into view.
      var box = $("results");
      if (window.innerWidth < 900 && box.getBoundingClientRect().top > window.innerHeight * 0.6) {
        var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        box.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      }
    } catch (e) {
      if (e && e.name === "CalcError") { showError(e.message); } else { showError("Something went wrong with that data. Check the readings and limits."); }
    }
  }

  function render() {
    var r = last.res, d = last.dec;
    empty.hidden = true;
    output.hidden = false;
    var pill = $("vpill");
    pill.textContent = r.verdict.verdict;
    pill.className = "vpill vpill-" + r.verdict.key;
    $("vreason").textContent = r.verdict.reason + " Based on PPAP-style criteria; your customer's limits apply if different.";
    $("ppk").textContent = idx(r.overall.cpk);
    $("pp").textContent = idx(r.overall.cp);
    $("cpk").textContent = idx(r.within ? r.within.cpk : null);
    $("cp").textContent = idx(r.within ? r.within.cp : null);

    var w = r.within, o = r.overall;
    var rows = [
      ["Readings", r.subgroups ? r.n + " (" + r.subgroups + " subgroups of " + r.subgroupSize + ")" : String(r.n)],
      ["Mean", fixed(r.mean, d + 1)],
      ["Min / max", fixed(r.min, d) + " / " + fixed(r.max, d)],
      ["LSL / USL", (r.lsl == null ? "none" : fixed(r.lsl, d)) + " / " + (r.usl == null ? "none" : fixed(r.usl, d))],
      ["Sigma, overall (s)", fixed(o.sigma, d + 2)],
      ["Sigma, within", w ? fixed(w.sigma, d + 2) + " · " + r.withinMethod : "–"],
      ["Ppl / Ppu", idx(o.cpl) + " / " + idx(o.cpu)],
      ["Cpl / Cpu", w ? idx(w.cpl) + " / " + idx(w.cpu) : "–"],
      ["Expected PPM, overall", ppm(o.ppmTotal) + "  (below " + ppm(o.ppmBelow) + ", above " + ppm(o.ppmAbove) + ")"],
      ["Expected PPM, within", w ? ppm(w.ppmTotal) : "–"],
      ["Observed PPM", ppm(r.ppmObserved) + "  (" + r.outside + " of " + r.n + " outside the limits)"],
      ["Normality (Anderson-Darling)", r.normality ? "A² = " + r.normality.a2.toFixed(3) + ", p = " +
        (r.normality.p < 0.001 ? "< 0.001" : r.normality.p.toFixed(3)) : "not checked (fewer than 8 readings)"]
    ];
    var tbody = $("stats");
    tbody.textContent = "";
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      var th = document.createElement("th"); th.scope = "row"; th.textContent = row[0];
      var td = document.createElement("td"); td.textContent = row[1];
      tr.appendChild(th); tr.appendChild(td); tbody.appendChild(tr);
    });

    var notes = $("notes");
    notes.textContent = "";
    r.notes.forEach(function (n) { var li = document.createElement("li"); li.textContent = n; notes.appendChild(li); });
    notes.hidden = r.notes.length === 0;
    drawHistogram(r, d);
    $("copied").textContent = "";
  }

  // ---------------------------------------------------------------- histogram

  var NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) { e.setAttribute(k, attrs[k]); }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function niceStep(span) {
    var raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  }

  function drawHistogram(r, d) {
    var svg = $("hist");
    var W = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 640), H = 260;
    var mL = 12, mR = 12, mT = 30, mB = 34;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    while (svg.lastChild && svg.lastChild.nodeName !== "title") { svg.removeChild(svg.lastChild); }

    var values = last.values;
    var s = r.overall.sigma, m = r.mean;
    var lo = Math.min(r.min, m - 3.5 * s), hi = Math.max(r.max, m + 3.5 * s);
    if (r.lsl != null) { lo = Math.min(lo, r.lsl); }
    if (r.usl != null) { hi = Math.max(hi, r.usl); }
    var pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
    var x = function (v) { return mL + (v - lo) / (hi - lo) * (W - mL - mR); };

    var k = Math.max(5, Math.min(25, Math.round(Math.sqrt(r.n))));
    var bw = (r.max - r.min) / k;
    var counts = new Array(k).fill(0);
    values.forEach(function (v) { counts[Math.min(k - 1, Math.floor((v - r.min) / bw))]++; });
    var pdfPeak = r.n * bw / (s * Math.sqrt(2 * Math.PI));
    var top = Math.max(Math.max.apply(null, counts), pdfPeak) * 1.08;
    var y = function (c) { return H - mB - c / top * (H - mT - mB); };

    counts.forEach(function (c, i) {
      if (!c) { return; }
      var x0 = x(r.min + i * bw), x1 = x(r.min + (i + 1) * bw);
      svg.appendChild(el("rect", { x: x0 + 0.5, y: y(c), width: Math.max(1, x1 - x0 - 1), height: H - mB - y(c), "class": "h-bar" }));
    });

    var dPath = "";
    for (var i = 0; i <= 160; i++) {
      var v = lo + (hi - lo) * i / 160;
      var c = pdfPeak * Math.exp(-0.5 * Math.pow((v - m) / s, 2));
      dPath += (i ? "L" : "M") + x(v).toFixed(1) + " " + y(c).toFixed(1);
    }
    svg.appendChild(el("path", { d: dPath, "class": "h-curve" }));
    svg.appendChild(el("line", { x1: mL, x2: W - mR, y1: H - mB, y2: H - mB, "class": "h-axis" }));

    var step = niceStep(hi - lo), td = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    for (var t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) {
      svg.appendChild(el("line", { x1: x(t), x2: x(t), y1: H - mB, y2: H - mB + 4, "class": "h-axis" }));
      svg.appendChild(el("text", { x: x(t), y: H - mB + 18, "text-anchor": "middle", "class": "h-tick" }, t.toFixed(td)));
    }

    function marker(v, label, cls, anchor) {
      svg.appendChild(el("line", { x1: x(v), x2: x(v), y1: mT - 8, y2: H - mB, "class": cls }));
      svg.appendChild(el("text", { x: x(v) + (anchor === "end" ? -4 : anchor === "start" ? 4 : 0), y: mT - 12,
        "text-anchor": anchor, "class": "h-label" }, label));
    }
    marker(m, "Mean " + m.toFixed(d + 1), "h-mean", "middle");
    if (r.lsl != null) { marker(r.lsl, "LSL " + r.lsl.toFixed(d), "h-spec", "start"); }
    if (r.usl != null) { marker(r.usl, "USL " + r.usl.toFixed(d), "h-spec", "end"); }
  }

  // ----------------------------------------------------------------- copy

  function summaryText() {
    var r = last.res;
    var lines = ["Process capability (Mensuro free calculator)",
      "Verdict: " + r.verdict.verdict + ". " + r.verdict.reason,
      "Ppk " + idx(r.overall.cpk) + " | Pp " + idx(r.overall.cp) + " | Cpk " + idx(r.within ? r.within.cpk : null) + " | Cp " + idx(r.within ? r.within.cp : null)];
    Array.prototype.forEach.call($("stats").rows, function (row) { lines.push(row.cells[0].textContent + ": " + row.cells[1].textContent); });
    r.notes.forEach(function (n) { lines.push("Note: " + n); });
    lines.push("Method: Montgomery, Introduction to SQC 6th ed.; NIST/SEMATECH e-Handbook 6.1.6. Verdict: PPAP-style criteria.");
    return lines.join("\n");
  }

  $("copy").addEventListener("click", function () {
    var done = function () { $("copied").textContent = "Copied"; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(summaryText()).then(done, function () { $("copied").textContent = "Copy failed; select the table instead."; });
    } else {
      $("copied").textContent = "Copy isn't available in this browser.";
    }
  });

  // ---------------------------------------------------------------- wiring

  form.addEventListener("submit", function (e) { e.preventDefault(); calculate(); });
  readingsEl.addEventListener("input", function () { updateCount(); $("example-label").hidden = true; });
  Array.prototype.forEach.call(form.querySelectorAll('input[name="index"]'), function (radio) {
    radio.addEventListener("change", function () { if (last) { calculate(); } });
  });
  $("load-example").addEventListener("click", function () {
    readingsEl.value = C.EXAMPLE.readings.join("\n");
    lslEl.value = C.EXAMPLE.lsl;
    uslEl.value = C.EXAMPLE.usl;
    sgEl.value = String(C.EXAMPLE.subgroupSize);
    var label = $("example-label");
    label.textContent = "Example data: " + C.EXAMPLE.label + ".";
    label.hidden = false;
    updateCount();
    calculate();
  });
  $("clear").addEventListener("click", function () {
    form.reset();
    last = null;
    output.hidden = true;
    empty.hidden = false;
    errorEl.hidden = true;
    $("example-label").hidden = true;
    updateCount();
    readingsEl.focus();
  });
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (last && !output.hidden) { drawHistogram(last.res, last.dec); } }, 150);
  });
  updateCount();
})();
