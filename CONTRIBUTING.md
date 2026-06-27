# Contributing to Nodica

## Architecture overview

```
src/nodica.js          Core library – all logic, no DOM except GraphView
app.js                 Standalone app wiring – DOM, fetch, localStorage
index.html             Single-page UI
settings.ttl           Operator deployment settings (D10)
vocab/config-ontology.ttl  cfg: vocabulary
test/core-test.js      Node.js test harness (no browser)
examples/              Demo data and configs
test/test-uncle-graph.ttl  Real Wikidata data used as the default dataset
```

### Core library (`src/nodica.js`)

A classic IIFE script exposing `window.Nodica`. No build step, no modules. DOM-free except for `GraphView` (which needs `vis.Network`). This keeps it testable in Node and reusable as a YASR plugin or Fractal Graph component.

Key exports:

| Export | Purpose |
|---|---|
| `parseRdf(text)` | Parse Turtle/TriG/N-Triples → `{quads, prefixes}` |
| `parseConfig(text, opts)` | Parse a `cfg:` Turtle file → settings object |
| `mergeSettings(...layers)` | DEFAULTS < config < UI overrides |
| `sanitizeSettings(obj)` | Validate/coerce untrusted settings |
| `sanitizeUserSettings(obj)` | Same + strip operator-only terms |
| `detectImageProperty(quads, configured)` | Auto-detect if configured prop matches nothing |
| `buildModel(quads, settings, prefixes)` | Quads → `{nodes, edges, predicates, stats}` |
| `computeVisibility(edges, nodeIds, hidden)` | Pure function for property filter (D12) |
| `resolveEntityUrl(uri, settings)` | Dereference rules → URL to open (D11) |
| `configToTurtle(settings)` | Round-trip: settings → Turtle string |
| `toVisOptions(settings)` | Settings → vis-network options object |
| `GraphView(container, model, settings)` | vis-network wrapper with events |
| `CFG_NS` | `https://kvistgaard.github.io/config#` |
| `OPERATOR_TERMS` | `["dataSource", "fallback", "settingsLocked"]` |

### App wiring (`app.js`)

- Fetches `settings.ttl` at startup (falls back to embedded `DEFAULT_CONFIG`).
- Merges: DEFAULTS < deployment settings < persisted user overrides < live edits.
- Persists only the user's delta in `localStorage` under key `nodica.overrides.v1`.
- On `file://` pages, the embedded copy of the config is used (preloading skipped).

## Development workflow

```bash
npm install          # installs n3 (dev dep only; not bundled)
npm test             # 80 checks, < 2s
npm run serve        # http://localhost:8090/ with live uncle graph
```

The test suite covers all decisions D1–D12. Run it after every change.

### Adding a feature

1. If it touches the core (model building, config parsing, rendering options): add it to `src/nodica.js` and write tests in `test/core-test.js` before touching `app.js`.
2. If it's UI-only (new button, layout tweak): `app.js` and `index.html` only.
3. If it introduces a new `cfg:` term: update `vocab/config-ontology.ttl` first, then `CONFIG_TERMS` in `nodica.js`, then the `SAMPLE_CONFIG`/`DEFAULT_CONFIG` strings in `app.js` if the term needs a default, and `settings.ttl`.

### Changing `settings.ttl`

The embedded `DEFAULT_CONFIG` string in `app.js` is a copy of `settings.ttl`. Keep them in sync: the test suite checks `settings.ttl` but `app.js`'s copy is only exercised in the browser on `file://` pages.

### Security notes

- All node/edge `title` values must go through `escapeHtml()` – vis-network renders them as raw HTML.
- `resolveEntityUrl()` rejects any result that is not `http(s)://` – keep this guard for any new URL-opening code.
- `sanitizeUserSettings()` strips operator-only terms – use it on everything coming from the user side (localStorage, panel inputs).

## cfg: vocabulary

Namespace: `https://kvistgaard.github.io/config#`  
Ontology file: `vocab/config-ontology.ttl`  
To be published at: `https://kvistgaard.github.io/config`

New terms should be added to the ontology first with `rdfs:isDefinedBy <https://kvistgaard.github.io/config>`. Terms marked `cfg:operatorOnly true` are stripped from user-side input by `sanitizeUserSettings`.

## Examples

`examples/scientists.ttl` and `examples/scientists-config.ttl` are the built-in sample. When adding a new demo dataset, add it under `examples/` and wire it with a matching `*-config.ttl`. The test harness reads example files directly.

## Roadmap (planned adapters)

- **YASR plugin** (`src/nodica-yasr-plugin.js`) – thin wrapper implementing `Yasr.Plugin`, consuming `resultSet.getOriginalResponseAsString()` then calling `Nodica.parseRdf` + `buildModel`.
- **JSON-LD** – `jsonld.toRDF(doc, {format:"application/n-quads"})` produces N-Quads that feed straight into `parseRdf`.
- **Fractal Graph** – edge-click event already emitted by `GraphView`; host supplies sub-graph RDF and the view swaps.
