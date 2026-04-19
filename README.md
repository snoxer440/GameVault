# Checkpoint Shelf

A lightweight browser app for scanning barcodes and tracking a video game collection, now tuned for iPhone-friendly use.

## Features

- Live barcode scanning with `@zxing/browser`
- `Scan From Photo` flow that works well on iPhone by opening the rear camera capture sheet
- Barcode metadata lookup that can prefill title, platform hints, notes, and cover art
- Local collection storage with `localStorage`
- Search, remove, and export collection items as JSON
- PWA manifest and service worker so it can be added to a home screen

## Run

Open [index.html](./index.html) in a modern browser. For camera access and service worker support, serve the folder from a tiny local web server instead of opening the file directly.

One simple option if Python is installed:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Notes

- The app imports `@zxing/browser` from a CDN at runtime, so internet access is required for scanning.
- Barcode lookup uses UPCitemdb. Direct browser requests may be blocked by CORS, so this prototype falls back to a public CORS proxy.
- For a production app, the barcode lookup should move behind your own small backend endpoint.

## Deploy To GitHub Pages

This repo includes a GitHub Pages workflow at `.github/workflows/pages.yml`.

1. Create a new GitHub repository.
2. Push this project to the `main` branch.
3. In GitHub, open `Settings` -> `Pages`.
4. Under `Build and deployment`, set `Source` to `GitHub Actions`.
5. Push again if needed, then wait for the `Deploy to GitHub Pages` workflow to finish.

Your site will be published at:

`https://<your-github-username>.github.io/<your-repo-name>/`
