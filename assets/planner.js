/* Mensuro free study planner: the page. The arithmetic is in planner-core.js.
   Nothing on this page sends or stores what you type: no network requests, no storage. */
(function () {
  "use strict";
  var P = window.MensuroPlanner;
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var TITLES = { grr: "Variable Gage R&R", attribute: "Attribute gage study", type1: "Type 1 gage study",
                 capability: "Initial process capability", reuse: "Reusing a Gage R&R" };
  var ICON = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6"/><path d="M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 11v6"/><path d="M12 7h.01"/></svg>'
  };
  var STATE_LABEL = { ok: "Meets", warn: "Check", info: "Note" };

  // ---------------------------------------------------------------- tabs
  var tabs = $$('[role="tab"]');
  function show(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) { tab.focus(); }
    try { history.replaceState(null, "", "#" + tab.id.slice(4)); } catch (e) { /* fine */ }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(t); });
    t.addEventListener("keydown", function (e) {
      var k = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (k) { e.preventDefault(); show(tabs[(i + k + tabs.length) % tabs.length], true); }
    });
  });

  // ---------------------------------------------------------------- reuse questions
  var answers = [];
  var list = $("#reuse-list");
  P.REUSE_CHECKS.forEach(function (q, k) {
    var li = document.createElement("li");
    li.innerHTML = '<span class="q">' + esc(q) + '</span><span class="yn-btns" role="radiogroup" aria-label="' + esc(q) + '">' +
      '<label><input type="radio" name="r' + k + '" value="yes"><span>Yes</span></label>' +
      '<label><input type="radio" name="r' + k + '" value="no"><span>No</span></label></span>';
    list.appendChild(li);
  });

  // ---------------------------------------------------------------- plans
  function inputs(panel) {
    var o = {};
    $$("[data-k]", panel).forEach(function (el) {
      if (el.type === "radio") { if (el.checked) { o[el.dataset.k] = el.value; } } else { o[el.dataset.k] = el.value; }
    });
    return o;
  }

  function plan(study, panel) {
    if (study === "reuse") {
      P.REUSE_CHECKS.forEach(function (_, k) {
        var c = $('input[name="r' + k + '"]:checked', panel);
        answers[k] = c ? c.value === "yes" : undefined;
      });
      return P.reuse(answers);
    }
    return P[study](inputs(panel));
  }

  function render(panel) {
    var study = panel.dataset.study, out = $("[data-out]", panel), r = plan(study, panel);
    if (study === "attribute") {
      var d = $('input[name="a-design"]:checked', panel).value;
      $$("[data-design]", panel).forEach(function (el) { el.hidden = el.dataset.design !== d; });
    }
    if (!r.ok) {
      out.innerHTML = '<div class="pc-top"><span class="pc-k">Your plan</span></div><p class="pc-invalid">' + esc(r.message) + "</p>";
      panel._text = null;
      return;
    }
    var html = '<div class="pc-top"><span class="pc-k">Your plan</span><span class="pc-study">' + esc(TITLES[study]) + "</span></div>" +
      '<div class="pc-big' + (r.state ? " pc-" + r.state : "") + '"><span class="v num">' + esc(r.value) + '</span><span class="u">' + esc(r.unit) + "</span></div>" +
      '<p class="pc-sub">' + esc(r.sub) + (r.time ? " · about " + esc(r.time) + " of measuring" : "") + "</p>" +
      '<ul class="pc-checks">' + r.checks.map(function (c) {
        return '<li class="' + c.state + '"><span class="ic" aria-hidden="true">' + ICON[c.state] + '</span><span><span class="sr">' + STATE_LABEL[c.state] + ": </span>" + esc(c.text) + "</span></li>";
      }).join("") + "</ul>";
    if (r.mix) {
      html += '<table class="pc-mix num"><caption>One way to choose the ' + r.mix.reduce(function (a, m) { return a + m.parts; }, 0) +
        " parts (Ford's mix, below)</caption><tbody>" + r.mix.map(function (m) {
          return "<tr><td>" + esc(m.label) + "</td><td>" + m.percent + "%</td><td><b>" + m.parts + "</b></td></tr>";
        }).join("") + "</tbody></table>";
    }
    html += '<div class="pc-actions"><button type="button" class="pc-btn" data-act="copy">Copy plan</button>' +
      '<button type="button" class="pc-btn" data-act="print">Print</button><span class="pc-done" role="status"></span></div>';
    out.innerHTML = html;
    panel._text = [TITLES[study] + " (Mensuro study planner)", r.value + " " + r.unit + ": " + r.sub + (r.time ? ", about " + r.time + " of measuring" : "")]
      .concat(r.checks.map(function (c) { return "- " + c.text; }))
      .concat(r.mix ? r.mix.map(function (m) { return "  " + m.parts + " parts " + m.label + " (" + m.percent + "%)"; }) : [])
      .concat(["Requirements and sources: https://mensuro.tech/study-planner.html#" + panel.id.slice(2)]).join("\n");
  }

  $$(".study").forEach(function (panel) {
    panel.addEventListener("input", function () { render(panel); });
    panel.addEventListener("change", function () { render(panel); });
    $("form", panel).addEventListener("submit", function (e) { e.preventDefault(); });
    panel.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) { return; }
      var done = $(".pc-done", panel);
      if (b.dataset.act === "print") { window.print(); return; }
      if (navigator.clipboard && navigator.clipboard.writeText && panel._text) {
        navigator.clipboard.writeText(panel._text).then(function () { done.textContent = "Copied"; },
          function () { done.textContent = "Copy failed"; });
      } else { done.textContent = "Copy isn't available here"; }
    });
    render(panel);
  });

  var start = document.getElementById("tab-" + location.hash.slice(1));
  show(start || tabs[0]);

  // "See what early access includes": scroll, then move focus to the heading.
  var strip = $(".next-strip a");
  if (strip) {
    strip.addEventListener("click", function (e) {
      e.preventDefault();
      var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("report").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      try { document.getElementById("report-title").focus({ preventScroll: true }); } catch (err) { /* fine */ }
    });
  }
})();
