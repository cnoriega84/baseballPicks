# Diamond Oracle — Flat GitHub Pages Build

This version has **no folders**. Upload these files directly to the root of your GitHub repo.

## Files

- `index.html` — the page
- `styles.css` — the design
- `app.js` — browser-side MLB model and card rendering
- `picks.json` — AI-readable pick feed at `/picks.json`
- `generate-picks.mjs` — optional local script to refresh `picks.json`
- `README.md` — this guide

## Upload to GitHub

1. Open your GitHub repo.
2. Click **Add file** → **Upload files**.
3. Drag these individual files into the upload page.
4. Commit changes.
5. Go to **Settings** → **Pages**.
6. Set source to `Deploy from branch`, branch `main`, folder `/root`.

Your page should load at:

`https://YOUR-USERNAME.github.io/YOUR-REPO/`

Your AI-readable feed should be:

`https://YOUR-USERNAME.github.io/YOUR-REPO/picks.json`

For your repo, that should be:

`https://cnoriega84.github.io/baseballPICKS/picks.json`

## Important limitation

Because this version has no `.github/workflows` folder, GitHub cannot auto-refresh `picks.json` on a schedule. The website cards still update in the browser when someone visits the page, but the public `picks.json` file is static until you update it.

To refresh the JSON manually from your computer:

```bash
node generate-picks.mjs
```

Then upload/commit the updated `picks.json` file to GitHub.

You can also generate a specific date:

```bash
node generate-picks.mjs 2026-07-10
```

## No backend

This build does not use `server.js`, Express, `/api/analyze`, Polymarket, star wallets, or wallet tracking. It is pure HTML, CSS, JavaScript, and JSON.
