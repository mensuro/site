# Mensuro website

The public marketing site for Mensuro: plain HTML, CSS and a little JavaScript, with no build step. Hosted on Netlify, which redeploys on every merge to `main`.

```
index.html      Landing page
thanks.html     Post-signup questions and founding-member offer
privacy.html    Privacy page
cpk-calculator.html  Free Cp/Cpk calculator (math in assets/cpk.js, page logic in assets/calculator.js)
assets/         Logos, favicon, images, self-hosted fonts, site.css, site.js
tests/          Calculator tests and their reference data (run on every pull request)
netlify.toml    Netlify settings
```

The product itself (stats engine and app) lives in the private `mensuro/mensuro` repo.

## How it works

- **Early-access forms** (home page and calculator): saved with Netlify Forms (form name `early-access`; the `source` field says which form). If `kitFormAction` is set in `assets/site.js`, signups go to Kit instead; in Kit, set "After subscribing" to redirect to `/thanks.html`.
- **Thank-you questions:** saved with Netlify Forms (form name `signup-details`). Enable form detection under Netlify → Forms. Multi-select answers arrive joined with `; `.
- **Founding pre-sale:** the "Reserve for $199" button uses `stripeLink` in `assets/site.js`.
- On a local preview (not the live host), the forms send nothing.
- **Cp/Cpk calculator:** runs entirely in the browser; it makes no network requests and stores nothing. Run its tests with `node --test "tests/*.test.js"` (Node 22). They check it against NIST and Montgomery reference results and against the Mensuro engine (`tests/reference/engine_parity.json`, generated from the engine). If the engine's capability math changes, regenerate that file.
- **No third-party requests:** fonts are self-hosted (`assets/fonts`, SIL Open Font License). Keep it that way, or update the privacy page.

## Local preview

Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000.

## Before launch

- Recheck the Minitab price line in the pricing section against minitab.com.
- Create the `hello@mensuro.ai` mailbox (footer and privacy page).
- When mensuro.ai is live, update the canonical, `og:url` and `og:image` URLs in `index.html`, and add the domain to `liveHosts` in `assets/site.js`.
- Add the analytics script tag to each page's `<head>` if you use Plausible or similar.
