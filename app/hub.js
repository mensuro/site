/* Mensuro app home: the access code once, then the choice of study. */
(function () {
  "use strict";
  function $(s) { return document.querySelector(s); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* fine */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* fine */ } }
  };
  var params = new URLSearchParams(location.search);
  var apiBase = (params.get("api") || (window.MENSURO_APP && MENSURO_APP.apiBase) || "").replace(/\/+$/, "");
  var keep = params.get("api") ? "?api=" + encodeURIComponent(params.get("api")) : "";
  if (keep) {
    Array.prototype.forEach.call(document.querySelectorAll(".hub-card, .app-nav a"), function (a) {
      var h = a.getAttribute("href");
      if (/\.html$/.test(h)) { a.setAttribute("href", h + keep); }
    });
  }

  function show(open) {
    $("#gate").hidden = open;
    $("#hub").hidden = !open;
    $("#hub-foot").hidden = !open;
    $("#forget").hidden = !open;
    if (!open) { $("#code").focus(); }
  }
  function err(msg) { var b = $("#gate-error"); b.textContent = msg || ""; b.hidden = !msg; }

  $("#gate-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#code").value.trim();
    if (!code) { err("Enter the access code."); return; }
    if (!apiBase) { err("The preview server isn't connected yet."); return; }
    err("");
    fetch(apiBase + "/v1/access", { headers: { "X-Mensuro-Access": code } }).then(function (r) {
      if (r.ok) { store.set("mensuro_access", code); show(true); return; }
      return r.json().catch(function () { return {}; }).then(function (j) { err(j.error || "That access code isn't right."); });
    }, function () { err("Couldn't reach the Mensuro server. Check your connection and try again."); });
  });
  $("#forget").addEventListener("click", function () { store.del("mensuro_access"); $("#code").value = ""; show(false); });

  // An invite link can carry the code (mensuro.tech/app/?code=...): check it, keep it on this
  // device, and take it out of the address bar so it isn't shared by accident.
  var linkCode = (params.get("code") || "").trim();
  if (linkCode) {
    params.delete("code");
    var rest = params.toString();
    try { history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash); } catch (e) { /* fine */ }
    $("#code").value = linkCode;
    show(false);
    $("#gate-form").requestSubmit ? $("#gate-form").requestSubmit() : $("#gate-form").dispatchEvent(new Event("submit", { cancelable: true }));
    return;
  }
  show(!!store.get("mensuro_access"));
})();
