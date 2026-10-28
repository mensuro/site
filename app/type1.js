/* Mensuro Type 1 gage study (private preview): column mapping, results and the PDF report.
   Built on core.js. Every number shown comes from the API (the tested engine); this script
   only counts rows for the live mapping check, bins readings for the histogram and draws charts. */
(function () {
  "use strict";

  var M = MensuroCore({
    onInspected: function (res) { S.value = res.guess.capability.column.value; renderMap(); },
    assign: function (role, col) { assign(role, col); },
    drawCharts: function () { drawCharts(); }
  });
  var $ = M.$, $$ = M.$$, esc = M.esc, NUM = M.NUM, SUMMARY = M.SUMMARY;
  var fmt = M.fmt, fmtFixed = M.fmtFixed, fmtP = M.fmtP, plural = M.plural, parseNum = M.parseNum;
  var setStep = M.setStep, showError = M.showError, handleAuth = M.handleAuth, api = M.api, disarm = M.disarm;
  var PREVIEW_ROWS = 40;
  var S = M.S;
  S.value = null;

  // ----------------------------------------------------------------- mapping
  function assign(role, col) {
    if (S.value === col) { S.value = null; }
    if (role === "value") { S.value = col; }
    renderMap();
    if (role) { M.flash(col); }
  }

  function renderPalette() {
    var p = $("#palette");
    p.innerHTML = '<span class="hint">Role:</span><button type="button" class="role' + (S.value != null ? " placed" : "") + (S.armed === "value" ? " armed" : "") +
      '" data-role="value" aria-pressed="' + (S.armed === "value") + '">Readings</button><span class="hint">Pick the column with the repeated readings of the reference part, in the order they were taken.</span>';
    $$(".role", p).forEach(M.bindDrag);
  }

  function renderTable() {
    var i = S.insp, cols = i.columns;
    var html = '<table class="preview"><thead><tr><th class="rn" scope="col">Row</th>';
    cols.forEach(function (c) {
      var on = S.value === c.index;
      html += '<th scope="col" class="droppable" data-col="' + c.index + '"' + (on ? ' data-r="value"' : "") + '><div class="colhead"><span class="cn"><em>' + esc(c.letter) + "</em>" + esc(c.name) + "</span>" +
        '<select data-col="' + c.index + '" aria-label="Role of column ' + esc(c.name) + '"><option value="">Not used</option><option value="value"' + (on ? " selected" : "") + ">Readings</option></select></div></th>";
    });
    html += "</tr></thead><tbody>";
    var shown = Math.min(PREVIEW_ROWS, i.rows.length);
    for (var r = 0; r < shown; r++) {
      var row = i.rows[r];
      var skip = S.value != null && [row[0], row[S.value]].some(function (t) { return t && !NUM.test(t) && SUMMARY.test(t); });
      html += '<tr><td class="rn">' + i.row_numbers[r] + "</td>";
      cols.forEach(function (c) {
        var v = row[c.index], on = S.value === c.index, cls = [];
        if (NUM.test(v)) { cls.push("n"); }
        if (skip) { cls.push("skip"); } else if (on && v !== "" && !NUM.test(v)) { cls.push("bad"); }
        html += "<td" + (on ? ' data-r="value"' : "") + (cls.length ? ' class="' + cls.join(" ") + '"' : "") + ">" + esc(v) + "</td>";
      });
      html += "</tr>";
    }
    html += "</tbody></table>";
    if (i.rows.length > shown) { html += '<div class="more-rows">Showing the first ' + shown + " of " + plural(i.row_count, "row") + ". All of them are checked.</div>"; }
    var wrap = $("#table-wrap"), sx = wrap.scrollLeft, sy = wrap.scrollTop;
    wrap.innerHTML = html;
    wrap.scrollLeft = sx; wrap.scrollTop = sy;
    $$("select[data-col]", wrap).forEach(function (sel) {
      sel.addEventListener("change", function () { assign(sel.value || null, Number(sel.dataset.col)); });
    });
    M.bindHeaderTaps(wrap);
  }

  // Count what the mapping will produce (counting only; statistics come from the engine).
  function summarize() {
    var i = S.insp, out = { items: [], readout: [], ok: true, big: "", sub: "" };
    function item(cls, text) { out.items.push({ cls: cls, text: text }); if (cls === "err" || cls === "todo") { out.ok = false; } }
    if (S.value == null) { item("todo", "Choose the readings column"); return out; }
    var values = [], bad = [], skipped = [];
    i.rows.forEach(function (row, n) {
      var v = row[S.value], num = i.row_numbers[n];
      if (v === "") { return; }
      var sum = [row[0], v].filter(function (t) { return t && !NUM.test(t) && SUMMARY.test(t); })[0];
      if (sum) { skipped.push(sum); return; }
      if (!NUM.test(v)) { bad.push({ row: num, v: v }); }
      values.push({ row: num, v: v });
    });
    var N = values.length;
    out.big = plural(N, "reading");
    out.sub = "of one reference part";
    if (bad.length) { item("err", plural(bad.length, "reading") + (bad.length === 1 ? " isn't a number" : " aren't numbers") + ": row " + bad[0].row + " has '" + bad[0].v + "'"); }
    else if (N) { item("ok", "All " + N + " readings are numbers"); }
    if (N && N < 2) { item("err", "At least 2 readings are needed"); }
    else if (N && N < 25) { item("warn", "Booklet 10 asks for at least 25 readings (50 preferred); results from " + N + " are less certain."); }
    else if (N >= 25 && N < 50) { item("ok", N + " readings: meets the 25 minimum (50 preferred)"); }
    else if (N >= 50) { item("ok", N + " readings: meets the preferred 50"); }
    if (!N && out.ok) { item("err", "No readings found in that column"); }
    if (skipped.length) { item("warn", "Skipping summary " + (skipped.length === 1 ? "row" : "rows") + ": " + skipped.filter(function (s, n) { return skipped.indexOf(s) === n; }).join(", ")); }
    if (i.truncated) { item("warn", "Checked the first " + i.rows.length + " rows here; the server checks all " + i.row_count + "."); }
    out.readout = values.slice(0, 3).map(function (x) { return "Row " + x.row + " → <b>" + esc(x.v) + "</b>"; });
    return out;
  }

  function renderCheck() {
    var s = summarize(), box = $("#check");
    var html = s.big ? '<div class="big">' + esc(s.big) + "<small>" + esc(s.sub) + "</small></div>"
      : '<div class="big">Almost there<small>Pick the readings column to see what Mensuro will read</small></div>';
    html += "<ul>" + s.items.map(function (it) { return '<li class="' + (it.cls === "ok" ? "" : it.cls) + '">' + esc(it.text) + "</li>"; }).join("") + "</ul>";
    if (s.readout.length) { html += '<div class="readout"><span>How Mensuro reads it:</span>' + s.readout.map(function (r) { return "<span>" + r + "</span>"; }).join("") + "</div>"; }
    box.innerHTML = html;
    if (s.big && s.big !== S.lastBig) { M.replay($(".big", box), "m-pulse"); }
    S.lastBig = s.big;
    $("#to-settings").disabled = !s.ok;
    S.summary = s;
  }

  function renderMap() {
    M.renderFilebar();
    renderPalette();
    renderTable();
    renderCheck();
  }
  $("#back-upload").addEventListener("click", function () { setStep(1); });
  $("#to-settings").addEventListener("click", function () {
    $("#settings-summary").textContent = S.summary.big + " · " + S.file.name;
    setStep(3);
  });

  // ---------------------------------------------------------------- settings
  $("#back-map").addEventListener("click", function () { setStep(2); });

  function readSettings() {
    var v = {};
    [["reference", "#ref"], ["lsl", "#lsl"], ["usl", "#usl"], ["resolution", "#res"], ["natural_limit", "#nat"], ["calibration_uncertainty", "#cal"]].forEach(function (f) {
      var x = parseNum($(f[1]).value);
      if (Number.isNaN(x)) { throw new Error("The " + $("label[for='" + f[1].slice(1) + "']").textContent.replace(/\s*\(.*\)/, "").toLowerCase() + " must be a number."); }
      v[f[0]] = x;
    });
    if (v.reference == null) { throw new Error("Enter the reference value of the reference part (from its calibration certificate)."); }
    if (v.lsl == null && v.usl == null) { throw new Error("Enter at least one spec limit."); }
    if (v.lsl != null && v.usl != null && v.usl <= v.lsl) { throw new Error("The upper spec limit must be above the lower one."); }
    v.minimum = Number($("#minimum").value);
    v.unit = $("#unit").value.trim() || null;
    return v;
  }

  function mappingBody() { return { layout: "column", value: S.value }; }

  $("#run").addEventListener("click", function () {
    var settings;
    showError($("#run-error"), "");
    try { settings = readSettings(); } catch (err) { showError($("#run-error"), err.message); return; }
    $("#run").disabled = true; $("#run-busy").hidden = false; M.busy($("#s-settings"), true);
    api("POST", "/v1/type1/analyze", { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: settings })
      .then(function (res) {
        S.result = res; S.settings = settings;
        setStep(4);
        renderResults();
      }, function (err) {
        if (!handleAuth(err)) { showError($("#run-error"), err.message); }
      })
      .then(function () { $("#run").disabled = false; $("#run-busy").hidden = true; M.busy($("#s-settings"), false); });
  });

  // ------------------------------------------------------------------ charts
  var niceTicks = M.niceTicks, mark = M.mark;
  function pText(p) { return p != null && p < 0.001 ? "p < 0.001" : "p = " + fmtP(p); }

  // Readings in the order taken, against the reference value (and the mean).
  function runChart(r, W) {
    var vals = r.readings, n = vals.length, H = 260, L = 56, R = 104, T = 14, B = 30;
    var lo = Math.min(r.min, r.reference), hi = Math.max(r.max, r.reference), pad = (hi - lo) * 0.25 || Math.abs(r.reference) * 0.001 || 1;
    var ticks = niceTicks(lo - pad, hi + pad, 5), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var sx = function (k) { return L + (W - L - R) * (n === 1 ? 0.5 : k / (n - 1)); }, sy = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Readings in the order taken, with the reference value and the mean">';
    ticks.forEach(function (t) { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" stroke="#EDF1F5"/><text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + fmt(t, 6) + "</text>"; });
    var lines = [[r.reference, "Ref", "#B42318", "5 4"], [r.mean, "x̄", "#14263D", "2 3"]];
    var ly = lines.map(function (l) { return sy(l[0]) + 4; });
    if (Math.abs(ly[1] - ly[0]) < 13) { ly[1] = ly[0] + (ly[1] >= ly[0] ? 13 : -13); }
    lines.forEach(function (l, q) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(l[0]) + '" y2="' + sy(l[0]) + '" stroke="' + l[2] + '" stroke-width="1.3" stroke-dasharray="' + l[3] + '"/>';
      svg += '<text class="tick" x="' + (W - R + 6) + '" y="' + ly[q] + '" style="fill:' + l[2] + ';font-weight:600">' + l[1] + " " + fmt(l[0], 6) + "</text>";
    });
    var d = "";
    vals.forEach(function (v, k) { d += (k ? "L" : "M") + sx(k).toFixed(1) + " " + sy(v).toFixed(1); });
    svg += '<path class="draw" pathLength="1" d="' + d + '" fill="none" stroke="#237E71" stroke-width="1.3" stroke-opacity=".8"/>';
    vals.forEach(function (v, k) { svg += mark("circle", sx(k), sy(v), 2.6, "#237E71"); });
    var step = Math.ceil(n / Math.max(4, Math.floor((W - L - R) / 36)));
    for (var k = 0; k < n; k += step) { svg += '<text class="tick" x="' + sx(k) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + (k + 1) + "</text>"; }
    return svg + "</svg>" + '<div class="legend"><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="#237E71"/></svg>Readings, in order</span>' +
      '<span><svg width="16" height="12" aria-hidden="true"><line x1="0" x2="16" y1="6" y2="6" stroke="#B42318" stroke-width="2" stroke-dasharray="4 3"/></svg>Reference value</span>' +
      '<span><svg width="16" height="12" aria-hidden="true"><line x1="0" x2="16" y1="6" y2="6" stroke="#14263D" stroke-width="2" stroke-dasharray="2 3"/></svg>Mean</span></div>';
  }

  function histogram(r, W) {
    var vals = r.readings, H = 220, L = 40, R = 16, T = 24, B = 34;
    var lo = Math.min(r.min, r.reference), hi = Math.max(r.max, r.reference), pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
    // Bin on the distinct reading values when the gage resolution makes readings repeat.
    var distinct = vals.filter(function (v, k) { return vals.indexOf(v) === k; }).sort(function (a, b) { return a - b; });
    var counts = distinct.map(function (u) { return vals.filter(function (v) { return v === u; }).length; });
    var gap = distinct.length > 1 ? Math.min.apply(null, distinct.slice(1).map(function (u, k) { return u - distinct[k]; })) : (hi - lo) / 10;
    var sx = function (v) { return L + (W - L - R) * (v - lo) / (hi - lo); };
    var bw = Math.max(2, Math.min(28, (sx(distinct[0] + gap) - sx(distinct[0])) * 0.8));
    var ymax = Math.max.apply(null, counts) * 1.15, sy = function (c) { return T + (H - T - B) * (1 - c / ymax); };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="How often each reading occurred, with the reference value">';
    niceTicks(0, ymax, 4).forEach(function (t) { if (t > ymax || t !== Math.floor(t)) { return; } svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" stroke="#EDF1F5"/><text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + t + "</text>"; });
    niceTicks(lo, hi, Math.max(4, Math.round(W / 120))).forEach(function (t) { if (t < lo || t > hi) { return; } svg += '<text class="tick" x="' + sx(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + fmt(t, 6) + "</text>"; });
    distinct.forEach(function (u, k) {
      svg += '<rect class="bar" style="--i:' + k + '" x="' + (sx(u) - bw / 2).toFixed(1) + '" y="' + sy(counts[k]).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (sy(0) - sy(counts[k])).toFixed(1) + '" rx="2" fill="#237E71" fill-opacity=".75"/>';
    });
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(0) + '" y2="' + sy(0) + '" stroke="#9AA7B8"/>';
    svg += '<line x1="' + sx(r.reference) + '" x2="' + sx(r.reference) + '" y1="' + (T - 6) + '" y2="' + sy(0) + '" stroke="#B42318" stroke-width="1.5" stroke-dasharray="5 4"/><text class="tick" x="' + sx(r.reference) + '" y="' + (T - 10) + '" text-anchor="middle" style="fill:#B42318;font-weight:600">Ref</text>';
    return svg + "</svg>";
  }

  function drawCharts() {
    var r = S.result;
    $$("#s-results [data-chart]").forEach(function (el) {
      var W = Math.max(300, Math.round(el.clientWidth || 560));
      el.innerHTML = el.dataset.chart === "run" ? runChart(r, W) : histogram(r, W);
    });
  }

  // ----------------------------------------------------------------- results
  function specText() {
    var s = S.settings || {}, u = s.unit ? " " + s.unit : "";
    if (s.lsl != null && s.usl != null) { return fmt(s.lsl, 8) + " to " + fmt(s.usl, 8) + u; }
    if (s.lsl != null) { return "Min " + fmt(s.lsl, 8) + u; }
    if (s.usl != null) { return "Max " + fmt(s.usl, 8) + u; }
    return "";
  }

  function renderResults() {
    var r = S.result, v = r.verdict, bt = r.bias_test, unit = S.settings.unit ? " " + S.settings.unit : "";
    var html = '<section class="panel" aria-labelledby="res-title"><div class="row spread"><div class="head"><span class="eyebrow">Type 1 gage study · Bosch Booklet No. 10</span><h2 id="res-title">Results</h2></div>' +
      '<span class="hint">' + esc(S.file.name) + (S.sheet ? " · " + esc(S.sheet) : "") + "</span></div>";
    if (v) {
      html += '<div class="verdict ' + v.key + '"><div><span class="pill ' + v.key + '">' + esc(v.label) + "</span><ul>" +
        v.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div><div class="headline"><div class="v">' + fmtFixed(r.cgk, 2) + "</div><small>Cgk · minimum " + fmtFixed(v.minimum, 2) + "</small></div></div>";
    } else {
      html += '<div class="verdict info"><div><span class="pill info">No Cg / Cgk</span><ul><li>With one spec limit and no natural limit, Cg and Cgk can\'t be calculated (Booklet 10, Appendix C.3).</li>' +
        (r.acceptance_limit ? "<li>" + esc(r.acceptance_limit.text) + "</li>" : "") + "</ul></div></div>";
    }
    html += '<div class="kpis">' +
      kpi("Cg", r.cg != null ? fmtFixed(r.cg, 2) : "–", r.cg_interval ? "95% CI " + fmtFixed(r.cg_interval[0], 2) + " – " + fmtFixed(r.cg_interval[1], 2) : "repeatability") +
      kpi("Cgk", r.cgk != null ? fmtFixed(r.cgk, 2) : "–", r.cgk_interval ? "95% CI " + fmtFixed(r.cgk_interval[0], 2) + " – " + fmtFixed(r.cgk_interval[1], 2) : "repeatability and bias") +
      kpi("Bias", fmt(r.bias, 4) + unit, bt.significant ? "significant (" + pText(bt.p) + ")" : "not significant (" + pText(bt.p) + ")") +
      kpi("Resolution", r.pct_resolution != null ? fmtFixed(r.pct_resolution, 2) + "%" : "–", r.pct_resolution != null ? "of the tolerance (limit 5%)" : "enter the gage resolution to check it") +
      "</div>";
    var notes = r.notes.concat(r.receipt.notes);
    if (notes.length) { html += '<div class="hint" style="display:flex;flex-direction:column;gap:4px">' + notes.map(function (n) { return "<span>• " + esc(n) + "</span>"; }).join("") + "</div>"; }
    html += "</section>";

    html += '<section class="panel" aria-labelledby="ch-title"><h3 id="ch-title">Charts</h3>' +
      '<div class="chart"><h3>Readings in order</h3><div data-chart="run"></div><p class="note">Look for drift or jumps: a trend means the gage or the setup changed during the study.</p></div>' +
      '<div class="chart"><h3>Distribution of the readings</h3><div data-chart="hist"></div></div></section>';

    var rows = [
      ["Readings", String(r.n)],
      ["Reference value", fmt(r.reference, 8) + unit],
      ["Mean / standard deviation", fmt(r.mean, 6) + " / " + fmt(r.s, 4) + unit],
      ["Min / max", fmt(r.min, 6) + " / " + fmt(r.max, 6) + unit],
      ["LSL / USL", (r.lsl != null ? fmt(r.lsl, 8) : "none") + " / " + (r.usl != null ? fmt(r.usl, 8) : "none")],
      ["Tolerance used", r.tolerance != null ? fmt(r.tolerance, 6) + unit + " (" + r.tolerance_basis + ")" : r.tolerance_basis],
      ["Bias (mean − reference)", fmt(r.bias, 4) + unit],
      ["Bias test", "|bias| / s = " + fmtFixed(bt.ratio, 3) + " vs " + fmtFixed(bt.criterion, 3) + " (t-test, α = " + bt.alpha + ", " + pText(bt.p) + ")"],
      ["Smallest tolerance for this gage", r.t_min_cgk != null ? fmt(r.t_min_cgk, 4) + unit + " (Cgk), " + fmt(r.t_min_cg, 4) + unit + " (Cg)" + (r.t_min_resolution != null ? ", " + fmt(r.t_min_resolution, 4) + unit + " (resolution)" : "") : "–"]
    ];
    if (r.acceptance_limit) { rows.push(["Acceptance limit", r.acceptance_limit.text]); }
    html += '<section class="panel" aria-labelledby="st-title"><h3 id="st-title">Statistics</h3><div class="scroll-x"><table class="num"><tbody>' +
      rows.map(function (x) { return "<tr><td>" + esc(x[0]) + "</td><td>" + esc(x[1]) + "</td></tr>"; }).join("") + "</tbody></table></div></section>";

    var rc = r.receipt;
    html += '<section class="panel" aria-labelledby="rc-title"><h3 id="rc-title">How this was calculated</h3><dl class="receipt">' +
      dd("Method", rc.method + " (" + rc.standard + ")") +
      dd("Formulas", "Cg = 0.2·T / (6·s); Cgk = (0.1·T − |x̄ − reference|) / (3·s)") +
      dd("Sample", Object.keys(rc.sample).map(function (k) { return rc.sample[k] + " " + k; }).join(", ")) +
      dd("Settings", Object.keys(rc.settings).map(function (k) { return k + " = " + (rc.settings[k] == null ? "none" : rc.settings[k]); }).join("; ")) +
      dd("Verdict rule", "Capable when Cg and Cgk are both at least the required minimum; resolution at most 5% of the tolerance (5–10% only if no finer gage is available)") +
      dd("Engine", "Mensuro engine " + rc.engine_version + ", checked against the Bosch Booklet No. 10 worked examples") +
      "</dl></section>";

    html += M.reportPanel([
      { key: "part_number", label: "Reference part / number", max: 80 },
      { key: "part_name", label: "Part name" },
      { key: "characteristic", label: "Characteristic", placeholder: "e.g. Outer diameter" },
      { key: "specification", label: "Specification", placeholder: specText() },
      { key: "gage", label: "Gage", placeholder: "Name and ID of the gage" },
      { key: "customer", label: "Customer" },
      { key: "company", label: "Your company" },
      { key: "prepared_by", label: "Prepared by", max: 80 },
      { key: "study_id", label: "Study ID", max: 60 }
    ]);
    html += '<div class="row spread"><span class="row"><button type="button" class="btn btn-ghost" id="res-map">← Columns</button><button type="button" class="btn btn-ghost" id="res-settings">Settings</button></span>' +
      '<button type="button" class="btn btn-dark" id="res-new">New study</button></div>';

    $("#s-results").innerHTML = html;
    drawCharts();
    $("#res-map").addEventListener("click", function () { setStep(2); });
    $("#res-settings").addEventListener("click", function () { setStep(3); });
    $("#res-new").addEventListener("click", function () { S.file = null; S.insp = null; S.result = null; setStep(1); });
    M.bindReport({
      path: "/v1/type1/report",
      body: function () { return { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: S.settings }; },
      filename: function (val) { return "Type 1" + (val.part_number ? " " + M.safeName(val.part_number) : "") + (val.characteristic ? " " + M.safeName(val.characteristic) : "") + ".pdf"; }
    });

    function kpi(k, val, s) { return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(val) + '</div><div class="s">' + esc(s) + "</div></div>"; }
    function dd(k, val) { return "<dt>" + esc(k) + "</dt><dd>" + esc(val) + "</dd>"; }
  }

  M.start();
})();
