/**
 * Nodica YASR plugin (D15)
 *
 * Thin adapter that renders SPARQL CONSTRUCT / DESCRIBE results as a Nodica
 * graph inside YASGUI's result area (YASR). Works with the Matdata YASGUI
 * fork (https://github.com/Matdata-eu/Yasgui) and any YASR exposing the
 * classic plugin interface: registerPlugin, canHandleResults, draw.
 *
 * Classic script (no build step). Load order on a page:
 *   yasgui.min.js, n3, vis-network, nodica.js, then this file.
 * It auto-registers as "nodica" when a Yasr class is found and also exposes
 * `NodicaYasrPlugin` (with `NodicaYasrPlugin.register()`) for manual wiring.
 *
 * SELECT / ASK results (SPARQL JSON, XML, CSV, TSV) are declined by
 * canHandleResults so the table/response plugins keep handling them.
 *
 * Draws the same controls as the file-mode app (D18): a Properties filter
 * panel (top-left) and Fix layout / Unpin all / Fit buttons (top-right),
 * built fresh per draw() since YASR gives the plugin an empty results
 * element, not the host page's own DOM. Styling is self-injected (works
 * with no host CSS at all) but reads these vars from .nodica-yasr if the
 * host defines them, e.g. to match its own theme exactly (D19):
 *   --nodica-label-color / --nodica-label-background   graph labels (GraphView)
 *   --nodica-btn-bg / --nodica-btn-text / --nodica-btn-hover   Properties toggle
 *   --nodica-accent-bg / --nodica-accent-hover   Fix layout / Unpin all / Fit
 *   --nodica-link                                "show all" / "hide all"
 *
 * Plugin configuration (all optional), via the Yasgui config object:
 *   yasr: { plugins: { nodica: { dynamicConfig: {
 *     configTurtle: "...",          // inline cfg: Turtle (D8)
 *     configUrl: "config.ttl",      // or a Turtle config fetched at first draw
 *     height: "560px",              // graph container height
 *     imageProperty: "...", ...     // plus any flat cfg: term as an override
 *   } } } }
 */
