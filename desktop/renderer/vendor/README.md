# Vendored runtime libraries

These are committed on purpose. The renderer previously loaded its entire JS
runtime + fonts from unpkg / cdn.jsdelivr.net at launch — a CDN/MITM supply-chain
RCE surface (a hijacked script runs in the renderer with full `window.lore` IPC
access). They are now served locally so the app never fetches executable code or
fonts over the network, and the CSP drops all remote hosts.

## Versions (pinned)
| File | Package | Version |
|------|---------|---------|
| `react.js` | react (UMD, production.min) | 18.3.1 |
| `react-dom.js` | react-dom (UMD, production.min) | 18.3.1 |
| `babel.min.js` | @babel/standalone | 7.29.0 |
| `lucide.min.js` | lucide (UMD) | 1.23.0 (was `@latest`) |
| `markdown-it.min.js` | markdown-it | 14.1.0 |
| `d3.min.js` | d3 | 7.9.0 |
| `fonts/ibm-plex-*.woff2` | @fontsource/ibm-plex-{sans,serif,mono} | latin subset (was `@latest`) |

## Re-fetch / upgrade
```bash
cd desktop/renderer/vendor
curl -sfo react.js           https://unpkg.com/react@18.3.1/umd/react.production.min.js
curl -sfo react-dom.js       https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
curl -sfo babel.min.js       https://unpkg.com/@babel/standalone@7.29.0/babel.min.js
curl -sfo lucide.min.js      https://unpkg.com/lucide@1.23.0/dist/umd/lucide.min.js
curl -sfo markdown-it.min.js https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js
curl -sfo d3.min.js          https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
```
Fonts: see the `@font-face` rules in `renderer/design/tokens/fonts.css`.
**Never** reintroduce a `@latest` or CDN URL — pin explicit versions.

## Remaining hardening (follow-up)
JSX is still compiled in-browser by `@babel/standalone`, so the CSP keeps
`'unsafe-eval'`/`'unsafe-inline'` on `script-src`. With no remote script source
and `connect-src` locked to localhost there is no injection vector, but dropping
`unsafe-eval` entirely requires precompiling the `.jsx` at build time.
