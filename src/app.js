/**
 * Nodica standalone application.
 * Wires the UI in index.html to the Nodica core (src/nodica.js).
 *
 * Configuration is two-tier (D10):
 * - settings.ttl: deployment (operator) configuration, fetched at startup;
 *   on file:// pages the embedded DEFAULT_CONFIG below is used instead.
 * - The settings panel: per-user overrides, persisted in localStorage (D9).
 *   Operator-only terms (dataSource, fallback, settingsLocked) are stripped
 *   from anything coming from the user side.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- sample data (same as examples/scientists.ttl) ------- */

  var SAMPLE_DATA = [
    '@prefix :       <http://example.org/scientist/> .',
    '@prefix rel:    <http://example.org/relation/> .',
    '@prefix schema: <https://schema.org/> .',
    '@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
    ':einstein a schema:Person ;',
    '    rdfs:label "Albert Einstein" ;',
    '    schema:image <https://commons.wikimedia.org/wiki/Special:FilePath/Albert%20Einstein%20Head.jpg?width=200> ;',
    '    rel:influencedBy :planck ;',
    '    rel:debatedWith :bohr .',
    '',
    ':bohr a schema:Person ;',
    '    rdfs:label "Niels Bohr" ;',
    '    schema:image <https://commons.wikimedia.org/wiki/Special:FilePath/Niels%20Bohr.jpg?width=200> ;',
    '    rel:studentOf :rutherford .',
    '',
    ':curie a schema:Person ;',
    '    rdfs:label "Marie Curie" ;',
    '    schema:image <https://commons.wikimedia.org/wiki/Special:FilePath/Marie%20Curie%20c1920.jpg?width=200> ;',
    '    rel:colleagueOf :einstein ;',
    '    schema:birthPlace "Warsaw" .',
    '',
    ':rutherford a schema:Person ;',
    '    rdfs:label "Ernest Rutherford" ;',
    '    schema:image <https://commons.wikimedia.org/wiki/Special:FilePath/Ernest%20Rutherford%20LOC.jpg?width=200> ;',
    '    rel:studentOf :thomson .',
    '',
    ':planck a schema:Person ;',
    '    rdfs:label "Max Planck" ;',
    '    schema:image <https://commons.wikimedia.org/wiki/Special:FilePath/Max%20Planck%20(1858-1947).jpg?width=200> .',
    '',
    ':thomson a schema:Person ;',
    '    rdfs:label "J. J. Thomson" .',
  ].join('\n');

  var SAMPLE_CONFIG = [
    '@prefix cfg:    <https://kvistgaard.github.io/config#> .',
    '@prefix schema: <https://schema.org/> .',
    '@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
    '<#scientists> a cfg:Configuration ;',
    '    rdfs:label "Scientists demo"@en ;',
    '    cfg:imageProperty      schema:image ;',
    '    cfg:labelProperty      rdfs:label ;',
    '    cfg:nodeSize           60 ;',
    '    cfg:edgeLength         250 ;',
    '    cfg:edgeWidth          3 ;',
    '    cfg:nodeLabelFontSize  18 ;',
    '    cfg:edgeLabelFontSize  14 ;',
    '    cfg:nodeLabelDistance  12 ;',
    '    cfg:nodeOutlineColor   "#2b7ce9" ;',
    '    cfg:edgeColor          "#999999" ;',
    '    cfg:physicsEnabled     true .',
  ].join('\n');

  /* Embedded copy of the deployment configuration, used when settings.ttl
     cannot be fetched (file:// pages, missing file).
     KEEP IN SYNC with settings.ttl. */
  var DEFAULT_CONFIG = [
    '@prefix cfg:  <https://kvistgaard.github.io/config#> .',
    '@prefix wdt:  <http://www.wikidata.org/prop/direct/> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
    '<#deployment> a cfg:Configuration ;',
    '    rdfs:label "Nodica deployment settings"@en ;',
    '    cfg:dataSource         <test/test-uncle-graph.ttl> ;',
    '    cfg:fallback           cfg:Sample ;',
    '    cfg:settingsLocked     false ;',
    '    cfg:dereferenceRule    [ cfg:uriPrefix "http://www.wikidata.org/entity/" ;',
    '                             cfg:template  "https://www.wikidata.org/wiki/{LOCAL}" ] ;',
    '    cfg:imageProperty      wdt:P18 ;',
    '    cfg:imageMaxWidth      400 ;',
    '    cfg:nodeSize           50 ;',
    '    cfg:edgeLength         200 ;',
    '    cfg:edgeWidth          4 ;',
    '    cfg:nodeLabelFontSize  20 ;',
    '    cfg:edgeLabelFontSize  20 ;',
    '    cfg:nodeLabelDistance  10 ;',
    '    cfg:nodeOutlineColor   "#2b7ce9" ;',
    '    cfg:edgeColor          "#888888" ;',
    '    cfg:physicsEnabled     true .',
  ].join('\n');

  var CFG_SAMPLE = Nodica.CFG_NS + "Sample";
  var CFG_EMPTY = Nodica.CFG_NS + "Empty";

  /* ---------------- per-user persistence (D9) --------------------------- */

  var STORAGE_KEY = "nodica.overrides.v1";

  function loadPersistedOverrides() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return Nodica.sanitizeUserSettings(JSON.parse(raw));
    } catch (e) {
      return {};
    }
  }

  function savePersistedOverrides(overrides) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (e) { /* storage unavailable or full */ }
  }

  function clearPersistedOverrides() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- state ---------------------------------------------- */

  var view = null;
  var effective = Nodica.mergeSettings();
  var lastParsed = null;
  var lastSynced = {};
  var persisted = loadPersistedOverrides();
  var renderSeq = 0;
  var configBaseIRI = null;
  var lastModel = null;
  var hiddenPredicates = {};

  var SETTING_INPUTS = {
    imageProperty: "s-imageProperty",
    labelProperty: "s-labelProperty",
    edgeLabelLanguage: "s-edgeLabelLanguage",
    imageMaxWidth: "s-imageMaxWidth",
    nodeSize: "s-nodeSize",
    edgeLength: "s-edgeLength",
    edgeWidth: "s-edgeWidth",
    nodeLabelFontSize: "s-nodeLabelFontSize",
    edgeLabelFontSize: "s-edgeLabelFontSize",
    nodeLabelDistance: "s-nodeLabelDistance",
    nodeOutlineColor: "s-nodeOutlineColor",
    edgeColor: "s-edgeColor",
    physicsEnabled: "s-physicsEnabled",
  };

  /* The last full result message, so transient progress lines (layout
     stabilisation) can borrow the status area and hand it back. */
  var lastStatus = { kind: "", message: "" };

  function showStatus(kind, message) {
    var el = $("status");
    el.className = kind || "";
    el.textContent = message || "";
  }

  function status(kind, message) {
    lastStatus = { kind: kind || "", message: message || "" };
    showStatus(kind, message);
  }

  function restoreStatus() {
    showStatus(lastStatus.kind, lastStatus.message);
  }

  function inputValue(input) {
    return input.type === "checkbox" ? String(input.checked) : String(input.value);
  }

  function settingsToInputs(s) {
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      var input = $(SETTING_INPUTS[key]);
      if (!input) return;
      if (input.type === "checkbox") input.checked = !!s[key];
      else input.value = s[key];
      lastSynced[key] = inputValue(input);
    });
  }

  function collectOverrides() {
    var out = {};
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      var input = $(SETTING_INPUTS[key]);
      if (!input) return;
      if (inputValue(input) === lastSynced[key]) return;
      if (input.type === "checkbox") out[key] = input.checked;
      else if (input.type === "number") out[key] = parseFloat(input.value);
      else out[key] = input.value.trim();
    });
    return Nodica.sanitizeUserSettings(out);
  }

  function absorbOverrides(fileSettings) {
    var locked = !!fileSettings.settingsLocked;
    $("settings").style.display = locked ? "none" : "";
    if (locked) {
      effective = Nodica.mergeSettings(fileSettings);
    } else {
      var dirty = collectOverrides();
      if (Object.keys(dirty).length > 0) {
        persisted = Nodica.sanitizeUserSettings(Object.assign({}, persisted, dirty));
        savePersistedOverrides(persisted);
      }
      effective = Nodica.mergeSettings(fileSettings, persisted);
    }
    effective.upgradeHttpImages = location.protocol === "https:";
    return effective;
  }

  /* ---------------- property filter (D12) -------------------------------- */

  function applyPredicateFilter() {
    if (view) view.setHiddenPredicates(Object.keys(hiddenPredicates));
  }

  function renderPropertyPanel() {
    var items = $("prop-items");
    items.textContent = "";
    if (!lastModel) return;
    lastModel.predicates.forEach(function (p) {
      var row = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = hiddenPredicates[p.uri] !== true;
      cb.addEventListener("change", function () {
        if (cb.checked) delete hiddenPredicates[p.uri];
        else hiddenPredicates[p.uri] = true;
        applyPredicateFilter();
      });
      var name = document.createElement("span");
      name.textContent = p.label;
      name.title = p.uri;
      var count = document.createElement("span");
      count.className = "count";
      count.textContent = "(" + p.count + ")";
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(count);
      items.appendChild(row);
    });
  }

  /* ---------------- render flow ----------------------------------------- */

  function buildAndShow(parsed) {
    var model = Nodica.buildModel(parsed.quads, effective, parsed.prefixes);

    var guarded = Nodica.applyPerformanceGuards(effective, model);
    var perfNote = guarded.note ? "\n" + guarded.note : "";
    if (guarded.note) {
      effective = guarded.settings;
      settingsToInputs(effective);
    }

    if (view) view.destroy();
    view = new Nodica.GraphView($("graph"), model, effective);
    model.perfNote = perfNote;

    // vis-network stabilises behind a blank canvas, so say what is happening
    // rather than leaving an empty panel (D20).
    view.on("stabilizationProgress", function (p) {
      showStatus("info", "Laying out " + model.nodes.length + " nodes... " + p.percent + "%");
    });
    view.on("stabilized", restoreStatus);

    var clickTimer = null;
    view.on("nodeClick", function (e) {
      var id = String(e.node);
      if (id.indexOf("lit:") === 0 || id.indexOf("_:") === 0) return;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(function () {
        clickTimer = null;
        var url = Nodica.resolveEntityUrl(id, effective);
        if (url) window.open(url, "_blank");
      }, 280);
    });
    view.on("nodeDoubleClick", function () {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    });
    view.on("edgeClick", function (e) {
      console.log("edgeClick", e.edge);
    });

    lastModel = model;
    var survivors = {};
    model.predicates.forEach(function (p) {
      if (hiddenPredicates[p.uri] === true) survivors[p.uri] = true;
    });
    hiddenPredicates = survivors;
    renderPropertyPanel();
    if (Object.keys(hiddenPredicates).length > 0) applyPredicateFilter();

    $("toggle-physics").textContent = effective.physicsEnabled ? "Fix layout" : "Release layout";
    return model;
  }

  function render() {
    var token = ++renderSeq;
    var fallbackNote = "";
    var configText = $("config-input").value.trim();

    var configPromise = configText
      ? Nodica.parseConfig(configText, { baseIRI: configBaseIRI || location.href })
      : Promise.resolve({});

    configPromise
      .then(function (fileSettings) {
        absorbOverrides(fileSettings);

        var dataText = $("data-input").value.trim();
        if (dataText) return dataText;

        var fallbackMode = effective.fallback || CFG_SAMPLE;

        if (effective.dataSource) {
          status("info", "Loading data from " + effective.dataSource + " ...");
          return fetch(effective.dataSource, {
            headers: { Accept: "text/turtle, application/trig, application/n-triples, */*" },
          })
            .then(function (r) {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.text();
            })
            .then(function (text) {
              $("data-input").value = text;
              return text;
            })
            .catch(function (err) {
              var why =
                "The configured data (" + effective.dataSource + ") could not be loaded" +
                (location.protocol === "file:"
                  ? " because this page was opened from disk (file://). Serve it over http to enable preloading, e.g.:\n  npx http-server -p 8090\nthen open http://localhost:8090/"
                  : ": " + err.message + ".");
              if (fallbackMode === CFG_EMPTY) {
                var e2 = new Error(why + "\nPaste data, upload a file, or click 'Load sample'.");
                e2.isInfo = true;
                throw e2;
              }
              fallbackNote = "\n" + why + "\nShowing the built-in sample instead.";
              $("data-input").value = SAMPLE_DATA;
              return SAMPLE_DATA;
            });
        }

        if (fallbackMode === CFG_SAMPLE) {
          fallbackNote = "\nNo data source configured: showing the built-in sample.";
          $("data-input").value = SAMPLE_DATA;
          return SAMPLE_DATA;
        }
        var e = new Error("Nothing to render: paste RDF data, upload a file, or click 'Load sample'.");
        e.isInfo = true;
        throw e;
      })
      .then(function (dataText) {
        return Nodica.parseRdf(dataText);
      })
      .then(function (parsed) {
        if (token !== renderSeq) return;
        lastParsed = parsed;

        var note = "";
        var det = Nodica.detectImageProperty(parsed.quads, effective.imageProperty);
        if (det.detected) {
          note =
            "\nImage property <" + effective.imageProperty + "> matched nothing; " +
            "auto-detected <" + det.property + "> (" + det.matches + " values). " +
            "Set it explicitly in the configuration or settings panel to override.";
          effective.imageProperty = det.property;
        }
        settingsToInputs(effective);

        var model = buildAndShow(parsed);
        var st = model.stats;
        // Images keep arriving after the layout is done; on an image-heavy
        // graph that tail is the slowest part and shouldn't look like a stall.
        var imageNote = st.imagesResolved > 25
          ? "\nThe " + st.imagesResolved + " images load in the background; nodes fill in as they arrive."
          : "";
        status(
          det.detected || model.perfNote || fallbackNote ? "info" : "success",
          "Rendered " + st.nodes + " nodes, " + st.edges + " edges " +
          "(from " + st.inputQuads + " input quads; " +
          st.imagesResolved + " images, " + st.labelsResolved + " labels resolved)." +
          fallbackNote + note + model.perfNote + imageNote
        );
      })
      .catch(function (err) {
        if (token !== renderSeq) return;
        status(err && err.isInfo ? "info" : "error", (err && err.message ? err.message : String(err)));
      });
  }

  /* ---------------- deployment configuration (D10) ----------------------- */

  function loadDeployConfig() {
    if (location.protocol === "file:") {
      return Promise.resolve({ text: DEFAULT_CONFIG, baseIRI: location.href });
    }
    var url = new URL("settings.ttl", location.href).toString();
    return fetch(url, { headers: { Accept: "text/turtle" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text().then(function (text) {
          return { text: text, baseIRI: url };
        });
      })
      .catch(function () {
        return { text: DEFAULT_CONFIG, baseIRI: location.href };
      });
  }

  /* ---------------- file / url loading ---------------------------------- */

  function wireFileInput(inputId, textareaId, onLoaded) {
    $(inputId).addEventListener("change", function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        $(textareaId).value = reader.result;
        if (onLoaded) onLoaded();
        status("info", "Loaded " + file.name + " (" + file.size + " bytes). Click Render.");
      };
      reader.onerror = function () { status("error", "Could not read " + file.name); };
      reader.readAsText(file);
    });
  }

  /** Fetch a document into a textarea. Resolves on success, rejects (after
   *  reporting) on failure, so callers can sequence several fetches. */
  function fetchInto(url, textareaId, onLoaded) {
    status("info", "Fetching " + url + " ...");
    return fetch(url, { headers: { Accept: "text/turtle, application/trig, application/n-triples, */*" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
        return r.text();
      })
      .then(function (text) {
        $(textareaId).value = text;
        if (onLoaded) onLoaded(url);
      })
      .catch(function (err) {
        status("error", "Fetch failed: " + err.message +
          (location.protocol === "file:" ? "\n(URL fetching does not work from file:// pages.)" : ""));
        throw err;
      });
  }

  function wireUrlLoad(buttonId, urlId, textareaId, onLoaded) {
    $(buttonId).addEventListener("click", function () {
      var url = $(urlId).value.trim();
      if (!url) return;
      // Fetching then waiting for a Render click was a step nobody wanted:
      // the only reason to fetch is to see it.
      fetchInto(url, textareaId, onLoaded).then(render, function () { /* reported */ });
    });
  }

  /* ---------------- wiring ----------------------------------------------- */

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof N3 === "undefined" || typeof vis === "undefined") {
      status("error", "Could not load N3.js / vis-network from CDN. Check your internet connection.");
      return;
    }

    settingsToInputs(Nodica.mergeSettings(persisted));

    $("render").addEventListener("click", render);

    $("load-sample").addEventListener("click", function () {
      $("data-input").value = SAMPLE_DATA;
      $("config-input").value = SAMPLE_CONFIG;
      configBaseIRI = location.href;
      render();
    });

    $("toggle-panel").addEventListener("click", function () {
      var panel = $("panel");
      panel.classList.toggle("collapsed");
      this.textContent = panel.classList.contains("collapsed") ? "Show input" : "Hide input";
      if (view) setTimeout(function () { view.fit(); }, 250);
    });

    $("apply-settings").addEventListener("click", function () {
      var dirty = collectOverrides();
      // These are baked into the model at build time, not applied by vis.
      var needsRebuild = ["imageProperty", "labelProperty", "imageMaxWidth", "edgeLabelLanguage"]
        .some(function (key) { return key in dirty; });
      if (Object.keys(dirty).length > 0) {
        persisted = Nodica.sanitizeUserSettings(Object.assign({}, persisted, dirty));
        savePersistedOverrides(persisted);
      }
      effective = Nodica.mergeSettings(effective, dirty);
      settingsToInputs(effective);
      if (!view) {
        status("info", "Settings stored; they will be used on the next Render.");
        return;
      }
      if (needsRebuild && lastParsed) {
        var model = buildAndShow(lastParsed);
        status("success", "Re-rendered with new image/label property: " +
          model.stats.imagesResolved + " images, " + model.stats.labelsResolved + " labels resolved." + model.perfNote);
      } else {
        view.updateSettings(effective);
        $("toggle-physics").textContent = effective.physicsEnabled ? "Fix layout" : "Release layout";
        status("info", "Settings applied to the current view (and saved in this browser).");
      }
    });

    $("reset-settings").addEventListener("click", function () {
      clearPersistedOverrides();
      persisted = {};
      status("info", "Saved settings cleared; re-rendering from the configuration.");
      render();
    });

    $("export-config").addEventListener("click", function () {
      var merged = Nodica.mergeSettings(effective, collectOverrides());
      var ttl = Nodica.configToTurtle(merged);
      var blob = new Blob([ttl], { type: "text/turtle" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "nodica-config.ttl";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });

    $("toggle-physics").addEventListener("click", function () {
      if (!view) return;
      var next = !view.settings.physicsEnabled;
      view.setPhysics(next);
      effective.physicsEnabled = next;
      $("s-physicsEnabled").checked = next;
      lastSynced.physicsEnabled = String(next);
      this.textContent = next ? "Fix layout" : "Release layout";
    });

    $("unpin").addEventListener("click", function () { if (view) view.unpinAll(); });
    $("fit").addEventListener("click", function () { if (view) view.fit(); });

    var FS_ENTER =
      '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
      '<path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
    var FS_EXIT =
      '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
      '<path d="M5 1v4H1M13 5H9V1M9 13V9h4M1 9h4v4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';

    function updateFullscreenButton() {
      var active = document.fullscreenElement != null;
      $("fullscreen").innerHTML = active ? FS_EXIT : FS_ENTER;
      $("fullscreen").title = active ? "Exit fullscreen" : "Fullscreen";
    }

    $("fullscreen").addEventListener("click", function () {
      if (document.fullscreenElement != null) {
        document.exitFullscreen();
      } else if ($("graph-wrap").requestFullscreen) {
        $("graph-wrap").requestFullscreen().catch(function (e) {
          status("error", "Fullscreen not available: " + e.message);
        });
      }
    });

    document.addEventListener("fullscreenchange", function () {
      updateFullscreenButton();
      if (view) setTimeout(function () { view.fit(); }, 150);
    });
    updateFullscreenButton();

    $("prop-toggle").addEventListener("click", function () {
      var collapsed = $("prop-list").classList.toggle("collapsed");
      this.innerHTML = collapsed ? "Properties &#x25B8;" : "Properties &#x25BE;";
    });
    $("prop-all").addEventListener("click", function () {
      hiddenPredicates = {};
      renderPropertyPanel();
      applyPredicateFilter();
    });
    $("prop-none").addEventListener("click", function () {
      if (!lastModel) return;
      hiddenPredicates = {};
      lastModel.predicates.forEach(function (p) { hiddenPredicates[p.uri] = true; });
      renderPropertyPanel();
      applyPredicateFilter();
    });

    wireFileInput("data-file", "data-input");
    wireFileInput("config-file", "config-input", function () { configBaseIRI = location.href; });
    wireUrlLoad("data-url-load", "data-url", "data-input");
    wireUrlLoad("config-url-load", "config-url", "config-input", function (url) {
      configBaseIRI = url;
    });

    var params = new URLSearchParams(location.search);
    var dataParam = params.get("data");
    var configParam = params.get("config");
    if (dataParam) $("data-url").value = dataParam;
    if (configParam) $("config-url").value = configParam;

    if (dataParam || configParam) {
      // Sequenced deliberately: the configuration decides how the data is
      // read, and a single render at the end beats two racing each other.
      var chain = Promise.resolve(true);
      if (configParam) {
        chain = chain.then(function () {
          // A missing configuration is survivable - defaults still render.
          return fetchInto(configParam, "config-input", function (url) { configBaseIRI = url; })
            .then(function () { return true; }, function () { return true; });
        });
      }
      if (dataParam) {
        chain = chain.then(function () {
          // A missing data document is not: rendering anyway would silently
          // fall back to the built-in sample and bury the fetch error.
          return fetchInto(dataParam, "data-input").then(function () { return true; }, function () { return false; });
        });
      }
      chain.then(function (ok) { if (ok) render(); });
    } else {
      loadDeployConfig().then(function (dc) {
        $("config-input").value = dc.text;
        configBaseIRI = dc.baseIRI;
        render();
      });
    }
  });
})();