(function (root) {
  "use strict";

  /** Content types a SPARQL endpoint may use for CONSTRUCT/DESCRIBE output
   *  that N3.js can parse. text/plain is the legacy N-Triples type and is
   *  additionally sniffed, since some endpoints use it for arbitrary text. */
  var RDF_CONTENT_TYPES = [
    "text/turtle",
    "application/x-turtle",
    "application/turtle",
    "application/trig",
    "application/n-triples",
    "application/n-quads",
    "text/n3",
    "text/rdf+n3",
    "text/plain",
  ];

  /** The Nodica core is resolved lazily so script order only matters at
   *  draw time, not at load time. */
  function lib() {
    if (!root.Nodica) {
      throw new Error("Nodica core not found: load src/nodica.js before the YASR plugin.");
    }
    return root.Nodica;
  }

  /** Heuristic for responses without a usable content type (or text/plain):
   *  does the body start like Turtle / TriG / N-Triples / N-Quads?
   *  SPARQL XML ("<?xml"), JSON ("{"/"[") and prose are rejected. */
  function looksLikeRdf(text) {
    if (typeof text !== "string" || text.trim() === "") return false;
    var head = text.slice(0, 2000);
    // drop leading blank and comment lines
    head = head.replace(/^(\s*(#[^\n]*)?\n)*\s*/, "");
    if (/^<\?xml/i.test(head)) return false;
    if (/^[{[]/.test(head)) return false;
    return /^(@prefix\b|@base\b|PREFIX\b|BASE\b|GRAPH\b|<[^\s>]*>|_:)/i.test(head);
  }

  function NodicaPlugin(yasr) {
    this.yasr = yasr;
    this.priority = 40; // above every 5.20.3 built-in (highest there: Geo, 30)
    this.label = "Nodica";
    this.helpReference = "https://kvistgaard.github.io/nodica";
    this.hideFromSelection = false;
    this.view = null;
    this.container = null;
    this._settingsPromise = null;
    this._model = null;
    this._propItemsEl = null;
    this._physicsBtn = null;
    this._statusEl = null;
    // Redrawing the same response (switching YASR tabs back and forth) should
    // not re-parse it or scatter the layout the user arranged (D20).
    this._cacheKey = null;
    this._cached = null;
    this._positions = null;
    // Serialises overlapping draws, the same way app.js's renderSeq does (D9).
    this._drawSeq = 0;
    this.hiddenPredicates = {};
  }

  /**
   * Inserted once (idempotent) so drawn chrome (property panel, buttons)
   * has sane default styling wherever the plugin is embedded, without
   * depending on the host page defining anything (every var() has a
   * fallback). A host that *does* want to match its own look - as
   * sparql.html does, to stay pixel-identical with file mode (D19) -
   * aliases these exact names on its .nodica-yasr container:
   *   --nodica-label-color / --nodica-label-background   graph labels (GraphView)
   *   --nodica-btn-bg / --nodica-btn-text / --nodica-btn-hover   Properties toggle
   *   --nodica-accent-bg / --nodica-accent-hover   Fix layout / Unpin all / Fit
   *   --nodica-link                                "show all" / "hide all"
   * The accent defaults (#337ab7/#2868a0) match YASGUI's own Run button, so
   * even a host that defines nothing still looks visually related to it.
   */
  NodicaPlugin._injectStyles = function () {
    if (NodicaPlugin._stylesInjected || typeof document === "undefined") return;
    NodicaPlugin._stylesInjected = true;
    var style = document.createElement("style");
    style.id = "nodica-yasr-plugin-styles";
    style.textContent = [
      ".nodica-yasr-canvas { width: 100%; height: 100%; }",
      ".nodica-yasr-controls { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 5; }",
      ".nodica-yasr-controls button { padding: 6px 14px; background: var(--nodica-accent-bg, #337ab7); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-family: inherit; }",
      ".nodica-yasr-controls button:hover { background: var(--nodica-accent-hover, #2868a0); }",
      ".nodica-yasr-props { position: absolute; top: 10px; left: 10px; z-index: 6; max-width: 300px; }",
      ".nodica-yasr-props-toggle { padding: 6px 14px; background: var(--nodica-btn-bg, #e8e8e8); color: var(--nodica-btn-text, #222); border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-family: inherit; }",
      ".nodica-yasr-props-toggle:hover { background: var(--nodica-btn-hover, #d8d8d8); }",
      ".nodica-yasr-props-list { margin-top: 6px; background: var(--nodica-label-background, #fff); color: var(--nodica-label-color, #222); border: 1px solid rgba(128,128,128,0.35); border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); padding: 8px; max-height: 50vh; overflow: auto; }",
      ".nodica-yasr-props-list.nodica-yasr-collapsed { display: none; }",
      ".nodica-yasr-props-list label { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; white-space: nowrap; }",
      ".nodica-yasr-count { color: #888; }",
      ".nodica-yasr-props-actions { display: flex; gap: 12px; margin-bottom: 6px; }",
      ".nodica-yasr-linklike { background: none; border: none; color: var(--nodica-link, #0066cc); cursor: pointer; font-size: 12px; padding: 0; font-family: inherit; }",
      ".nodica-yasr-linklike:hover { text-decoration: underline; }",
      ".nodica-yasr-status { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 7; padding: 4px 12px; border-radius: 12px; font-size: 12px; background: var(--nodica-label-background, #fff); color: var(--nodica-label-color, #222); border: 1px solid rgba(128,128,128,0.35); box-shadow: 0 2px 6px rgba(0,0,0,0.15); pointer-events: none; }",
      ".nodica-yasr-status[hidden] { display: none; }",
    ].join("\n");
    document.head.appendChild(style);
  };

  /** Raw response body, or "" when unavailable. */
  NodicaPlugin.prototype._raw = function () {
    try {
      var results = this.yasr && this.yasr.results;
      if (results && typeof results.getOriginalResponseAsString === "function") {
        return results.getOriginalResponseAsString() || "";
      }
    } catch (e) { /* fall through */ }
    return "";
  };

  /** Normalised response content type ("" when unknown). */
  NodicaPlugin.prototype._contentType = function () {
    try {
      var results = this.yasr && this.yasr.results;
      if (results && typeof results.getContentType === "function") {
        return String(results.getContentType() || "").split(";")[0].trim().toLowerCase();
      }
    } catch (e) { /* fall through */ }
    return "";
  };

  NodicaPlugin.prototype.canHandleResults = function () {
    var raw = this._raw();
    if (!raw.trim()) return false;
    var ct = this._contentType();
    if (ct === "") return looksLikeRdf(raw);
    if (RDF_CONTENT_TYPES.indexOf(ct) === -1) return false;
    return ct === "text/plain" ? looksLikeRdf(raw) : true;
  };

  /** Static per-page plugin configuration from the Yasgui/Yasr config. */
  NodicaPlugin.prototype._pluginConfig = function () {
    try {
      var plugins = this.yasr && this.yasr.config && this.yasr.config.plugins;
      var mine = plugins && plugins.nodica;
      if (mine && typeof mine === "object") {
        var cfg = mine.dynamicConfig !== undefined ? mine.dynamicConfig : mine;
        if (cfg && typeof cfg === "object") return cfg;
      }
    } catch (e) { /* fall through */ }
    return {};
  };

  /**
   * Resolve settings once per plugin instance (D8): defaults < configTurtle
   * or configUrl < flat overrides from the plugin config. The page author is
   * the operator here, so sanitizeSettings (not sanitizeUserSettings) applies.
   */
  NodicaPlugin.prototype._resolveSettings = function () {
    var self = this;
    if (this._settingsPromise) return this._settingsPromise;
    var N = lib();
    var cfg = this._pluginConfig();

    var filePromise;
    if (typeof cfg.configTurtle === "string" && cfg.configTurtle.trim() !== "") {
      var base = typeof document !== "undefined" ? document.baseURI : undefined;
      filePromise = N.parseConfig(cfg.configTurtle, { baseIRI: base });
    } else if (typeof cfg.configUrl === "string" && cfg.configUrl.trim() !== "") {
      filePromise = fetch(cfg.configUrl, { headers: { Accept: "text/turtle" } })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (text) {
          return N.parseConfig(text, { baseIRI: cfg.configUrl });
        });
    } else {
      filePromise = Promise.resolve({});
    }

    var overrides = {};
    Object.keys(cfg).forEach(function (k) {
      if (k !== "configTurtle" && k !== "configUrl" && k !== "height") overrides[k] = cfg[k];
    });

    this._settingsPromise = filePromise
      .catch(function (err) {
        if (root.console) {
          console.warn("Nodica YASR plugin: configuration not loaded (" +
            (err && err.message ? err.message : err) + "); using defaults.");
        }
        return {};
      })
      .then(function (fileSettings) {
        return N.mergeSettings(
          fileSettings,
          N.sanitizeSettings(overrides),
          // Query directives last, so what the query says wins over the page
          // config - the query is the more specific, and more portable,
          // statement of intent (D26).
          //
          // sanitizeUserSettings, NOT sanitizeSettings: a query is authored by
          // a user and is routinely pasted in from elsewhere, so it sits on
          // the user side of D10's trust boundary and must not be able to set
          // operator-only terms (dataSource, fallback, settingsLocked).
          N.sanitizeUserSettings(self._querySettings || {})
        );
      });
    return this._settingsPromise;
  };

  /**
   * Supply settings read from the SPARQL query's comment directives (D26).
   *
   * The host page passes these in because a YASR results plugin cannot reach
   * the query itself - `yasr` exposes results, config and DOM, and nothing
   * that leads back to the editor (verified against 5.20.3). Clears the
   * resolved-settings cache so the next draw picks the new value up; editing
   * the marker and re-running would otherwise keep the first value.
   */
  NodicaPlugin.prototype.setQuerySettings = function (settings) {
    var next = JSON.stringify(settings || {});
    if (next === JSON.stringify(this._querySettings || {})) return;
    this._querySettings = settings || {};
    this._settingsPromise = null;
    this._cacheKey = null; // model was built with the old image property
  };

  /** Replace the container content with a plain-text notice. */
  NodicaPlugin.prototype._message = function (text) {
    if (!this.container) return;
    this.container.innerHTML = "";
    var div = document.createElement("div");
    div.setAttribute("style", "padding:16px;color:#555;font-size:14px;white-space:pre-wrap;");
    div.textContent = text; // textContent: no HTML interpretation
    this.container.appendChild(div);
  };

  NodicaPlugin.prototype._teardown = function () {
    if (this.view) {
      // Remember where the user left the graph: YASR calls draw() again on
      // every view switch, and re-running the layout would throw away an
      // arrangement they may have spent time on (D20).
      try { this._positions = this.view.getPositions(); } catch (e) { /* keep the old set */ }
      try { this.view.destroy(); } catch (e) { /* already gone */ }
      this.view = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this._propItemsEl = null;
    this._physicsBtn = null;
    this._statusEl = null;
  };

  /** Transient overlay line ("" hides it) - the graph is invisible while
   *  vis-network stabilises, so the wait needs a caption. */
  NodicaPlugin.prototype._setStatus = function (text) {
    if (!this._statusEl) return;
    this._statusEl.textContent = text || "";
    this._statusEl.hidden = !text;
  };

  /** Property filter (D12), mirroring app.js's renderPropertyPanel(). */
  NodicaPlugin.prototype._renderPropertyPanel = function () {
    var self = this;
    var items = this._propItemsEl;
    if (!items || !this._model) return;
    items.innerHTML = "";
    this._model.predicates.forEach(function (p) {
      var row = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = self.hiddenPredicates[p.uri] !== true;
      cb.addEventListener("change", function () {
        if (cb.checked) delete self.hiddenPredicates[p.uri];
        else self.hiddenPredicates[p.uri] = true;
        self._applyPredicateFilter();
      });
      var name = document.createElement("span");
      name.textContent = p.label;
      name.title = p.uri;
      var count = document.createElement("span");
      count.className = "nodica-yasr-count";
      count.textContent = "(" + p.count + ")";
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(count);
      items.appendChild(row);
    });
  };

  NodicaPlugin.prototype._applyPredicateFilter = function () {
    if (this.view) this.view.setHiddenPredicates(Object.keys(this.hiddenPredicates));
  };

  /**
   * Builds the Properties panel and Fix layout / Unpin all / Fit controls
   * (D18) into this.container, appends a bare canvas host for GraphView,
   * and returns that host. Mirrors app.js's #prop-panel / #graph-buttons.
   */
  NodicaPlugin.prototype._buildChrome = function () {
    var self = this;
    NodicaPlugin._injectStyles();

    var propPanel = document.createElement("div");
    propPanel.className = "nodica-yasr-props";

    var propToggle = document.createElement("button");
    propToggle.type = "button";
    propToggle.className = "nodica-yasr-props-toggle";
    propToggle.innerHTML = "Properties &#x25B8;";

    var propList = document.createElement("div");
    propList.className = "nodica-yasr-props-list nodica-yasr-collapsed";

    var propActions = document.createElement("div");
    propActions.className = "nodica-yasr-props-actions";
    var allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "nodica-yasr-linklike";
    allBtn.textContent = "show all";
    var noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className = "nodica-yasr-linklike";
    noneBtn.textContent = "hide all";
    propActions.appendChild(allBtn);
    propActions.appendChild(noneBtn);

    var propItems = document.createElement("div");
    this._propItemsEl = propItems;

    propList.appendChild(propActions);
    propList.appendChild(propItems);
    propPanel.appendChild(propToggle);
    propPanel.appendChild(propList);

    propToggle.addEventListener("click", function () {
      var collapsed = propList.classList.toggle("nodica-yasr-collapsed");
      propToggle.innerHTML = collapsed ? "Properties &#x25B8;" : "Properties &#x25BE;";
    });
    allBtn.addEventListener("click", function () {
      self.hiddenPredicates = {};
      self._renderPropertyPanel();
      self._applyPredicateFilter();
    });
    noneBtn.addEventListener("click", function () {
      if (!self._model) return;
      self.hiddenPredicates = {};
      self._model.predicates.forEach(function (p) { self.hiddenPredicates[p.uri] = true; });
      self._renderPropertyPanel();
      self._applyPredicateFilter();
    });

    var controls = document.createElement("div");
    controls.className = "nodica-yasr-controls";

    var physicsBtn = document.createElement("button");
    physicsBtn.type = "button";
    this._physicsBtn = physicsBtn;
    physicsBtn.addEventListener("click", function () {
      if (!self.view) return;
      var next = !self.view.settings.physicsEnabled;
      self.view.setPhysics(next);
      physicsBtn.textContent = next ? "Fix layout" : "Release layout";
    });

    var unpinBtn = document.createElement("button");
    unpinBtn.type = "button";
    unpinBtn.textContent = "Unpin all";
    unpinBtn.addEventListener("click", function () { if (self.view) self.view.unpinAll(); });

    var fitBtn = document.createElement("button");
    fitBtn.type = "button";
    fitBtn.textContent = "Fit";
    fitBtn.addEventListener("click", function () { if (self.view) self.view.fit(); });

    controls.appendChild(physicsBtn);
    controls.appendChild(unpinBtn);
    controls.appendChild(fitBtn);

    var statusEl = document.createElement("div");
    statusEl.className = "nodica-yasr-status";
    statusEl.hidden = true;
    this._statusEl = statusEl;

    var canvasEl = document.createElement("div");
    canvasEl.className = "nodica-yasr-canvas";

    this.container.appendChild(propPanel);
    this.container.appendChild(controls);
    this.container.appendChild(statusEl);
    this.container.appendChild(canvasEl);
    return canvasEl;
  };

  NodicaPlugin.prototype.draw = function () {
    var self = this;
    var N = lib();
    var raw = this._raw();

    // YASR can call draw() again before the previous one has finished (it does
    // exactly that when it restores a persisted response and then activates the
    // tab). Everything below the first `await` writes into this.container, so
    // without a token two overlapping draws build their chrome into the *same*
    // container - two Properties panels, two control bars - and the earlier
    // GraphView is never destroyed. Stale draws bail out instead.
    var token = ++this._drawSeq;
    var isStale = function () { return token !== self._drawSeq; };

    this._teardown();
    var container = document.createElement("div");
    container.className = "nodica-yasr";
    container.style.position = "relative";
    container.style.width = "100%";
    container.style.height = String(this._pluginConfig().height || "560px");
    this.container = container;
    this.yasr.resultsEl.appendChild(container);

    if (!raw.trim()) {
      this._message("The response is empty: nothing to draw.");
      return;
    }

    return this._resolveSettings()
      .then(function (settings) {
        if (isStale()) return;
        // YASR keeps one plugin instance per tab and calls draw() on every
        // view switch. Re-parsing and re-building an unchanged response is
        // pure waste, so the built model is cached against the raw text (D20).
        var prepared;
        if (self._cacheKey === raw && self._cached) {
          prepared = Promise.resolve(self._cached);
        } else {
          prepared = N.parseRdf(raw).then(function (parsed) {
            var built = N.mergeSettings(settings);

            // D6: fall back to an auto-detected image property when the
            // configured one matches nothing in this result.
            var det = N.detectImageProperty(parsed.quads, built.imageProperty);
            if (det.detected) built.imageProperty = det.property;

            var newModel = N.buildModel(parsed.quads, built, parsed.prefixes);
            var entry = {
              model: newModel,
              settings: N.applyPerformanceGuards(built, newModel).settings,
            };
            self._cacheKey = raw;
            self._cached = entry;
            self._positions = null; // different data: no layout to resume
            return entry;
          });
        }

        return prepared.then(function (entry) {
          if (isStale()) return;
          var model = entry.model;
          var effective = N.mergeSettings(entry.settings);

          if (model.nodes.length === 0) {
            self._message("The query returned no triples to draw.\nNodica renders CONSTRUCT and DESCRIBE results.");
            return;
          }

          // Same data as last time: put every node back where it was and skip
          // stabilisation, so switching views is instant instead of a reshuffle.
          if (self._positions && N.applyPositions(model, self._positions) > 0) {
            effective.stabilizationEnabled = false;
          }

          self._model = model;
          // Keep filter state only for predicates still present (D12, same
          // "survivors" rule app.js uses across re-renders of the same tab).
          var survivors = {};
          model.predicates.forEach(function (p) {
            if (self.hiddenPredicates[p.uri] === true) survivors[p.uri] = true;
          });
          self.hiddenPredicates = survivors;

          var canvasEl = self._buildChrome();
          self.view = new N.GraphView(canvasEl, model, effective);
          self._physicsBtn.textContent = effective.physicsEnabled ? "Fix layout" : "Release layout";
          self._renderPropertyPanel();
          if (Object.keys(self.hiddenPredicates).length > 0) self._applyPredicateFilter();

          self.view.on("stabilizationProgress", function (p) {
            self._setStatus("Laying out " + model.nodes.length + " nodes... " + p.percent + "%");
          });
          self.view.on("stabilized", function () { self._setStatus(""); });

          // Same click discipline as app.js: single click (280 ms, not part
          // of a double click) opens the entity via resolveEntityUrl (D11).
          var clickTimer = null;
          self.view.on("nodeClick", function (e) {
            var id = String(e.node);
            if (id.indexOf("lit:") === 0 || id.indexOf("_:") === 0) return;
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(function () {
              clickTimer = null;
              var url = N.resolveEntityUrl(id, effective);
              if (url) window.open(url, "_blank", "noopener");
            }, 280);
          });
          self.view.on("nodeDoubleClick", function () {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
          });
        });
      })
      .catch(function (err) {
        if (isStale()) return;
        self._message(
          "Could not render this result as a graph: " +
          (err && err.message ? err.message : String(err)) +
          "\nSwitch to the Response view to inspect the raw result."
        );
      });
  };

  /** Offer the raw RDF response for download (extension by content type). */
  NodicaPlugin.prototype.download = function (filename) {
    var raw = this._raw();
    if (!raw) return undefined;
    var ct = this._contentType() || "text/turtle";
    var ext = {
      "application/n-triples": ".nt",
      "application/n-quads": ".nq",
      "application/trig": ".trig",
    }[ct] || ".ttl";
    return {
      getData: function () { return raw; },
      contentType: ct,
      title: "Download graph RDF",
      filename: (filename || "queryResults") + ext,
    };
  };

  /** Icon for the YASR plugin selector: three linked nodes. */
  NodicaPlugin.prototype.getIcon = function () {
    var el = document.createElement("div");
    el.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">' +
      '<line x1="12" y1="6" x2="5" y2="18" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="12" y1="6" x2="19" y2="18" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="5" y1="18" x2="19" y2="18" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="12" cy="6" r="3.5" fill="currentColor"/>' +
      '<circle cx="5" cy="18" r="3.5" fill="currentColor"/>' +
      '<circle cx="19" cy="18" r="3.5" fill="currentColor"/>' +
      "</svg>";
    return el;
  };

  NodicaPlugin.prototype.destroy = function () {
    this._teardown();
    this._cacheKey = null;
    this._cached = null;
    this._positions = null;
  };

  /** Register with whatever Yasr class is reachable; safe to call again. */
  NodicaPlugin.register = function () {
    var Y = (root.Yasgui && root.Yasgui.Yasr) || root.Yasr;
    if (Y && typeof Y.registerPlugin === "function") {
      Y.registerPlugin("nodica", NodicaPlugin);
      return true;
    }
    return false;
  };

  root.NodicaYasrPlugin = NodicaPlugin;
  NodicaPlugin.register();
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
