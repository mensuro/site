/* Mensuro site behavior.
   On the live site, signups and thank-you answers are saved in Netlify Forms ("early-access"
   and "signup-details"). Setting kitFormAction sends signups to Kit instead. Anywhere else
   (a local preview) the forms send nothing and just move to the thank-you page. */
var MENSURO_CONFIG = {
  // Kit (ConvertKit) form endpoint, from the form's HTML embed code, e.g.
  // "https://app.kit.com/forms/1234567/subscriptions". In Kit, set the form's
  // "After subscribing" option to redirect to https://mensuro.ai/thanks.html
  kitFormAction: "",
  // Stripe Payment Link for the $199 founding membership, e.g. "https://buy.stripe.com/..."
  stripeLink: "",
  // Hosts where the Netlify forms should really submit (any *.netlify.app address also counts).
  liveHosts: ["mensuro.ai", "www.mensuro.ai"]
};

(function () {
  function store(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* storage blocked: fine */ }
  }
  function read(key) {
    try { return sessionStorage.getItem(key) || ""; } catch (e) { return ""; }
  }
  var isLive = MENSURO_CONFIG.liveHosts.indexOf(location.hostname) !== -1 || /\.netlify\.app$/.test(location.hostname);

  // Early-access forms (hero and final band)
  Array.prototype.forEach.call(document.querySelectorAll("form.join-form"), function (form) {
    var input = form.querySelector('input[type="email"]');
    var error = form.querySelector(".form-error");
    form.addEventListener("submit", function (event) {
      var email = (input.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        event.preventDefault();
        if (error) { error.hidden = false; error.textContent = "Enter a work email like you@company.com."; }
        input.focus();
        return;
      }
      if (error) { error.hidden = true; }
      store("mensuro_email", email);
      if (MENSURO_CONFIG.kitFormAction && isLive) {
        form.action = MENSURO_CONFIG.kitFormAction;
        form.method = "post";
        return; // native POST to Kit; Kit redirects to thanks.html
      }
      event.preventDefault();
      if (!isLive) { location.href = "thanks.html"; return; }
      // Save the signup in Netlify Forms ("early-access") before moving to the thank-you page.
      var button = form.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; }
      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)).toString()
      })
        .then(function (r) {
          if (!r.ok) { throw new Error(r.status); }
          location.href = "thanks.html";
        })
        .catch(function () {
          if (button) { button.disabled = false; }
          if (error) { error.hidden = false; error.textContent = "We couldn't save your email. Check your connection and try again."; }
        });
    });
  });

  // Thank-you page: qualifying questions (Netlify Forms) and founding pre-sale
  var details = document.getElementById("signup-details");
  if (details) {
    var emailField = details.querySelector('input[name="email"]');
    if (emailField) { emailField.value = read("mensuro_email"); }
    var status = document.getElementById("details-status");
    details.addEventListener("submit", function (event) {
      event.preventDefault();
      // Multi-select chips: join each group into one hidden field, so every answer lands in one column.
      [["role_pick", "role"], ["tool_pick", "current_tool"], ["analysis_pick", "top_analysis"]].forEach(function (pair) {
        var picked = Array.prototype.map.call(details.querySelectorAll('input[name="' + pair[0] + '"]:checked'), function (box) { return box.value; });
        details.querySelector('input[name="' + pair[1] + '"]').value = picked.join("; ");
      });
      var form = new FormData(details);
      ["role_pick", "tool_pick", "analysis_pick"].forEach(function (name) { form.delete(name); });
      var data = new URLSearchParams(form).toString();
      if (!isLive) {
        status.hidden = false;
        status.textContent = "Preview: your answers are not sent from this copy of the page.";
        return;
      }
      fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: data })
        .then(function (r) {
          if (!r.ok) { throw new Error(r.status); }
          status.hidden = false;
          status.textContent = "Saved. Thanks, that helps us build the right analysis first.";
          details.querySelector("button[type=submit]").disabled = true;
        })
        .catch(function () {
          status.hidden = false;
          status.textContent = "We couldn't save your answers. Check your connection and try again.";
        });
    });
  }

  var reserve = document.getElementById("reserve");
  if (reserve) {
    if (MENSURO_CONFIG.stripeLink) {
      reserve.href = MENSURO_CONFIG.stripeLink;
    } else {
      reserve.addEventListener("click", function (event) {
        event.preventDefault();
        var note = document.getElementById("reserve-note");
        if (note) { note.hidden = false; }
      });
    }
  }
})();
