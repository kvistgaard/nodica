# Changelog

All notable changes to Nodica are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries cite the decision that explains them (`D20`, …). The decisions live in
[`decision-log.md`](decision-log.md), which stays the authoritative record of
*why* something was done; this file is the short answer to *what changed when*.

## [Unreleased]

## [0.4.1] - unreleased

### Changed

- **The uncle-relations demo is labelled.** It carried
  no `rdfs:label` at all, so file mode's default graph showed `wd:Q199484` on
  every node and `ex:hasUncle` on every edge. It now has an English label for
  each of its 194 entities (from the Wikidata API) and one on the predicate,
  so the graph reads as names and "has uncle". The predicate label adds no
  node, since that URI is used only as a predicate (D17). This is the dataset
  D18 flagged as a poor demonstration.
- **`test/test-uncle-graph.ttl` moved to `examples/uncle-graph.ttl`.** It is
  file mode's shipped default dataset, not a test fixture – the same reasoning
  that moved the default SPARQL query out of `test/` in 0.3.0 (D28). Anyone
  running a fork with a customised `settings.ttl` that points at the old path
  needs to update `cfg:dataSource`.

### Fixed

- **Dark theme now has dark scrollbars** (issue #1). Browsers paint scrollbars,
  checkboxes, number spinners and the colour-input swatch from the CSS
  `color-scheme` property, which no stylesheet declared, so those controls
  stayed light while everything around them went dark. `assets/theme.css`
  declares it alongside the tokens (D19), which is enough for both pages, the
  YASGUI query editor and the plugin's panels, since the property inherits.
  `npm run test:browser` gained a check per scenario (108 → 112). It reads the
  computed property; a screenshot would prove nothing here, since headless
  Chromium draws overlay scrollbars that occupy no space.

## [0.4.0] - 2026-08-08

The first version published as a GitHub release. Earlier versions exist as
tags only.

### Added

- **Label fallback cascade.** When `cfg:labelProperty` has no value for a
  subject, Nodica now falls back through `rdfs:label`, `skos:prefLabel`,
  `schema:name` (both http and https forms), `dcterms:title` and `foaf:name`,
  resolved per subject; the configured property still wins wherever it is
  present. Data labelled with any of these renders named nodes and edges with
  no configuration. Measured cost: none (buildModel median 1.68 ms before,
  1.32 ms after, on the 379-quad demo graph). The order ships as
  `Nodica.LABEL_CASCADE`. One visible change: a subject carrying two label
  properties no longer sprouts a literal box for the losing one - both
  triples count as labels. (D30)
- `test/embed-fixture-triply.html` – the bare-host embed check now runs against
  upstream Triply YASGUI (`@triply/yasgui@4.2.28`) as well as the Matdata fork
  (`@matdata/yasgui@5.20.3`), so `npm run test:browser` covers two YASGUI
  lineages instead of one. The README's claim that the plugin works in any
  YASGUI deployment is now asserted rather than assumed.

## [0.3.0] - 2026-08-07

SPARQL mode becomes the front door, and a query can now say which property
fills its nodes.

### Changed – action may be required

- **SPARQL mode is now `index.html`; file mode moved to `file-mode.html`.**
  The bare deployment URL opens the query editor. **A bookmark or link to
  `sparql.html` will 404** – use the site root instead; links to `index.html`
  meaning file mode now land on SPARQL mode. The two pages link to each other
  from their headers. (D27)
- **File mode's built-in fallback sample is the Enlightenment-influences
  graph** (`examples/influences.ttl`, real Wikidata output) instead of the
  synthetic scientists set, so both modes show the same graph when nothing
  else is available. `cfg:dataSource` is unchanged – file mode still opens on
  the uncle-relations graph when it can be fetched. The scientists files moved
  from `examples/` to `test/`, where they remain as test fixtures. (D27)

### Added

- **`# nodica:image` – choose the image property from inside the SPARQL
  query.** Mark the property on the line where it is used and the query
  carries its own presentation, so sharing the query reproduces the graph;
  `# nodica:image wdt:P18` names it explicitly. Parsed by
  `Nodica.parseQueryDirectives()` (new, in the core), merged over the page
  config and sanitized as user-level input so a pasted query cannot set
  operator-only terms. (D26)
- `NodicaPlugin#setQuerySettings()` – how a host page passes query-derived
  settings in, since a YASR plugin cannot reach the query itself. (D26)
- SPARQL mode's default query is now an Enlightenment-influences graph
  carrying its own image marker, **read from `examples/influences.rq`** rather
  than pasted into the page – edit the file to change the query. An inline
  copy remains as the `file://` fallback, where fetching a sibling file is
  impossible, and a test asserts the two stay byte-identical. Measured cost
  of the fetch: 5–9 ms, indistinguishable from run-to-run noise end to end.
  (D26, D28)
- `npm run sync:query` (`tools/sync-query.cjs`) – copies `examples/influences.rq`
  into the inline `file://` fallback in `index.html`, which `npm test` requires
  to be identical. Edit the query, run this, done. (D28)
- `test/embed-fixture.html` – a bare YASGUI page containing only what the
  README tells a third party to write, asserted by `npm run test:browser`. It
  immediately earned itself: the documented snippet was missing
  `Yasgui.Yasr.defaults.defaultPlugin = "nodica"`, without which YASR lands on
  Table and the graph is never drawn. The plugin itself needed no change –
  it renders, styles and controls itself correctly with no host CSS.
- `test/browser-smoke.mjs` (`npm run test:browser`) – browser regression checks
  for SPARQL mode: footer placement, graph filling its panel, column
  alignment, the Properties filter, layout controls, and button colours,
  across two viewport sizes, both themes, every results view, **both layout
  orientations, and the returning-user reload path**. Controls are asserted
  *visible at their screen position* (`elementFromPoint`), not merely present
  in the DOM – presence passed while everything was collapsed to 2px. Each
  assertion corresponds to a defect that reached a user; `npm test` covers the
  DOM-free core only, which is why they were not caught. (D23, D24)

### Removed

- `assets/logo.svg` – unreferenced since D16 replaced it with an inline
  `currentColor` SVG so the logo would not vanish in dark mode.

### Changed

- **SPARQL mode's vertical layout is now pure CSS.** The JavaScript that
  measured the graph's position and set a pixel height on it is gone; flexbox
  pins the footer for every results view instead. (D23)

### Fixed

- **SPARQL mode: the query editor can be resized again, and has one scrollbar
  instead of two.** A `max-height` added in 0.2.x silently overrode the inline
  height YASQE's drag grip writes, so the grip did nothing; the `overflow-y`
  beside it stacked a second native scrollbar on CodeMirror's own. Both are
  gone – the editor was never auto-growing and never lacked a scroller, which
  was the premise they were added on. Its starting height is now fitted to the
  window instead, and left alone entirely once you drag it. (D25)
- **SPARQL mode: the graph no longer disappears on short windows.** The
  results pane could collapse to zero height, which also hid the fact that
  anything was wrong – the page reported no overflow. It now keeps a floor.
  (D25)
- **SPARQL mode: Horizontal Layout (the fork's side-by-side mode) no longer
  collapses the graph to 2px**, which took the Properties filter and the
  layout controls with it – in the DOM but invisible. The fork pins its
  results column to an explicit small height there; the column now stretches
  to the row. The graph, filter and controls were never removed from the
  code (`src/` is untouched this session). They were rendered into a
  collapsed container, in an orientation no earlier check ever ran in. (D24)
- **SPARQL mode: the Response view neither gets squeezed by the query
  editor's height cap (an over-broad selector) nor overflows the page on
  short windows** – its CodeMirror is a flex item that scrolls internally,
  like the graph. (D24)
- **SPARQL mode: the footer no longer floats above the bottom of the window in
  the Table or Response views, or on a new tab** (measured: 436px, 233px and
  436px of dead space). The old JavaScript fit sized only the Nodica graph
  container, so any view without one left nothing holding the page open. (D23)
- **SPARQL mode: the graph fills the results panel** instead of stopping short
  and leaving blank space above the footer – YASGUI's `.yasrWrapperEl` does
  not grow, capping the panel at its content height. (D23)
- **SPARQL mode: the graph no longer sits at a fixed 560px with dead space
  below the footer on tall viewports.** Its height is now fit to actual
  available space (viewport height minus the graph's rendered top position
  minus the footer), re-measured on resize and on every redraw, floored at
  420px so short windows scroll instead of squashing the canvas. YASGUI's own
  editor/results layout is untouched – only Nodica's own container is resized.
  (D22)
- **SPARQL mode: the footer is reachable without scrolling at any realistic
  window height.** YASGUI's stylesheet pinned the page at a minimum 904px
  (`.yasgui{min-height:800px}` plus `.yasr{min-height:400px}`) no matter how
  small its contents were; both are now released, so the page is sized by its
  actual content. Measured overflow is 0 at every viewport height from 620px
  up. (D22)
- **SPARQL mode: the query editor is sized to fit a short window** on load,
  and left alone once you resize it yourself. (An earlier attempt within this
  release capped it in CSS instead; that broke drag-to-resize and is described
  under the editor fix below. D22, corrected by D25.)
- **SPARQL mode: the graph fit was 16px short**, subtracting only the footer
  and not `#yasgui`'s bottom padding – enough on its own to keep a scrollbar
  alive on every screen size. It now measures the whole span below the graph.
  (D22)
- **SPARQL mode: the footer and the "Query Types"/"Patterns" buttons now line
  up with the rest of the page.** The footer ran the full width of the window
  rather than the 16px content column shared by the editor and graph panels,
  and YASGUI's snippets bar indented those two buttons 10px past every other
  row. The footer is now a bordered card on that column, with an even 16px
  gap on all four sides and its text inset from its own border. (D22)

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
  of as the original upload – those are routinely 10–30 MB, and one image in
  the bundled demo data was a 30 MB TIFF. `0` restores the old behaviour.
  Exposed in the settings panel as "Image width". (D20)
- `GraphView` emits `stabilizationProgress` and `stabilized`, so a host can say
  what is happening while vis-network lays out the graph behind a blank canvas.
  File mode shows it in the status line; the YASR plugin in an overlay. (D20)
- `Nodica.LIMITS` – the size thresholds that change rendering behaviour, in one
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
- SPARQL mode only auto-runs the demo query on a genuine first visit – when no
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
SPARQL mode, shared theming. See `decision-log.md` D1–D19.

[0.4.1]: https://github.com/kvistgaard/nodica/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kvistgaard/nodica/releases/tag/v0.4.0
