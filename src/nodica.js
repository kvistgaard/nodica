/**
 * Nodica core library (v0.2)
 *
 * RDF graph visualisation with image-filled nodes.
 * See decisions-log.md for the full spec and decisions D1-D20.
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
    edgeLabelLanguage: "en",
    imageMaxWidth: 400,
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
    edgeLabelLanguage: "string",
    imageMaxWidth: "number",
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

  /**
   * Size thresholds above which rendering options change (D20). Kept here,
   * in the core, so the app and the YASR plugin cannot drift apart.
   */
  var LIMITS = {
    /** Above this many nodes the force layout starts switched off (D9). */
    maxPhysicsNodes: 1500,
    /**
     * vis-network's own `layout.clusterThreshold`. Its `improvedLayout`
     * (Kamada-Kawai initial placement) is worth its cost below this size;
     * above it, vis clusters the graph first, which is far slower than
     * letting physics place the nodes from random positions.
     */
    maxImprovedLayoutNodes: 150,
    /** Above this many edges, curved edges cost more per frame than they add. */
    maxSmoothEdges: 500,
  };

  /* ------------------------------------------------------------------ */
  /* Image URLs                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Hosts known to serve https only. An `http://` image URL for them costs a
   * redirect per image before a single byte arrives, and RDF in the wild is
   * full of them (Wikidata's own `wdt:P18` values are all `http://commons...`).
   * Anchored at the scheme, and the optional sub-domain group cannot cross
   * `/`, `?` or `#`, so it matches the host and nothing else.
   */
  var HTTPS_ONLY_IMAGE_HOSTS =
    /^http:\/\/([^\/?#]*\.)?(wikimedia|wikipedia|wikidata|wikibooks|wikisource)\.org(?=[\/?#]|$)/i;

  /** MediaWiki's redirect endpoint for a file's *original* upload. */
  var FILE_PATH_RE = /\/Special:FilePath\//i;

  /**
   * Ask MediaWiki's thumbnailer for a scaled rendering instead of the original
   * upload (D20). Originals are routinely 10-30 MB - a 30 MB TIFF in the
   * bundled test graph becomes 33 KB at width=400 - and the browser must also
   * decode every one of them at full resolution before shrinking it into a
   * node a hundred pixels wide.
   *
   * Only `Special:FilePath` URLs are touched: that endpoint documents `width`,
   * and appending a query parameter to an arbitrary image URL could break it.
   * A URL that already carries a width is left alone (the author sized it).
   * `width <= 0` disables the rewrite entirely.
   */
  function withThumbnailWidth(url, width) {
    if (!(width > 0) || !FILE_PATH_RE.test(url)) return url;
    var hash = "";
    var hashAt = url.indexOf("#");
    if (hashAt !== -1) {
      hash = url.slice(hashAt);
      url = url.slice(0, hashAt);
    }
    if (/[?&]width=/i.test(url)) return url + hash;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "width=" + Math.round(width) + hash;
  }

  /**
   * Everything that happens to an image URL between the RDF and the canvas:
   * https upgrade (always for known https-only hosts, and for every host when
   * `upgradeHttpImages` guards against mixed content on an https page, D9),
   * then thumbnailing (`imageMaxWidth`, D20).
   */
  function normalizeImageUrl(url, settings) {
    if (typeof url !== "string" || url === "") return url;
    var s = settings || {};
    if (HTTPS_ONLY_IMAGE_HOSTS.test(url)) url = "https://" + url.slice(7);
    else if (s.upgradeHttpImages) url = url.replace(/^http:\/\//, "https://");
    return withThumbnailWidth(url, s.imageMaxWidth);
  }

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
      '    cfg:edgeLabelLanguage  "' + s.edgeLabelLanguage + '" ;',
      "    cfg:imageMaxWidth      " + s.imageMaxWidth + " ;",
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

  /**
   * Well-known label properties, in fallback order (D30). The configured
   * cfg:labelProperty always ranks first; any subject it misses falls
   * through this sequence. Exported (like LIMITS) so hosts can show or
   * document the order without hardcoding a copy.
   */
  var LABEL_CASCADE = [
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://www.w3.org/2004/02/skos/core#prefLabel",
    "https://schema.org/name",
    "http://purl.org/dc/terms/title",
    "http://xmlns.com/foaf/0.1/name",
  ];

  /**
   * Precedence map for label predicates: configured property -> 0, then the
   * cascade in order. Built once per buildModel and consulted with one hash
   * lookup per quad, so the cascade costs the same as the single comparison
   * it replaces (the makeShortener lesson, D20). Keys are normalized IRIs;
   * look up with normalizeIri() so both schema.org forms match. Null
   * prototype, so inherited names like "constructor" cannot read as hits.
   */
  function makeLabelRank(configured) {
    var rank = Object.create(null);
    if (configured) rank[normalizeIri(configured)] = 0;
    for (var i = 0; i < LABEL_CASCADE.length; i++) {
      if (!(LABEL_CASCADE[i] in rank)) rank[LABEL_CASCADE[i]] = i + 1;
    }
    return rank;
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

  /** Comment markers understood in a SPARQL query -> settings key (D26). */
  var QUERY_DIRECTIVES = { image: "imageProperty" };

  var RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

  /** True for something usable as a predicate: <iri>, prefix:local, or `a`. */
  function isTermToken(t) {
    return /^<[^>\s]*>$/.test(t) || /^[A-Za-z][\w.\-]*:[^\s<>"'{}]*$/.test(t) || t === "a";
  }

  /** `<iri>` / `prefix:local` / `a` -> absolute IRI, or null if unresolvable. */
  function expandTerm(token, prefixes) {
    if (!token) return null;
    if (token === "a") return RDF_TYPE;
    if (/^<[^>\s]*>$/.test(token)) return token.slice(1, -1);
    var i = token.indexOf(":");
    if (i === -1) return null;
    var pfx = token.slice(0, i);
    var ns = (prefixes && prefixes[pfx]) || WELL_KNOWN_PREFIXES[pfx];
    return ns ? ns + token.slice(i + 1) : null;
  }

  /**
   * Index of the first `#` that starts a comment - i.e. one that is not inside
   * an <IRI> (`<http://x#y>`) or a quoted literal. Scanning rather than
   * indexOf("#") because both are ordinary in SPARQL.
   */
  function commentStart(line) {
    var inIri = false, quote = null;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "<") inIri = true;
      else if (c === ">") inIri = false;
      else if (c === "#" && !inIri) return i;
    }
    return -1;
  }

  /**
   * The predicate of the triple pattern the marker is attached to.
   *
   * Read from the END of the line, not the start: the marker is written after
   * the pattern it annotates, and a line may hold more than one pattern plus
   * a keyword - `CONSTRUCT { ?a wdt:P737 ?b . ?a foaf:depiction ?img .` is
   * ordinary formatting, and scanning forward picked `CONSTRUCT` and gave up.
   * So the last pattern wins, which is also the one nearest the marker.
   *
   * Positional rather than "the last IRI-looking token", because objects are
   * frequently IRIs too (`?child wdt:P22 wd:Q1339`) and would win. In
   * `subject predicate object` the predicate is second-from-last; a
   * `;`-continuation drops the subject (`rdfs:label ?l`), which lands on the
   * same slot. A bare predicate on its own is the remaining fallback.
   */
  function predicateOnLine(text, prefixes) {
    var tokens = String(text).trim().split(/\s+/)
      .map(function (t) { return t.replace(/^[;,{}()]+|[;,.{}()]+$/g, ""); })
      .filter(function (t) { return t !== ""; });
    var candidates = [tokens[tokens.length - 2], tokens[tokens.length - 1]];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && isTermToken(candidates[i])) {
        var iri = expandTerm(candidates[i], prefixes);
        if (iri) return iri;
      }
    }
    return null;
  }

  /**
   * Read Nodica directives out of a SPARQL query's comments (D26).
   *
   * Data-centricity: the query carries its own presentation, so sharing the
   * query reproduces the graph - which a per-browser setting cannot do.
   * Follows the convention Wikidata Query Service established with
   * `#defaultView:`, and the marker is written where the property is used:
   *
   *     ?child wdt:P18 ?img .   # nodica:image
   *
   * The marker takes the predicate of the triple pattern on its own line (one
   * pattern per line, as SPARQL is normally formatted). An explicit argument
   * wins when given, which also covers a marker on a line of its own:
   *
   *     # nodica:image wdt:P18
   *
   * Prefixes come from the query's own PREFIX declarations, falling back to
   * the well-known table. Returns a settings object ({} when nothing is
   * marked) for the caller to merge - it is not sanitized here, so it passes
   * through the same validation as any other settings source.
   */
  function parseQueryDirectives(query) {
    var out = {};
    if (typeof query !== "string" || query === "") return out;

    var prefixes = {};
    var re = /(?:^|\s)PREFIX\s+([A-Za-z][\w.\-]*)?\s*:\s*<([^>]*)>/gi;
    var m;
    while ((m = re.exec(query)) !== null) prefixes[m[1] || ""] = m[2];

    var lines = query.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var at = commentStart(lines[i]);
      if (at === -1) continue;
      var d = /^\s*nodica:([A-Za-z]+)\s*(\S+)?/i.exec(lines[i].slice(at + 1));
      if (!d) continue;
      var key = QUERY_DIRECTIVES[d[1].toLowerCase()];
      if (!key) continue;
      var iri = d[2]
        ? expandTerm(d[2].replace(/^[;,]+|[;,.]+$/g, ""), prefixes)
        : predicateOnLine(lines[i].slice(0, at), prefixes);
      if (iri) out[key] = iri;
    }
    return out;
  }

  /**
   * Build a shortening function for one document: the merged prefix table and
   * the results are computed once, not per URI. `buildModel` shortens once per
   * node and once per edge, so rebuilding the table inside the loop made the
   * cost of a graph quadratic in (prefixes x terms) for no benefit (D20).
   *
   * Returns f(iri) -> "prefix:local", else the fragment/last path segment.
   */
  function makeShortener(prefixes) {
    var namespaces = [];
    var all = {};
    Object.keys(WELL_KNOWN_PREFIXES).forEach(function (p) {
      all[p] = WELL_KNOWN_PREFIXES[p];
    });
    Object.keys(prefixes || {}).forEach(function (p) {
      var ns = prefixes[p];
      // N3 may hand back NamedNodes as prefix values
      all[p] = typeof ns === "string" ? ns : ns.value;
    });
    Object.keys(all).forEach(function (pfx) {
      namespaces.push({ prefix: pfx, ns: all[pfx] });
    });
    // Null-prototype cache: URIs are arbitrary strings, and a plain object
    // would report inherited members ("constructor") as cached entries.
    var cache = Object.create(null);
    return function (iri) {
      var hit = cache[iri];
      if (hit !== undefined) return hit;
      var best = null;
      var bestLen = -1;
      for (var i = 0; i < namespaces.length; i++) {
        var nsVal = namespaces[i].ns;
        if (nsVal.length > bestLen && iri.indexOf(nsVal) === 0) {
          best = namespaces[i].prefix + ":" + iri.slice(nsVal.length);
          bestLen = nsVal.length;
        }
      }
      if (best === null) {
        var m = iri.match(/[#\/]([^#\/]*)$/);
        best = m && m[1] ? m[1] : iri;
      }
      cache[iri] = best;
      return best;
    };
  }

  /** One-off shortening; prefer makeShortener() when shortening many URIs. */
  function shorten(iri, prefixes) {
    return makeShortener(prefixes)(iri);
  }

  /**
   * Turn quads into a vis-network model.
   * - Named graphs (TriG) are flattened; duplicate s/p/o triples are deduplicated (D7).
   * - Triples whose predicate is the configured image/label property are consumed:
   *   they style the subject node and are not drawn as edges (D5).
   * - Multiple image/label values per node: first encountered wins (D6).
   * - Literal objects become leaf nodes (one node per occurrence).
   * - Tooltips (titles) are HTML-escaped; image URLs go through
   *   normalizeImageUrl (https upgrade D9, thumbnailing D20).
   * - Distinct predicates are aggregated with counts for the filter (D12).
   * - Edge/predicate-filter labels: a property's own rdfs:label (or
   *   whatever labelProperty is configured), in settings.edgeLabelLanguage
   *   if present, else any language, else the prefixed/shortened URI (D17).
   *   A predicate-only URI's label triple doesn't spawn a node of its own.
   *
   * @returns { nodes: [], edges: [], predicates: [], stats: {} }
   */
  function buildModel(quads, settings, prefixes) {
    var s = mergeSettings(settings);
    var shortenIri = makeShortener(prefixes);
    var images = {}; // subject id -> image URL (first wins)
    var labels = {}; // subject id -> label (first wins)
    var consumedSubjects = {}; // subject id -> term (so image-only subjects still get a node)
    var seen = {}; // s|p|o -> true, for cross-graph dedup
    var triples = [];

    // Candidate labels for predicate URIs (label-cascade triples whose
    // subject happens to be used elsewhere as a predicate): uri -> { rank,
    // byLang, noLang, first }, resolved into edge/predicate labels after
    // pass 1 once every triple - and thus every used predicate - is known.
    var propertyLabelCandidates = {};

    // Every URI used as a predicate anywhere in the input, known upfront so
    // pass 1 can tell "a property's own label" from "an ordinary resource's
    // label" (D17): a label triple on a predicate-only URI must not spawn a
    // bare node just because it was "consumed" - its label is for the edge.
    var predicateUris = {};
    for (var pu = 0; pu < quads.length; pu++) predicateUris[quads[pu].predicate.value] = true;

    function termId(term) {
      return term.termType === "BlankNode" ? "_:" + term.value : term.value;
    }

    /**
     * Rank-aware candidate recording (D30): a lower-ranked label property
     * replaces everything a higher-ranked one collected; within one rank the
     * D17 language bookkeeping applies unchanged.
     */
    function recordPropertyLabelCandidate(uri, term, rank) {
      if (term.termType !== "Literal") return;
      var c = propertyLabelCandidates[uri];
      if (!c || rank < c.rank) c = propertyLabelCandidates[uri] = { rank: rank, byLang: {} };
      else if (rank > c.rank) return;
      var lang = (term.language || "").toLowerCase();
      if (lang) {
        if (!(lang in c.byLang)) c.byLang[lang] = term.value;
      } else if (c.noLang === undefined) {
        c.noLang = term.value;
      }
      if (c.first === undefined) c.first = term.value;
    }

    // Label precedence (D30): configured property first, then the cascade.
    // One O(1) lookup per quad; labelRanks remembers which rank produced each
    // node's label so a better-ranked triple later in the input replaces it,
    // while an equal rank keeps the first value seen (D6 first-wins).
    var labelRank = makeLabelRank(s.labelProperty);
    var labelRanks = {};

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
      var rank = labelRank[normalizeIri(q.predicate.value)];
      if (rank !== undefined) {
        if (!(sid in labels) || rank < labelRanks[sid]) {
          labels[sid] = q.object.value;
          labelRanks[sid] = rank;
        }
        recordPropertyLabelCandidate(sid, q.object, rank);
        // A URI used only as a predicate shouldn't get a node of its own
        // just because it has a label; a URI that's also a real resource
        // (subject/object elsewhere) still gets one, via consumedSubjects
        // as before, or naturally through that other triple.
        if (!predicateUris[sid]) consumedSubjects[sid] = q.subject;
        continue; // consumed
      }
      triples.push(q);
    }

    // Resolve each candidate to one label: the configured language wins,
    // then any plain (language-free) literal, then whichever came first.
    var edgeLabelLang = String(s.edgeLabelLanguage || "en").toLowerCase();
    var propertyLabels = {};
    Object.keys(propertyLabelCandidates).forEach(function (uri) {
      var c = propertyLabelCandidates[uri];
      propertyLabels[uri] =
        c.byLang[edgeLabelLang] !== undefined ? c.byLang[edgeLabelLang] :
        c.noLang !== undefined ? c.noLang :
        c.first;
    });

    function edgeLabel(predicateUri) {
      return propertyLabels[predicateUri] !== undefined
        ? propertyLabels[predicateUri]
        : shortenIri(predicateUri);
    }

    // Pass 2: build nodes and edges.
    var nodes = {}; // id -> node
    var edges = [];
    var litCount = 0;

    function ensureResourceNode(term) {
      var id = termId(term);
      if (nodes[id]) return id;
      var isBlank = term.termType === "BlankNode";
      var label = labels[id] !== undefined ? labels[id] : isBlank ? id : shortenIri(term.value);
      var node = {
        id: id,
        label: label,
        title: escapeHtml(isBlank ? "blank node " + id : term.value),
        shape: "dot",
      };
      if (images[id] !== undefined) {
        node.shape = "circularImage";
        // https upgrade + thumbnailing; see normalizeImageUrl (D9, D20).
        node.image = normalizeImageUrl(images[id], s);
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
        // The property's own rdfs:label (in edgeLabelLanguage, D17) wins
        // over the prefixed/shortened URI when the data supplies one.
        label: edgeLabel(quad.predicate.value),
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
        return { uri: p, label: edgeLabel(p), count: predicateCounts[p] };
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

  /**
   * Map effective settings to vis-network options (single source of truth).
   *
   * `hints` carries the model's size ({ nodeCount, edgeCount }) because three
   * vis options should follow the graph rather than the configuration (D20):
   * the Kamada-Kawai pre-layout, curved edges, and - via applyPerformanceGuards
   * - physics itself. Called without hints, nothing scales and the small-graph
   * options apply.
   */
  function toVisOptions(settings, hints) {
    var s = mergeSettings(settings);
    var h = hints || {};
    var nodeCount = typeof h.nodeCount === "number" ? h.nodeCount : 0;
    var edgeCount = typeof h.edgeCount === "number" ? h.edgeCount : 0;
    return {
      layout: {
        // Above vis-network's own clusterThreshold this pre-layout clusters
        // the graph first, which costs far more than it saves.
        improvedLayout: nodeCount <= LIMITS.maxImprovedLayoutNodes,
      },
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
        smooth: { enabled: edgeCount <= LIMITS.maxSmoothEdges, type: "continuous", roundness: 0.5 },
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
        stabilization: {
          // Internal (not a cfg: term): a redraw that restores known node
          // positions has nothing to stabilise and should appear at once.
          enabled: s.stabilizationEnabled !== false,
          iterations: 200,
          updateInterval: 10,
          fit: true,
        },
        minVelocity: 0.75,
      },
      interaction: { hover: true, tooltipDelay: 150 },
    };
  }

  /**
   * Large-graph guards (D9, D20), shared by the app and the YASR plugin so the
   * two cannot drift apart. Returns fresh settings plus a note for the user
   * ("" when nothing was changed) - it never mutates its argument.
   */
  function applyPerformanceGuards(settings, model) {
    var s = mergeSettings(settings);
    var nodeCount = model && model.nodes ? model.nodes.length : 0;
    var note = "";
    if (nodeCount > LIMITS.maxPhysicsNodes && s.physicsEnabled) {
      s.physicsEnabled = false;
      note =
        "Large graph (" + nodeCount + " nodes): physics switched off to keep " +
        "the page responsive. Re-enable it via the Physics checkbox if needed.";
    }
    return { settings: s, note: note };
  }

  /**
   * Copy previously captured positions (GraphView#getPositions) onto a model's
   * nodes, so a redraw of the same data resumes the layout the user was
   * looking at instead of scattering it (D20). Returns how many were applied.
   */
  function applyPositions(model, positions) {
    if (!model || !model.nodes || !positions) return 0;
    var applied = 0;
    model.nodes.forEach(function (node) {
      var p = positions[node.id];
      if (p && typeof p.x === "number" && typeof p.y === "number") {
        node.x = p.x;
        node.y = p.y;
        applied++;
      }
    });
    return applied;
  }

  /**
   * Renders a model into a container and manages interaction:
   * physics toggle (fix/release the layout), pinning dragged nodes,
   * events for the host app ('nodeDoubleClick', 'edgeClick', 'nodeClick').
   */
  function GraphView(container, model, settings) {
    this.container = container;
    this.settings = mergeSettings(settings);
    this.nodes = new vis.DataSet(model.nodes);
    this.edges = new vis.DataSet(model.edges);
    // Size-dependent rendering options follow the model, not the config (D20).
    this._hints = { nodeCount: model.nodes.length, edgeCount: model.edges.length };
    this.network = new vis.Network(
      container,
      { nodes: this.nodes, edges: this.edges },
      toVisOptions(this.settings, this._hints)
    );
    this._handlers = {};

    var self = this;

    // Stabilisation happens behind a blank canvas, so on a graph large enough
    // to take a moment the host needs to be able to say so (D20).
    this.network.on("stabilizationProgress", function (params) {
      var total = params && params.total ? params.total : 0;
      self._emit("stabilizationProgress", {
        iterations: params ? params.iterations : 0,
        total: total,
        percent: total ? Math.round((params.iterations / total) * 100) : 0,
      });
    });
    this.network.on("stabilizationIterationsDone", function () {
      self._emit("stabilized", {});
    });

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

    this._syncThemeColors();
    this._watchThemeChanges();
  }

  /**
   * Theme support (D15): if the container has --nodica-label-color and/or
   * --nodica-label-background CSS custom properties (set by the host page,
   * scoped to its light/dark theme), apply them to node and edge labels.
   * toVisOptions() hard-codes black-on-white labels, which is illegible on a
   * dark host page; hosts that don't set these variables see no change.
   */
  GraphView.prototype._syncThemeColors = function () {
    if (!this.network || !this.container || typeof getComputedStyle !== "function") return;
    var style = getComputedStyle(this.container);
    var labelColor = (style.getPropertyValue("--nodica-label-color") || "").trim();
    var labelBackground = (style.getPropertyValue("--nodica-label-background") || "").trim();
    if (!labelColor && !labelBackground) return;
    var options = {};
    if (labelColor) {
      options.nodes = { font: { color: labelColor } };
      options.edges = { font: { color: labelColor } };
    }
    if (labelBackground) {
      options.edges = options.edges || {};
      options.edges.font = options.edges.font || {};
      options.edges.font.background = labelBackground;
    }
    this.network.setOptions(options);
  };

  /** Re-apply theme colors whenever the host flips data-theme on <html>
   *  (e.g. a theme toggle, or YASGUI's own theme switch). */
  GraphView.prototype._watchThemeChanges = function () {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    var self = this;
    this._themeObserver = new MutationObserver(function () { self._syncThemeColors(); });
    this._themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  };

  GraphView.prototype._emit = function (event, payload) {
    (this._handlers[event] || []).forEach(function (cb) {
      cb(payload);
    });
  };

  /** Subscribe to 'nodeClick' | 'nodeDoubleClick' | 'edgeClick' |
   *  'stabilizationProgress' | 'stabilized'. */
  GraphView.prototype.on = function (event, cb) {
    (this._handlers[event] = this._handlers[event] || []).push(cb);
    return this;
  };

  /** Live-apply changed settings (UI overrides). */
  GraphView.prototype.updateSettings = function (partial) {
    this.settings = mergeSettings(this.settings, partial);
    this.network.setOptions(toVisOptions(this.settings, this._hints));
    this._syncThemeColors();
  };

  /** Current node positions, keyed by node id - hand back to applyPositions()
   *  to resume this layout on a later redraw of the same data (D20). */
  GraphView.prototype.getPositions = function () {
    try {
      return this.network.getPositions();
    } catch (e) {
      return {};
    }
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
    if (this._themeObserver) {
      this._themeObserver.disconnect();
      this._themeObserver = null;
    }
    this.network.destroy();
  };

  /* ------------------------------------------------------------------ */

  root.Nodica = {
    VERSION: "0.3.0",
    CFG_NS: CFG_NS,
    DEFAULTS: DEFAULTS,
    CONFIG_TERMS: CONFIG_TERMS,
    LIMITS: LIMITS,
    parseRdf: parseRdf,
    parseConfig: parseConfig,
    mergeSettings: mergeSettings,
    sanitizeSettings: sanitizeSettings,
    sanitizeUserSettings: sanitizeUserSettings,
    OPERATOR_TERMS: OPERATOR_TERMS,
    escapeHtml: escapeHtml,
    configToTurtle: configToTurtle,
    detectImageProperty: detectImageProperty,
    LABEL_CASCADE: LABEL_CASCADE,
    parseQueryDirectives: parseQueryDirectives,
    resolveEntityUrl: resolveEntityUrl,
    normalizeImageUrl: normalizeImageUrl,
    buildModel: buildModel,
    computeVisibility: computeVisibility,
    toVisOptions: toVisOptions,
    applyPerformanceGuards: applyPerformanceGuards,
    applyPositions: applyPositions,
    GraphView: GraphView,
  };
})(typeof window !== "undefined" ? window : globalThis);
