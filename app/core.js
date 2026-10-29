/* Mensuro app core (private preview): access code, upload, file bar, drag-and-drop roles,
   chart helpers and the PDF report form. Each study page (grr.js, capability.js) builds on
   this. Every number on a page comes from the API (the tested engine); page scripts only
   count rows for the live mapping check and draw charts. */
window.MensuroCore = function (opts) {
  "use strict";

  // ------------------------------------------------------------------ helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked or full: fine */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* fine */ } }
  };
  var NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
  var SUMMARY = /^\s*(avg|average|averages|mean|means|range|ranges|r[\s-]?bar|x[\s-]?bar|x̄|r̄|total|totals|sum|std|stdev|sigma|min|max|ucl|lcl)\b/i;
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
    s = String(s == null ? "" : s).trim().replace(/\s/g, "");
    if (!s) { return null; }
    if (/^[+-]?\d*,\d+$/.test(s)) { s = s.replace(",", "."); }
    return NUM.test(s) ? Number(s) : NaN;
  }

  // ---------------------------------------------------------------- state, api
  var params = new URLSearchParams(location.search);
  var apiBase = (params.get("api") || (window.MENSURO_APP && MENSURO_APP.apiBase) || "").replace(/\/+$/, "");
  var S = { code: store.get("mensuro_access"), step: 1, file: null, sheet: null, insp: null, armed: null, result: null };

  function request(method, path, body) {
    if (!apiBase) { return Promise.reject(new Error("The preview server isn't connected yet.")); }
    return fetch(apiBase + path, {
      method: method,
      headers: { "Content-Type": "application/json", "X-Mensuro-Access": S.code },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.ok) { return r; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        var e = new Error(j.error || ("The server answered with an error (" + r.status + ")."));
        e.status = r.status; throw e;
      });
    }, function () { throw new Error("Couldn't reach the Mensuro server. Check your connection and try again."); });
  }
  function api(method, path, body) { return request(method, path, body).then(function (r) { return r.json(); }); }
  function handleAuth(err) {
    if (err.status === 401 || err.status === 503) { showGate(err.message); return true; }
    return false;
  }
  function showError(box, msg) { box.textContent = msg; box.hidden = !msg; }
  // A thin moving bar along the top of a panel while the server works.
  function busy(el, on) { if (el) { el.classList.toggle("loading", !!on); } }
  // Briefly highlight a column that just got a role.
  function flash(col) {
    if (col == null) { return; }
    replay($('#table-wrap th[data-col="' + col + '"]'), "flash");
  }

  // ------------------------------------------------------------------- steps
  var sections = { 1: "#s-upload", 2: "#s-map", 3: "#s-settings", 4: "#s-results" };
  // Motion is decoration only: skipped entirely for people who ask for reduced motion.
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function replay(el, cls) {
    if (reduceMotion || !el) { return; }
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    el.addEventListener("animationend", function done(e) { if (e.target === el) { el.classList.remove(cls); el.removeEventListener("animationend", done); } });
  }
  function setStep(n) {
    var prev = S.step;
    S.step = n;
    var gateWasOpen = !$("#gate").hidden;
    $("#gate").hidden = true;
    Object.keys(sections).forEach(function (k) { $(sections[k]).hidden = Number(k) !== n; });
    $$("#stepper li").forEach(function (li) {
      var s = Number(li.dataset.step);
      li.classList.remove("done", "current");
      if (s < n) { li.classList.add("done"); } else if (s === n) { li.classList.add("current"); }
      if (s < n && s >= prev && !gateWasOpen) { replay(li, "just-done"); }
      if (s === n) { li.setAttribute("aria-current", "step"); } else { li.removeAttribute("aria-current"); }
    });
    var sec = $(sections[n]);
    if (prev !== n || gateWasOpen) { replay(sec, n >= prev ? "m-enter-fwd" : "m-enter-back"); }
    if (n === 4 && !reduceMotion) {
      sec.classList.add("m-fresh");
      clearTimeout(setStep.fresh);
      setStep.fresh = setTimeout(function () { sec.classList.remove("m-fresh"); }, 2000);
    }
    var h = $(sections[n] + " h2");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // -------------------------------------------------------------------- gate
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
    if (f.size > MAX_BYTES) { showError($("#upload-error"), "That file is " + (f.size / 1048576).toFixed(1) + " MB; the limit is 3 MB. Study files are usually well under 1 MB."); return; }
    if (/\.xls$/i.test(f.name)) { showError($("#upload-error"), "Old .xls files aren't supported. In Excel, use Save As → .xlsx or .csv, then upload again."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      S.file = { name: f.name, size: f.size, content: String(reader.result).split(",")[1] || "" };
      inspect(null);
    };
    reader.onerror = function () { showError($("#upload-error"), "The file couldn't be read."); };
    reader.readAsDataURL(f);
  }

  function inspect(sheet) {
    $("#upload-busy").hidden = false; busy($("#s-upload"), true);
    api("POST", "/v1/tables/inspect", { filename: S.file.name, content: S.file.content, sheet: sheet })
      .then(function (res) {
        $("#upload-busy").hidden = true; busy($("#s-upload"), false);
        S.insp = res; S.sheet = res.sheet;
        opts.onInspected(res);
        setStep(2);
      }, function (err) {
        $("#upload-busy").hidden = true; busy($("#s-upload"), false);
        if (!handleAuth(err)) { setStep(1); showError($("#upload-error"), err.message); }
      });
  }

  function renderFilebar() {
    var i = S.insp, bits = [];
    bits.push('<span class="name"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>' + esc(S.file.name) + "</span>");
    if (i.sheets && i.sheets.length > 1) {
      bits.push('<span class="row" style="gap:8px"><label for="sheet">Sheet</label><select id="sheet" class="inline-select">' +
        i.sheets.map(function (s) { return "<option" + (s === i.sheet ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select></span>");
    } else if (i.sheet) { bits.push("<span>Sheet <b>" + esc(i.sheet) + "</b></span>"); }
    bits.push("<span>" + (i.header_row ? "Column names from row " + i.header_row : "No header row found") + "</span>");
    bits.push("<span>" + plural(i.row_count, "data row") + "</span>");
    (i.notes || []).forEach(function (n) { bits.push("<span>" + esc(n) + "</span>"); });
    $("#filebar").innerHTML = bits.join("");
    var sel = $("#sheet");
    if (sel) { sel.addEventListener("change", function () { setStep(1); inspect(sel.value); }); }
  }

  // ------------------------------------------------- drag, or tap then tap
  function disarm() { S.armed = null; document.body.classList.remove("arming"); $$(".role.armed").forEach(function (b) { b.classList.remove("armed"); b.setAttribute("aria-pressed", "false"); }); }
  function arm(chip) { disarm(); S.armed = chip.dataset.role; chip.classList.add("armed"); chip.setAttribute("aria-pressed", "true"); document.body.classList.add("arming"); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && S.armed) { disarm(); } });

  function bindDrag(chip) {
    var start = null, ghost = null, hover = null;
    chip.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) { return; }
      start = { x: e.clientX, y: e.clientY };
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
        if (th && th.tagName === "TD") { th = $$("#table-wrap thead th")[th.cellIndex]; if (th && !th.classList.contains("droppable")) { th = null; } }
        if (hover !== th) { if (hover) { hover.classList.remove("drop-hover"); } hover = th; if (hover) { hover.classList.add("drop-hover"); } }
        var wrap = $("#table-wrap"), rect = wrap.getBoundingClientRect();
        if (e.clientX > rect.right - 40) { wrap.scrollLeft += 12; } else if (e.clientX < rect.left + 60) { wrap.scrollLeft -= 12; }
      }
    });
    function end(cancelled) {
      if (!start) { return; }
      var dragged = !!ghost, target = hover;
      if (ghost) { ghost.remove(); ghost = null; }
      document.body.classList.remove("dragging");
      $$("th.drop-target").forEach(function (th) { th.classList.remove("drop-target", "drop-hover"); });
      hover = null; start = null;
      if (cancelled) { return; }
      if (dragged) { if (target) { disarm(); opts.assign(chip.dataset.role, Number(target.dataset.col)); } return; }
      if (S.armed === chip.dataset.role) { disarm(); } else { arm(chip); }
    }
    chip.addEventListener("pointerup", function () { end(false); });
    chip.addEventListener("pointercancel", function () { end(true); });
    chip.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (S.armed === chip.dataset.role) { disarm(); } else { arm(chip); } }
    });
  }
  // Column headers accept an armed role on click.
  function bindHeaderTaps(wrap) {
    $$("th.droppable", wrap).forEach(function (th) {
      th.addEventListener("click", function (e) {
        if (!S.armed || e.target.closest("select, input, button")) { return; }
        var role = S.armed; disarm(); opts.assign(role, Number(th.dataset.col));
      });
    });
  }

  // ------------------------------------------------------------------ charts
  var COLORS = ["#237E71", "#3B6FB6", "#B4591E", "#7B5EA7", "#5B6B82", "#2A8FBF", "#9A4A68", "#6E7F2B"];
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
  // Redraw charts when the width changes (charts are drawn at their real pixel width).
  var resizeTimer = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (S.step !== 4 || !S.result || window.innerWidth === lastW) { return; }
    lastW = window.innerWidth; clearTimeout(resizeTimer); resizeTimer = setTimeout(opts.drawCharts, 150);
  });

  // ----------------------------------------------------------- report (PDF)
  var REPORT_KEY = "mensuro_report_defaults";
  var KEEP = ["company", "customer", "prepared_by", "page_size", "logo", "logo_name"];
  function reportDefaults() { try { return JSON.parse(store.get(REPORT_KEY) || "{}"); } catch (e) { return {}; } }

  function reportPanel(fields) {
    var d = reportDefaults();
    var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    var html = '<section class="panel" aria-labelledby="rep-title"><div class="head"><h3 id="rep-title">Customer report (PDF)</h3>' +
      '<p class="hint">Add what your customer expects in the report header. These details only label the report; they never change a number.</p></div>' +
      '<form id="report-form" class="report-grid" novalidate>';
    fields.forEach(function (f) {
      var v = f.value != null ? f.value : (d[f.key] || "");
      html += '<div class="field"><label for="ri-' + f.key + '">' + esc(f.label) + "</label>" +
        '<input id="ri-' + f.key + '" name="' + f.key + '" value="' + esc(v) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + ' autocomplete="off" maxlength="' + (f.max || 120) + '"></div>';
    });
    html += '<div class="field"><label for="ri-study_date">Study date</label><input id="ri-study_date" name="study_date" type="date" value="' + today + '"></div>' +
      '<div class="field"><label for="ri-page_size">Paper</label><select id="ri-page_size" name="page_size">' +
      ["Letter", "A4"].map(function (p) { return "<option" + ((d.page_size || "Letter") === p ? " selected" : "") + ">" + p + "</option>"; }).join("") + "</select></div>" +
      '<div class="field logo-field"><span class="label">Your logo <span class="hint">(optional · PNG, JPG or SVG)</span></span>' +
      '<div class="row" style="gap:10px"><label class="btn btn-ghost btn-sm" for="ri-logo">Choose logo</label><input id="ri-logo" type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" class="visually-hidden">' +
      '<span class="hint" id="ri-logo-name">' + (d.logo ? esc(d.logo_name || "Saved logo") + ' · <button type="button" class="linklike" id="ri-logo-clear">remove</button>' : "None") + "</span></div></div>" +
      '<div class="field span-all"><label for="ri-justification">Engineering justification <span class="hint">(optional)</span></label>' +
      '<textarea id="ri-justification" name="justification" rows="3" maxlength="2000" aria-describedby="ri-justification-help"></textarea>' +
      '<small id="ri-justification-help">For anything a reviewer should know, e.g. why a conditional result is acceptable, or why a cavity sits off-center but tool wear moves it away from the limit. It prints after the summary, marked as your note, not a Mensuro calculation. <span id="ri-justification-count">0 / 2000</span></small></div>' +
      '</form><p class="error-box" id="report-error" role="alert" hidden></p>' +
      '<div class="row spread"><span class="hint">Remembered on this device: company, customer, prepared by, paper and logo.</span>' +
      '<span class="row"><span class="busy" id="report-busy" hidden>Building your report…</span>' +
      '<button type="button" class="btn" id="report-download">Download PDF report</button></span></div></section>';
    return html;
  }

  function bindReport(cfg) {
    var form = $("#report-form"), logo = reportDefaults().logo || null, logoName = reportDefaults().logo_name || "";
    function showLogo() {
      var box = $("#ri-logo-name");
      box.innerHTML = logo ? esc(logoName || "Logo") + ' · <button type="button" class="linklike" id="ri-logo-clear">remove</button>' : "None";
      var clear = $("#ri-logo-clear");
      if (clear) { clear.addEventListener("click", function () { logo = null; logoName = ""; save(); showLogo(); }); }
    }
    function values() {
      var out = {};
      $$("input[name], select[name], textarea[name]", form).forEach(function (el) { out[el.name] = el.value.trim(); });
      return out;
    }
    var note = $("#ri-justification");
    note.addEventListener("input", function () { $("#ri-justification-count").textContent = note.value.length + " / 2000"; });
    function save() {
      var v = values(), keep = {};
      KEEP.forEach(function (k) { if (v[k]) { keep[k] = v[k]; } });
      if (logo) { keep.logo = logo; keep.logo_name = logoName; }
      store.set(REPORT_KEY, JSON.stringify(keep));
    }
    showLogo();
    $("#ri-logo").addEventListener("change", function () {
      var f = this.files[0]; this.value = "";
      if (!f) { return; }
      if (f.size > 500 * 1024) { showError($("#report-error"), "That logo is " + Math.round(f.size / 1024) + " KB; use an image under 500 KB."); return; }
      var reader = new FileReader();
      reader.onload = function () { logo = String(reader.result).split(",")[1] || null; logoName = f.name; showError($("#report-error"), ""); save(); showLogo(); };
      reader.readAsDataURL(f);
    });
    $("#report-download").addEventListener("click", function () {
      var v = values(), btn = this;
      showError($("#report-error"), "");
      save();
      var info = {};
      Object.keys(v).forEach(function (k) { if (v[k]) { info[k] = v[k]; } });
      if (logo) { info.logo = logo; }
      var body = cfg.body(); body.info = info;
      btn.disabled = true; $("#report-busy").hidden = false; busy(form.closest(".panel"), true);
      request("POST", cfg.path, body).then(function (r) { return r.blob(); }).then(function (blob) {
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = cfg.filename(v); document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }, function (err) {
        if (!handleAuth(err)) { showError($("#report-error"), err.message); }
      }).then(function () { btn.disabled = false; $("#report-busy").hidden = true; busy(form.closest(".panel"), false); });
    });
  }
  function safeName(s) { return String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60); }

  // ------------------------------------------------------------------- start
  function start() {
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
  }

  return {
    $: $, $$: $$, esc: esc, store: store, NUM: NUM, SUMMARY: SUMMARY,
    fmt: fmt, fmtFixed: fmtFixed, fmtP: fmtP, plural: plural, parseNum: parseNum,
    S: S, api: api, handleAuth: handleAuth, showError: showError, setStep: setStep, busy: busy, flash: flash, replay: replay,
    renderFilebar: renderFilebar, bindDrag: bindDrag, bindHeaderTaps: bindHeaderTaps, disarm: disarm,
    COLORS: COLORS, SHAPES: SHAPES, mark: mark, niceTicks: niceTicks,
    reportPanel: reportPanel, bindReport: bindReport, safeName: safeName, start: start
  };
};
