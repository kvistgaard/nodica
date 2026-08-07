# Changelog

All notable changes to Nodica are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries cite the decision that explains them (`D20`, …). The decisions live in
[`decisions-log.md`](decisions-log.md), which stays the authoritative record of
*why* something was done; this file is the short answer to *what changed when*.

## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-08-07

A performance and user-experience release. No API was removed and no
configuration file needs changing; existing `settings.ttl` files keep working.

Measured on `test/test-uncle-graph.ttl` (194 nodes, 157 edges, 194 images) in
headless Chromium, same machine and connection before and after:

| | before | after |
|---|---|---|
| All images finished loading | 142.5 s | **3.0 s** |
| Slowest single image | 59.7 s | **3.1 s** |
| Image requests over `http://` (a redirect each) | 194 | **0** |
| SPARQL mode, return visit: endpoint calls | 1 | **0** |
| SPARQL mode, return visit: time to graph | 2376 ms | **183 ms** |

### Added

- `cfg:imageMaxWidth` (default `400`, user-settable): node images that come
  from a MediaWiki `Special:FilePath` URL are requested at this width instead
  of as the original upload — those are routinely 10–30 MB, and one image in
  the bundled demo data was a 30 MB TIFF. `0` restores the old behaviour.
  Exposed in the settings panel as "Image width". (D20)
- `GraphView` emits `stabilizationProgress` and `stabilized`, so a host can say
  what is happening while vis-network lays out the graph behind a blank canvas.
  File mode shows it in the status line; the YASR plugin in an overlay. (D20)
- `Nodica.LIMITS` — the size thresholds that change rendering behaviour, in one
  place instead of duplicated between the app and the plugin. (D20)
- `Nodica.applyPerformanceGuards()`, `Nodica.applyPositions()`,
  `Nodica.normalizeImageUrl()`, `GraphView#getPositions()`. (D20)
- `CHANGELOG.md` (this file) and a documented release practice. (D21)

### Changed

- Image URLs on Wikimedia hosts are upgraded to `https://` even when the page
  is served over `http://`, removing one redirect per image. Every other host
  keeps the previous rule (upgrade only on an https page, D9). (D20)
- `toVisOptions(settings, hints)` takes the model's size and scales two options
  to it: vis-network's Kamada-Kawai pre-layout is switched off above 150 nodes
  (its own `clusterThreshold`, above which it clusters first and gets much
  slower), and curved edges above 500 edges. Called without hints, nothing
  changes. (D20)
- SPARQL mode only auto-runs the demo query on a genuine first visit — when no
  response was restored *and* the tab still holds the demo query verbatim. A
  query you wrote is never re-executed against the endpoint behind your back.
  (D20)
- All CDN scripts on both pages are `defer`red and preceded by `preconnect`
  hints, so ~3 MB of JavaScript no longer blocks first paint. (D20)
- Fetching a data or configuration URL now renders immediately instead of
  asking for a separate Render click. `?data=` and `?config=` are sequenced
  (configuration first, then data, one render) rather than racing. (D20)
- The YASR plugin caches the parsed model per response and restores node
  positions across redraws, so switching YASR views is instant and does not
  reshuffle a layout you arranged. (D20)
- `shorten()` is now built once per document (`makeShortener`) instead of
  rebuilding its prefix table for every node and every edge. (D20)
- Ontology `owl:versionInfo` 0.3.0 → 0.4.0 (new term). Test suite grew from
  123 to 159 checks.

### Fixed

- **Duplicated controls in the YASR plugin.** Two overlapping `draw()` calls
  each built their own Properties panel and control bar into the same
  container, and left an orphaned `GraphView` whose network and
  `MutationObserver` were never destroyed. Present since the controls were
  added (D18); reproduced against a clean checkout of `533a796` before fixing.
  Draws are now serialised with a token, the same way `app.js` serialises
  renders. (D20)
- Changing "Property language" (`cfg:edgeLabelLanguage`) in the settings panel
  did nothing, because it affects the model but was not in the rebuild list.
  (D20)
- A failed `?data=` fetch silently fell back to the built-in sample, burying
  the error. It now leaves the error visible. (D20)

## [0.1.0] - 2026-07-11

First working version: core library, standalone file-mode app, YASR plugin for
SPARQL mode, shared theming. See `decisions-log.md` D1–D19.
