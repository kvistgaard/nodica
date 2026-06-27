/**
 * Nodica core library (v0.1)
 *
 * RDF graph visualisation with image-filled nodes.
 * See requirements.md for the full spec and decisions D1-D12.
 *
 * Classic script (no build step): attaches `Nodica` to window/globalThis.
 * Dependencies (globals): N3 (parsing), vis (vis-network, only needed by GraphView).
 *
 * The model-building functions are DOM-free so they can be unit-tested in Node
 * and reused by the YASR plugin adapter and the Fractal Graph component.
 */
(function (root) {
  "use strict";

  var CFG_NS = "https://kvistgaard.github.io/config#";
  var RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

  /** Built-in defaults (lowest precedence; Turtle config and UI overrides sit on top). */
  var DEFAULTS = {
    imageProperty: "https://schema.org/image",
    labelProperty: "http://www.w3.org/2000/01/rdf-schema#label",
    nodeSize: 50,
    edgeLength: 200,
    edgeWidth: 4,
    nodeLabelFontSize: 20,
    edgeLabelFontSize: 20,
    nodeLabelDistance: 10,
    nodeOutlineColor: "#2b7ce9",
    edgeColor: "#888888",
    physicsEnabled: true,
  };

  /** cfg: term name -> value kind, used when reading a configuration file. */
  var CONFIG_TERMS = {
    imageProperty: "iri",
    labelProperty: "iri",
    dataSource: "iri",
    fallback: "iri",
    settingsLocked: "boolean",
    nodeSize: "number",
    edgeLength: "number",
    edgeWidth: "number",
    nodeLabelFontSize: "number",
    edgeLabelFontSize: "number",
    nodeLabelDistance: "number",
    nodeOutlineColor: "string",
    edgeColor: "string",
    physicsEnabled: "boolean",
  };

  /** Placeholder shown when a node image fails to load. */
  var BROKEN_IMAGE =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
        '<circle cx="50" cy="50" r="48" fill="#e0e0e0" stroke="#aaaaaa" stroke-width="2"/>' +
        '<text x="50" y="58" font-size="40" text-anchor="middle" fill="#888888">?</text>' +
        "</svg>"
    );

  /* ------------------------------------------------------------------ */
  /* Parsing                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Parse RDF text (Turtle, TriG, N-Triples or N-Quads; N3.js auto-detects).
   * @returns Promise<{ quads: Quad[], prefixes: object }>
   */
  function parseRdf(text, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var quads = [];
      var parser = new N3.Parser({
        baseIRI: options.baseIRI || "http://example.org/base/",
      });
      parser.parse(text, function (error, quad, prefixes) {
        if (error) reject(error);
        else if (quad) quads.push(quad);
        else resolve({ quads: quads, prefixes: prefixes || {} });
      });
    });
  }

  /**
   * Parse a Turtle configuration file using the cfg: vocabulary
   * (https://kvistgaard.github.io/config). Returns only the settings present
   * in the file; merge over DEFAULTS yourself (see mergeSettings).
   * If several cfg:Configuration resources exist, the first one found wins.
   * For repeated properties, the first value wins.
   *
   * options.baseIRI: base against which relative IRIs (e.g. cfg:dataSource)
   * are resolved - pass the configuration document's own URL.
   */
  function parseConfig(text, options) {
    options = options || {};
    return parseRdf(text, { baseIRI: options.baseIRI || "http://example.org/config/" }).then(function (parsed) {
      var quads = parsed.quads;
      // Choose the configuration subject: prefer an explicit rdf:type
      // cfg:Configuration, otherwise the first subject using a cfg: predicate.
      var subject = null;
      for (var i = 0; i < quads.length; i++) {
        var q = quads[i];
        if (q.predicate.value === RDF_TYPE && q.object.value === CFG_NS + "Configuration") {
          subject = q.subject.value;
          break;
        }
      }
      if (subject === null) {
        for (var j = 0; j < quads.length; j++) {
          if (quads[j].predicate.value.indexOf(CFG_NS) === 0) {
            subject = quads[j].subject.value;
            break;
          }
        }
      }
      var settings = {};
      if (subject === null) return settings;
      for (var k = 0; k < quads.length; k++) {
        var quad = quads[k];
        if (quad.subject.value !== subject) continue;
        if (quad.predicate.value.indexOf(CFG_NS) !== 0) continue;
        var key = quad.predicate.value.slice(CFG_NS.length);
        var kind = CONFIG_TERMS[key];
        if (!kind) continue; // unknown term: ignore
        if (key in settings) continue; // first value wins
        var v = quad.object.value;
        if (kind === "number") {
          var n = parseFloat(v);
          if (!isNaN(n)) settings[key] = n;
        } else if (kind === "boolean") {
          settings[key] = v === "true" || v === "1";
        } else {
          settings[key] = v; // iri | string
        }
      }

      // Structured term: cfg:dereferenceRule -> cfg:uriPrefix / cfg:template (D11)
      var rules = [];
      for (var r = 0; r < quads.length; r++) {
        var rq = quads[r];
        if (rq.subject.value !== subject) continue;
        if (rq.predicate.value !== CFG_NS + "dereferenceRule") continue;
        var ruleTerm = rq.object;
        var rule = { uriPrefix: "", template: "{RAW}" };
        for (var p = 0; p < quads.length; p++) {
          var pq = quads[p];
          if (pq.subject.termType !== ruleTerm.termType || pq.subject.value !== ruleTerm.value) continue;
          if (pq.predicate.value === CFG_NS + "uriPrefix") rule.uriPrefix = pq.object.value;
          else if (pq.predicate.value === CFG_NS + "template") rule.template = pq.object.value;
        }
        rules.push(rule);
      }
      if (rules.length > 0) {
        // longest prefix first, so the most specific rule wins
        rules.sort(function (a, b) {
          return b.uriPrefix.length - a.uriPrefix.length;
        });
        settings.dereferenceRules = rules;
      }

      return settings;
    });
  }

  /**
   * Resolve the web page to open for an entity URI (D11): the dereference
   * rule with the longest matching cfg:uriPrefix wins; placeholders {RAW},
   * {URI} (percent-encoded) and {LOCAL} (after the prefix) are substituted.
   * Without a matching rule the URI itself is used. Returns null when the
   * result is not an http(s) URL (literals, blank nodes, javascript: etc.).
   */
  function resolveEntityUrl(uri, settings) {
    if (typeof uri !== "string") return null;
    var rules = (settings && settings.dereferenceRules) || [];
    var url = uri;
    for (var i = 0; i < rules.length; i++) {
      if (uri.indexOf(rules[i].uriPrefix) === 0) {
        url = String(rules[i].template)
          .replace(/\{URI\}/g, encodeURIComponent(uri))
          .replace(/\{LOCAL\}/g, uri.slice(rules[i].uriPrefix.length))
          .replace(/\{RAW\}/g, uri);
        break;
      }
    }
    return /^https?:\/\//.test(url) ? url : null;
  }

  /**
   * Coerce and filter a settings object against CONFIG_TERMS. Use on any
   * untrusted source (e.g. localStorage-persisted overrides): unknown keys
   * are dropped, numbers must be finite, booleans accept true/"true".
   */
  function sanitizeSettings(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (key) {
      if (key === "dereferenceRules") {
        // structured term (D11): keep only well-formed rules
        if (Array.isArray(obj[key])) {
          var rules = obj[key]
            .filter(function (r) {
              return r && typeof r.uriPrefix === "string" && typeof r.template === "string";
            })
            .map(function (r) {
              return { uriPrefix: r.uriPrefix, template: r.template };
            });
          if (rules.length > 0) out.dereferenceRules = rules;
        }
        return;
      }
      var kind = CONFIG_TERMS[key];
      if (!kind) return; // unknown key: drop
      var v = obj[key];
      if (v === undefined || v === null) return;
      if (kind === "number") {
        var n = typeof v === "number" ? v : parseFloat(v);
        if (isFinite(n)) out[key] = n;
      } else if (kind === "boolean") {
        if (typeof v === "boolean") out[key] = v;
        else if (v === "true" || v === "1") out[key] = true;
        else if (v === "false" || v === "0") out[key] = false;
      } else {
        var s = String(v).trim();
        if (s !== "") out[key] = s;
      }
    });
    return out;
  }

  /** Terms only the deployment configuration may set; never honoured from
   *  the UI panel or persisted user overrides (D10). */
  var OPERATOR_TERMS = ["dataSource", "fallback", "settingsLocked"];

  /** sanitizeSettings plus removal of operator-only terms: use for anything
   *  coming from the user side (UI panel, localStorage). */
  function sanitizeUserSettings(obj) {
    var clean = sanitizeSettings(obj);
    OPERATOR_TERMS.forEach(function (t) {
      delete clean[t];
    });
    return clean;
  }

  /** Escape a string for safe use in HTML contexts (vis-network renders
   *  node/edge titles as HTML, and RDF data is untrusted input). */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** defaults < config file < UI overrides */
  function mergeSettings() {
    var out = {};
    var sources = [DEFAULTS].concat(Array.prototype.slice.call(arguments));
    sources.forEach(function (src) {
      if (!src) return;
      Object.keys(src).forEach(function (k) {
        if (src[k] !== undefined && src[k] !== null && src[k] !== "") out[k] = src[k];
      });
    });
    return out;
  }

  /** Serialise effective settings back to a Turtle configuration file. */
  function configToTurtle(settings) {
    var s = mergeSettings(settings);
    return [
      "@prefix cfg: <" + CFG_NS + "> .",
      "",
      "<#config>",
      "    a cfg:Configuration ;",
      s.dataSource ? "    cfg:dataSource         <" + s.dataSource + "> ;" : null,
      "    cfg:imageProperty      <" + s.imageProperty + "> ;",
      "    cfg:labelProperty      <" + s.labelProperty + "> ;",
      "    cfg:nodeSize           " + s.nodeSize + " ;",
      "    cfg:edgeLength         " + s.edgeLength + " ;",
      "    cfg:edgeWidth          " + s.edgeWidth + " ;",
      "    cfg:nodeLabelFontSize  " + s.nodeLabelFontSize + " ;",
      "    cfg:edgeLabelFontSize  " + s.edgeLabelFontSize + " ;",
      "    cfg:nodeLabelDistance  " + s.nodeLabelDistance + " ;",
      '    cfg:nodeOutlineColor   "' + s.nodeOutlineColor + '" ;',
      '    cfg:edgeColor          "' + s.edgeColor + '" ;',
      (s.dereferenceRules || [])
        .map(function (r) {
          return (
            '    cfg:dereferenceRule [ cfg:uriPrefix "' +
            r.uriPrefix.replace(/"/g, '\\"') +
            '" ; cfg:template "' +
            r.template.replace(/"/g, '\\"') +
            '" ] ;'
          );
        })
        .join("\n") || null,
      "    cfg:physicsEnabled     " + (s.physicsEnabled ? "true" : "false") + " .",
      "",
    ]
      .filter(function (line) {
        return line !== null;
      })
      .join("\n");
  }

  /* ------------------------------------------------------------------ */
  /* Model building                                                      */
  /* ------------------------------------------------------------------ */

  /** Treat http://schema.org/ and https://schema.org/ as the same namespace. */
  function normalizeIri(iri) {
    return iri.replace(/^http:\/\/schema\.org\//, "https://schema.org/");
  }

  function samePredicate(a, b) {
    return normalizeIri(a) === normalizeIri(b);
  }

  /** Well-known image properties, in preference order, for auto-detection. */
  var IMAGE_PROPERTY_CANDIDATES = [
    "https://schema.org/image",
    "http://xmlns.com/foaf/0.1/depiction",
    "http://xmlns.com/foaf/0.1/img",
    "http://www.wikidata.org/prop/direct/P18",
    "http://dbpedia.org/ontology/thumbnail",
    "https://schema.org/logo",
    "https://schema.org/thumbnailUrl",
  ];

  var IMAGE_URL_RE = /\.(jpe?g|png|gif|svg|webp|tiff?|bmp|ico)([?#].*)?$/i;

  function looksLikeImage(term) {
    if (term.termType !== "NamedNode" && term.termType !== "Literal") return false;
    return IMAGE_URL_RE.test(term.value) || term.value.indexOf("Special:FilePath") !== -1;
  }

  /**
   * Decide which image property to use for a dataset (D6 helper).
   * If the configured property matches at least one triple it is kept.
   * Otherwise well-known image properties are tried in preference order,
   * and as a last resort the predicate with the most image-looking object
   * values (by URL pattern) is chosen.
   *
   * @returns { property, matches, detected } - detected=true when the
   *          configured property was replaced by an auto-detected one.
   */
  function detectImageProperty(quads, configured) {
    var counts = {}; // predicate -> object count
    var imageish = {}; // predicate -> objects that look like image URLs
    for (var i = 0; i < quads.length; i++) {
      var q = quads[i];
      var p = q.predicate.value;
      counts[p] = (counts[p] || 0) + 1;
      if (looksLikeImage(q.object)) imageish[p] = (imageish[p] || 0) + 1;
    }
    function countFor(prop) {
      var n = 0;
      Object.keys(counts).forEach(function (pred) {
        if (samePredicate(pred, prop)) n += counts[pred];
      });
      return n;
    }
    var configuredCount = configured ? countFor(configured) : 0;
    if (configuredCount > 0) return { property: configured, matches: configuredCount, detected: false };
    for (var c = 0; c < IMAGE_PROPERTY_CANDIDATES.length; c++) {
      var n = countFor(IMAGE_PROPERTY_CANDIDATES[c]);
      if (n > 0) return { property: IMAGE_PROPERTY_CANDIDATES[c], matches: n, detected: true };
    }
    var best = null;
    var bestN = 0;
    Object.keys(imageish).forEach(function (pred) {
      if (imageish[pred] > bestN) {
        best = pred;
        bestN = imageish[pred];
      }
    });
    if (best !== null) return { property: best, matches: bestN, detected: true };
    return { property: configured, matches: 0, detected: false };
  }

  /** Fallback prefixes used when the document does not declare its own. */
  var WELL_KNOWN_PREFIXES = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    owl: "http://www.w3.org/2002/07/owl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    schema: "https://schema.org/",
    foaf: "http://xmlns.com/foaf/0.1/",
    skos: "http://www.w3.org/2004/02/skos/core#",
    dcterms: "http://purl.org/dc/terms/",
    wd: "http://www.wikidata.org/entity/",
    wdt: "http://www.wikidata.org/prop/direct/",
  };

  /** Shorten a URI with the document's prefixes (well-known prefixes as
   *  fallback), else use the fragment/last path segment. */
  function shorten(iri, prefixes) {
    var all = {};
    Object.keys(WELL_KNOWN_PREFIXES).forEach(function (p) {
      all[p] = WELL_KNOWN_PREFIXES[p];
    });
    Object.keys(prefixes || {}).forEach(function (p) {
      var ns = prefixes[p];
      // N3 may hand back NamedNodes as prefix values
      all[p] = typeof ns === "string" ? ns : ns.value;
    });
    var best = null;
    var bestLen = -1;
    Object.keys(all).forEach(function (pfx) {
      var nsVal = all[pfx];
      if (iri.indexOf(nsVal) === 0 && nsVal.length > bestLen) {
        best = pfx + ":" + iri.slice(nsVal.length);
        bestLen = nsVal.length;
      }
    });
    if (best !== null) return best;
    var m = iri.match(/[#\/]([^#\/]*)$/);
    return m && m[1] ? m[1] : iri;
  }

  /**
   * Turn quads into a vis-network model.
   * - Named graphs (TriG) are flattened; duplicate s/p/o triples are deduplicated (D7).
   * - Triples whose predicate is the configured image/label property are consumed:
   *   they style the subject node and are not drawn as edges (D5).
   * - Multiple image/label values per node: first encountered wins (D6).
   * - Literal objects become leaf nodes (one node per occurrence).
   * - Tooltips (titles) are HTML-escaped; with settings.upgradeHttpImages,
   *   http:// image URLs are rewritten to https:// (D9).
   * - Distinct predicates are aggregated with counts for the filter (D12).
   *
   * @returns { nodes: [], edges: [], predicates: [], stats: {} }
   */
  function buildModel(quads, settings, prefixes) {
    var s = mergeSettings(settings);
    var images = {}; // subject id -> image URL (first wins)
    var labels = {}; // subject id -> label (first wins)
    var consumedSubjects = {}; // subject id -> term (so image-only subjects still get a node)
    var seen = {}; // s|p|o -> true, for cross-graph dedup
    var triples = [];

    function termId(term) {
      return term.termType === "BlankNode" ? "_:" + term.value : term.value;
    }

    // Pass 1: dedupe across graphs, collect consumed (image/label) triples.
    for (var i = 0; i < quads.length; i++) {
      var q = quads[i];
      var key = termId(q.subject) + "|" + q.predicate.value + "|" + q.object.termType + ":" + q.object.value;
      if (seen[key]) continue;
      seen[key] = true;

      var sid = termId(q.subject);
      if (samePredicate(q.predicate.value, s.imageProperty)) {
        if (!(sid in images)) images[sid] = q.object.value;
        consumedSubjects[sid] = q.subject;
        continue; // consumed
      }
      if (samePredicate(q.predicate.value, s.labelProperty)) {
        if (!(sid in labels)) labels[sid] = q.object.value;
        consumedSubjects[sid] = q.subject;
        continue; // consumed
      }
      triples.push(q);
    }

    // Pass 2: build nodes and edges.
    var nodes = {}; // id -> node
    var edges = [];
    var litCount = 0;

    function ensureResourceNode(term) {
      var id = termId(term);
      if (nodes[id]) return id;
      var isBlank = term.termType === "BlankNode";
      var label = labels[id] !== undefined ? labels[id] : isBlank ? id : shorten(term.value, prefixes);
      var node = {
        id: id,
        label: label,
        title: escapeHtml(isBlank ? "blank node " + id : term.value),
        shape: "dot",
      };
      if (images[id] !== undefined) {
        var imageUrl = images[id];
        // Avoid mixed-content blocking when the app is served over https.
        if (s.upgradeHttpImages) imageUrl = imageUrl.replace(/^http:\/\//, "https://");
        node.shape = "circularImage";
        node.image = imageUrl;
        node.brokenImage = BROKEN_IMAGE;
      }
      nodes[id] = node;
      return id;
    }

    for (var t = 0; t < triples.length; t++) {
      var quad = triples[t];
      var from = ensureResourceNode(quad.subject);
      var to;
      if (quad.object.termType === "Literal") {
        // one literal node per occurrence, so shared values do not merge branches
        to = "lit:" + litCount++;
        var text = quad.object.value;
        nodes[to] = {
          id: to,
          label: text.length > 60 ? text.slice(0, 57) + "..." : text,
          title: escapeHtml(text),
          shape: "box",
        };
      } else {
        to = ensureResourceNode(quad.object);
      }
      edges.push({
        id: "e" + t,
        from: from,
        to: to,
        label: shorten(quad.predicate.value, prefixes),
        // predicate kept raw in `predicate` for programmatic use (Fractal),
        // escaped in `title` because vis renders titles as HTML
        predicate: quad.predicate.value,
        title: escapeHtml(quad.predicate.value),
        arrows: "to",
      });
    }

    // Subjects whose only triples were consumed (image/label) still deserve
    // a node, otherwise e.g. a resource with just an image would disappear.
    Object.keys(consumedSubjects).forEach(function (sid) {
      if (!nodes[sid]) ensureResourceNode(consumedSubjects[sid]);
    });

    var nodeList = Object.keys(nodes).map(function (id) {
      return nodes[id];
    });

    // Distinct predicates with counts, for the property filter (D12).
    var predicateCounts = {};
    edges.forEach(function (e) {
      predicateCounts[e.predicate] = (predicateCounts[e.predicate] || 0) + 1;
    });
    var predicates = Object.keys(predicateCounts)
      .map(function (p) {
        return { uri: p, label: shorten(p, prefixes), count: predicateCounts[p] };
      })
      .sort(function (a, b) {
        return b.count - a.count || (a.label < b.label ? -1 : 1);
      });

    return {
      nodes: nodeList,
      edges: edges,
      predicates: predicates,
      stats: {
        inputQuads: quads.length,
        distinctTriples: triples.length + Object.keys(images).length + Object.keys(labels).length,
        nodes: nodeList.length,
        edges: edges.length,
        imagesResolved: Object.keys(images).length,
        labelsResolved: Object.keys(labels).length,
      },
    };
  }

  /**
   * Pure helper for the property filter (D12): given the full edge list, all
   * node ids and a set (object) of hidden predicate URIs, compute `hidden`
   * flags for vis-network. A node is hidden when it has edges but none of
   * them is visible; nodes without any edges (e.g. image-only subjects)
   * always stay visible. No model rebuild, no re-layout.
   */
  function computeVisibility(edges, nodeIds, hiddenPredicates) {
    var hidden = hiddenPredicates || {};
    var hasEdge = {};
    var visibleByEdge = {};
    var edgeUpdates = edges.map(function (e) {
      var hide = hidden[e.predicate] === true;
      hasEdge[e.from] = true;
      hasEdge[e.to] = true;
      if (!hide) {
        visibleByEdge[e.from] = true;
        visibleByEdge[e.to] = true;
      }
      return { id: e.id, hidden: hide };
    });
    var nodeUpdates = nodeIds.map(function (id) {
      return { id: id, hidden: hasEdge[id] === true && visibleByEdge[id] !== true };
    });
    return { edgeUpdates: edgeUpdates, nodeUpdates: nodeUpdates };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  /** Map effective settings to vis-network options (single source of truth). */
  function toVisOptions(settings) {
    var s = mergeSettings(settings);
    return {
      nodes: {
        size: s.nodeSize,
        borderWidth: 2,
        borderWidthSelected: 4,
        color: {
          border: s.nodeOutlineColor,
          background: "#ffffff",
          highlight: { border: s.nodeOutlineColor, background: "#f0f0f0" },
        },
        font: { size: s.nodeLabelFontSize, color: "#000000", vadjust: s.nodeLabelDistance },
        shapeProperties: { useBorderWithImage: true, interpolation: false },
      },
      edges: {
        width: s.edgeWidth,
        color: { color: s.edgeColor, highlight: s.edgeColor },
        font: { size: s.edgeLabelFontSize, align: "middle", strokeWidth: 0, background: "#ffffff" },
        smooth: { enabled: true, type: "continuous", roundness: 0.5 },
      },
      physics: {
        enabled: !!s.physicsEnabled,
        barnesHut: {
          gravitationalConstant: -8000,
          centralGravity: 0.3,
          springLength: s.edgeLength,
          springConstant: 0.04,
          damping: 0.09,
          avoidOverlap: 0.1,
        },
        stabilization: { enabled: true, iterations: 200, updateInterval: 10, fit: true },
        minVelocity: 0.75,
      },
      interaction: { hover: true, tooltipDelay: 150 },
    };
  }

  /**
   * Renders a model into a container and manages interaction:
   * physics toggle (fix/release the layout), pinning dragged nodes,
   * events for the host app ('nodeDoubleClick', 'edgeClick', 'nodeClick').
   */
  function GraphView(container, model, settings) {
    this.settings = mergeSettings(settings);
    this.nodes = new vis.DataSet(model.nodes);
    this.edges = new vis.DataSet(model.edges);
    this.network = new vis.Network(
      container,
      { nodes: this.nodes, edges: this.edges },
      toVisOptions(this.settings)
    );
    this._handlers = {};

    var self = this;

    // Manual rearrangement: a dragged node stays where the user puts it.
    this.network.on("dragEnd", function (params) {
      params.nodes.forEach(function (id) {
        self.nodes.update({ id: id, fixed: { x: true, y: true } });
      });
    });

    this.network.on("doubleClick", function (params) {
      if (params.nodes.length > 0) self._emit("nodeDoubleClick", { node: params.nodes[0] });
    });

    this.network.on("click", function (params) {
      if (params.nodes.length > 0) self._emit("nodeClick", { node: params.nodes[0] });
      else if (params.edges.length > 0)
        // Fractal Graph hook (D3): host can zoom into a sub-graph from here.
        self._emit("edgeClick", { edge: self.edges.get(params.edges[0]) });
    });
  }

  GraphView.prototype._emit = function (event, payload) {
    (this._handlers[event] || []).forEach(function (cb) {
      cb(payload);
    });
  };

  /** Subscribe to 'nodeClick' | 'nodeDoubleClick' | 'edgeClick'. */
  GraphView.prototype.on = function (event, cb) {
    (this._handlers[event] = this._handlers[event] || []).push(cb);
    return this;
  };

  /** Live-apply changed settings (UI overrides). */
  GraphView.prototype.updateSettings = function (partial) {
    this.settings = mergeSettings(this.settings, partial);
    this.network.setOptions(toVisOptions(this.settings));
  };

  /** Fix (freeze) or release the force layout. */
  GraphView.prototype.setPhysics = function (enabled) {
    this.settings.physicsEnabled = !!enabled;
    this.network.setOptions({ physics: { enabled: !!enabled } });
  };

  /** Hide/show edges by predicate URI (D12). Pass an array of hidden URIs;
   *  positions and layout are preserved (only `hidden` flags change). */
  GraphView.prototype.setHiddenPredicates = function (hiddenList) {
    var hidden = {};
    (hiddenList || []).forEach(function (p) {
      hidden[p] = true;
    });
    var result = computeVisibility(this.edges.get(), this.nodes.getIds(), hidden);
    this.edges.update(result.edgeUpdates);
    this.nodes.update(result.nodeUpdates);
  };

  /** Release all nodes pinned by dragging. */
  GraphView.prototype.unpinAll = function () {
    var updates = this.nodes.getIds().map(function (id) {
      return { id: id, fixed: false };
    });
    this.nodes.update(updates);
  };

  GraphView.prototype.fit = function () {
    this.network.fit({ animation: true });
  };

  GraphView.prototype.destroy = function () {
    this.network.destroy();
  };

  /* ------------------------------------------------------------------ */

  root.Nodica = {
    VERSION: "0.1.0",
    CFG_NS: CFG_NS,
    DEFAULTS: DEFAULTS,
    CONFIG_TERMS: CONFIG_TERMS,
    parseRdf: parseRdf,
    parseConfig: parseConfig,
    mergeSettings: mergeSettings,
    sanitizeSettings: sanitizeSettings,
    sanitizeUserSettings: sanitizeUserSettings,
    OPERATOR_TERMS: OPERATOR_TERMS,
    escapeHtml: escapeHtml,
    configToTurtle: configToTurtle,
    detectImageProperty: detectImageProperty,
    resolveEntityUrl: resolveEntityUrl,
    buildModel: buildModel,
    computeVisibility: computeVisibility,
    toVisOptions: toVisOptions,
    GraphView: GraphView,
  };
})(typeof window !== "undefined" ? window : globalThis);
