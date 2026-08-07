# Nodica

Visualise RDF graphs with image-filled nodes. You can use an RDF file or a SPARQL query. Everything about how the graph looks and behaves is itself expressed in RDF.

**[Use it right away →](https://kvistgaard.github.io/nodica)**

---

## Running locally

**From disk** — open `index.html` directly (`file://`). CDN delivers N3.js and vis-network, so it works without a server. Preloading from `cfg:dataSource` is skipped on `file://`; the built-in scientists sample loads instead with an explanatory note.
- [ ] To fix

**With a local server** (recommended — enables data preloading and URL fetching):

```bash
npm install        # once; installs n3 as a dev dependency for tests
npm run serve      # http://localhost:8090/
```

On startup the app loads `settings.ttl`, which preloads the Wikidata uncle-relations demo (`test/test-uncle-graph.ttl`, images via `wdt:P18`). Click any node to open its Wikidata page.
- [ ] To fix



---

## Configuration

**Two-tier design:** `settings.ttl` (in the repo) is operator-controlled — it sets the data source, dereference rules, and baseline visuals. Users adjust the settings panel; their changes are stored only in their own browser (`localStorage` key `nodica.overrides.v1`) and never affect anyone else. Operator-only terms are stripped from all user-side input.

The `cfg:` vocabulary describes every aspect of the visualisation. A minimal config is a handful of Turtle triples:

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

| Term (property)                                                           | Meaning                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cfg:imageProperty`                                                       | RDF property whose value fills each node with an image                                    |
| `cfg:labelProperty`                                                       | RDF property supplying the node label (default `rdfs:label`)                              |
| `cfg:edgeLabelLanguage`                                                   | Preferred language for edge/property labels (default `"en"`) — see below                  |
| `cfg:imageMaxWidth`                                                       | Width requested for Wikimedia Commons images (default `400`; `0` loads originals) — see below |
| `cfg:dataSource`                                                          | RDF file to preload at startup — relative IRI resolved against the config (operator-only) |
| `cfg:fallback`                                                            | `cfg:Sample` or `cfg:Empty` when the data source is unavailable (operator-only)           |
| `cfg:settingsLocked`                                                      | Hide the settings panel and ignore user overrides (operator-only)                         |
| `cfg:dereferenceRule`                                                     | Rule mapping entity URI prefixes to pages opened on node click                            |
| `cfg:nodeSize`, `cfg:edgeLength`, `cfg:edgeWidth`                         | Layout dimensions (px)                                                                    |
| `cfg:nodeLabelFontSize`, `cfg:edgeLabelFontSize`, `cfg:nodeLabelDistance` | Typography (px)                                                                           |
| `cfg:nodeOutlineColor`, `cfg:edgeColor`                                   | Colors (CSS values)                                                                       |
| `cfg:physicsEnabled`                                                      | Force layout active on load                                                               |

**Edges use the property's own label, if the data has one.** If the loaded RDF also states a label for a predicate itself — e.g. `<http://example.org/hasParent> rdfs:label "father"@en .` — edges (and the matching entry in the Properties filter) show "father" instead of the shortened URI `ex:hasParent`. When a property has labels in more than one language, `cfg:edgeLabelLanguage` picks which one wins (falling back to any other available language, then to the URI, if nothing matches). A predicate-only URI's label triple doesn't add a floating node to the graph — only real resources do.

**Images are thumbnailed, not downloaded whole.** A Wikimedia Commons URL of the form `.../Special:FilePath/Some%20File.jpg` serves the *original upload*, which is routinely 10–30 MB — one image in the bundled demo data is a 30 MB TIFF. Nodica appends `?width=` (from `cfg:imageMaxWidth`, default 400 px, ample for a node) so Commons returns a scaled rendering instead: on the demo dataset that is the difference between 142 seconds and 3 seconds until every node is filled. Only `Special:FilePath` URLs are rewritten, and never one that already specifies a width. Set `cfg:imageMaxWidth 0` to load originals.

---


## SPARQL queries

**[Query mode →](https://kvistgaard.github.io/nodica/sparql.html)** — `sparql.html` embeds the [Matdata YASGUI](https://github.com/Matdata-eu/Yasgui) SPARQL editor with Nodica registered as a results view. Run any `CONSTRUCT` or `DESCRIBE` query against any CORS-enabled endpoint and the returned RDF renders as an image-filled graph; `SELECT`/`ASK` results stay with YASGUI's table and response views. The page opens with a Wikidata demo query (the Bach family, portraits via `wdt:P18`).

The rendered graph has the same controls as file mode:
- Properties filter (top-left), 
- Fix layout / Release layout, Unpin all, and 
- Fit (top-right) — built by the plugin itself, so they work in any YASGUI deployment, not just this page.

Nodica is also usable in **any YASGUI deployment**: load `src/nodica.js` and `src/nodica-yasr-plugin.js` (plus the N3.js and vis-network CDN scripts) after `yasgui.min.js` and the plugin registers itself as `nodica`. Configure it through the standard YASGUI config object:

```js
Yasgui.Yasr.defaults.plugins.nodica = {
  enabled: true,
  dynamicConfig: {
    configTurtle: "...",        // inline cfg: Turtle, or configUrl: "config.ttl"
    height: "560px",            // graph area height
    imageProperty: "https://schema.org/image"   // any cfg: term as a flat override
  }
};
```

The plugin follows the host's theme: style its `.nodica-yasr` container and define these custom properties on it — none are required, each has a sensible default (`--nodica-accent-bg`/`--nodica-accent-hover` default to `#337ab7`/`#2868a0`, matching YASGUI's own Run button):

| Variable | Styles |
|---|---|
| `--nodica-label-color`, `--nodica-label-background` | Graph node/edge labels (applied by `GraphView`, re-applied on `data-theme` changes) |
| `--nodica-btn-bg`, `--nodica-btn-text`, `--nodica-btn-hover` | The Properties toggle button |
| `--nodica-accent-bg`, `--nodica-accent-hover` | Fix layout / Unpin all / Fit |
| `--nodica-link` | "show all" / "hide all" |

`sparql.html` aliases all of them onto its own tokens (from `assets/theme.css`, the same file `index.html` loads) so both pages render pixel-identical controls, in both themes.

**A note on the theme toggle in SPARQL mode.** Because `sparql.html` embeds Matdata's YASGUI rather than Nodica's own page chrome, its theme switch is a different control from file mode's: it's YASGUI's own sun/moon icon inside the query toolbar (next to the settings gear), not the button in Nodica's header. Both pages read and persist the choice through the same `localStorage` key (`yasgui_theme`, in YASGUI's own format), so switching the theme on either page carries over to the other.

---

## Interaction

- **Fix layout / Release layout** – freeze or re-enable the force simulation
- **Unpin all** – release all manually positioned nodes
- **Fit** – zoom to fit all nodes
- **⛶ / exit icon** – toggle fullscreen (all controls keep working inside)
- **Properties ▸** – expand a checklist to show/hide individual predicates without re-layout; hidden in fullscreen
- **Click a node** – opens the entity according to the configured dereference rules
- **Drag a node** to pin it; double-click a pinned node to unpin it
- **Sun/moon icon (header)** – switch light/dark theme; remembered and shared with SPARQL mode (see below)

---

## Deployment

Push to `main`, enable GitHub Pages from the repo root, and the app is live at `https://<user>.github.io/<repo>/`. No build step.

To point the app at a different dataset: edit `cfg:dataSource` and the dereference rules in `settings.ttl` and commit.

Release history is in [`CHANGELOG.md`](CHANGELOG.md); the reasoning behind every design decision is in [`decisions-log.md`](decisions-log.md).

---

## Roadmap

- **YASR plugin** – registered via `Yasr.registerPlugin`, consuming SPARQL CONSTRUCT results directly
- **JSON-LD input** – via jsonld.js `toRDF`
- **Fractal Graph** – edge-click zooms into a sub-graph; breadcrumb to zoom back out
