# CT Town Clerk Puppeteer discovery bridge

This optional bridge renders only seed pages that `scrape_ct_clerks.py` already
approved under its robots policy, including public pages whose plain HTTP fetch
returned 403. It emits candidate document URLs as JSON; the Python driver
remains responsible for downloads, throttling, deduplication, manifests, and
ZIP files.

Install from the repository root:

```powershell
Push-Location .\tools\ct-clerk-puppeteer
npm install
Pop-Location
```

Enable it:

```powershell
python .\scrape_ct_clerks.py `
  --towns .\towns.json `
  --out .\data\ct-town-clerks `
  --puppeteer-fallback `
  --resume
```

It can be combined with `--external-discovery-cmd`: the external Firecrawl
helper runs first, and Puppeteer runs only if that helper fails or returns no
URLs.

Optional environment controls:

- `CT_CLERK_BROWSER_MAX_PAGES` — maximum robots-approved seed pages rendered
  for one town; default `20`.
- `CT_CLERK_BROWSER_SETTLE_MS` — delay after DOM ready before extraction;
  default `2000`.

The bridge does not click login, CAPTCHA, consent, or paywall controls.
