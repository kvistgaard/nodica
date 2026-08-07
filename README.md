# Nodica

Visualise RDF graphs with image-filled nodes. Query a SPARQL endpoint or load an RDF file. Everything about how the graph looks and behaves is itself expressed in RDF — including, for a query, which property fills the nodes.

**[Use it right away →](https://kvistgaard.github.io/nodica)**

## Two modes

| | |
|---|---|
| **[SPARQL mode](https://kvistgaard.github.io/nodica)** (`index.html`, the default) | Query any CORS-enabled endpoint in a full editor; `CONSTRUCT`/`DESCRIBE` results render as a graph. Opens on a Wikidata query of Enlightenment influences. |
| **[File mode](https://kvistgaard.github.io/nodica/file-mode.html)** (`file-mode.html`) | Paste, upload or fetch an RDF file, and tune every setting in a panel. Opens on the bundled Wikidata uncle-relations graph. |

Each links to the other from its header.

---

## Running locally

**From disk** — open either page directly (`file://`). CDN delivers N3.js and vis-network, so it works without a server. Preloading from `cfg:dataSource` is skipped on `file://`, so file mode shows the built-in sample instead, with a note saying so.

**With a local server** (recommended — enables data preloading and URL fetching):

```bash
npm install        # once; installs n3 as a dev dependency for tests
npm run serve      # http://localhost:8090/
```

File mode loads `settings.ttl` on startup, which preloads the Wikidata uncle-relations demo (`test/test-uncle-graph.ttl`, images via `wdt:P18`). Click any node to open its Wikidata page. When that data source cannot be loaded, `cfg:fallback cfg:Sample` shows the bundled influences graph (`examples/influences.ttl`) instead — the same graph SPARQL mode opens with.

```bash
npm test           # core library, no browser needed
npm run test:browser   # SPARQL mode layout/UI checks (needs `npm run serve`)
```

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

**The image property is auto-detected when the configured one finds nothing.** If `cfg:imageProperty` matches no triple in the loaded data, Nodica looks for a property whose values look like images and uses that instead, reporting which one it picked. This is what makes an arbitrary SPARQL result render without configuring anything; set the term explicitly when the data has more than one image-ish property and you want a specific one.

**Edges use the property's own label, if the data has one.** If the loaded RDF also states a label for a predicate itself — e.g. `<http://example.org/hasParent> rdfs:label "father"@en .` — edges (and the matching entry in the Properties filter) show "father" instead of the shortened URI `ex:hasParent`. When a property has labels in more than one language, `cfg:edgeLabelLanguage` picks which one wins (falling back to any other available language, then to the URI, if nothing matches). A predicate-only URI's label triple doesn't add a floating node to the graph — only real resources do.

**Images are thumbnailed, not downloaded whole.** A Wikimedia Commons URL of the form `.../Special:FilePath/Some%20File.jpg` serves the *original upload*, which is routinely 10–30 MB — one image in the bundled demo data is a 30 MB TIFF. Nodica appends `?width=` (from `cfg:imageMaxWidth`, default 400 px, ample for a node) so Commons returns a scaled rendering instead: on the demo dataset that is the difference between 142 seconds and 3 seconds until every node is filled. Only `Special:FilePath` URLs are rewritten, and never one that already specifies a width. Set `cfg:imageMaxWidth 0` to load originals.

---


## SPARQL queries

**[SPARQL mode →](https://kvistgaard.github.io/nodica)** — `index.html` embeds the [Matdata YASGUI](https://github.com/Matdata-eu/Yasgui) SPARQL editor with Nodica registered as a results view. Run any `CONSTRUCT` or `DESCRIBE` query against any CORS-enabled endpoint and the returned RDF renders as an image-filled graph; `SELECT`/`ASK` results stay with YASGUI's table and response views. It opens on a Wikidata query of who influenced whom among people born 1590–1750 (`test/influences.rq`).

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

`index.html` aliases all of them onto its own tokens (from `assets/theme.css`, the same file `file-mode.html` loads) so both pages render pixel-identical controls, in both themes.

### Choosing the image property from the query

Mark the property where it is used, and the query carries its own presentation — share it and the other person sees the same graph, with no settings to carry across:

```sparql
CONSTRUCT {
  ?a wdt:P737 ?b .
  ?a wdt:P18 ?aImage .            # nodica:image
  ?a rdfs:label ?aLabel .
}
```

The marker takes the predicate of the triple pattern on its line (the one nearest the comment, if the line holds more than one). Naming the property explicitly also works, and is the more robust form:

```sparql
# nodica:image wdt:P18
```

Prefixes resolve against the query's own `PREFIX` declarations, falling back to well-known ones (`wdt:`, `foaf:`, `schema:`, …). Without a marker, the page configuration applies, and failing that the property is auto-detected.

> **Caveat.** YASQE reformats a query that isn't already in its canonical layout, and comments do not travel with their line — a marker can end up on a line that has no predicate, where it silently stops working. Normally-formatted queries (one pattern per line, as the built-in query is) are unaffected. Use the explicit `# nodica:image wdt:P18` form for queries you expect to be reformatted or widely shared.

### What carries over between the two modes

**The theme does; nothing else does.** Both pages read and write the same `localStorage` key (`yasgui_theme`, in YASGUI's own format), so light/dark set in either mode applies to the other. The control differs: SPARQL mode embeds Matdata's YASGUI rather than Nodica's page chrome, so its switch is YASGUI's sun/moon icon in the query toolbar, not the button in Nodica's header.

**Settings panel changes stay in file mode.** Image property, label property, sizes, colours and the rest are saved per-browser under `nodica.overrides.v1` and are read only by `file-mode.html`. SPARQL mode takes its configuration from the page's `dynamicConfig` (below) instead, so a graph you tuned in file mode will not look the same after switching — adjust the page config, or rely on the auto-detection described under [Configuration](#configuration).

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

Push to `main`, enable GitHub Pages from the repo root, and the app is live at `https://<user>.github.io/<repo>/`. No build step. `index.html` is SPARQL mode, so that is what the bare URL opens; file mode is `file-mode.html` alongside it.

To point file mode at a different dataset: edit `cfg:dataSource` and the dereference rules in `settings.ttl` and commit. To change the query SPARQL mode opens with, edit `DEFAULT_QUERY` in `index.html`.

Release history is in [`CHANGELOG.md`](CHANGELOG.md); the reasoning behind every design decision is in [`decisions-log.md`](decisions-log.md).

---

## Roadmap

- **More query directives** – `# nodica:image` exists; the same mechanism could carry the label property and other `cfg:` terms
- **JSON-LD input** – via jsonld.js `toRDF`
- **Fractal Graph** – edge-click zooms into a sub-graph; breadcrumb to zoom back out
- **Upstream the plugin** – offer `nodica` to Matdata-eu/Yasgui as a contributed plugin
