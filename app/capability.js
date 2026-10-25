/* Mensuro capability study (private preview): column mapping, results and the PDF report.
   Built on core.js. Every number shown comes from the API (the tested engine); this script
   only counts rows for the live mapping check, bins readings for the histogram and draws charts. */
(function () {
  "use strict";

  var M = MensuroCore({
    onInspected: function (res) { applyGuess(res.guess.capability); renderMap(); },
    assign: function (role, col) { assign(role, col); },
    drawCharts: function () { drawCharts(); }
  });
  var $ = M.$, $$ = M.$$, esc = M.esc, NUM = M.NUM, SUMMARY = M.SUMMARY;
  var fmt = M.fmt, fmtFixed = M.fmtFixed, fmtP = M.fmtP, plural = M.plural, parseNum = M.parseNum;
  var setStep = M.setStep, showError = M.showError, handleAuth = M.handleAuth, api = M.api, disarm = M.disarm;
  var PREVIEW_ROWS = 40;
  var S = M.S;
  S.layout = "column";
  S.col = { value: null, subgroup: null, group: false, size: 5 };
  S.rows = { cols: {}, label: null };

  function applyGuess(g) {
    S.layout = g.suggested;
    S.col = { value: g.column.value, subgroup: g.column.subgroup, group: false, size: 5 };
    S.rows = { cols: {}, label: null };
    if (g.rows) {
      g.rows.columns.forEach(function (c) { S.rows.cols[c] = true; });
      S.rows.label = g.rows.label;
    }
  }

  // ----------------------------------------------------------------- mapping
  var LABELS = { column: { value: "Readings", subgroup: "Subgroup" }, rows: { value: "Reading", subgroup: "Subgroup label" } };
  function roleOf(col) {
    if (S.layout === "column") { return S.col.value === col ? "value" : (S.col.subgroup === col ? "subgroup" : null); }
    return S.rows.cols[col] ? "value" : (S.rows.label === col ? "subgroup" : null);
  }
  function tint(role) { return role === "subgroup" ? "part" : role; }
  function readingCols() { return Object.keys(S.rows.cols).map(Number).filter(function (k) { return S.rows.cols[k]; }).sort(function (a, b) { return a - b; }); }

  function assign(role, col) {
    if (S.layout === "column") {
      if (S.col.value === col) { S.col.value = null; }
      if (S.col.subgroup === col) { S.col.subgroup = null; }
      if (role === "value") { S.col.value = col; } else if (role === "subgroup") { S.col.subgroup = col; S.col.group = false; }
    } else {
      delete S.rows.cols[col];
      if (S.rows.label === col) { S.rows.label = null; }
      if (role === "value") { S.rows.cols[col] = true; } else if (role === "subgroup") { S.rows.label = col; }
    }
    renderMap();
  }

  function renderPalette() {
    var p = $("#palette"), html = '<span class="hint">Roles:</span>';
    ["value", "subgroup"].forEach(function (r) {
      var placed = S.layout === "column" ? S.col[r] != null : (r === "value" ? readingCols().length > 0 : S.rows.label != null);
      html += '<button type="button" class="role' + (placed && !(S.layout === "rows" && r === "value") ? " placed" : "") + (S.armed === r ? " armed" : "") + '" data-role="' + r + '" aria-pressed="' + (S.armed === r) + '" style="--c: var(--role-' + (r === "value" ? "value" : "part") + ')">' +
        esc(LABELS[S.layout][r]) + (r === "subgroup" ? ' <span class="opt">optional</span>' : "") + "</button>";
    });
    if (S.layout === "column") {
      var disabled = S.col.subgroup != null;
      html += '<label class="group-size"><input type="checkbox" id="group-on"' + (S.col.group && !disabled ? " checked" : "") + (disabled ? " disabled" : "") + '> Group consecutive readings into subgroups of ' +
        '<input id="group-n" inputmode="numeric" value="' + esc(S.col.size) + '"' + (disabled ? " disabled" : "") + ' aria-label="Readings per subgroup"></label>';
      html += '<span class="hint">' + (disabled ? "Subgroups come from the subgroup column." : "Leave unticked for individual readings in time order.") + "</span>";
    } else {
      html += '<span class="hint">Mark every column that holds a reading. Each row is one subgroup.</span>';
    }
    p.innerHTML = html;
    $$(".role", p).forEach(M.bindDrag);
    var on = $("#group-on"), n = $("#group-n");
    if (on) {
      on.addEventListener("change", function () { S.col.group = on.checked; renderTable(); renderCheck(); });
      n.addEventListener("input", function () { S.col.size = n.value.trim(); if (S.col.group) { renderCheck(); } });
    }
  }

  function colHeadControl(c) {
    var role = roleOf(c.index);
    var opts = [["", "Not used"], ["value", LABELS[S.layout].value], ["subgroup", LABELS[S.layout].subgroup]];
    return '<select data-col="' + c.index + '" aria-label="Role of column ' + esc(c.name) + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + ((role || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
  }

  function rowTags(row, extra) {
    return [row[0]].concat(extra).filter(function (t) { return t && !NUM.test(t); });
  }

  function renderTable() {
    var i = S.insp, cols = i.columns;
    var html = '<table class="preview"><thead><tr><th class="rn" scope="col">Row</th>';
    cols.forEach(function (c) {
      var r = roleOf(c.index);
      html += '<th scope="col" class="droppable" data-col="' + c.index + '"' + (r ? ' data-r="' + tint(r) + '"' : "") + '><div class="colhead"><span class="cn"><em>' + esc(c.letter) + "</em>" + esc(c.name) + "</span>" + colHeadControl(c) + "</div></th>";
    });
    html += "</tr></thead><tbody>";
    var shown = Math.min(PREVIEW_ROWS, i.rows.length);
    for (var r = 0; r < shown; r++) {
      var row = i.rows[r], skip;
      if (S.layout === "column") { skip = rowTags(row, [S.col.subgroup != null ? row[S.col.subgroup] : "", S.col.value != null ? row[S.col.value] : ""]).some(function (t) { return SUMMARY.test(t); }); }
      else { skip = rowTags(row, [S.rows.label != null ? row[S.rows.label] : ""]).some(function (t) { return SUMMARY.test(t); }); }
      html += '<tr><td class="rn">' + i.row_numbers[r] + "</td>";
      cols.forEach(function (c) {
        var v = row[c.index], role = roleOf(c.index), cls = [];
        if (NUM.test(v)) { cls.push("n"); }
        if (skip) { cls.push("skip"); } else if (role === "value" && v !== "" && !NUM.test(v)) { cls.push("bad"); }
        html += "<td" + (role ? ' data-r="' + tint(role) + '"' : "") + (cls.length ? ' class="' + cls.join(" ") + '"' : "") + ">" + esc(v) + "</td>";
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
    var values = [], skipped = [], bad = [], missing = [], groups = [], index = {};

    if (S.layout === "column") {
      var C = S.col;
      if (C.value == null) { item("todo", "Choose the readings column"); return out; }
      i.rows.forEach(function (row, n) {
        var v = row[C.value], lab = C.subgroup != null ? row[C.subgroup] : null, num = i.row_numbers[n];
        if (v === "" && (C.subgroup == null || lab === "")) { return; }
        var tags = rowTags(row, [lab || "", v]);
        var sum = tags.filter(function (t) { return SUMMARY.test(t); })[0];
        if (sum) { skipped.push(sum); return; }
        if (!NUM.test(v)) { bad.push({ row: num, v: v }); }
        if (C.subgroup != null) {
          if (lab === "") { missing.push(num); return; }
          if (!(lab in index)) { index[lab] = groups.length; groups.push({ label: lab, n: 0 }); }
          groups[index[lab]].n += 1;
        }
        values.push({ row: num, v: v, g: lab });
      });
      if (C.group && C.subgroup == null) {
        var size = Number(C.size);
        if (!(size >= 2 && size <= 25 && Math.floor(size) === size)) { item("err", "Readings per subgroup must be a whole number from 2 to 25"); }
        else if (values.length % size) { item("err", values.length + " readings don't split into subgroups of " + size + ": " + (values.length % size) + " left over"); }
        else { for (var g = 0; g < values.length / size; g++) { groups.push({ label: String(g + 1), n: size }); } values.forEach(function (x, k) { x.g = String(Math.floor(k / size) + 1); }); }
      }
    } else {
      var cols = readingCols(), L = S.rows.label;
      if (cols.length < 2) { item("todo", "Mark at least 2 reading columns (one per reading in a subgroup)"); return out; }
      i.rows.forEach(function (row, n) {
        var cells = cols.map(function (c) { return row[c]; }), num = i.row_numbers[n];
        if (cells.every(function (c) { return c === ""; })) { return; }
        var lab = L != null ? row[L] : "";
        var sum = rowTags(row, [lab]).filter(function (t) { return SUMMARY.test(t); })[0];
        if (sum) { skipped.push(sum); return; }
        var label = lab || String(groups.length + 1);
        groups.push({ label: label, n: cells.length });
        cells.forEach(function (v) { if (!NUM.test(v)) { bad.push({ row: num, v: v }); } values.push({ row: num, v: v, g: label }); });
      });
    }

    var N = values.length, K = groups.length;
    if (missing.length) { item("err", "Row " + missing[0] + " has a reading but no subgroup" + (missing.length > 1 ? " (and " + plural(missing.length - 1, "more row") + ")" : "")); }
    if (K) {
      var sizes = {};
      groups.forEach(function (g) { sizes[g.n] = (sizes[g.n] || 0) + 1; });
      var keys = Object.keys(sizes).map(Number);
      if (keys.length > 1) {
        var common = keys.sort(function (a, b) { return sizes[b] - sizes[a]; })[0];
        var odd = groups.filter(function (g) { return g.n !== common; })[0];
        item("err", "Subgroups have different sizes: most have " + common + ", but subgroup " + odd.label + " has " + odd.n);
      } else if (keys[0] < 2) {
        item("err", "Each subgroup has only 1 reading. Untick grouping or clear the subgroup column to treat them as individual readings.");
      } else if (keys[0] > 25) {
        item("err", "Subgroups of " + keys[0] + " readings are too big for an x̄–R chart (2 to 25)");
      } else {
        out.big = K + " subgroups × " + keys[0] + " readings";
        if (K < 2) { item("err", "At least 2 subgroups are needed"); }
        else { item("ok", "Every subgroup has " + keys[0] + " readings"); }
        if (K >= 2 && K < 20) { item("warn", "Only " + K + " subgroups; control limits are usually based on 20 to 25."); }
      }
    } else if (N) {
      out.big = N + " individual readings";
      item("ok", "Within variation from moving ranges of consecutive readings");
    }
    out.sub = plural(N, "reading");
    if (bad.length) { item("err", plural(bad.length, "reading") + (bad.length === 1 ? " isn't a number" : " aren't numbers") + ": row " + bad[0].row + (bad[0].v ? " has '" + bad[0].v + "'" : " is blank")); }
    else if (N) { item("ok", "All " + N + " readings are numbers"); }
    if (N && N < 30) { item("warn", "Only " + N + " readings; 30 or more give a more reliable estimate (100 is common)."); }
    if (skipped.length) { item("warn", "Skipping summary " + (skipped.length === 1 ? "row" : "rows") + ": " + skipped.filter(function (s, n) { return skipped.indexOf(s) === n; }).join(", ")); }
    if (i.truncated) { item("warn", "Checked the first " + i.rows.length + " rows here; the server checks all " + i.row_count + "."); }
    out.readout = values.slice(0, 3).map(function (x) {
      return "Row " + x.row + (x.g ? " → subgroup <b>" + esc(x.g) + "</b> · " : " → ") + "<b>" + esc(x.v || "blank") + "</b>";
    });
    if (!N && out.ok) { item("err", "No readings found in that column"); }
    return out;
  }

  function renderCheck() {
    var s = summarize(), box = $("#check");
    var html = s.big ? '<div class="big">' + esc(s.big) + "<small>" + esc(s.sub) + "</small></div>"
      : '<div class="big">Almost there<small>Map the columns to see what Mensuro will read</small></div>';
    html += "<ul>" + s.items.map(function (it) { return '<li class="' + (it.cls === "ok" ? "" : it.cls) + '">' + esc(it.text) + "</li>"; }).join("") + "</ul>";
    if (s.readout.length) { html += '<div class="readout"><span>How Mensuro reads it:</span>' + s.readout.map(function (r) { return "<span>" + r + "</span>"; }).join("") + "</div>"; }
    box.innerHTML = html;
    $("#to-settings").disabled = !s.ok;
    S.summary = s;
  }

  function renderMap() {
    M.renderFilebar();
    $$('input[name="layout"]').forEach(function (r) { r.checked = r.value === S.layout; });
    renderPalette();
    renderTable();
    renderCheck();
  }
  $$('input[name="layout"]').forEach(function (r) {
    r.addEventListener("change", function () { if (r.checked) { S.layout = r.value; disarm(); renderMap(); } });
  });
  $("#back-upload").addEventListener("click", function () { setStep(1); });
  $("#to-settings").addEventListener("click", function () {
    $("#settings-summary").textContent = S.summary.big + " · " + S.file.name;
    setStep(3);
  });

  // ---------------------------------------------------------------- settings
  $("#back-map").addEventListener("click", function () { setStep(2); });

  function readSettings() {
    var lsl = parseNum($("#lsl").value), usl = parseNum($("#usl").value);
    if (Number.isNaN(lsl) || Number.isNaN(usl)) { throw new Error("The spec limits must be numbers."); }
    if (lsl == null && usl == null) { throw new Error("Enter at least one spec limit."); }
    if (lsl != null && usl != null && usl <= lsl) { throw new Error("The upper spec limit must be above the lower one."); }
    return { lsl: lsl, usl: usl, unit: $("#unit").value.trim() || null, verdict_index: $('input[name="vindex"]:checked').value };
  }

  function mappingBody() {
    if (S.layout === "column") {
      return { layout: "column", value: S.col.value, subgroup: S.col.subgroup, subgroup_size: S.col.group && S.col.subgroup == null ? Number(S.col.size) : null };
    }
    return { layout: "rows", columns: readingCols(), label: S.rows.label };
  }

  $("#run").addEventListener("click", function () {
    var settings;
    showError($("#run-error"), "");
    try { settings = readSettings(); } catch (err) { showError($("#run-error"), err.message); return; }
    $("#run").disabled = true; $("#run-busy").hidden = false;
    api("POST", "/v1/capability/analyze", { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: settings })
      .then(function (res) {
        S.result = res; S.settings = settings;
        setStep(4);
        renderResults();
      }, function (err) {
        if (!handleAuth(err)) { showError($("#run-error"), err.message); }
      })
      .then(function () { $("#run").disabled = false; $("#run-busy").hidden = true; });
  });

  // ------------------------------------------------------------------ charts
  var niceTicks = M.niceTicks, mark = M.mark;

  function histogram(r, W) {
    var vals = r.readings, n = vals.length, H = Math.round(Math.min(320, Math.max(240, W * 0.4))), L = 44, R = 16, T = 30, B = 36;
    var lo = Math.min(r.min, r.lsl != null ? r.lsl : r.min), hi = Math.max(r.max, r.usl != null ? r.usl : r.max);
    var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var bins = Math.max(6, Math.min(30, Math.ceil(Math.sqrt(n)) + 2));
    var w = (r.max - r.min) / bins || 1, b0 = r.min, counts = new Array(bins).fill(0);
    vals.forEach(function (v) { var k = Math.min(bins - 1, Math.floor((v - b0) / w)); counts[k] += 1; });
    var sigma = r.overall.sigma, peak = n * w / (sigma * Math.sqrt(2 * Math.PI));
    var ymax = Math.max(Math.max.apply(null, counts), peak) * 1.12;
    var sx = function (v) { return L + (W - L - R) * (v - lo) / (hi - lo); }, sy = function (c) { return T + (H - T - B) * (1 - c / ymax); };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Histogram of the readings with the specification limits and fitted normal curves">';
    niceTicks(0, ymax, 4).forEach(function (t) { if (t > ymax) { return; } svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" stroke="#EDF1F5"/><text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + t + "</text>"; });
    niceTicks(lo, hi, Math.max(4, Math.round(W / 110))).forEach(function (t) { if (t < lo || t > hi) { return; } svg += '<text class="tick" x="' + sx(t) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + fmt(t, 6) + "</text>"; });
    counts.forEach(function (c, k) {
      if (!c) { return; }
      var x0 = sx(b0 + k * w), x1 = sx(b0 + (k + 1) * w);
      svg += '<rect x="' + (x0 + 0.5).toFixed(1) + '" y="' + sy(c).toFixed(1) + '" width="' + Math.max(1, x1 - x0 - 1).toFixed(1) + '" height="' + (sy(0) - sy(c)).toFixed(1) + '" fill="#237E71" fill-opacity=".72"/>';
    });
    function curve(sd, dash, color) {
      var d = "", steps = 120;
      for (var k = 0; k <= steps; k++) {
        var x = lo + (hi - lo) * k / steps, z = (x - r.mean) / sd, y = n * w * Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
        d += (k ? "L" : "M") + sx(x).toFixed(1) + " " + sy(y).toFixed(1);
      }
      return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8"' + (dash ? ' stroke-dasharray="5 4"' : "") + "/>";
    }
    svg += curve(r.overall.sigma, false, "#14263D");
    if (r.within) { svg += curve(r.within.sigma, true, "#3B6FB6"); }
    svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(0) + '" y2="' + sy(0) + '" stroke="#9AA7B8"/>';
    [[r.lsl, "LSL"], [r.usl, "USL"]].forEach(function (s) {
      if (s[0] == null) { return; }
      svg += '<line x1="' + sx(s[0]) + '" x2="' + sx(s[0]) + '" y1="' + (T - 8) + '" y2="' + sy(0) + '" stroke="#B42318" stroke-width="1.6"/><text class="tick" x="' + sx(s[0]) + '" y="' + (T - 12) + '" text-anchor="middle" style="fill:#B42318;font-weight:600">' + s[1] + " " + fmt(s[0], 6) + "</text>";
    });
    svg += '<line x1="' + sx(r.mean) + '" x2="' + sx(r.mean) + '" y1="' + T + '" y2="' + sy(0) + '" stroke="#14263D" stroke-dasharray="3 3"/>';
    svg += "</svg>";
    return svg + '<div class="legend"><span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="#237E71" fill-opacity=".72"/></svg>Your readings</span>' +
      '<span><svg width="16" height="12" aria-hidden="true"><line x1="0" x2="16" y1="6" y2="6" stroke="#14263D" stroke-width="2"/></svg>Normal curve, overall (Pp, Ppk)</span>' +
      (r.within ? '<span><svg width="16" height="12" aria-hidden="true"><line x1="0" x2="16" y1="6" y2="6" stroke="#3B6FB6" stroke-width="2" stroke-dasharray="4 3"/></svg>Within (Cp, Cpk)</span>' : "") +
      '<span><svg width="12" height="12" aria-hidden="true"><line x1="6" x2="6" y1="0" y2="12" stroke="#B42318" stroke-width="2"/></svg>Spec limits</span></div>';
  }

  function controlChart(r, kind, W) {
    var ch = r.chart, lim = kind === "range" ? ch.r : ch.xbar, pts = ch.points;
    var vals = pts.map(function (p) { return kind === "range" ? p.range : p.mean; });
    var H = 220, L = 50, R = 92, T = 12, B = 30;
    var lo = Math.min(Math.min.apply(null, vals), lim.lcl), hi = Math.max(Math.max.apply(null, vals), lim.ucl), pad = (hi - lo) * 0.1 || 1;
    if (kind === "range") { lo = Math.min(0, lo); }
    var ticks = niceTicks(kind === "range" ? lo : lo - pad, hi + pad, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var sy = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var sx = function (k) { return L + (W - L - R) * (k + 0.5) / pts.length; };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + (kind === "range" ? "Range" : "Average") + ' chart of the subgroups with control limits">';
    ticks.forEach(function (t) { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" stroke="#EDF1F5"/><text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + fmt(t, 6) + "</text>"; });
    var lines = [[lim.ucl, "UCL", "#B42318", "5 4"], [lim.center, kind === "range" ? "R̄" : "X̿", "#14263D", ""]];
    if (lim.lcl > 0 || kind === "average") { lines.push([lim.lcl, "LCL", "#B42318", "5 4"]); }
    var ly = lines.map(function (l) { return sy(l[0]) + 4; });
    for (var q = 1; q < ly.length; q++) { if (ly[q] - ly[q - 1] < 13) { ly[q] = ly[q - 1] + 13; } }
    lines.forEach(function (l, q) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(l[0]) + '" y2="' + sy(l[0]) + '" stroke="' + l[2] + '" stroke-width="1.2"' + (l[3] ? ' stroke-dasharray="' + l[3] + '"' : "") + "/>";
      svg += '<text class="tick" x="' + (W - R + 6) + '" y="' + ly[q] + '" style="fill:' + l[2] + ';font-weight:600">' + l[1] + " " + fmt(l[0], 5) + "</text>";
    });
    var d = "";
    vals.forEach(function (v, k) { d += (k ? "L" : "M") + sx(k).toFixed(1) + " " + sy(v).toFixed(1); });
    svg += '<path d="' + d + '" fill="none" stroke="#237E71" stroke-width="1.4"/>';
    pts.forEach(function (p, k) {
      var sig = kind === "range" ? p.range_signal : p.mean_signal;
      svg += mark("circle", sx(k), sy(vals[k]), sig ? 4.2 : 3, sig ? "#B42318" : "#237E71");
    });
    var step = Math.ceil(pts.length / Math.max(4, Math.floor((W - L - R) / 34)));
    pts.forEach(function (p, k) { if (k % step === 0) { svg += '<text class="tick" x="' + sx(k) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + esc(p.subgroup) + "</text>"; } });
    return svg + "</svg>";
  }

  function drawCharts() {
    var r = S.result;
    $$("#s-results [data-chart]").forEach(function (el) {
      var W = Math.max(300, Math.round(el.clientWidth || 560)), k = el.dataset.chart;
      el.innerHTML = k === "hist" ? histogram(r, W) : controlChart(r, k, W);
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
    var r = S.result, v = r.verdict, o = r.overall, w = r.within, unit = S.settings.unit ? " " + S.settings.unit : "";
    var html = "";
    html += '<section class="panel" aria-labelledby="res-title"><div class="row spread"><div class="head"><span class="eyebrow">Capability · verdict on ' + esc(v.index) + '</span><h2 id="res-title">Results</h2></div>' +
      '<span class="hint">' + esc(S.file.name) + (S.sheet ? " · " + esc(S.sheet) : "") + "</span></div>";
    html += '<div class="verdict ' + v.key + '"><div><span class="pill ' + v.key + '">' + esc(v.label) + "</span><ul>" +
      v.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div><div class="headline"><div class="v">' + fmtFixed(v.value, 2) + "</div><small>" + esc(v.index) + "</small></div></div>";
    var oneSided = r.lsl == null || r.usl == null;
    html += '<div class="kpis">' +
      kpi("Ppk", fmtFixed(o.cpk, 2), "overall (long-term)") +
      kpi("Pp", fmtFixed(o.cp, 2), oneSided ? "needs both spec limits" : "overall, spread only") +
      kpi("Cpk", w ? fmtFixed(w.cpk, 2) : "–", "within (short-term)") +
      kpi("Cp", w ? fmtFixed(w.cp, 2) : "–", oneSided ? "needs both spec limits" : "within, spread only") + "</div>";
    var notes = r.notes.concat(r.receipt.notes);
    if (r.chart && r.chart.signals.length) { notes = notes.concat(r.chart.signals); }
    if (notes.length) { html += '<div class="hint" style="display:flex;flex-direction:column;gap:4px">' + notes.map(function (n) { return "<span>• " + esc(n) + "</span>"; }).join("") + "</div>"; }
    html += "</section>";

    html += '<section class="panel" aria-labelledby="ch-title"><h3 id="ch-title">Charts</h3>';
    html += '<div class="chart"><h3>Distribution against the spec</h3><div data-chart="hist"></div></div>';
    if (r.chart) {
      html += '<div class="charts2"><div class="chart"><h3>x̄ chart (subgroup averages)</h3><div data-chart="average"></div></div>' +
        '<div class="chart"><h3>R chart (subgroup ranges)</h3><div data-chart="range"></div></div></div>' +
        '<p class="hint">' + (r.chart.in_control ? "No points outside the control limits: the process looks stable, so the capability numbers describe it fairly." : "Points outside the control limits (red) mean the process wasn't stable during the study; capability numbers from an unstable process can mislead.") + "</p>";
    }
    html += "</section>";

    var rows = [
      ["Readings", String(r.n) + (r.subgroups ? " (" + r.subgroups.k + " subgroups of " + r.subgroups.n + ")" : " (individual readings)")],
      ["Mean", fmt(r.mean, 6) + unit],
      ["Min / max", fmt(r.min, 6) + " / " + fmt(r.max, 6) + unit],
      ["LSL / USL", (r.lsl != null ? fmt(r.lsl, 8) : "none") + " / " + (r.usl != null ? fmt(r.usl, 8) : "none")],
      ["Overall sigma (s)", fmt(o.sigma, 4) + unit],
      ["Within sigma", w ? fmt(w.sigma, 4) + unit + " · " + (r.receipt.settings["within sigma"] || "") : "–"],
      ["Ppl / Ppu", fmtFixed(o.cpl, 2) + " / " + fmtFixed(o.cpu, 2)],
      ["Cpl / Cpu", w ? fmtFixed(w.cpl, 2) + " / " + fmtFixed(w.cpu, 2) : "–"],
      ["Expected PPM, overall", fmt(o.ppm_total, 3) + " (below " + fmt(o.ppm_below || 0, 3) + ", above " + fmt(o.ppm_above || 0, 3) + ")"],
      ["Expected PPM, within", w ? fmt(w.ppm_total, 3) : "–"],
      ["Observed PPM", fmt(r.ppm_observed, 3)],
      ["Normality (Anderson–Darling)", r.normality.ad != null ? "A² = " + fmtFixed(r.normality.ad, 3) + ", p = " + fmtP(r.normality.p) : "not tested (fewer than 8 readings)"]
    ];
    html += '<section class="panel" aria-labelledby="st-title"><h3 id="st-title">Statistics</h3><div class="scroll-x"><table class="num"><tbody>' +
      rows.map(function (x) { return "<tr><td>" + esc(x[0]) + "</td><td>" + esc(x[1]) + "</td></tr>"; }).join("") + "</tbody></table></div></section>";

    var rc = r.receipt;
    html += '<section class="panel" aria-labelledby="rc-title"><h3 id="rc-title">How this was calculated</h3><dl class="receipt">' +
      dd("Method", rc.method + " (" + rc.standard + ")") +
      dd("Sample", Object.keys(rc.sample).map(function (k) { return rc.sample[k] + " " + k; }).join(", ")) +
      dd("Constants", Object.keys(rc.constants).map(function (k) { return k + " = " + rc.constants[k]; }).join(", ")) +
      dd("Settings", Object.keys(rc.settings).map(function (k) { return k + " = " + (rc.settings[k] == null ? "none" : rc.settings[k]); }).join("; ")) +
      dd("Verdict rule", "PPAP-style criteria: above 1.67 acceptable, 1.33 to 1.67 acceptable with customer approval, below 1.33 not acceptable") +
      dd("Engine", "Mensuro engine " + rc.engine_version + ", checked against Montgomery's published capability examples") +
      "</dl></section>";

    html += M.reportPanel([
      { key: "part_number", label: "Part number", max: 80 },
      { key: "part_name", label: "Part name" },
      { key: "characteristic", label: "Characteristic", placeholder: "e.g. Bore diameter" },
      { key: "specification", label: "Specification", placeholder: specText() },
      { key: "gage", label: "Gage", placeholder: "Gage used for the readings" },
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
      path: "/v1/capability/report",
      body: function () { return { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: S.settings }; },
      filename: function (val) { return "Capability" + (val.part_number ? " " + M.safeName(val.part_number) : "") + (val.characteristic ? " " + M.safeName(val.characteristic) : "") + ".pdf"; }
    });

    function kpi(k, val, s) { return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(val) + '</div><div class="s">' + esc(s) + "</div></div>"; }
    function dd(k, val) { return "<dt>" + esc(k) + "</dt><dd>" + esc(val) + "</dd>"; }
  }

  M.start();
})();
