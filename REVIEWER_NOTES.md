# Notes for AMO / Chrome Web Store reviewers

## Build
No bundler or transpiler is used. `node build.mjs` copies the files listed in `build.mjs` into `dist/firefox` and `dist/chrome`
(only `manifest.json` differs) and runs consistency checks. Third-party files in `libs/` are unmodified npm release files;
exact versions, hashes and the reproduction commands are in `THIRD_PARTY_NOTICES.md`.

## Data transmission (summary; full text in PRIVACY.md)
Two destinations, both HTTPS, no cookies (`credentials: "omit"`), no referrer (`referrerPolicy: "no-referrer"`):
- `pubchem.ncbi.nlm.nih.gov`: the primary destination for every search.
- `www.wikidata.org`: used only (a) when PubChem's English name/formula search finds nothing, as a Japanese-name fallback,
  and (b) when the user switches the display language to Japanese, to look up a compound's Japanese label from its PubChem CID.
  Both calls use the public, CORS-enabled `action=wbsearchentities` / `action=wbgetentities` / `action=query` endpoints with
  `origin=*` (see https://www.mediawiki.org/wiki/API:Cross-site_requests). No API key, no account, no write access.

What is sent: text the user typed in the search box or explicitly selected and sent via "Analyze" (to PubChem, and to Wikidata
only as the fallback described above), the PubChem CID of the currently displayed compound (to Wikidata, only when the user
switches to Japanese display), and (only if the optional page-highlight feature is enabled) a formula-like string the user
**clicked** on a page. Hovering sends nothing. No analytics, no remote code, no developer server.
Declared in `data_collection_permissions`: `searchTerms`, `websiteContent` (required, because the extension cannot work without them).

## GHS hazard statement translation (Japanese)
Hazard statement translations use a static, offline dictionary (`GHS_JA` in `pubchem.js`) mapping H-codes (H200-H420) to
Japanese text, based on the Japanese Ministry of Health, Labour and Welfare's provisional translation of UN GHS Annex 3.
No network request is made for this; only the H-code prefix of PubChem's English statement is matched against the dictionary.

## About the `eval` warning in libs/3Dmol-min.js (DANGEROUS_EVAL)
This is upstream 3Dmol.js 2.5.5 (BSD-3-Clause), unmodified. The single `eval` is inside `makeFunction(callback)` and runs only when a
**string** is passed as a callback (a legacy convenience). This extension never calls that API with a string, and under the MV3
default CSP (no `unsafe-eval`) it could not run anyway. The other 3Dmol builds in the npm package contain the same code.
Helper functions in the library that can download PDB/PubChem data are never called; all structure data is fetched by `pubchem.js`.

## Permissions
- `host_permissions`: `https://pubchem.ncbi.nlm.nih.gov/*` and `https://www.wikidata.org/*` (see "Data transmission" above).
- `optional_host_permissions: <all_urls>`: requested at runtime only when the user turns on page highlighting; revoked when it is turned off.
  No `content_scripts` are declared; the highlight script is registered dynamically via `scripting.registerContentScripts`.
- `activeTab` + `scripting`: read the current selection when the keyboard shortcut is pressed.
- `contextMenus`, `storage`: context menu entry; history/settings (`storage.local`) and a one-minute in-memory hand-off (`storage.session`).
- `sidePanel` (Chrome build only).

## Page highlight (optional, off by default)
The content script never talks to the network. On click (hover sends nothing), it sends a message (`chemviewer:analyze`) to the
background script with the normalized formula string; the background script validates that the string parses as a chemical
formula, then follows the same path as the context-menu/keyboard-shortcut flow (store as a pending query, attempt to open the
popup). It does not change visible page text (it wraps matches in a `<span>`); links, buttons, code and editable fields are
skipped. Deuterium/tritium (D/T) notation is intentionally excluded from automatic page scanning (but allowed in the manual
search box) because it caused false positives on common acronyms (HTTP2, COVID19, UTF8); see `formula.js` comments.
