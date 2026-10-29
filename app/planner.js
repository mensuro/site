/* Mensuro study planner: counts readings for a planned study and checks them against the
   cited minimums. Static: nothing is sent anywhere, and no statistics are computed here. */
(function () {
  "use strict";
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function int(id) { var v = Number(String($(id).value).trim()); return Number.isInteger(v) && v > 0 ? v : null; }
  function num(id) { var s = String($(id).value).trim().replace(",", "."); if (!s) { return null; } var v = Number(s); return isFinite(v) && v > 0 ? v : NaN; }
  function big(v, label) { return '<div class="pbig"><span class="v">' + v + '</span><span class="k">' + label + "</span></div>"; }
  function line(ok, text) { return '<li class="' + (ok === true ? "ok" : ok === false ? "warn" : "") + '">' + text + "</li>"; }
  function time(readings, sec) {
    if (!sec || isNaN(sec)) { return ""; }
    var m = Math.round(readings * sec / 60);
    return line(null, "About " + (m < 90 ? m + " minutes" : (Math.round(m / 6) / 10) + " hours") + " of measuring, before setup and breaks");
  }

  // ---- tabs
  var tabs = $$('[role="tab"]');
  function show(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    try { history.replaceState(null, "", "#" + tab.id.slice(4)); } catch (e) { /* fine */ }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(t); });
    t.addEventListener("keydown", function (e) {
      var k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (k) { e.preventDefault(); var n = tabs[(i + k + tabs.length) % tabs.length]; show(n); n.focus(); }
    });
  });
  var start = document.getElementById("tab-" + location.hash.slice(1));
  show(start || tabs[0]);

  // ---- variable Gage R&R
  function grr() {
    var p = int("#g-parts"), o = int("#g-ops"), t = int("#g-trials"), sec = num("#g-sec"), out = $("#g-out");
    if (!p || !o || !t) { out.innerHTML = '<p class="hint">Enter whole numbers for parts, operators and trials.</p>'; return; }
    var n = p * o * t;
    out.innerHTML = big(n, "readings") + "<ul>" +
      line(p >= 10 && o >= 3 && t >= 3, p + " × " + o + " × " + t + (p >= 10 && o >= 3 && t >= 3 ? " meets Ford's 10 × 3 × 3 minimum" : " is below Ford's 10 × 3 × 3 minimum")) +
      line(o >= 2 && t >= 2 ? true : false, o >= 2 && t >= 2 ? "Enough repeats to separate repeatability from reproducibility" : "Needs at least 2 operators and 2 trials") +
      line(null, "Each operator measures " + p * t + " times; randomise the part order every trial") +
      time(n, sec) + "</ul>";
  }
  ["#g-parts", "#g-ops", "#g-trials", "#g-sec"].forEach(function (id) { $(id).addEventListener("input", grr); });
  grr();

  // ---- attribute: agreement study with Ford's part mix
  var MIX = [["near the lower limit", 25], ["near the upper limit", 25], ["across the process variation", 30], ["outside the lower limit", 10], ["outside the upper limit", 10]];
  function split(n) {
    var raw = MIX.map(function (m) { return n * m[1] / 100; }), base = raw.map(Math.floor), left = n - base.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (r, i) { return [r - base[i], i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, left).forEach(function (x) { base[x[1]] += 1; });
    return base;
  }
  function attr() {
    var p = int("#a-parts"), o = int("#a-ops"), t = int("#a-trials"), out = $("#a-out");
    if (!p || !o || !t) { out.innerHTML = '<p class="hint">Enter whole numbers for parts, appraisers and trials.</p>'; return; }
    var parts = split(p), ok = p >= 50 && o >= 3 && t >= 3;
    out.innerHTML = big(p * o * t, "judgements") + "<ul>" +
      line(ok, p + " × " + o + " × " + t + (ok ? " meets Ford's 50 × 3 × 3 minimum" : " is below Ford's 50 × 3 × 3 minimum")) + "</ul>" +
      '<table class="num mix"><caption class="hint">Part mix (Ford §2.2.8)</caption><tbody>' +
      MIX.map(function (m, i) { return "<tr><td>" + m[0] + "</td><td>" + m[1] + "%</td><td><b>" + parts[i] + "</b> parts</td></tr>"; }).join("") +
      "</tbody></table>";
  }
  ["#a-parts", "#a-ops", "#a-trials"].forEach(function (id) { $(id).addEventListener("input", attr); });
  attr();

  function analytic() {
    var lim = Number($('input[name="a-limits"]:checked').value);
    $("#an-out").innerHTML = big(8 * 20 * lim, "checks") + "<ul>" +
      line(null, lim * 8 + " parts with known reference values (8 per limit), each checked 20 times") +
      line(null, "Only " + lim + (lim === 1 ? " part" : " parts") + " must be always rejected: the one furthest beyond " + (lim === 1 ? "the limit" : "each limit")) + "</ul>";
  }
  $$('input[name="a-limits"]').forEach(function (r) { r.addEventListener("change", analytic); });
  analytic();

  $$('input[name="a-design"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var d = $('input[name="a-design"]:checked').value;
      $$("[data-design]").forEach(function (el) { el.hidden = el.dataset.design !== d; });
    });
  });

  // ---- Type 1
  function t1() {
    var n = int("#t-n"), tol = num("#t-tol"), res = num("#t-res"), out = $("#t-out");
    if (!n) { out.innerHTML = '<p class="hint">Enter the number of readings as a whole number.</p>'; return; }
    var html = big(n, "readings") + "<ul>" + line(n >= 25, n >= 50 ? "Meets Bosch's 50 readings" : n >= 25 ? "Meets Bosch's minimum of 25 (50 recommended)" : "Below Bosch's minimum of 25 readings");
    if (tol && res && !isNaN(tol) && !isNaN(res)) {
      var pct = 100 * res / tol;
      html += line(pct <= 5, "Resolution is " + (Math.round(pct * 10) / 10) + "% of the tolerance (5% or finer needed)");
    } else if (isNaN(tol) || isNaN(res)) {
      html += line(false, "Tolerance and resolution must be positive numbers");
    } else {
      html += line(null, "Add the tolerance and gage resolution to check the 5% resolution rule");
    }
    out.innerHTML = html + "</ul>";
  }
  ["#t-n", "#t-tol", "#t-res"].forEach(function (id) { $(id).addEventListener("input", t1); });
  t1();

  // ---- capability
  function cap() {
    var k = int("#c-k"), n = int("#c-n"), c = int("#c-cav"), out = $("#c-out");
    if (!k || !n || !c) { out.innerHTML = '<p class="hint">Enter whole numbers for subgroups, subgroup size and cavities.</p>'; return; }
    var per = k * n, ok = k >= 25 && n >= 5;
    var html = big(per * c, c > 1 ? "measurements in all" : "measurements") + "<ul>" +
      line(ok, k + " subgroups of " + n + (ok ? " meets Ford's 25 × 5 (125) minimum" : " is below Ford's 25 subgroups of 5 (125)")) +
      line(n >= 2 && n <= 25 ? null : false, n >= 2 && n <= 25 ? "Subgroups of " + n + " work for an x̄–R chart" : "x̄–R charts need subgroups of 2 to 25");
    if (c > 1) {
      html += line(null, per + " measurements per cavity × " + c + " cavities, each cavity judged on its own") +
        line(null, "Keep a cavity column in the data file so Mensuro can split it");
    }
    out.innerHTML = html + "</ul>";
  }
  ["#c-k", "#c-n", "#c-cav"].forEach(function (id) { $(id).addEventListener("input", cap); });
  cap();
})();
