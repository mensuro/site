/* Mensuro Gage R&R (private preview): column mapping, results and the PDF report.
   Built on core.js. Every number shown comes from the API (the tested engine); this script
   only counts rows for the live mapping check and draws charts. */
(function () {
  "use strict";

  var M = MensuroCore({
    onInspected: function (res) { applyGuess(res.guess); renderMap(); },
    assign: function (role, col) { assign(role, col); },
    drawCharts: function () { drawCharts(); }
  });
  var $ = M.$, $$ = M.$$, esc = M.esc, NUM = M.NUM, SUMMARY = M.SUMMARY;
  var fmt = M.fmt, fmtFixed = M.fmtFixed, fmtP = M.fmtP, plural = M.plural, parseNum = M.parseNum;
  var setStep = M.setStep, showError = M.showError, handleAuth = M.handleAuth, api = M.api, disarm = M.disarm;
  var ROLES = { part: "Part", operator: "Operator", trial: "Trial", value: "Measurement" };
  var PREVIEW_ROWS = 40;
  var S = M.S;
  S.layout = "long";
  S.long = { part: null, operator: null, trial: null, value: null };
  S.wide = { part: null, cols: {} };

  function applyGuess(g) {
    S.layout = g.suggested;
    S.long = { part: g.long.part, operator: g.long.operator, trial: g.long.trial, value: g.long.value };
    S.wide = { part: null, cols: {} };
    if (g.wide) {
      S.wide.part = g.wide.part;
      g.wide.readings.forEach(function (r) { S.wide.cols[r.column] = { use: true, operator: r.operator, trial: String(r.trial) }; });
    } else {
      var first = S.insp.columns.filter(function (c) { return !c.numeric; })[0];
      S.wide.part = first ? first.index : 0;
      S.insp.columns.forEach(function (c) { if (c.numeric && c.index !== S.wide.part) { S.wide.cols[c.index] = { use: true, operator: "", trial: "" }; } });
    }
  }

  // ----------------------------------------------------------------- mapping
  function roleOf(col) {
    if (S.layout === "long") {
      for (var k in S.long) { if (S.long[k] === col) { return k; } }
      return null;
    }
    if (S.wide.part === col) { return "part"; }
    var w = S.wide.cols[col];
    return w && w.use ? "value" : null;
  }

  function assign(role, col) {
    if (S.layout === "long") {
      Object.keys(S.long).forEach(function (k) { if (S.long[k] === col) { S.long[k] = null; } });
      if (role) { S.long[role] = col; }
    } else if (role === "part") {
      if (S.wide.cols[col]) { S.wide.cols[col].use = false; }
      S.wide.part = col;
    } else if (role === "value") {
      if (S.wide.part === col) { S.wide.part = null; }
      var c = S.wide.cols[col] || (S.wide.cols[col] = { use: true, operator: "", trial: "" });
      c.use = true;
    } else {
      if (S.wide.part === col) { S.wide.part = null; }
      if (S.wide.cols[col]) { S.wide.cols[col].use = false; }
    }
    renderMap();
    if (role) { M.flash(col); }
  }

  function renderPalette() {
    var p = $("#palette"), html = '<span class="hint">Roles:</span>';
    var list = S.layout === "long" ? ["part", "operator", "trial", "value"] : ["part", "value"];
    list.forEach(function (r) {
      var placed = S.layout === "long" ? S.long[r] != null : (r === "part" && S.wide.part != null);
      var label = S.layout === "wide" && r === "value" ? "Reading" : ROLES[r];
      html += '<button type="button" class="role' + (placed ? " placed" : "") + (S.armed === r ? " armed" : "") + '" data-role="' + r + '" aria-pressed="' + (S.armed === r) + '">' +
        esc(label) + (r === "trial" ? ' <span class="opt">optional</span>' : "") + "</button>";
    });
    html += S.layout === "wide"
      ? '<span class="hint">Under each reading column, set the operator and trial.</span>'
      : '<span class="hint">No trial column? Leave it out and readings are numbered in order.</span>';
    p.innerHTML = html;
    $$(".role", p).forEach(M.bindDrag);
  }

  function colHeadControl(c) {
    var role = roleOf(c.index), id = "col-" + c.index;
    var opts;
    if (S.layout === "long") {
      opts = [["", "Not used"], ["part", "Part"], ["operator", "Operator"], ["trial", "Trial"], ["value", "Measurement"]];
    } else {
      opts = [["", "Not used"], ["part", "Part"], ["value", "Reading"]];
    }
    var html = '<select id="' + id + '" data-col="' + c.index + '" aria-label="Role of column ' + esc(c.name) + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + ((role || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
    if (S.layout === "wide" && role === "value") {
      var w = S.wide.cols[c.index];
      var known = operatorList();
      html += '<div class="pair"><select data-op="' + c.index + '" aria-label="Operator for column ' + esc(c.name) + '">' +
        (w.operator ? "" : '<option value="" selected>Operator</option>') +
        known.map(function (o) { return '<option value="' + esc(o) + '"' + (o === w.operator ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") +
        '<option value="__new">New operator…</option></select>' +
        '<select data-trial="' + c.index + '" aria-label="Trial for column ' + esc(c.name) + '"><option value="">Trial</option>';
      for (var t = 1; t <= 25; t++) { html += '<option value="' + t + '"' + (String(w.trial) === String(t) ? " selected" : "") + ">T" + t + "</option>"; }
      html += "</select></div>";
    }
    return html;
  }

  function renderTable() {
    var i = S.insp, cols = i.columns;
    var html = '<table class="preview"><thead><tr><th class="rn" scope="col">Row</th>';
    cols.forEach(function (c) {
      var r = roleOf(c.index);
      html += '<th scope="col" class="droppable" data-col="' + c.index + '"' + (r ? ' data-r="' + r + '"' : "") + '><div class="colhead"><span class="cn"><em>' + esc(c.letter) + "</em>" + esc(c.name) + "</span>" + colHeadControl(c) + "</div></th>";
    });
    html += "</tr></thead><tbody>";
    var shown = Math.min(PREVIEW_ROWS, i.rows.length);
    var partCol = S.layout === "long" ? S.long.part : S.wide.part;
    for (var r = 0; r < shown; r++) {
      var row = i.rows[r];
      var skip = partCol != null && SUMMARY.test(row[partCol] || "") && (S.layout === "wide" || S.long.operator == null || !row[S.long.operator]);
      html += '<tr><td class="rn">' + i.row_numbers[r] + "</td>";
      cols.forEach(function (c) {
        var v = row[c.index], role = roleOf(c.index), cls = [];
        if (NUM.test(v)) { cls.push("n"); }
        if (skip) { cls.push("skip"); }
        else if (role === "value" && v !== "" && !NUM.test(v)) { cls.push("bad"); }
        else if (role === "value" && v === "" && (S.layout === "long" ? rowHasRoles(row) : row[partCol])) { cls.push("bad"); }
        html += "<td" + (role ? ' data-r="' + role + '"' : "") + (cls.length ? ' class="' + cls.join(" ") + '"' : "") + ">" + (v === "" && cls.indexOf("bad") >= 0 ? "blank" : esc(v)) + "</td>";
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
    $$("select[data-op]", wrap).forEach(function (sel) {
      sel.addEventListener("change", function () {
        var col = S.wide.cols[sel.dataset.op];
        col.operator = sel.value === "__new" ? nextOperatorName() : sel.value;
        renderMap();
      });
    });
    $$("select[data-trial]", wrap).forEach(function (sel) {
      sel.addEventListener("change", function () { S.wide.cols[sel.dataset.trial].trial = sel.value; renderMap(); });
    });
    M.bindHeaderTaps(wrap);
  }

  // Operators used in reading columns, in column order.
  function operatorList() {
    var out = [];
    Object.keys(S.wide.cols).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
      var o = S.wide.cols[k].operator;
      if (S.wide.cols[k].use && o && out.indexOf(o) < 0) { out.push(o); }
    });
    return out;
  }
  // A new operator gets the next free letter (A, B, C, ...); rename it in the side panel.
  function nextOperatorName() {
    var used = operatorList();
    for (var i = 0; i < 26; i++) { var n = String.fromCharCode(65 + i); if (used.indexOf(n) < 0) { return n; } }
    return "Operator " + (used.length + 1);
  }

  function rowHasRoles(row) {
    return ["part", "operator", "trial", "value"].some(function (k) { return S.long[k] != null && row[S.long[k]] !== ""; });
  }

  // Count what the mapping will produce, so problems show up before running.
  // (Counting only; every statistic comes from the engine.)
  function summarize() {
    var i = S.insp, out = { items: [], readout: [], ok: true, big: "", sub: "" };
    function item(cls, text) { out.items.push({ cls: cls, text: text }); if (cls === "err" || cls === "todo") { out.ok = false; } }
    var records = [], skipped = [], bad = [], missing = [];

    if (S.layout === "long") {
      var L = S.long;
      ["part", "operator", "value"].forEach(function (k) { if (L[k] == null) { item("todo", "Choose the " + ROLES[k].toLowerCase() + " column"); } });
      if (!out.ok) { return out; }
      i.rows.forEach(function (row, n) {
        if (!rowHasRoles(row)) { return; }
        var part = row[L.part], op = row[L.operator], v = row[L.value];
        if (SUMMARY.test(part) && !op) { skipped.push(part); return; }
        if (!part || !op) { missing.push(i.row_numbers[n]); return; }
        if (!NUM.test(v)) { bad.push({ row: i.row_numbers[n], v: v }); }
        records.push({ row: i.row_numbers[n], part: part, op: op, trial: L.trial != null ? row[L.trial] : null, v: v });
      });
    } else {
      var W = S.wide, used = [];
      if (W.part == null) { item("todo", "Choose the part column"); }
      Object.keys(W.cols).forEach(function (k) { var c = W.cols[k]; if (c.use) { used.push({ col: Number(k), op: c.operator, trial: c.trial }); } });
      used.sort(function (a, b) { return a.col - b.col; });
      if (used.length < 4) { item("todo", "Mark at least 4 reading columns (2 operators × 2 trials)"); }
      var unset = used.filter(function (u) { return !u.op || !u.trial; });
      if (unset.length) { item("todo", "Set the operator and trial for " + plural(unset.length, "reading column")); }
      var seen = {}, dup = null;
      used.forEach(function (u) { var key = u.op + "\u0000" + u.trial; if (u.op && u.trial) { if (seen[key]) { dup = u; } seen[key] = 1; } });
      if (dup) { item("err", "Two columns are both operator " + dup.op + ", trial " + dup.trial); }
      if (!out.ok) { return out; }
      var trialsBy = {};
      used.forEach(function (u) { (trialsBy[u.op] = trialsBy[u.op] || []).push(Number(u.trial)); });
      var sets = Object.keys(trialsBy).map(function (o) { return trialsBy[o].sort(function (a, b) { return a - b; }).join(", "); });
      if (sets.some(function (s) { return s !== sets[0]; })) {
        item("err", "Operators have different trials: " + Object.keys(trialsBy).map(function (o) { return o + " (" + trialsBy[o].join(", ") + ")"; }).join(", "));
        return out;
      }
      var partSeen = {};
      i.rows.forEach(function (row, n) {
        var part = row[W.part];
        if (!part) {
          if (used.some(function (u) { return row[u.col] !== ""; })) { missing.push(i.row_numbers[n]); }
          return;
        }
        if (SUMMARY.test(part)) { skipped.push(part); return; }
        partSeen[part] = (partSeen[part] || 0) + 1;
        used.forEach(function (u) {
          var v = row[u.col];
          if (!NUM.test(v)) { bad.push({ row: i.row_numbers[n], v: v }); }
          records.push({ row: i.row_numbers[n], part: part, op: u.op, trial: u.trial, v: v });
        });
      });
      var twice = Object.keys(partSeen).filter(function (p) { return partSeen[p] > 1; });
      if (twice.length) { item("err", "Part " + twice[0] + " appears in " + partSeen[twice[0]] + " rows" + (twice.length > 1 ? " (and " + plural(twice.length - 1, "other part") + ")" : "") + ". Each part needs one row."); }
    }

    if (missing.length) { item("err", "Row " + missing[0] + " has readings but no " + (S.layout === "long" ? "part or operator" : "part") + (missing.length > 1 ? " (and " + plural(missing.length - 1, "more row") + ")" : "")); }
    var parts = {}, ops = {}, cells = {};
    records.forEach(function (r) { parts[r.part] = 1; ops[r.op] = 1; var k = r.part + "\u0000" + r.op; cells[k] = (cells[k] || 0) + 1; });
    var P = Object.keys(parts).length, O = Object.keys(ops).length, T = 0;
    Object.keys(cells).forEach(function (k) { T = Math.max(T, cells[k]); });
    out.big = P + " parts × " + O + " operators × " + T + " trials";
    out.sub = plural(records.length, "reading");

    if (P < 2) { item("err", "A gage study needs at least 2 parts"); }
    if (O < 2) { item("err", "A crossed study needs at least 2 operators. For one operator, use a Type 1 study."); }
    if (T < 2) { item("err", "Each operator needs to measure each part at least twice"); }
    var short = [];
    Object.keys(parts).forEach(function (p) { Object.keys(ops).forEach(function (o) { var n = cells[p + "\u0000" + o] || 0; if (n !== T) { short.push({ p: p, o: o, n: n }); } }); });
    if (short.length) { item("err", "Not balanced: part " + short[0].p + " / operator " + short[0].o + " has " + short[0].n + " of " + T + " readings" + (short.length > 1 ? " (and " + plural(short.length - 1, "more pair") + ")" : "")); }
    else if (T >= 2 && P >= 2 && O >= 2) { item("ok", "Every operator measured every part " + T + " times"); }
    if (bad.length) { item("err", plural(bad.length, "reading") + (bad.length === 1 ? " isn't a number" : " aren't numbers") + ": row " + bad[0].row + (bad[0].v ? " has '" + bad[0].v + "'" : " is blank")); }
    else if (records.length) { item("ok", "All " + records.length + " readings are numbers"); }
    if (skipped.length) { item("warn", "Skipping summary " + (skipped.length === 1 ? "row" : "rows") + ": " + skipped.filter(function (s, n) { return skipped.indexOf(s) === n; }).join(", ")); }
    if (out.ok && P > 0 && P < 5) { item("warn", "Only " + plural(P, "part") + ". Most studies use 10 so part variation is well estimated."); }
    if (S.layout === "long" && S.long.trial == null && out.ok) { item("warn", "No trial column: readings are numbered in file order for each part and operator"); }
    if (i.truncated) { item("warn", "Checked the first " + i.rows.length + " rows here; the server checks all " + i.row_count + "."); }

    var pick = [], seenOp = {};
    records.forEach(function (r) { if (pick.length < 3 && !seenOp[r.op]) { seenOp[r.op] = 1; pick.push(r); } });
    if (pick.length < 3) { records.slice(0, 3).forEach(function (r) { if (pick.length < 3 && pick.indexOf(r) < 0) { pick.push(r); } }); }
    out.readout = pick.map(function (r) {
      return "Row " + r.row + " → part <b>" + esc(r.part) + "</b> · operator <b>" + esc(r.op) + "</b>" + (r.trial ? " · trial <b>" + esc(r.trial) + "</b>" : "") + " · <b>" + esc(r.v || "blank") + "</b>";
    });
    out.P = P; out.O = O; out.T = T; out.N = records.length;
    return out;
  }

  function renderCheck() {
    var s = summarize(), box = $("#check");
    var html = "";
    if (s.big) { html += '<div class="big">' + esc(s.big) + "<small>" + esc(s.sub) + "</small></div>"; }
    else { html += '<div class="big">Almost there<small>Map the columns to see what Mensuro will read</small></div>'; }
    html += "<ul>" + s.items.map(function (it) { return '<li class="' + (it.cls === "ok" ? "" : it.cls) + '">' + esc(it.text) + "</li>"; }).join("") + "</ul>";
    if (S.layout === "wide") {
      var ops = [];
      Object.keys(S.wide.cols).forEach(function (k) { var c = S.wide.cols[k]; if (c.use && c.operator && ops.indexOf(c.operator) < 0) { ops.push(c.operator); } });
      if (ops.length) {
        html += '<div class="ops"><span class="hint"><b>Operator names</b> (rename to show them on the results)</span>' +
          ops.map(function (o) { return '<label class="op"><span class="hint">' + esc(o) + '</span><input data-rename="' + esc(o) + '" value="' + esc(o) + '" aria-label="Name for operator ' + esc(o) + '"></label>'; }).join("") + "</div>";
      }
    }
    if (s.readout.length) { html += '<div class="readout"><span>How Mensuro reads it:</span>' + s.readout.map(function (r) { return "<span>" + r + "</span>"; }).join("") + "</div>"; }
    box.innerHTML = html;
    if (s.big && s.big !== S.lastBig) { M.replay($(".big", box), "m-pulse"); }
    S.lastBig = s.big;
    $$("input[data-rename]", box).forEach(function (inp) {
      inp.addEventListener("change", function () {
        var from = inp.dataset.rename, to = inp.value.trim();
        if (!to || to === from) { inp.value = from; return; }
        Object.keys(S.wide.cols).forEach(function (k) { if (S.wide.cols[k].operator === from) { S.wide.cols[k].operator = to; } });
        renderMap();
      });
    });
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
    var s = S.summary;
    $("#settings-summary").textContent = s.big + " · " + s.sub + " · " + S.file.name;
    setStep(3);
  });

  // ---------------------------------------------------------------- settings
  $$('input[name="specmode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      $$(".spec [data-mode]").forEach(function (f) { f.hidden = f.dataset.mode !== r.value; });
    });
  });
  $("#back-map").addEventListener("click", function () { setStep(2); });

  function readSettings() {
    var method = $('input[name="method"]:checked').value;
    var mode = $('input[name="specmode"]:checked').value;
    var s = { method: method, unit: $("#unit").value.trim() || null };
    if (mode === "limits") {
      var lsl = parseNum($("#lsl").value), usl = parseNum($("#usl").value);
      if (Number.isNaN(lsl) || Number.isNaN(usl)) { throw new Error("The spec limits must be numbers."); }
      if ((lsl == null) !== (usl == null)) { throw new Error("Give both spec limits, or leave both empty."); }
      if (lsl != null) { if (usl <= lsl) { throw new Error("The upper spec limit must be above the lower one."); } s.lsl = lsl; s.usl = usl; }
    } else {
      var tol = parseNum($("#tol").value);
      if (Number.isNaN(tol) || (tol != null && tol <= 0)) { throw new Error("The tolerance must be a positive number."); }
      if (tol != null) { s.tolerance = tol; }
    }
    return s;
  }

  function mappingBody() {
    if (S.layout === "long") {
      return { layout: "long", part: S.long.part, operator: S.long.operator, trial: S.long.trial, value: S.long.value };
    }
    var readings = [];
    Object.keys(S.wide.cols).forEach(function (k) {
      var c = S.wide.cols[k];
      if (c.use) { readings.push({ column: Number(k), operator: c.operator, trial: Number(c.trial) }); }
    });
    readings.sort(function (a, b) { return a.column - b.column; });
    return { layout: "wide", part: S.wide.part, readings: readings };
  }

  $("#run").addEventListener("click", function () {
    var settings;
    showError($("#run-error"), "");
    try { settings = readSettings(); } catch (err) { showError($("#run-error"), err.message); return; }
    $("#run").disabled = true; $("#run-busy").hidden = false; M.busy($("#s-settings"), true);
    api("POST", "/v1/grr/analyze", { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: settings })
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
  var OP_COLORS = M.COLORS, SHAPES = M.SHAPES, mark = M.mark, niceTicks = M.niceTicks;
  function legend(ops) {
    return '<div class="legend">' + ops.map(function (o, k) {
      return '<span><svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">' + mark(SHAPES[k % 4], 0, 0, 4, OP_COLORS[k % OP_COLORS.length]) + "</svg>Operator " + esc(o) + "</span>";
    }).join("") + "</div>";
  }

  function componentsChart(r, W) {
    var c = r.components, tol = r.tolerance != null;
    var rows = [["Gage R&R", c.gage_rr], ["Repeatability", c.repeatability], ["Reproducibility", c.reproducibility], ["Part-to-part", c.part_to_part]];
    var L = 118, R = 56, rowH = tol ? 46 : 34, top = 22, H = top + rows.length * rowH + 28;
    var max = 0;
    rows.forEach(function (x) { max = Math.max(max, x[1].pct_study_var, tol ? x[1].pct_tolerance : 0); });
    var xmax = Math.max(100, Math.ceil(max / 10) * 10), sx = function (v) { return L + (W - L - R) * v / xmax; };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Variation by source as a percentage of study variation' + (tol ? " and of tolerance" : "") + '">';
    niceTicks(0, xmax, 5).forEach(function (t) {
      if (t > xmax) { return; }
      svg += '<line x1="' + sx(t) + '" x2="' + sx(t) + '" y1="' + top + '" y2="' + (H - 24) + '" stroke="#EDF1F5"/><text class="tick" x="' + sx(t) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + "%</text>";
    });
    [10, 30].forEach(function (g) {
      svg += '<line x1="' + sx(g) + '" x2="' + sx(g) + '" y1="' + (top - 8) + '" y2="' + (H - 24) + '" stroke="#8A5A00" stroke-dasharray="4 4" stroke-width="1.2"/><text class="tick" x="' + sx(g) + '" y="' + (top - 11) + '" text-anchor="middle" style="fill:#8A5A00;font-weight:600">' + g + "%</text>";
    });
    rows.forEach(function (x, k) {
      var y = top + k * rowH + 6;
      svg += '<text x="' + (L - 10) + '" y="' + (y + (tol ? 17 : 11)) + '" text-anchor="end" style="font-weight:600;font-size:12.5px;fill:#14263D" class="tick">' + x[0] + "</text>";
      var h = tol ? 15 : 18;
      svg += '<rect class="hbar" style="--i:' + (2 * k) + '" x="' + L + '" y="' + y + '" width="' + Math.max(1, sx(x[1].pct_study_var) - L) + '" height="' + h + '" rx="3" fill="#14263D"/>';
      svg += '<text x="' + (sx(x[1].pct_study_var) + 6) + '" y="' + (y + h - 4) + '" class="tick" style="fill:#14263D;font-weight:600">' + fmtFixed(x[1].pct_study_var, 1) + "%</text>";
      if (tol) {
        var y2 = y + h + 3;
        svg += '<rect class="hbar" style="--i:' + (2 * k + 1) + '" x="' + L + '" y="' + y2 + '" width="' + Math.max(1, sx(x[1].pct_tolerance) - L) + '" height="' + h + '" rx="3" fill="#36C2AE"/>';
        svg += '<text x="' + (sx(x[1].pct_tolerance) + 6) + '" y="' + (y2 + h - 4) + '" class="tick" style="fill:#237E71;font-weight:600">' + fmtFixed(x[1].pct_tolerance, 1) + "%</text>";
      }
    });
    svg += "</svg>";
    var leg = '<div class="legend"><span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="#14263D"/></svg>% of study variation</span>' +
      (tol ? '<span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="#36C2AE"/></svg>% of tolerance</span>' : "") +
      '<span><svg width="14" height="12" aria-hidden="true"><line x1="0" x2="14" y1="6" y2="6" stroke="#8A5A00" stroke-dasharray="3 3" stroke-width="1.5"/></svg>10% and 30% guidelines</span></div>';
    return svg + leg;
  }

  function byPartChart(r, W) {
    var ch = r.charts, parts = ch.parts, ops = ch.operators;
    var H = Math.round(Math.min(340, Math.max(260, W * 0.42))), L = 50, R = 12, T = 14, B = 40;
    var vals = r.readings.map(function (x) { return x[3]; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || 1;
    var ticks = niceTicks(lo - pad, hi + pad, 5), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var band = (W - L - R) / parts.length, sy = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var off = function (k) { return ops.length === 1 ? 0 : (k - (ops.length - 1) / 2) * Math.min(10, band * 0.6 / ops.length); };
    var px = function (p, k) { return L + band * (parts.indexOf(p) + 0.5) + off(k); };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Every reading by part, coloured by operator, with lines through each operator\'s part averages">';
    ticks.forEach(function (t) { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" stroke="#EDF1F5"/><text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + fmt(t, 6) + "</text>"; });
    var step = Math.ceil(parts.length / 20);
    parts.forEach(function (p, k) { if (k % step === 0) { svg += '<text class="tick" x="' + (L + band * (k + 0.5)) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + esc(p) + "</text>"; } });
    svg += '<text class="tick" x="' + (L + (W - L - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle" style="font-weight:600">Part</text>';
    ops.forEach(function (o, k) {
      var col = OP_COLORS[k % OP_COLORS.length], d = "";
      ch.averages[o].forEach(function (v, j) { d += (j ? "L" : "M") + px(parts[j], k).toFixed(1) + " " + sy(v).toFixed(1); });
      svg += '<path class="draw" pathLength="1" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-opacity=".7"/>';
    });
    r.readings.forEach(function (x) {
      var k = ops.indexOf(x[1]);
      svg += mark(SHAPES[k % 4], px(x[0], k), sy(x[3]), 3.2, OP_COLORS[k % OP_COLORS.length], ' fill-opacity=".85"');
    });
    svg += "</svg>";
    return svg + legend(ops);
  }

  function controlChart(r, kind, W) {
    var ch = r.charts, parts = ch.parts, ops = ch.operators;
    var data = kind === "range" ? ch.ranges : ch.averages;
    var center = kind === "range" ? ch.r_bar : ch.x_bar_bar, ucl = kind === "range" ? ch.r_ucl : ch.x_ucl, lcl = kind === "range" ? ch.r_lcl : ch.x_lcl;
    var H = 240, L = 50, R = 92, T = 12, B = 34, gap = 10;
    var all = [];
    ops.forEach(function (o) { all = all.concat(data[o]); });
    var lo = Math.min(Math.min.apply(null, all), lcl), hi = Math.max(Math.max.apply(null, all), ucl), pad = (hi - lo) * 0.08 || 1;
    if (kind === "range") { lo = Math.min(0, lo); }
    var ticks = niceTicks(kind === "range" ? lo : lo - pad, hi + pad, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var sy = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var blockW = (W - L - R - gap * (ops.length - 1)) / ops.length;
    var sx = function (k, j) { return L + k * (blockW + gap) + blockW * (j + 0.5) / parts.length; };
    var svg = '<svg class="plot" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + (kind === "range" ? "Range" : "Average") + ' chart by operator with control limits">';
    ticks.forEach(function (t) { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" stroke="#EDF1F5"/><text class="tick" x="' + (L - 6) + '" y="' + (sy(t) + 4) + '" text-anchor="end">' + fmt(t, 6) + "</text>"; });
    var lines = [[ucl, "UCL", "#B42318", "5 4"], [center, kind === "range" ? "R̄" : "X̿", "#14263D", ""]];
    if (lcl > 0 || kind === "average") { lines.push([lcl, "LCL", "#B42318", "5 4"]); }
    var ly = lines.map(function (l) { return sy(l[0]) + 4; });
    for (var q = 1; q < ly.length; q++) { if (ly[q] - ly[q - 1] < 13) { ly[q] = ly[q - 1] + 13; } }
    lines.forEach(function (l, q) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(l[0]) + '" y2="' + sy(l[0]) + '" stroke="' + l[2] + '" stroke-width="1.2"' + (l[3] ? ' stroke-dasharray="' + l[3] + '"' : "") + "/>";
      svg += '<text class="tick" x="' + (W - R + 6) + '" y="' + ly[q] + '" style="fill:' + l[2] + ';font-weight:600">' + l[1] + " " + fmt(l[0], 5) + "</text>";
    });
    ops.forEach(function (o, k) {
      var col = OP_COLORS[k % OP_COLORS.length], d = "";
      data[o].forEach(function (v, j) { d += (j ? "L" : "M") + sx(k, j).toFixed(1) + " " + sy(v).toFixed(1); });
      svg += '<path class="draw" pathLength="1" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.4"/>';
      data[o].forEach(function (v, j) {
        var out = kind === "range" ? v > ucl + 1e-12 : false;
        svg += mark(SHAPES[k % 4], sx(k, j), sy(v), out ? 4.2 : 3, out ? "#B42318" : col);
      });
      svg += '<text class="tick" x="' + (L + k * (blockW + gap) + blockW / 2) + '" y="' + (H - B + 18) + '" text-anchor="middle" style="font-weight:600;fill:' + col + '">' + (blockW > 90 ? "Operator " : "") + esc(o) + "</text>";
      if (k > 0) { svg += '<line x1="' + (L + k * (blockW + gap) - gap / 2) + '" x2="' + (L + k * (blockW + gap) - gap / 2) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#DDE3EA"/>'; }
    });
    svg += "</svg>";
    return svg;
  }

  // ----------------------------------------------------------------- results
  function renderResults() {
    var r = S.result, v = r.verdict, c = r.components, tol = r.tolerance != null, basis = tol ? "pct_tolerance" : "pct_study_var";
    var basisLabel = tol ? "of tolerance" : "of study variation";
    var html = "";

    html += '<section class="panel" aria-labelledby="res-title"><div class="row spread"><div class="head"><span class="eyebrow">Gage R&amp;R · ' + esc(r.method) + '</span><h2 id="res-title">Results</h2></div>' +
      '<span class="hint">' + esc(S.file.name) + (S.sheet ? " · " + esc(S.sheet) : "") + "</span></div>";
    html += '<div class="verdict ' + v.key + '"><div><span class="pill ' + v.key + '">' + esc(v.label) + "</span><ul>" +
      v.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div><div class="headline"><div class="v">' + fmtFixed(v.percent_grr, 1) + '%</div><small>%GRR ' + basisLabel + "</small></div></div>";
    html += '<div class="kpis">' +
      kpi("Part-to-part", fmtFixed(c.part_to_part.pct_study_var, 1) + "%", "of study variation: how much the parts differ") +
      kpi("Distinct categories", String(r.ndc), "ndc; AIAG asks for 5 or more") +
      kpi("Repeatability (EV)", fmtFixed(c.repeatability[basis], 1) + "%", "the gage itself") +
      kpi("Reproducibility (AV)", fmtFixed(c.reproducibility[basis], 1) + "%", "differences between operators") +
      "</div>";
    if (r.charts.notes.length || r.notes.length) {
      html += '<div class="hint" style="display:flex;flex-direction:column;gap:4px">' + r.notes.concat(r.charts.notes).map(function (n) { return "<span>• " + esc(n) + "</span>"; }).join("") + "</div>";
    }
    html += "</section>";

    html += '<section class="panel" aria-labelledby="var-title"><h3 id="var-title">Where the variation comes from</h3><div class="chart" style="border:0;padding:0" data-chart="components"></div>';
    var rows = [["Gage R&R", "gage_rr", "hl"], ["Repeatability", "repeatability", "sub"], ["Reproducibility", "reproducibility", "sub"]];
    if (c.interaction && r.interaction_pooled === false) { rows.push(["Operator", "operator", "sub2"], ["Part × Operator", "interaction", "sub2"]); }
    rows.push(["Part-to-part", "part_to_part", ""], ["Total variation", "total", "total"]);
    html += '<div class="scroll-x"><table class="num"><thead><tr><th scope="col">Source</th><th scope="col">Std dev' + (S.settings.unit ? " (" + esc(S.settings.unit) + ")" : "") + '</th><th scope="col">Variance</th><th scope="col">% Contribution</th><th scope="col">% Study var</th>' + (tol ? '<th scope="col">% Tolerance</th>' : "") + "</tr></thead><tbody>";
    rows.forEach(function (x) {
      var k = c[x[1]];
      html += '<tr class="' + x[2] + '"><td>' + x[0] + "</td><td>" + fmt(k.std_dev, 4) + "</td><td>" + fmt(k.variance, 4) + "</td><td>" + fmtFixed(k.pct_contribution, 2) + "%</td><td>" + fmtFixed(k.pct_study_var, 2) + "%</td>" + (tol ? "<td>" + fmtFixed(k.pct_tolerance, 2) + "%</td>" : "") + "</tr>";
    });
    html += "</tbody></table></div></section>";

    html += '<section class="panel" aria-labelledby="ch-title"><h3 id="ch-title">Charts</h3>';
    html += '<div class="chart"><h3>Measurements by part</h3><div data-chart="bypart"></div><p class="note">Each mark is one reading; lines join each operator\'s part averages. Lines that run apart point to an operator difference.</p></div>';
    html += '<div class="charts2"><div class="chart"><h3>Range chart by operator</h3><div data-chart="range"></div><p class="note">' + esc(r.charts.notes[0] || "") + "</p></div>";
    html += '<div class="chart"><h3>Average chart by operator</h3><div data-chart="average"></div><p class="note">' + esc(r.charts.notes[1] || "") + "</p></div></div></section>";

    if (r.anova_table) {
      html += '<section class="panel" aria-labelledby="anova-title"><h3 id="anova-title">ANOVA table</h3><div class="scroll-x"><table class="num"><thead><tr><th scope="col">Source</th><th scope="col">DF</th><th scope="col">SS</th><th scope="col">MS</th><th scope="col">F</th><th scope="col">p</th></tr></thead><tbody>';
      r.anova_table.forEach(function (row) {
        html += "<tr" + (row.source === "Total" ? ' class="total"' : "") + "><td>" + esc(row.source) + "</td><td>" + row.df + "</td><td>" + fmt(row.ss, 5) + "</td><td>" + fmt(row.ms, 5) + "</td><td>" + fmt(row.f, 4) + "</td><td>" + fmtP(row.p) + "</td></tr>";
      });
      html += "</tbody></table></div>";
      if (r.interaction_p_value != null) { html += '<p class="hint">Part × Operator interaction ' + (r.interaction_p_value < 0.001 ? "p < 0.001" : "p = " + fmtP(r.interaction_p_value)) + (r.interaction_pooled ? ": not significant, so it was pooled into repeatability." : ": significant, so it stays in the model.") + "</p>"; }
      html += "</section>";
    }

    var rc = r.receipt, spec = r.spec || {};
    html += '<section class="panel" aria-labelledby="rc-title"><h3 id="rc-title">How this was calculated</h3><dl class="receipt">' +
      dd("Method", rc.method + " (" + rc.standard + ")") +
      dd("Study", rc.sample.parts + " parts × " + rc.sample.operators + " operators × " + rc.sample.trials + " trials = " + r.study.readings + " readings") +
      dd("Tolerance", tol ? (spec.lsl != null ? "LSL " + fmt(spec.lsl, 8) + " to USL " + fmt(spec.usl, 8) + " (width " + fmt(r.tolerance, 8) + ")" : fmt(r.tolerance, 8)) + (spec.unit ? " " + spec.unit : "") : "None given; %GRR is judged against study variation") +
      dd("Constants", Object.keys(rc.constants).map(function (k) { return k + " = " + rc.constants[k]; }).join(", ")) +
      dd("Settings", Object.keys(rc.settings).map(function (k) { return k + " = " + (rc.settings[k] == null ? "none" : rc.settings[k]); }).join(", ")) +
      (rc.notes.length ? dd("Notes", rc.notes.join(" ")) : "") +
      dd("Verdict rule", "AIAG MSA 4th ed.: %GRR under 10% acceptable, 10–30% conditionally acceptable, over 30% not acceptable; ndc of 5 or more") +
      dd("Engine", "Mensuro engine " + rc.engine_version + ", checked against the AIAG MSA 4th edition worked example") +
      "</dl></section>";

    html += reusePanel();
    html += M.reportPanel([
      { key: "part_number", label: "Part number", max: 80 },
      { key: "part_name", label: "Part name" },
      { key: "characteristic", label: "Characteristic", placeholder: "e.g. Bore diameter" },
      { key: "specification", label: "Specification", placeholder: specText() },
      { key: "gage", label: "Gage", placeholder: "Name and ID of the gage" },
      { key: "customer", label: "Customer" },
      { key: "company", label: "Your company" },
      { key: "prepared_by", label: "Prepared by", max: 80 },
      { key: "study_id", label: "Study ID", max: 60 }
    ]);
    html += '<div class="row spread"><span class="row"><button type="button" class="btn btn-ghost" id="res-map">← Columns</button><button type="button" class="btn btn-ghost" id="res-settings">Settings</button></span>' +
      '<button type="button" class="btn btn-dark" id="res-new">New study</button></div>';

    var box = $("#s-results");
    box.innerHTML = html;
    drawCharts();
    M.bindReport({
      path: "/v1/grr/report",
      body: function () {
        var b = { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: S.settings };
        if (S.reuse && S.reuse.on && S.reuse.out) { b.reuse = reuseBody(); }
        return b;
      },
      filename: function (v) { return "Gage R&R" + (v.part_number ? " " + M.safeName(v.part_number) : "") + (v.characteristic ? " " + M.safeName(v.characteristic) : "") + ".pdf"; }
    });
    bindReuse();
    $("#res-map").addEventListener("click", function () { setStep(2); });
    $("#res-settings").addEventListener("click", function () { setStep(3); });
    $("#res-new").addEventListener("click", function () { S.file = null; S.insp = null; S.result = null; setStep(1); });

    function kpi(k, val, s) { return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(val) + '</div><div class="s">' + esc(s) + "</div></div>"; }
    function dd(k, val) { return "<dt>" + esc(k) + "</dt><dd>" + esc(val) + "</dd>"; }
  }

  // ------------------------------------------------- reusing the study for another part
  // Courtney's case: a study run on one part is offered for another with a tighter tolerance.
  // The engine judges the same readings at both tolerances; the checklist is the author's.
  function reusePanel() {
    var R = S.reuse = S.reuse && S.reuse.fileKey === reuseKey() ? S.reuse : { fileKey: reuseKey(), mode: "limits", on: false, answers: {} };
    var tolText = S.result.tolerance != null ? specText() : "none given (judged against study variation)";
    return '<section class="panel reuse" aria-labelledby="reuse-title"><div class="head"><span class="eyebrow">Reviewing a reused study</span><h3 id="reuse-title">Using this study for another part?</h3>' +
      '<p class="hint">A Gage R&amp;R only holds for the tolerance it is judged against. Enter the other part\'s tolerance to see whether the same readings still pass there. This study was run at: <b>' + esc(tolText) + "</b>.</p></div>" +
      '<div class="reuse-grid">' +
      field("ru-part", "Original part number", R.part || "", "The part the study was run on") +
      field("ru-char", "Original characteristic", R.char || "", "e.g. Bore diameter") +
      "</div>" +
      '<fieldset class="reuse-spec"><legend class="label">Other part\'s tolerance</legend>' +
      '<div class="seg" role="radiogroup" aria-label="How to give the other part\'s tolerance">' +
      '<label><input type="radio" name="ru-mode" value="limits"' + (R.mode === "limits" ? " checked" : "") + '>Spec limits</label>' +
      '<label><input type="radio" name="ru-mode" value="width"' + (R.mode === "width" ? " checked" : "") + ">Tolerance width</label></div>" +
      '<div class="reuse-grid">' +
      field("ru-lsl", "Lower spec (LSL)", R.lsl != null ? R.lsl : "", "", "limits", true) +
      field("ru-usl", "Upper spec (USL)", R.usl != null ? R.usl : "", "", "limits", true) +
      field("ru-tol", "Tolerance (USL − LSL)", R.tol != null ? R.tol : "", "", "width", true) +
      '<div class="field" style="align-self:end"><button type="button" class="btn btn-dark" id="ru-run">Recheck at this tolerance</button></div>' +
      "</div></fieldset>" +
      '<p class="error-box" id="ru-error" role="alert" hidden></p><span class="busy" id="ru-busy" hidden>Rechecking…</span>' +
      '<div id="ru-out" aria-live="polite"></div></section>';

    function field(id, label, value, ph, mode, num) {
      return '<div class="field"' + (mode ? ' data-ru-mode="' + mode + '"' + (R.mode !== mode ? " hidden" : "") : "") + '><label for="' + id + '">' + esc(label) + "</label>" +
        '<input id="' + id + '" value="' + esc(value) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + (num ? ' inputmode="decimal"' : ' maxlength="120"') + ' autocomplete="off"></div>';
    }
  }
  function reuseKey() { return S.file ? S.file.name + "|" + JSON.stringify(S.settings) + "|" + JSON.stringify(mappingBody()) : ""; }

  function reuseSpec() {
    var R = S.reuse;
    if (R.mode === "width") {
      var t = parseNum($("#ru-tol").value);
      if (t == null || isNaN(t) || t <= 0) { throw new Error("Enter the other part's tolerance width as a positive number."); }
      return { tolerance: t };
    }
    var lsl = parseNum($("#ru-lsl").value), usl = parseNum($("#ru-usl").value);
    if (lsl == null || usl == null || isNaN(lsl) || isNaN(usl)) { throw new Error("Enter both of the other part's spec limits as numbers."); }
    if (usl <= lsl) { throw new Error("The upper spec limit must be above the lower one."); }
    return { lsl: lsl, usl: usl };
  }

  function reuseBody() {
    var R = S.reuse, sp = R.spec;
    return {
      original_part: R.part || null, original_characteristic: R.char || null,
      lsl: sp.lsl != null ? sp.lsl : null, usl: sp.usl != null ? sp.usl : null, tolerance: sp.tolerance != null ? sp.tolerance : null,
      checks: R.out.checks.map(function (st, k) { return { statement: st, answer: R.answers[k] || "unknown" }; })
    };
  }

  function bindReuse() {
    var R = S.reuse;
    $("#ru-part").addEventListener("input", function () { R.part = this.value.trim(); });
    $("#ru-char").addEventListener("input", function () { R.char = this.value.trim(); });
    $$('input[name="ru-mode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        R.mode = r.value;
        $$("[data-ru-mode]").forEach(function (f) { f.hidden = f.dataset.ruMode !== R.mode; });
      });
    });
    ["ru-lsl", "ru-usl", "ru-tol"].forEach(function (id) {
      $("#" + id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("#ru-run").click(); } });
    });
    $("#ru-run").addEventListener("click", function () {
      var spec;
      M.showError($("#ru-error"), "");
      try { spec = reuseSpec(); } catch (e) { M.showError($("#ru-error"), e.message); return; }
      R.lsl = spec.lsl; R.usl = spec.usl; R.tol = spec.tolerance;
      var btn = this; btn.disabled = true; $("#ru-busy").hidden = false; M.busy($(".panel.reuse"), true);
      M.api("POST", "/v1/grr/recheck", { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: S.settings, recheck: spec })
        .then(function (out) { R.out = out; R.spec = spec; renderReuseOut(); M.replay($("#ru-out"), "m-fresh"); },
          function (err) { if (!M.handleAuth(err)) { M.showError($("#ru-error"), err.message); } })
        .then(function () { btn.disabled = false; $("#ru-busy").hidden = true; M.busy($(".panel.reuse"), false); });
    });
    if (R.out) { renderReuseOut(); }
  }

  function renderReuseOut() {
    var R = S.reuse, o = R.out.original, n = R.out.recheck, u = S.settings.unit ? " " + S.settings.unit : "";
    function card(title, x, tolText) {
      var pct = x.pct_tolerance != null ? fmtFixed(x.pct_tolerance, 1) + "%" : fmtFixed(x.pct_study_var, 1) + "%";
      var what = x.pct_tolerance != null ? "%GRR of tolerance" : "%GRR of study variation";
      return '<div class="cmp ' + x.verdict.key + '"><div class="k">' + esc(title) + '</div><div class="t">' + esc(tolText) + '</div>' +
        '<div class="v">' + pct + '</div><div class="s">' + what + " · ndc " + x.ndc + '</div><span class="pill ' + x.verdict.key + '">' + esc(x.verdict.label) + "</span></div>";
    }
    var tolO = o.tolerance != null ? "Tolerance " + fmt(o.tolerance, 6) + u : "No tolerance";
    var tolN = "Tolerance " + fmt(n.tolerance, 6) + u + (R.spec.lsl != null ? " (LSL " + fmt(R.spec.lsl, 8) + ", USL " + fmt(R.spec.usl, 8) + ")" : "");
    var same = o.verdict.key === n.verdict.key && o.tolerance != null;
    var msg = same ? "Same verdict at both tolerances." :
      "The verdict changes: " + o.verdict.label.toLowerCase() + " at the study's tolerance, " + n.verdict.label.toLowerCase() + " at the other part's.";
    if (o.tolerance != null && n.tolerance < o.tolerance) { msg += " The other part's tolerance is " + Math.round(100 * n.tolerance / o.tolerance) + "% of the original, so the same gage error takes up more of it."; }
    var html = '<div class="cmp-row">' + card("Study's own tolerance", o, tolO) + '<div class="cmp-arrow" aria-hidden="true">→</div>' + card("Other part's tolerance", n, tolN) + "</div>" +
      '<p class="cmp-msg">' + esc(msg) + "</p>" +
      '<p class="hint">Only %GRR of tolerance changes with the tolerance. %GRR of study variation and ndc describe the parts in the original study, so they carry over only if the other part\'s process varies about as much.</p>' +
      '<fieldset class="checklist"><legend class="label">Reuse checklist <span class="hint">(your answers; Mensuro can\'t check these)</span></legend>' +
      R.out.checks.map(function (st, k) {
        var a = R.answers[k] || "unknown";
        return '<div class="chk"><span>' + esc(st) + '</span><span class="seg seg-sm" role="radiogroup" aria-label="' + esc(st) + '">' +
          [["yes", "Yes"], ["no", "No"], ["unknown", "Not sure"]].map(function (x) {
            return '<label><input type="radio" name="ru-chk-' + k + '" value="' + x[0] + '"' + (a === x[0] ? " checked" : "") + ">" + x[1] + "</label>";
          }).join("") + "</span></div>";
      }).join("") + '</fieldset><p class="cmp-warn" id="ru-warn" hidden></p>' +
      '<label class="ru-toggle"><input type="checkbox" id="ru-on"' + (R.on ? " checked" : "") + '> <span><b>Make the PDF for the other part, with a reuse record.</b> The report is judged at the other part\'s tolerance and adds a page with both verdicts and your checklist. Fill in the other part\'s details below.</span></label>';
    $("#ru-out").innerHTML = html;
    function warn() {
      var vals = R.out.checks.map(function (_, k) { return R.answers[k] || "unknown"; });
      var w = vals.indexOf("no") >= 0 ? "You answered no to at least one check, so this study may not represent the measurement process for the other part. A new study is the usual remedy." : "";
      $("#ru-warn").textContent = w; $("#ru-warn").hidden = !w;
    }
    $$('#ru-out input[type="radio"]').forEach(function (r) {
      r.addEventListener("change", function () { R.answers[Number(r.name.split("-").pop())] = r.value; warn(); });
    });
    function placeholder() {
      var box = $("#ri-specification"), u = S.settings.unit ? " " + S.settings.unit : "", sp = R.spec;
      if (!box) { return; }
      box.placeholder = !R.on ? specText() : sp.lsl != null ? fmt(sp.lsl, 8) + " to " + fmt(sp.usl, 8) + u : "Tolerance " + fmt(sp.tolerance, 8) + u;
    }
    $("#ru-on").addEventListener("change", function () { R.on = this.checked; placeholder(); });
    placeholder();
    warn();
  }

  function specText() {
    var s = S.settings || {}, u = s.unit ? " " + s.unit : "";
    if (s.lsl != null && s.usl != null) { return fmt(s.lsl, 8) + " to " + fmt(s.usl, 8) + u; }
    if (s.tolerance != null) { return "Tolerance " + fmt(s.tolerance, 8) + u; }
    return "e.g. 4.000 ± 0.100 mm";
  }

  function drawCharts() {
    var r = S.result;
    $$("#s-results [data-chart]").forEach(function (el) {
      var W = Math.max(300, Math.round(el.clientWidth || 560)), k = el.dataset.chart;
      el.innerHTML = k === "components" ? componentsChart(r, W) : k === "bypart" ? byPartChart(r, W) : controlChart(r, k, W);
    });
  }
  M.start();
})();
