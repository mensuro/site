# Mensuro website

The public marketing site for Mensuro: plain HTML, CSS and a little JavaScript, with no build step. Hosted on Netlify, which redeploys on every merge to `main`.

```
index.html      Landing page
thanks.html     Post-signup questions and founding-member offer
privacy.html    Privacy page
assets/         Logos, favicon, images, site.css, site.js
netlify.toml    Netlify settings
```

The product itself (stats engine and app) lives in the private `mensuro/mensuro` repo.

## How it works

- **Early-access form:** posts to Kit once `kitFormAction` is set in `assets/site.js`. In Kit, set the form's "After subscribing" option to redirect to the site's `/thanks.html`.
- **Thank-you questions:** saved with Netlify Forms (form name `signup-details`). Enable form detection under Netlify → Forms. Multi-select answers arrive joined with `; `.
- **Founding pre-sale:** the "Reserve for $199" button uses `stripeLink` in `assets/site.js`.
- Until `kitFormAction` and `stripeLink` are filled in, the forms run in preview mode and send nothing.

## Local preview

Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000.

## Before launch

- Recheck the Minitab price line in the pricing section against minitab.com.
- Create the `hello@mensuro.ai` mailbox (footer and privacy page).
- When mensuro.ai is live, update the canonical, `og:url` and `og:image` URLs in `index.html`, and add the domain to `liveHosts` in `assets/site.js`.
- Add the analytics script tag to each page's `<head>` if you use Plausible or similar.
