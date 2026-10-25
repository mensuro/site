/* Mensuro Gage R&R (private preview).
   The page reads the file through the API, lets the user confirm the column mapping, and
   shows the engine's results. Every number shown in the results comes from the API (the
   tested engine); this script only counts rows for the live mapping check and draws charts. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: fine */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* fine */ } }
  };
  var NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
  var SUMMARY = /^\s*(avg|average|averages|mean|means|range|ranges|r[\s-]?bar|x[\s-]?bar|x̄|r̄|total|totals|sum|std|stdev|sigma|min|max|ucl|lcl)\b/i;
  var ROLES = { part: "Part", operator: "Operator", trial: "Trial", value: "Measurement" };
  var PREVIEW_ROWS = 40;
  var MAX_BYTES = 3 * 1024 * 1024;

  function fmt(x, sig) {
    if (x == null || !isFinite(x)) { return "–"; }
    var a = Math.abs(x);
    if (a !== 0 && (a < 1e-4 || a >= 1e6)) { return x.toExponential(2); }
    return String(Number(x.toPrecision(sig || 4)));
  }
  function fmtFixed(x, d) { return x == null || !isFinite(x) ? "–" : x.toFixed(d); }
  function fmtP(p) { return p == null ? "–" : (p < 0.001 ? "< 0.001" : p.toFixed(3)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function parseNum(s) {
    s = String(s || "").trim().replace(/\s/g, "");
    if (!s) { return null; }
    if (/^[+-]?\d*,\d+$/.test(s)) { s = s.replace(",", "."); }
    return NUM.test(s) ? Number(s) : NaN;
  }

  // -------------------------------------------------------------------- state
  var params = new URLSearchParams(location.search);
  var apiBase = (params.get("api") || (window.MENSURO_APP && MENSURO_APP.apiBase) || "").replace(/\/+$/, "");
  var S = {
    code: store.get("mensuro_access"),
    step: 1, file: null, sheet: null, insp: null,
    layout: "long",
    long: { part: null, operator: null, trial: null, value: null },
    wide: { part: null, cols: {} },
    armed: null, result: null
  };

  function api(method, path, body) {
    if (!apiBase) { return Promise.reject(new Error("The preview server isn't connected yet.")); }
    return fetch(apiBase + path, {
      method: method,
      headers: { "Content-Type": "application/json", "X-Mensuro-Access": S.code },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ("The server answered with an error (" + r.status + ").")); e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error("Couldn't reach the Mensuro server. Check your connection and try again."); });
  }
  function handleAuth(err) {
    if (err.status === 401 || err.status === 503) { showGate(err.message); return true; }
    return false;
  }
  function showError(box, msg) { box.textContent = msg; box.hidden = !msg; }

  // ------------------------------------------------------------------ steps
  var sections = { 1: "#s-upload", 2: "#s-map", 3: "#s-settings", 4: "#s-results" };
  function setStep(n) {
    S.step = n;
    $("#gate").hidden = true;
    Object.keys(sections).forEach(function (k) { $(sections[k]).hidden = Number(k) !== n; });
    $$("#stepper li").forEach(function (li) {
      var s = Number(li.dataset.step);
      li.className = s < n ? "done" : (s === n ? "current" : "");
      if (s === n) { li.setAttribute("aria-current", "step"); } else { li.removeAttribute("aria-current"); }
    });
    var h = $(sections[n] + " h2");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // ------------------------------------------------------------------- gate
  function showGate(msg) {
    Object.keys(sections).forEach(function (k) { $(sections[k]).hidden = true; });
    $("#gate").hidden = false;
    showError($("#gate-error"), msg || "");
    $("#forget").hidden = true;
    $("#code").focus();
  }
  $("#gate-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#code").value.trim();
    if (!code) { showError($("#gate-error"), "Enter the access code."); return; }
    S.code = code;
    api("GET", "/v1/access").then(function () {
      store.set("mensuro_access", code);
      $("#forget").hidden = false;
      setStep(1);
    }, function (err) { showError($("#gate-error"), err.message); });
  });
  $("#forget").addEventListener("click", function () {
    store.del("mensuro_access"); S.code = ""; $("#code").value = ""; showGate("");
  });

  // ------------------------------------------------------------------ upload
  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { loadFile(f); }
  });
  $("#file").addEventListener("change", function () { if (this.files[0]) { loadFile(this.files[0]); } this.value = ""; });
  $$("[data-sample]").forEach(function (b) {
    b.addEventListener("click", function () {
      var url = b.dataset.sample;
      fetch(url).then(function (r) { if (!r.ok) { throw new Error(); } return r.blob(); })
        .then(function (blob) { loadFile(new File([blob], url.split("/").pop())); })
        .catch(function () { showError($("#upload-error"), "Couldn't load the example file."); });
    });
  });

  function loadFile(f) {
    showError($("#upload-error"), "");
    if (f.size > MAX_BYTES) { showError($("#upload-error"), "That file is " + (f.size / 1048576).toFixed(1) + " MB; the limit is 3 MB. A gage study is usually well under 1 MB."); return; }
    if (/\.xls$/i.test(f.name)) { showError($("#upload-error"), "Old .xls files aren't supported. In Excel, use Save As → .xlsx or .csv, then upload again."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var b64 = String(reader.result).split(",")[1] || "";
      S.file = { name: f.name, size: f.size, content: b64 };
      inspect(null);
    };
    reader.onerror = function () { showError($("#upload-error"), "The file couldn't be read."); };
    reader.readAsDataURL(f);
  }

  function inspect(sheet) {
    $("#upload-busy").hidden = false;
    api("POST", "/v1/tables/inspect", { filename: S.file.name, content: S.file.content, sheet: sheet })
      .then(function (res) {
        $("#upload-busy").hidden = true;
        S.insp = res; S.sheet = res.sheet;
        applyGuess(res.guess);
        renderMap();
        setStep(2);
      }, function (err) {
        $("#upload-busy").hidden = true;
        if (!handleAuth(err)) { setStep(1); showError($("#upload-error"), err.message); }
      });
  }

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
  }

  function renderFilebar() {
    var i = S.insp, bits = [];
    bits.push('<span class="name"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>' + esc(S.file.name) + "</span>");
    if (i.sheets && i.sheets.length > 1) {
      bits.push('<span class="row" style="gap:8px"><label for="sheet">Sheet</label><select id="sheet" class="field-inline" style="height:34px;border-radius:8px;border:1px solid #C9D3E0;font:inherit;font-size:14px;padding:0 8px">' +
        i.sheets.map(function (s) { return "<option" + (s === i.sheet ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select></span>");
    } else if (i.sheet) { bits.push("<span>Sheet <b>" + esc(i.sheet) + "</b></span>"); }
    bits.push("<span>" + (i.header_row ? "Column names from row " + i.header_row : "No header row found") + "</span>");
    bits.push("<span>" + plural(i.row_count, "data row") + "</span>");
    (i.notes || []).forEach(function (n) { bits.push("<span>" + esc(n) + "</span>"); });
    $("#filebar").innerHTML = bits.join("");
    var sel = $("#sheet");
    if (sel) { sel.addEventListener("change", function () { setStep(1); inspect(sel.value); }); }
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
    $$(".role", p).forEach(bindDrag);
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
      html += '<div class="pair"><input data-op="' + c.index + '" value="' + esc(w.operator) + '" placeholder="Operator" aria-label="Operator for column ' + esc(c.name) + '" list="op-list">' +
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
    var ops = {};
    Object.keys(S.wide.cols).forEach(function (k) { var o = S.wide.cols[k].operator; if (o) { ops[o] = 1; } });
    html += '<datalist id="op-list">' + Object.keys(ops).map(function (o) { return "<option>" + esc(o) + "</option>"; }).join("") + "</datalist>";
    var wrap = $("#table-wrap"), sx = wrap.scrollLeft, sy = wrap.scrollTop;
    wrap.innerHTML = html;
    wrap.scrollLeft = sx; wrap.scrollTop = sy;

    $$("select[data-col]", wrap).forEach(function (sel) {
      sel.addEventListener("change", function () { assign(sel.value || null, Number(sel.dataset.col)); });
    });
    $$("input[data-op]", wrap).forEach(function (inp) {
      inp.addEventListener("input", function () { S.wide.cols[inp.dataset.op].operator = inp.value.trim(); renderCheck(); });
      inp.addEventListener("change", function () { renderMap(); });
    });
    $$("select[data-trial]", wrap).forEach(function (sel) {
      sel.addEventListener("change", function () { S.wide.cols[sel.dataset.trial].trial = sel.value; renderMap(); });
    });
    $$("th.droppable", wrap).forEach(function (th) {
      th.addEventListener("click", function (e) {
        if (!S.armed || e.target.closest("select, input")) { return; }
        var role = S.armed; disarm(); assign(role, Number(th.dataset.col));
      });
    });
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
    renderFilebar();
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

  // ------------------------------------------------- drag, or tap then tap
  function disarm() { S.armed = null; document.body.classList.remove("arming"); $$(".role.armed").forEach(function (b) { b.classList.remove("armed"); b.setAttribute("aria-pressed", "false"); }); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && S.armed) { disarm(); } });

  function bindDrag(chip) {
    var start = null, ghost = null, hover = null;
    chip.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) { return; }
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      chip.setPointerCapture(e.pointerId);
    });
    chip.addEventListener("pointermove", function (e) {
      if (!start) { return; }
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
        ghost = chip.cloneNode(true); ghost.classList.add("ghost"); ghost.classList.remove("placed", "armed");
        document.body.appendChild(ghost); document.body.classList.add("dragging");
        $$("th.droppable").forEach(function (th) { th.classList.add("drop-target"); });
      }
      if (ghost) {
        ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px";
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var th = under && under.closest("th.droppable, td");
        if (th && th.tagName === "TD") { var idx = th.cellIndex; th = $$("#table-wrap thead th")[idx]; if (th && !th.classList.contains("droppable")) { th = null; } }
        if (hover !== th) { if (hover) { hover.classList.remove("drop-hover"); } hover = th; if (hover) { hover.classList.add("drop-hover"); } }
        var wrap = $("#table-wrap"), rect = wrap.getBoundingClientRect();
        if (e.clientX > rect.right - 40) { wrap.scrollLeft += 12; } else if (e.clientX < rect.left + 60) { wrap.scrollLeft -= 12; }
      }
    });
    function end(e, cancelled) {
      if (!start) { return; }
      var dragged = !!ghost, target = hover;
      if (ghost) { ghost.remove(); ghost = null; }
      document.body.classList.remove("dragging");
      $$("th.drop-target").forEach(function (th) { th.classList.remove("drop-target", "drop-hover"); });
      hover = null; start = null;
      if (cancelled) { return; }
      if (dragged) { if (target) { disarm(); assign(chip.dataset.role, Number(target.dataset.col)); } return; }
      // a tap: arm this role, then tap a column
      var role = chip.dataset.role;
      if (S.armed === role) { disarm(); return; }
      disarm(); S.armed = role; chip.classList.add("armed"); chip.setAttribute("aria-pressed", "true"); document.body.classList.add("arming");
    }
    chip.addEventListener("pointerup", function (e) { end(e, false); });
    chip.addEventListener("pointercancel", function (e) { end(e, true); });
    chip.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        var role = chip.dataset.role;
        if (S.armed === role) { disarm(); } else { disarm(); S.armed = role; chip.classList.add("armed"); chip.setAttribute("aria-pressed", "true"); document.body.classList.add("arming"); }
      }
    });
  }

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
    $("#run").disabled = true; $("#run-busy").hidden = false;
    api("POST", "/v1/grr/analyze", { filename: S.file.name, content: S.file.content, sheet: S.sheet, mapping: mappingBody(), settings: settings })
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
  var OP_COLORS = ["#237E71", "#3B6FB6", "#B4591E", "#7B5EA7", "#5B6B82", "#2A8FBF", "#9A4A68", "#6E7F2B"];
  var SHAPES = ["circle", "square", "diamond", "triangle"];
  function mark(shape, x, y, r, color, extra) {
    extra = extra || "";
    if (shape === "square") { return '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" fill="' + color + '"' + extra + "/>"; }
    if (shape === "diamond") { return '<path d="M' + x + " " + (y - r * 1.3) + "L" + (x + r * 1.3) + " " + y + "L" + x + " " + (y + r * 1.3) + "L" + (x - r * 1.3) + " " + y + 'Z" fill="' + color + '"' + extra + "/>"; }
    if (shape === "triangle") { return '<path d="M' + x + " " + (y - r * 1.3) + "L" + (x + r * 1.2) + " " + (y + r) + "L" + (x - r * 1.2) + " " + (y + r) + 'Z" fill="' + color + '"' + extra + "/>"; }
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '"' + extra + "/>";
  }
  function niceTicks(lo, hi, n) {
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = (n * step) / span;
    if (err <= 0.15) { step *= 10; } else if (err <= 0.35) { step *= 5; } else if (err <= 0.75) { step *= 2; }
    var t0 = Math.floor(lo / step) * step, out = [];
    for (var t = t0; t <= hi + step * 0.5; t += step) { out.push(Number(t.toPrecision(12))); }
    return out;
  }
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
      svg += '<rect x="' + L + '" y="' + y + '" width="' + Math.max(1, sx(x[1].pct_study_var) - L) + '" height="' + h + '" rx="3" fill="#14263D"/>';
      svg += '<text x="' + (sx(x[1].pct_study_var) + 6) + '" y="' + (y + h - 4) + '" class="tick" style="fill:#14263D;font-weight:600">' + fmtFixed(x[1].pct_study_var, 1) + "%</text>";
      if (tol) {
        var y2 = y + h + 3;
        svg += '<rect x="' + L + '" y="' + y2 + '" width="' + Math.max(1, sx(x[1].pct_tolerance) - L) + '" height="' + h + '" rx="3" fill="#36C2AE"/>';
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
      svg += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-opacity=".7"/>';
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
      svg += '<text class="tick" x="' + (W - R + 6) + '" y="' + ly[q] + '" style="fill:' + l[2] + ';font-weight:600">' + l[1] + " " + fmt(l[0], 4) + "</text>";
    });
    ops.forEach(function (o, k) {
      var col = OP_COLORS[k % OP_COLORS.length], d = "";
      data[o].forEach(function (v, j) { d += (j ? "L" : "M") + sx(k, j).toFixed(1) + " " + sy(v).toFixed(1); });
      svg += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.4"/>';
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
      if (r.interaction_p_value != null) { html += '<p class="hint">Part × Operator interaction p = ' + fmtP(r.interaction_p_value) + (r.interaction_pooled ? ": not significant, so it was pooled into repeatability." : ": significant, so it stays in the model.") + "</p>"; }
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

    html += '<div class="row spread"><span class="row"><button type="button" class="btn btn-ghost" id="res-map">← Columns</button><button type="button" class="btn btn-ghost" id="res-settings">Settings</button></span>' +
      '<span class="row"><span class="soon">PDF report: coming in the next update</span><button type="button" class="btn btn-dark" id="res-new">New study</button></span></div>';

    var box = $("#s-results");
    box.innerHTML = html;
    drawCharts();
    $("#res-map").addEventListener("click", function () { setStep(2); });
    $("#res-settings").addEventListener("click", function () { setStep(3); });
    $("#res-new").addEventListener("click", function () { S.file = null; S.insp = null; S.result = null; setStep(1); });

    function kpi(k, val, s) { return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(val) + '</div><div class="s">' + esc(s) + "</div></div>"; }
    function dd(k, val) { return "<dt>" + esc(k) + "</dt><dd>" + esc(val) + "</dd>"; }
  }

  function drawCharts() {
    var r = S.result;
    $$("#s-results [data-chart]").forEach(function (el) {
      var W = Math.max(300, Math.round(el.clientWidth || 560)), k = el.dataset.chart;
      el.innerHTML = k === "components" ? componentsChart(r, W) : k === "bypart" ? byPartChart(r, W) : controlChart(r, k, W);
    });
  }
  var resizeTimer = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (S.step !== 4 || !S.result || window.innerWidth === lastW) { return; }
    lastW = window.innerWidth; clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 150);
  });

  // -------------------------------------------------------------------- start
  if (!apiBase) {
    showGate("");
    $("#gate-form").hidden = true;
    showError($("#gate-error"), "The preview server isn't connected yet.");
  } else if (S.code) {
    $("#forget").hidden = false;
    setStep(1);
  } else {
    showGate("");
  }
})();
