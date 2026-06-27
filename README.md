# Nodica

Visualise RDF graphs with image-filled nodes. Load any Turtle, TriG, or N-Triples file and the graph renders immediately, with each node filled by the image named in the data. Everything about how the graph looks and behaves — which property supplies the image, node sizes, edge lengths, colors, click-through rules — is itself expressed in RDF, so your configuration is data too: queryable, shareable, and version-controlled alongside your datasets.

**[Use it right away →](https://kvistgaard.github.io/nodica)**

---

## Configuration is RDF

The `cfg:` vocabulary (`vocab/config-ontology.ttl`, namespace `https://kvistgaard.github.io/config#`) describes every aspect of the visualisation. A minimal config is a handful of Turtle triples:

```turtle
@prefix cfg:    <https://kvistgaard.github.io/config#> .
@prefix wdt:    <http://www.wikidata.org/prop/direct/> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .

<#my-graph> a cfg:Configuration ;
    cfg:imageProperty  wdt:P18 ;
    cfg:labelProperty  rdfs:label ;
    cfg:nodeSize       50 ;
    cfg:edgeLength     200 ;
    cfg:physicsEnabled true .
```

Paste or load any such file in the Configuration panel, adjust settings interactively, and export back to Turtle. The full vocabulary:

| Term | Meaning |
|---|---|
| `cfg:imageProperty` | RDF property whose value fills each node with an image |
| `cfg:labelProperty` | RDF property supplying the node label (default `rdfs:label`) |
| `cfg:dataSource` | RDF file to preload at startup — relative IRI resolved against the config (operator-only) |
| `cfg:fallback` | `cfg:Sample` or `cfg:Empty` when the data source is unavailable (operator-only) |
| `cfg:settingsLocked` | Hide the settings panel and ignore user overrides (operator-only) |
| `cfg:dereferenceRule` | Rule mapping entity URI prefixes to pages opened on node click |
| `cfg:nodeSize`, `cfg:edgeLength`, `cfg:edgeWidth` | Layout dimensions (px) |
| `cfg:nodeLabelFontSize`, `cfg:edgeLabelFontSize`, `cfg:nodeLabelDistance` | Typography (px) |
| `cfg:nodeOutlineColor`, `cfg:edgeColor` | Colors (CSS values) |
| `cfg:physicsEnabled` | Force layout active on load |

**Two-tier design:** `settings.ttl` (in the repo) is operator-controlled — it sets the data source, dereference rules, and baseline visuals. Users adjust the settings panel; their changes are stored only in their own browser (`localStorage` key `nodica.overrides.v1`) and never affect anyone else. Operator-only terms are stripped from all user-side input.

---

## Running locally

**With a local server** (recommended — enables data preloading and URL fetching):

```bash
npm install        # once; installs n3 as a dev dependency for tests
npm run serve      # http://localhost:8090/
```

On startup the app loads `settings.ttl`, which preloads the Wikidata uncle-relations demo (`test/test-uncle-graph.ttl`, images via `wdt:P18`). Click any node to open its Wikidata page.

**From disk** — open `index.html` directly (`file://`). CDN delivers N3.js and vis-network, so it works without a server. Preloading from `cfg:dataSource` is skipped on `file://`; the built-in scientists sample loads instead with an explanatory note.

---

## Interaction

- **Fix layout / Release layout** – freeze or re-enable the force simulation
- **Unpin all** – release all manually positioned nodes
- **Fit** – zoom to fit all nodes
- **⛶ / exit icon** – toggle fullscreen (all controls keep working inside)
- **Properties ▸** – expand a checklist to show/hide individual predicates without re-layout; hidden in fullscreen
- **Click a node** – opens the entity according to the configured dereference rules
- **Drag a node** to pin it; double-click a pinned node to unpin it

---

## File layout

```
index.html               app UI (GitHub Pages root)
app.js                   app wiring (UI → core)
settings.ttl             deployment settings (operator-controlled)
src/nodica.js            core library: parsing, config, model, GraphView
vocab/config-ontology.ttl  cfg: vocabulary (to publish at https://kvistgaard.github.io/config)
examples/                demo data (.ttl, .trig) and sample configurations
test/core-test.js        Node test harness (DOM-free; no browser needed)
test/test-uncle-graph.ttl  real Wikidata CONSTRUCT result used as default data
```

---

## Tests

```bash
npm test   # 80 checks; no browser needed
```

Covers: config parsing, model building (Turtle/TriG/N-Triples, named-graph flattening, cross-graph dedup), first-wins image selection, image-property auto-detection (including real Wikidata data), `cfg:dataSource` resolution and round-trip, two-tier config, dereference rules, property filter, vis-network option mapping, settings sanitization, HTML-escaping, http→https image upgrade, and error propagation.

---

## Deployment

Push to `main`, enable GitHub Pages from the repo root, and the app is live at `https://<user>.github.io/<repo>/`. No build step.

To point the app at a different dataset: edit `cfg:dataSource` and the dereference rules in `settings.ttl` and commit.

---

## Roadmap

- **YASR plugin** – registered via `Yasr.registerPlugin`, consuming SPARQL CONSTRUCT results directly
- **JSON-LD input** – via jsonld.js `toRDF`
- **Fractal Graph** – edge-click zooms into a sub-graph; breadcrumb to zoom back out
