/* Sigmi preview. Scripted, not AI: a launcher, suggested questions with prewritten answers for
   the page and step you're on, and an open box that sends a typed question to the Mensuro team.
   Figures quoted in answers come straight from the engine results already on the page; nothing
   is calculated here. Only the typed question text is ever sent (Netlify form "sigmi-questions"). */
(function () {
  "use strict";
  var tool = document.body.getAttribute("data-tool") || "home";
  var AVATAR = "../assets/sigmi-avatar.svg";
  var MAX_SENDS = 5, sent = 0, greeted = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f(x, d) { return x == null || !isFinite(x) ? "–" : Number(x).toFixed(d); }
  function link(href, text) {
    var parts = href.split("#"), q = location.search.replace(/"/g, "");
    return '<a href="' + parts[0] + q + (parts[1] ? "#" + parts[1] : "") + '">' + esc(text) + "</a>";
  }
  function st() { return window.MensuroState || null; }
  function step() { var s = st(); return s ? s.step : 0; }
  function gateOpen() { var g = document.getElementById("gate"); return g && !g.hidden; }

  // ------------------------------------------------------------------ panel
  var fab = document.createElement("button");
  fab.type = "button";
  fab.className = "sigmi-fab";
  fab.setAttribute("aria-controls", "sigmi-panel");
  fab.setAttribute("aria-expanded", "false");
  fab.innerHTML = '<img src="' + AVATAR + '" alt="" width="36" height="36"><span>Ask Sigmi</span>';

  var panel = document.createElement("section");
  panel.id = "sigmi-panel";
  panel.className = "sigmi";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Sigmi, Mensuro's assistant (preview)");
  panel.hidden = true;
  panel.innerHTML =
    '<header class="sigmi-head"><img src="' + AVATAR + '" alt="" width="34" height="34">' +
    '<div><b>Sigmi</b><span class="sigmi-tag">Preview · scripted answers</span></div>' +
    '<button type="button" class="sigmi-x" aria-label="Close Sigmi">×</button></header>' +
    '<div class="sigmi-log" aria-live="polite"></div>' +
    '<div class="sigmi-chips" role="group" aria-label="Suggested questions"></div>' +
    '<form class="sigmi-ask" novalidate><label for="sigmi-q" class="visually-hidden">What would you ask Sigmi?</label>' +
    '<textarea id="sigmi-q" rows="2" maxlength="500" placeholder="What would you ask Sigmi?"></textarea>' +
    '<button type="submit" class="sigmi-send">Send</button></form>' +
    '<p class="sigmi-note">Sigmi isn\'t live yet. A typed question goes to the Mensuro team (just the text) so we know what to teach it. Please leave out part numbers and customer names.</p>';
  document.body.appendChild(fab);
  document.body.appendChild(panel);
  var log = panel.querySelector(".sigmi-log"), chips = panel.querySelector(".sigmi-chips");

  function say(html, who) {
    var m = document.createElement("div");
    m.className = "sigmi-msg " + (who || "bot");
    m.innerHTML = html;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }
  function setChips(list) {
    chips.innerHTML = "";
    list.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sigmi-chip";
      b.textContent = c.label;
      b.addEventListener("click", function () {
        say(esc(c.label), "you");
        var out = c.answer();
        say(out.text);
        setChips(out.chips || context());
      });
      chips.appendChild(b);
    });
  }
  function open() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    fab.hidden = true;
    if (!greeted) {
      greeted = true;
      say("Hi there! I'm <b>Sigmi</b>, your Mensuro assistant. I'm not live yet, but here's a preview of how I'll help: tap a question below.");
    }
    setChips(context());
    panel.querySelector(".sigmi-chip, textarea").focus();
  }
  function close() {
    panel.hidden = true;
    fab.hidden = false;
    fab.setAttribute("aria-expanded", "false");
    fab.focus();
  }
  fab.addEventListener("click", open);
  panel.querySelector(".sigmi-x").addEventListener("click", close);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") { close(); } });
  document.addEventListener("mensuro:step", function () { if (!panel.hidden) { setChips(context()); } });

  // ------------------------------------------------------- the open question
  panel.querySelector(".sigmi-ask").addEventListener("submit", function (e) {
    e.preventDefault();
    var box = panel.querySelector("textarea"), q = box.value.trim();
    if (!q) { box.focus(); return; }
    say(esc(q), "you");
    box.value = "";
    if (sent >= MAX_SENDS) { say("Thanks! That's plenty for one session. I've passed on your earlier questions."); return; }
    sent += 1;
    var body = new URLSearchParams({ "form-name": "sigmi-questions", question: q.slice(0, 500), page: tool + (step() ? " · step " + step() : "") }).toString();
    fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
      .then(function (r) {
        if (!r.ok) { throw new Error(); }
        say("Thanks! I can't answer that yet, but your question went to the Mensuro team. It helps decide what I learn first.");
      })
      .catch(function () { say("I couldn't pass that on just now. You can email it to <a href=\"mailto:nick@mensuro.tech\">nick@mensuro.tech</a>."); });
  });

  // ---------------------------------------------------------------- answers
  var SAFE = { label: "Is my data safe?", answer: function () {
    return { text: "Your file goes to the Mensuro server over an encrypted connection, is analysed in memory and is discarded as soon as the answer comes back. Nothing is stored. When I'm live, I'll see column names, summary statistics and results, never your raw readings." };
  } };
  var WHAT = { label: "What will Sigmi do?", answer: function () {
    return { text: "When I'm live I'll help you pick the right study, map your columns, and explain results in plain English. Every number still comes from Mensuro's tested statistics engine. I explain, I never calculate." };
  } };

  function chooser() {
    return { label: "Which study do I need?", answer: function () {
      return { text: "What are you trying to show?", chips: [
        { label: "My gage gives trustworthy readings", answer: function () {
          return { text: "Do several operators measure the same parts, or does one person check a reference part with a known value?", chips: [
            { label: "Several operators, several parts", answer: function () { return { text: "That's a <b>Gage R&amp;R</b>: usually 10 parts × 3 operators × 3 trials. " + link("gage-rr.html", "Start a Gage R&R →") }; } },
            { label: "One reference part, known value", answer: function () { return { text: "That's a <b>Type 1 gage study</b>: about 50 readings of one calibrated part. It's often run before a Gage R&amp;R. " + link("type1.html", "Start a Type 1 study →") }; } }
          ] };
        } },
        { label: "My process makes parts in spec", answer: function () { return { text: "That's a <b>capability study</b> (Cp, Cpk, Pp, Ppk). For a multi-cavity tool, map the cavity column and each cavity is judged on its own. " + link("capability.html", "Start a capability study →") }; } },
        { label: "Pass/fail or visual inspection", answer: function () { return { text: "That's an <b>attribute agreement study</b>. It isn't in Mensuro yet, but the planner shows how to design one, including the analytic method that needs far fewer bad parts. " + link("planner.html#attr", "Open the planner →") }; } },
        { label: "I'm planning and need requirements", answer: function () { return { text: "The <b>study planner</b> sizes each study and shows the source for every number. " + link("planner.html", "Open the planner →") }; } }
      ] };
    } };
  }

  function upload() {
    var layouts = {
      grr: "One row per reading (part, operator, trial, value), or the classic AIAG sheet with a column per operator and trial. Title rows and average rows are skipped.",
      capability: "One column of readings, a subgroup column, or one row per subgroup (X1, X2…). Add a cavity column for capability by cavity.",
      type1: "One column of repeated readings of the reference part, in the order taken."
    };
    return [
      { label: "What file layouts work?", answer: function () { return { text: (layouts[tool] || layouts.grr) + " CSV or Excel, up to 3 MB. You'll check how Mensuro reads it before anything is calculated." }; } },
      { label: "Can I try it without my own data?", answer: function () { return { text: "Yes. Pick one of the sample files under the upload box. They're published reference examples or simulated data." }; } },
      SAFE
    ];
  }

  function mapping() {
    var list = [{ label: "How do I map the columns?", answer: function () {
      return { text: "Mensuro has made a first guess. Drag a role onto a column, tap a role then a column, or use the menu under each column name. The panel on the right shows exactly what will be read before anything is calculated." };
    } }];
    if (tool === "capability") {
      list.push({ label: "My tool has several cavities", answer: function () { return { text: "Give the <b>Cavity</b> role to the column that names the cavity. Each cavity then gets its own capability study, and the verdict follows the worst one." }; } });
    }
    if (tool === "grr") {
      list.push({ label: "One column per operator and trial?", answer: function () { return { text: "Choose <b>One row per part</b> at the top, then set the operator and trial under each reading column." }; } });
    }
    return list;
  }

  function settings() {
    if (tool === "grr") {
      return [
        { label: "ANOVA or Average & Range?", answer: function () { return { text: "<b>ANOVA</b> is recommended (and some customers require it). It also checks whether operators measure some parts differently. Average &amp; Range is the classic hand-calculation method." }; } },
        { label: "Do I need a tolerance?", answer: function () { return { text: "Usually, yes. Most customers judge %GRR against the tolerance. Without one, %GRR is judged against the variation of the parts in your study." }; } }
      ];
    }
    if (tool === "capability") {
      return [
        { label: "Ppk or Cpk for the verdict?", answer: function () { return { text: "<b>Ppk</b> uses the overall (long-term) variation and is what PPAP initial process studies usually ask for. Cpk uses short-term, within-subgroup variation. Both are always shown." }; } },
        { label: "Only one spec limit?", answer: function () { return { text: "Fine. Leave the other blank and Mensuro reports the one-sided indices (Cpk, Ppk). Cp and Pp need both limits." }; } }
      ];
    }
    return [
      { label: "Where does the reference value come from?", answer: function () { return { text: "From the reference part's calibration certificate. Mensuro compares your readings with it to judge bias." }; } },
      { label: "Why does resolution matter?", answer: function () { return { text: "If the gage's smallest step is coarse compared with the tolerance, it can't see the differences that matter. Bosch Booklet 10 asks for 5% of the tolerance or finer." }; } }
    ];
  }

  // results: quotes the engine's numbers already shown on the page
  function results() {
    var s = st(), r = s && s.result;
    if (!r) { return []; }
    if (r.analysis === "gage_rr") { return grrResults(r); }
    if (r.analysis === "capability_groups") { return groupResults(r); }
    if (r.analysis === "capability") { return capResults(r); }
    if (r.analysis === "type1") { return type1Results(r); }
    return [];
  }

  function grrResults(r) {
    var v = r.verdict, tol = r.tolerance != null, basis = tol ? "pct_tolerance" : "pct_study_var", c = r.components;
    return [
      { label: "Is this good enough for PPAP?", answer: function () {
        return { text: "Mensuro's verdict is <b>" + esc(v.label) + "</b>: %GRR is " + f(v.percent_grr, 1) + "% of " + (tol ? "the tolerance" : "study variation") + " and ndc is " + esc(r.ndc) + ". " +
          "AIAG MSA: under 10% acceptable, 10–30% may be acceptable depending on the application, over 30% not acceptable, and ndc of 5 or more." +
          (tol ? "" : " Most customers judge %GRR against the tolerance, so add your spec limits in Settings.") + " Your customer's own requirements win where they differ." };
      } },
      { label: "What does ndc mean?", answer: function () {
        return { text: "The <b>number of distinct categories</b>: roughly how many groups of parts the gage can tell apart across the parts in your study. Yours is " + esc(r.ndc) + "; AIAG asks for 5 or more. A low ndc can also mean the parts were too alike, so pick parts across the whole process range." };
      } },
      { label: "What should I fix first?", answer: function () {
        var ev = c.repeatability[basis], av = c.reproducibility[basis], w = r.charts && r.charts.widest_operator;
        var t = ev >= av
          ? "<b>Repeatability</b> (the gage itself) is the larger share: " + f(ev, 1) + "% against " + f(av, 1) + "% for reproducibility. Look at the gage, the fixture, how the part is held, and resolution."
          : "<b>Reproducibility</b> (differences between operators) is the larger share: " + f(av, 1) + "% against " + f(ev, 1) + "% for repeatability. Look at the method and training" + (w ? "; operator " + esc(w) + " has the widest repeat-reading ranges" : "") + ".";
        if (r.interaction_pooled === false) { t += " Operators also measure some parts differently (the part × operator interaction is significant)."; }
        return { text: t };
      } },
      { label: "Can I reuse this study for another part?", answer: function () {
        return { text: "Use <b>Using this study for another part?</b> below the results. Enter the other part's tolerance and Mensuro rechecks the same readings there, with a checklist and a reuse record for the PDF." };
      } }
    ];
  }

  function capResults(r) {
    var v = r.verdict, o = r.overall, w = r.within;
    return [
      { label: "Is this good enough for PPAP?", answer: function () {
        var t = "Mensuro's verdict is <b>" + esc(v.label) + "</b>: " + esc(v.index) + " is " + f(v.value, 2) + ". PPAP: above 1.67 acceptable, 1.33 to 1.67 with customer approval, below 1.33 not acceptable.";
        if (r.chart && !r.chart.in_control) { t += " The control chart has points outside the limits, so the process may not have been stable; fix that before relying on the number."; }
        if (r.normality && r.normality.p != null && r.normality.p < 0.05) { t += " The data may not be normal, so treat the indices with caution."; }
        return { text: t };
      } },
      { label: "Ppk or Cpk: what's the difference?", answer: function () {
        return { text: "<b>Ppk</b> (" + f(o.cpk, 2) + ") uses all the variation over the study, the long-term picture. <b>Cpk</b> (" + (w ? f(w.cpk, 2) : "–") + ") uses only the variation within subgroups, what the process could do if it stayed steady. A big gap between them means the process drifted during the study." };
      } },
      { label: "What should I improve first?", answer: function () {
        if (o.cp == null) { return { text: "With one spec limit, " + esc(v.index) + " improves by moving the average away from that limit or by reducing variation." }; }
        var t = o.cpk < o.cp * 0.85
          ? "Pp is " + f(o.cp, 2) + " but Ppk is only " + f(o.cpk, 2) + ": the spread would fit, but the average sits off-center. Centering the process is usually the quickest gain."
          : "Pp (" + f(o.cp, 2) + ") and Ppk (" + f(o.cpk, 2) + ") are close, so the process is well centered. To improve, reduce variation.";
        return { text: t };
      } }
    ];
  }

  function groupResults(r) {
    var v = r.verdict, name = (r.group_name || "Cavity").toLowerCase();
    return [
      { label: "Is this good enough for PPAP?", answer: function () {
        return { text: "The verdict follows the lowest " + esc(name) + ": " + esc(r.group_name) + " " + esc(r.worst) + ", with " + esc(v.index) + " " + f(v.value, 2) + ", so the study is <b>" + esc(v.label) + "</b>. PPAP: above 1.67 acceptable, 1.33 to 1.67 with customer approval, below 1.33 not acceptable." };
      } },
      { label: "Why not use the combined number?", answer: function () {
        return { text: "All " + esc(name) + "s combined gives Ppk " + f(r.combined.overall.cpk, 2) + ", but that mixes good and bad " + esc(name) + "s together. One off-center " + esc(name) + " can hide inside a combined number that looks fine, so it's shown for reference only." };
      } },
      { label: "A cavity is off-center, but tool wear moves it away", answer: function () {
        return { text: "Write that up in the <b>Engineering justification</b> box in the report section. It prints right after the summary, marked as your note, so the reviewer sees your reasoning next to the numbers." };
      } }
    ];
  }

  function type1Results(r) {
    var v = r.verdict;
    var list = [{ label: "Is my gage capable?", answer: function () {
      if (!v) { return { text: "Add the tolerance (spec limits) in Settings so Mensuro can judge Cg and Cgk." }; }
      return { text: "Mensuro's verdict is <b>" + esc(v.label) + "</b>: Cg " + f(v.cg, 2) + " and Cgk " + f(v.cgk, 2) + ", against a minimum of " + f(v.minimum, 2) + " (Bosch Booklet 10)." };
    } },
    { label: "Cg or Cgk: what's the difference?", answer: function () {
      return { text: "<b>Cg</b> looks only at the spread of your readings. <b>Cgk</b> also counts bias, how far the average is from the reference value." + (r.bias_test && r.bias_test.significant ? " Here the bias is statistically significant, so recheck the gage's zero or calibration." : " Here the bias isn't statistically significant.") };
    } },
    { label: "What next?", answer: function () {
      return { text: "If the gage passes, run a " + link("gage-rr.html", "Gage R&R") + " with your operators on production parts to see the whole measurement process." };
    } }];
    return list;
  }

  function context() {
    if (tool === "home" || tool === "planner") { return [chooser(), SAFE, WHAT]; }
    if (gateOpen()) { return [WHAT, SAFE]; }
    var n = step();
    if (n === 4) { return results().concat([chooser()]); }
    if (n === 3) { return settings().concat([SAFE]); }
    if (n === 2) { return mapping().concat([SAFE]); }
    return upload().concat([chooser()]);
  }
})();
