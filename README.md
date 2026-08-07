# Nodica

Visualise RDF graphs with image-filled nodes. Query a SPARQL endpoint or load an RDF file. Everything about how the graph looks and behaves is itself expressed in RDF.

**[Use it right away →](https://kvistgaard.github.io/nodica)**

## Two modes

| | |
|---|---|
| **[SPARQL mode](https://kvistgaard.github.io/nodica)** (`index.html`, the default) | Query any CORS-enabled endpoint in a full editor; `CONSTRUCT`/`DESCRIBE` results render as a graph. Opens on a Wikidata query of Enlightenment influences. |
| **[File mode](https://kvistgaard.github.io/nodica/file-mode.html)** (`file-mode.html`) | Paste, upload or fetch an RDF file, and tune every setting in a panel. Opens on the bundled Wikidata uncle-relations graph. |

Each links to the other from its header.

---

## Running locally

**From disk** – open either page directly (`file://`). CDN delivers N3.js and vis-network, so it works without a server. Preloading from `cfg:dataSource` is skipped on `file://`, so file mode shows the built-in sample instead, with a note saying so.

**With a local server** (recommended – enables data preloading and URL fetching):

```bash
npm install        # once; installs n3 as a dev dependency for tests
npm run serve      # http://localhost:8090/
```

File mode loads `settings.ttl` on startup, preloading the Wikidata uncle-relations demo (`test/test-uncle-graph.ttl`, `wdt:P18` images; click a node to open its Wikidata page). If that data source can't be loaded, `cfg:fallback cfg:Sample` shows the bundled influences graph instead (`examples/influences.ttl` – the same graph SPARQL mode opens with).

```bash
npm test           # core library, no browser needed
npm run test:browser   # SPARQL mode layout/UI checks (needs `npm run serve`)
```

---

## Configuration

**Two-tier design:** `settings.ttl` (operator-controlled) sets the data source, dereference rules and baseline visuals. Users adjust the settings panel instead; their changes stay in their own browser (`localStorage` key `nodica.overrides.v1`) and never affect anyone else – operator-only terms are stripped from user input.

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
| `cfg:edgeLabelLanguage`                                                   | Preferred language for edge/property labels (default `"en"`) – see below                  |
| `cfg:imageMaxWidth`                                                       | Width requested for Wikimedia Commons images (default `400`; `0` loads originals) – see below |
| `cfg:dataSource`                                                          | RDF file to preload at startup – relative IRI resolved against the config (operator-only) |
| `cfg:fallback`                                                            | `cfg:Sample` or `cfg:Empty` when the data source is unavailable (operator-only)           |
| `cfg:settingsLocked`                                                      | Hide the settings panel and ignore user overrides (operator-only)                         |
| `cfg:dereferenceRule`                                                     | Rule mapping entity URI prefixes to pages opened on node click                            |
| `cfg:nodeSize`, `cfg:edgeLength`, `cfg:edgeWidth`                         | Layout dimensions (px)                                                                    |
| `cfg:nodeLabelFontSize`, `cfg:edgeLabelFontSize`, `cfg:nodeLabelDistance` | Typography (px)                                                                           |
| `cfg:nodeOutlineColor`, `cfg:edgeColor`                                   | Colors (CSS values)                                                                       |
| `cfg:physicsEnabled`                                                      | Force layout active on load                                                               |

**The image property is auto-detected when the configured one has no match – in both modes.** Nodica looks for a property whose values look like images and uses that instead, which is what lets an arbitrary SPARQL result render unconfigured. File mode says so in the status line (naming the property and how many values it matched); SPARQL mode substitutes silently. Set the term explicitly when more than one image-ish property is present and you want a specific one. Order of precedence: a query's `# nodica:image` marker, then the configuration, then auto-detection.

**Edges use the property's own label, if the data has one.** Given `<http://example.org/hasParent> rdfs:label "father"@en .`, edges (and the matching Properties-filter entry) show "father" instead of `ex:hasParent`. `cfg:edgeLabelLanguage` picks which language wins when a property has several, falling back to any other language and then the URI. A predicate-only label triple never spawns a floating node – only real resources do.

**Images are thumbnailed, not downloaded whole.** A Wikimedia Commons `Special:FilePath` URL serves the *original upload* – routinely 10–30 MB, one demo image is a 30 MB TIFF. Nodica appends `?width=` (from `cfg:imageMaxWidth`, default 400 px), which took the demo dataset from 142 s to 3 s until every node was filled. Only `Special:FilePath` URLs without an existing width are rewritten; set `cfg:imageMaxWidth 0` to load originals.

---

## SPARQL queries

**[SPARQL mode →](https://kvistgaard.github.io/nodica)** – `index.html` embeds the [Matdata YASGUI](https://github.com/Matdata-eu/Yasgui) SPARQL editor with Nodica registered as a results view. Run any `CONSTRUCT` or `DESCRIBE` query against any CORS-enabled endpoint and the returned RDF renders as an image-filled graph; `SELECT`/`ASK` results stay with YASGUI's table and response views. It opens on a Wikidata query of who influenced whom among people born 1590–1750 (`examples/influences.rq`).

The rendered graph has the same controls as file mode – Properties filter (top-left) and Fix layout/Release layout, Unpin all, Fit (top-right) – built by the plugin itself, so they work in any YASGUI deployment, not just this page.

Nodica also works in **any YASGUI deployment**: load `src/nodica.js` and `src/nodica-yasr-plugin.js` (plus N3.js and vis-network) after `yasgui.min.js` – the plugin self-registers as `nodica`. Configure it via the standard YASGUI config object:

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

The plugin follows the host's theme via CSS custom properties on `.nodica-yasr` – all optional, each with a sensible default (e.g. `--nodica-accent-bg`/`--nodica-accent-hover` default to `#337ab7`/`#2868a0`, matching YASGUI's Run button):

| Variable | Styles |
|---|---|
| `--nodica-label-color`, `--nodica-label-background` | Graph node/edge labels (applied by `GraphView`, re-applied on `data-theme` changes) |
| `--nodica-btn-bg`, `--nodica-btn-text`, `--nodica-btn-hover` | The Properties toggle button |
| `--nodica-accent-bg`, `--nodica-accent-hover` | Fix layout / Unpin all / Fit |
| `--nodica-link` | "show all" / "hide all" |

`index.html` aliases all of them onto its own tokens (`assets/theme.css`, shared with `file-mode.html`), so both pages render pixel-identical controls in both themes.

### Choosing the image property from the query

Mark the property where it's used and the query carries its own presentation – share it, and the other person sees the same graph, with no settings to carry across:

```sparql
CONSTRUCT {
  ?a wdt:P737 ?b .
  ?a wdt:P18 ?aImage .            # nodica:image
  ?a rdfs:label ?aLabel .
}
```

The marker takes the predicate of the triple pattern on its line (the nearest one, if the line holds more than one). Naming the property explicitly also works, and is more robust:

```sparql
# nodica:image wdt:P18
```

Prefixes resolve against the query's own `PREFIX` declarations, falling back to well-known ones (`wdt:`, `foaf:`, `schema:`, …). Without a marker, the page configuration applies, and failing that the property is auto-detected.

> **Caveat.** YASQE can reformat a query that isn't already in its canonical layout, and comments don't travel with their line – a marker can end up annotating nothing. Normally-formatted queries (one pattern per line, like the built-in one) are unaffected; use the explicit `# nodica:image wdt:P18` form for queries you expect to be reformatted or shared widely.

### What carries over between the two modes

**The theme does; nothing else does.** Both pages read and write the same `localStorage` key (`yasgui_theme`, in YASGUI's own format), so light/dark set in either mode applies to the other. The control differs: SPARQL mode embeds Matdata's YASGUI rather than Nodica's page chrome, so its switch is YASGUI's sun/moon icon in the query toolbar, not the button in Nodica's header.

**Settings-panel changes stay in file mode.** They're saved per-browser under `nodica.overrides.v1` and read only by `file-mode.html`. SPARQL mode takes its configuration from the page's `dynamicConfig` instead, so a graph tuned in file mode won't look the same after switching – adjust the page config, or rely on auto-detection ([Configuration](#configuration)).

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

Push to `main`, enable GitHub Pages from the repo root, and the app is live at `https://<user>.github.io/<repo>/` – no build step. `index.html` is SPARQL mode (the bare URL); file mode is `file-mode.html` alongside it.

To point file mode at a different dataset, edit `cfg:dataSource` and the dereference rules in `settings.ttl`. To change the default SPARQL query, edit `examples/influences.rq`, then run `npm run sync:query` to copy it into the inline `file://` fallback in `index.html` (`npm test` fails if the two drift).

Release history is in [`CHANGELOG.md`](CHANGELOG.md); the reasoning behind every design decision is in [`decisions-log.md`](decisions-log.md).

---

## Roadmap

- **More query directives** – `# nodica:image` exists; the same mechanism could carry the label property and other `cfg:` terms
- **JSON-LD input** – via jsonld.js `toRDF`
