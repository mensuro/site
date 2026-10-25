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
- **Caching:** CSS and JS revalidate on every visit, so deploys show up at once. Pages link them with `?v=...`; bump that value when you want browsers that cached an older copy to refetch.
- **No third-party requests:** fonts are self-hosted (`assets/fonts`, SIL Open Font License). Keep it that way, or update the privacy page.

## Tracking which posts bring signups

There's no analytics tool yet. Instead, tag every link you post:

```
https://mensuro.tech/cpk-calculator.html?utm_source=linkedin&utm_campaign=post-01
```

The tag is kept for the visitor's tab and saved with their early-access signup in Netlify Forms (field `ref`, e.g. `source=linkedin; campaign=post-01`). The `source` field says which form they used (hero, final or calculator).

## Local preview

Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000.

## Before launch

- Recheck the Minitab price line in the pricing section against minitab.com.
- The site lives at https://mensuro.tech. Netlify redirects `www.mensuro.tech` and `mensuro.netlify.app` to it once the domain is set as primary.
- Contact address: `nick@mensuro.tech` (footer and privacy page). Keep the mailbox working; the privacy page promises a reply within 30 days.
- If the domain ever changes: update the canonical, `og:url` and `og:image` URLs in `index.html` and `cpk-calculator.html`, the URLs in `sitemap.xml` and `robots.txt`, and `liveHosts` in `assets/site.js`. Then re-check link previews with LinkedIn's Post Inspector.
- Add the analytics script tag to each page's `<head>` if you use Plausible or similar.

## App preview (private)

`app/gage-rr.html` is the Gage R&R upload, column mapping and results screen. It isn't
linked from the site, is excluded in `robots.txt` and sends `X-Robots-Tag: noindex`, and it
only works with an access code checked by the API (see `api/README.md` in the engine repo).

- Set the API address in `app/app-config.js` (`apiBase`) once the API is deployed.
- Local testing: run the API with `MENSURO_DEV=1`, serve this folder, and open
  `http://localhost:8000/app/gage-rr.html?api=http://localhost:8000` (adjust ports).
- Sample files in `app/samples/` are the published AIAG MSA 4th edition worked example.
