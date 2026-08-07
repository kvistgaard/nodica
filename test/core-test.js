/**
 * Node test harness for the DOM-free part of the Nodica core:
 * parseRdf, parseConfig, mergeSettings, buildModel, configToTurtle.
 *
 * Run from the repo root (requires the n3 package to be resolvable):
 *   npm install        (once)
 *   npm test           (or: node test/core-test.js)
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Provide the globals the classic script expects.
global.N3 = require("n3");
require(path.join(__dirname, "..", "src", "nodica.js"));
const IG = globalThis.Nodica;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log("  ok   " + name);
  } else {
    failures++;
    console.error("  FAIL " + name + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

(async function main() {
  console.log("Nodica core tests\n");

  /* ---- parseConfig on examples/scientists-config.ttl ------------------ */
  console.log("parseConfig (scientists-config.ttl)");
  const cfg = await IG.parseConfig(read("examples/scientists-config.ttl"));
  check("imageProperty", cfg.imageProperty === "https://schema.org/image", cfg.imageProperty);
  check("labelProperty", cfg.labelProperty === "http://www.w3.org/2000/01/rdf-schema#label", cfg.labelProperty);
  check("nodeSize 60", cfg.nodeSize === 60, cfg.nodeSize);
  check("edgeLength 250", cfg.edgeLength === 250, cfg.edgeLength);
  check("physicsEnabled true", cfg.physicsEnabled === true, cfg.physicsEnabled);
  check("nodeOutlineColor", cfg.nodeOutlineColor === "#2b7ce9", cfg.nodeOutlineColor);

  /* ---- parseConfig on examples/example-config.ttl (wdt:P18) ----------- */
  console.log("parseConfig (example-config.ttl)");
  const cfg2 = await IG.parseConfig(read("examples/example-config.ttl"));
  check("imageProperty wdt:P18", cfg2.imageProperty === "http://www.wikidata.org/prop/direct/P18", cfg2.imageProperty);

  /* ---- vocab file parses ---------------------------------------------- */
  console.log("vocab/config-ontology.ttl");
  const vocab = await IG.parseRdf(read("vocab/config-ontology.ttl"));
  check("parses, >70 triples", vocab.quads.length > 70, vocab.quads.length);

  /* ---- Turtle model ---------------------------------------------------- */
  console.log("buildModel (scientists.ttl)");
  const settings = IG.mergeSettings(cfg);
  const ttl = await IG.parseRdf(read("examples/scientists.ttl"));
  // 6 persons; triples: einstein 5, bohr 4, curie 5, rutherford 4, planck 3, thomson 2 = 23
  check("23 quads parsed", ttl.quads.length === 23, ttl.quads.length);
  const model = IG.buildModel(ttl.quads, settings, ttl.prefixes);
  // consumed: 5 images + 6 labels = 11; remaining 12 triples -> edges
  check("12 edges", model.edges.length === 12, model.edges.length);
  // nodes: 6 persons + schema:Person + 1 literal ("Warsaw") = 8
  check("8 nodes", model.nodes.length === 8, model.nodes.length);
  check("5 images resolved", model.stats.imagesResolved === 5, model.stats.imagesResolved);
  check("6 labels resolved", model.stats.labelsResolved === 6, model.stats.labelsResolved);

  const byId = {};
  model.nodes.forEach((n) => (byId[n.id] = n));
  const einstein = byId["http://example.org/scientist/einstein"];
  check("einstein is circularImage", einstein && einstein.shape === "circularImage", einstein && einstein.shape);
  check("einstein label from rdfs:label", einstein && einstein.label === "Albert Einstein", einstein && einstein.label);
  const thomson = byId["http://example.org/scientist/thomson"];
  check("thomson has no image (dot)", thomson && thomson.shape === "dot", thomson && thomson.shape);
  const litNode = model.nodes.find((n) => n.id.indexOf("lit:") === 0);
  check("literal node 'Warsaw' is box", litNode && litNode.shape === "box" && litNode.label === "Warsaw", litNode);
  const typeEdge = model.edges.find((e) => e.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  check("rdf:type edge label shortened", typeEdge && typeEdge.label === "rdf:type", typeEdge && typeEdge.label);
  const noImageEdges = model.edges.every((e) => e.predicate !== "https://schema.org/image");
  check("image triples consumed (no schema:image edges)", noImageEdges);

  /* ---- TriG model: flattening + dedup ---------------------------------- */
  console.log("buildModel (scientists.trig)");
  const trig = await IG.parseRdf(read("examples/scientists.trig"));
  const model2 = IG.buildModel(trig.quads, settings, trig.prefixes);
  // Same data as the .ttl, with :curie rel:colleagueOf :einstein duplicated
  // across graphs: model must match the Turtle one exactly after dedup.
  check("quads include duplicate (24)", trig.quads.length === 24, trig.quads.length);
  check("12 edges after dedup", model2.edges.length === 12, model2.edges.length);
  check("8 nodes after flatten", model2.nodes.length === 8, model2.nodes.length);

  /* ---- first-wins for multiple image values (D6) ----------------------- */
  console.log("first wins (D6)");
  const multi = await IG.parseRdf(
    '@prefix s: <https://schema.org/> . <http://x.org/a> s:image <http://img/1> ; s:image <http://img/2> .'
  );
  const model3 = IG.buildModel(multi.quads, settings, multi.prefixes);
  const a3 = model3.nodes.find((n) => n.id === "http://x.org/a");
  check("image-only subject still gets a node", !!a3, model3.nodes);
  check("first image wins", a3 && a3.image === "http://img/1", a3 && a3.image);

  /* ---- schema.org http/https equivalence ------------------------------- */
  console.log("schema.org http/https");
  const httpData = await IG.parseRdf(
    '@prefix s: <http://schema.org/> . <http://x.org/a> s:image <http://img/1> .'
  );
  const model4 = IG.buildModel(httpData.quads, settings, httpData.prefixes);
  const a4 = model4.nodes.find((n) => n.id === "http://x.org/a");
  check("http://schema.org/image matched", a4 && a4.image === "http://img/1", a4);

  /* ---- edge/property labels from the data itself (D17) ------------------ */
  console.log("edge labels: property's own rdfs:label (D17)");
  const propLabelData = await IG.parseRdf(
    '@prefix ex: <http://x.org/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n' +
    'ex:hasParent rdfs:label "father"@en, "Vater"@de .\n' +
    'ex:noLabel rdfs:label "sans langue" .\n' +
    'ex:a ex:hasParent ex:b ; ex:noLabel ex:c ; ex:unlabelled ex:d .'
  );
  const modelEn = IG.buildModel(propLabelData.quads, IG.mergeSettings(), propLabelData.prefixes);
  const edgeHasParent = modelEn.edges.find((e) => e.predicate === "http://x.org/hasParent");
  check("english property label used for edge", edgeHasParent && edgeHasParent.label === "father", edgeHasParent && edgeHasParent.label);
  const edgeNoLabel = modelEn.edges.find((e) => e.predicate === "http://x.org/noLabel");
  check("language-free label used when no language matches", edgeNoLabel && edgeNoLabel.label === "sans langue", edgeNoLabel && edgeNoLabel.label);
  const edgeUnlabelled = modelEn.edges.find((e) => e.predicate === "http://x.org/unlabelled");
  check("falls back to shortened URI when the property has no label", edgeUnlabelled && edgeUnlabelled.label === "ex:unlabelled", edgeUnlabelled && edgeUnlabelled.label);
  const predHasParent = modelEn.predicates.find((p) => p.uri === "http://x.org/hasParent");
  check("property filter panel uses the same label", predHasParent && predHasParent.label === "father", predHasParent && predHasParent.label);
  check("property-label triples don't spawn orphan nodes",
    !modelEn.nodes.some((n) => n.id === "http://x.org/hasParent" || n.id === "http://x.org/noLabel"),
    modelEn.nodes.map((n) => n.id));

  const modelDe = IG.buildModel(propLabelData.quads, IG.mergeSettings({ edgeLabelLanguage: "de" }), propLabelData.prefixes);
  const edgeHasParentDe = modelDe.edges.find((e) => e.predicate === "http://x.org/hasParent");
  check("edgeLabelLanguage selects the German label", edgeHasParentDe && edgeHasParentDe.label === "Vater", edgeHasParentDe && edgeHasParentDe.label);

  const modelFr = IG.buildModel(propLabelData.quads, IG.mergeSettings({ edgeLabelLanguage: "fr" }), propLabelData.prefixes);
  const edgeHasParentFr = modelFr.edges.find((e) => e.predicate === "http://x.org/hasParent");
  check("unmatched language falls back to any available label",
    edgeHasParentFr && (edgeHasParentFr.label === "father" || edgeHasParentFr.label === "Vater"),
    edgeHasParentFr && edgeHasParentFr.label);

  check("edgeLabelLanguage defaults to en", IG.DEFAULTS.edgeLabelLanguage === "en", IG.DEFAULTS.edgeLabelLanguage);
  const edgeLangRoundTrip = await IG.parseConfig(IG.configToTurtle(IG.mergeSettings({ edgeLabelLanguage: "de" })));
  check("edgeLabelLanguage round-trips through configToTurtle", edgeLangRoundTrip.edgeLabelLanguage === "de", edgeLangRoundTrip.edgeLabelLanguage);

  /* ---- config defaults + overrides ------------------------------------- */
  console.log("mergeSettings + configToTurtle round-trip");
  const merged = IG.mergeSettings({ nodeSize: 99 }, { edgeColor: "#123456" });
  check("override wins", merged.nodeSize === 99 && merged.edgeColor === "#123456");
  check("defaults fill gaps", merged.edgeLength === IG.DEFAULTS.edgeLength);
  const roundTrip = await IG.parseConfig(IG.configToTurtle(merged));
  check("round-trip nodeSize", roundTrip.nodeSize === 99, roundTrip.nodeSize);
  check("round-trip edgeColor", roundTrip.edgeColor === "#123456", roundTrip.edgeColor);
  check("round-trip imageProperty", roundTrip.imageProperty === IG.DEFAULTS.imageProperty, roundTrip.imageProperty);

  /* ---- image property auto-detection ------------------------------------ */
  console.log("detectImageProperty");
  const detKept = IG.detectImageProperty(ttl.quads, "https://schema.org/image");
  check("configured property kept when it matches", detKept.detected === false && detKept.matches === 5, detKept);
  const heur = await IG.parseRdf(
    '<http://x.org/a> <http://x.org/pic> <http://x.org/files/portrait.png> ; <http://x.org/knows> <http://x.org/b> .'
  );
  const detHeur = IG.detectImageProperty(heur.quads, IG.DEFAULTS.imageProperty);
  check("URL-pattern heuristic finds unknown property",
    detHeur.detected === true && detHeur.property === "http://x.org/pic", detHeur);

  /* ---- uncle graph (real Wikidata CONSTRUCT output, wdt:P18) ------------ */
  console.log("uncle graph (test-uncle-graph.ttl)");
  let uncleText = null;
  try {
    uncleText = read("test/test-uncle-graph.ttl");
  } catch (e) {
    console.log("  (file not found - skipping)");
  }
  if (uncleText) {
    const u = await IG.parseRdf(uncleText);
    const detU = IG.detectImageProperty(u.quads, IG.DEFAULTS.imageProperty);
    check("wdt:P18 auto-detected",
      detU.detected === true && detU.property === "http://www.wikidata.org/prop/direct/P18", detU);
    const uSettings = IG.mergeSettings({ imageProperty: detU.property });
    const uModel = IG.buildModel(u.quads, uSettings, u.prefixes);
    check(">100 images resolved", uModel.stats.imagesResolved > 100, uModel.stats.imagesResolved);
    const fileNodes = uModel.nodes.filter((n) => n.id.indexOf("Special:FilePath") !== -1);
    check("no separate image-URL nodes", fileNodes.length === 0, fileNodes.length);
    const p18Edges = uModel.edges.filter((e) => e.predicate === "http://www.wikidata.org/prop/direct/P18");
    check("no wdt:P18 edges drawn", p18Edges.length === 0, p18Edges.length);
    const imageNodes = uModel.nodes.filter((n) => n.shape === "circularImage");
    check("every resolved image fills a node", imageNodes.length === uModel.stats.imagesResolved, imageNodes.length);
    // D6: Q133028 has two P18 values - the first must win. D20: the URL is
    // then https-upgraded and thumbnailed on the way to the node.
    const richard = uModel.nodes.find((n) => n.id === "http://www.wikidata.org/entity/Q133028");
    check("first image wins for Q133028 (https + thumbnailed, D20)",
      richard && richard.image === "https://commons.wikimedia.org/wiki/Special:FilePath/King%20Richard%20III%20from%20NPG.jpg?width=400",
      richard && richard.image);
    const unthumbed = IG.buildModel(u.quads, IG.mergeSettings({ imageProperty: detU.property, imageMaxWidth: 0 }), u.prefixes)
      .nodes.filter((n) => n.image && n.image.indexOf("?width=") !== -1);
    check("imageMaxWidth 0 loads originals", unthumbed.length === 0, unthumbed.length);
    const thumbed = uModel.nodes.filter((n) => n.image && n.image.indexOf("?width=400") !== -1);
    check("every Commons image thumbnailed by default",
      thumbed.length === uModel.stats.imagesResolved, thumbed.length + "/" + uModel.stats.imagesResolved);
    const insecure = uModel.nodes.filter((n) => n.image && n.image.indexOf("http://") === 0);
    check("no http:// image URLs left (saves a redirect each)", insecure.length === 0, insecure.length);
    const hasUncleEdges = uModel.edges.filter((e) => e.predicate === "https://example.org/rel/hasUncle");
    check("hasUncle edges present", hasUncleEdges.length > 100, hasUncleEdges.length);
  }

  /* ---- cfg:dataSource (preloaded file) ----------------------------------- */
  console.log("cfg:dataSource");
  const dsCfg = await IG.parseConfig(
    '@prefix cfg: <https://kvistgaard.github.io/config#> .\n' +
    '<#c> a cfg:Configuration ; cfg:dataSource <test/test-uncle-graph.ttl> .',
    { baseIRI: "http://host/index.html" }
  );
  check("relative dataSource resolved against baseIRI",
    dsCfg.dataSource === "http://host/test/test-uncle-graph.ttl", dsCfg.dataSource);
  const dsTtl = IG.configToTurtle(IG.mergeSettings({ dataSource: "http://host/data.ttl" }));
  const dsRound = await IG.parseConfig(dsTtl);
  check("dataSource round-trips through export", dsRound.dataSource === "http://host/data.ttl", dsRound.dataSource);
  const noDsTtl = IG.configToTurtle(IG.mergeSettings({}));
  check("export omits dataSource when unset", noDsTtl.indexOf("dataSource") === -1);
  const vocabHasDs = vocab.quads.some((q) => q.subject.value === IG.CFG_NS + "dataSource");
  check("ontology defines cfg:dataSource", vocabHasDs);
  const vocabNew = ["fallback", "settingsLocked", "dereferenceRule", "uriPrefix", "template", "StartupMode", "Sample", "Empty"]
    .every((t) => vocab.quads.some((q) => q.subject.value === IG.CFG_NS + t));
  check("ontology defines D10/D11 terms", vocabNew);

  /* ---- two-tier configuration (D10) -------------------------------------- */
  console.log("operator vs user settings (D10)");
  const opCfg = await IG.parseConfig(
    '@prefix cfg: <https://kvistgaard.github.io/config#> .\n' +
    '<#c> a cfg:Configuration ; cfg:fallback cfg:Empty ; cfg:settingsLocked true ; cfg:dataSource <http://x/d.ttl> .'
  );
  check("cfg:fallback parsed", opCfg.fallback === IG.CFG_NS + "Empty", opCfg.fallback);
  check("cfg:settingsLocked parsed", opCfg.settingsLocked === true, opCfg.settingsLocked);
  const userSide = IG.sanitizeUserSettings({
    nodeSize: 70,
    dataSource: "http://evil/x.ttl",
    settingsLocked: true,
    fallback: IG.CFG_NS + "Empty",
  });
  check("user settings keep visual terms", userSide.nodeSize === 70, userSide);
  check("operator terms stripped from user side",
    !("dataSource" in userSide) && !("settingsLocked" in userSide) && !("fallback" in userSide), userSide);
  check("OPERATOR_TERMS exported", Array.isArray(IG.OPERATOR_TERMS) && IG.OPERATOR_TERMS.indexOf("dataSource") !== -1);

  // the actual deployment settings file must parse and be complete
  const deploy = await IG.parseConfig(read("settings.ttl"), { baseIRI: "http://host/settings.ttl" });
  check("deployment config: dataSource resolves", deploy.dataSource === "http://host/test/test-uncle-graph.ttl", deploy.dataSource);
  check("deployment config: fallback Sample", deploy.fallback === IG.CFG_NS + "Sample", deploy.fallback);
  check("deployment config: dereference rule present",
    Array.isArray(deploy.dereferenceRules) && deploy.dereferenceRules.length === 1, deploy.dereferenceRules);

  /* ---- dereferencing (D11) ------------------------------------------------ */
  console.log("resolveEntityUrl (D11)");
  const drSettings = {
    dereferenceRules: [
      { uriPrefix: "http://www.wikidata.org/entity/", template: "https://www.wikidata.org/wiki/{LOCAL}" },
      { uriPrefix: "", template: "https://lookup.example.org/?u={URI}" },
    ],
  };
  check("longest prefix wins ({LOCAL})",
    IG.resolveEntityUrl("http://www.wikidata.org/entity/Q42", drSettings) === "https://www.wikidata.org/wiki/Q42",
    IG.resolveEntityUrl("http://www.wikidata.org/entity/Q42", drSettings));
  check("catch-all with {URI} encoding",
    IG.resolveEntityUrl("http://example.org/a b", drSettings) === "https://lookup.example.org/?u=" + encodeURIComponent("http://example.org/a b"),
    IG.resolveEntityUrl("http://example.org/a b", drSettings));
  check("no rules: URI opens as-is",
    IG.resolveEntityUrl("http://example.org/x", {}) === "http://example.org/x");
  check("non-http URI without rules rejected",
    IG.resolveEntityUrl("urn:isbn:123", {}) === null);
  check("javascript: template rejected",
    IG.resolveEntityUrl("http://x.org/a", { dereferenceRules: [{ uriPrefix: "", template: "javascript:alert(1)" }] }) === null);
  const drCfg = await IG.parseConfig(
    '@prefix cfg: <https://kvistgaard.github.io/config#> .\n' +
    '<#c> a cfg:Configuration ;\n' +
    '  cfg:dereferenceRule [ cfg:uriPrefix "http://a/" ; cfg:template "https://x/{LOCAL}" ] ;\n' +
    '  cfg:dereferenceRule [ cfg:uriPrefix "http://a/b/" ; cfg:template "https://y/{LOCAL}" ] .'
  );
  check("rules parsed and sorted longest-first",
    drCfg.dereferenceRules && drCfg.dereferenceRules.length === 2 && drCfg.dereferenceRules[0].uriPrefix === "http://a/b/",
    drCfg.dereferenceRules);
  check("parsed rules resolve", IG.resolveEntityUrl("http://a/b/c", drCfg) === "https://y/c",
    IG.resolveEntityUrl("http://a/b/c", drCfg));
  const drTtl = IG.configToTurtle(IG.mergeSettings(drCfg));
  const drRound = await IG.parseConfig(drTtl);
  check("rules survive export round-trip",
    drRound.dereferenceRules && drRound.dereferenceRules.length === 2 &&
    IG.resolveEntityUrl("http://a/b/c", drRound) === "https://y/c", drRound.dereferenceRules);
  const cleanRules = IG.sanitizeSettings({ dereferenceRules: [{ uriPrefix: "http://a/", template: "https://x/{LOCAL}" }, { bad: true }, "junk"] });
  check("sanitize keeps only well-formed rules",
    cleanRules.dereferenceRules && cleanRules.dereferenceRules.length === 1, cleanRules.dereferenceRules);

  /* ---- property filter (D12) ---------------------------------------------- */
  console.log("property filter (D12)");
  check("predicates aggregated (6 distinct)", model.predicates && model.predicates.length === 6,
    model.predicates && model.predicates.map((p) => p.label));
  const typePred = model.predicates.find((p) => p.uri === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  check("rdf:type count 6, label shortened", typePred && typePred.count === 6 && typePred.label === "rdf:type", typePred);
  const sumCounts = model.predicates.reduce((a, p) => a + p.count, 0);
  check("predicate counts sum to edge count", sumCounts === model.edges.length, sumCounts);
  const nodeIds = model.nodes.map((n) => n.id);
  const visHidden = IG.computeVisibility(model.edges, nodeIds, { "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": true });
  const hiddenEdgeCount = visHidden.edgeUpdates.filter((u) => u.hidden).length;
  check("hiding rdf:type hides its 6 edges", hiddenEdgeCount === 6, hiddenEdgeCount);
  const personUpd = visHidden.nodeUpdates.find((u) => u.id === "https://schema.org/Person");
  check("orphaned class node hidden", personUpd && personUpd.hidden === true, personUpd);
  const einsteinUpd = visHidden.nodeUpdates.find((u) => u.id === "http://example.org/scientist/einstein");
  check("connected nodes stay visible", einsteinUpd && einsteinUpd.hidden === false, einsteinUpd);
  const isolated = IG.computeVisibility([], ["http://x.org/solo"], {});
  check("edgeless nodes always visible", isolated.nodeUpdates[0].hidden === false, isolated.nodeUpdates);
  const visNone = IG.computeVisibility(model.edges, nodeIds, {});
  check("empty filter hides nothing",
    visNone.edgeUpdates.every((u) => !u.hidden) && visNone.nodeUpdates.every((u) => !u.hidden));

  /* ---- requirements coverage: every config term reaches the view --------- */
  console.log("config terms -> vis options (requirements: Configuration)");
  const probe = IG.mergeSettings({
    nodeSize: 42, edgeLength: 123, edgeWidth: 7,
    nodeLabelFontSize: 21, edgeLabelFontSize: 17, nodeLabelDistance: 33,
    nodeOutlineColor: "#abcdef", edgeColor: "#fedcba", physicsEnabled: false,
  });
  const vo = IG.toVisOptions(probe);
  check("cfg:nodeSize -> nodes.size", vo.nodes.size === 42);
  check("cfg:edgeLength -> physics spring length", vo.physics.barnesHut.springLength === 123);
  check("cfg:edgeWidth -> edges.width", vo.edges.width === 7);
  check("cfg:nodeLabelFontSize -> nodes.font.size", vo.nodes.font.size === 21);
  check("cfg:edgeLabelFontSize -> edges.font.size", vo.edges.font.size === 17);
  check("cfg:nodeLabelDistance -> nodes.font.vadjust", vo.nodes.font.vadjust === 33);
  check("cfg:nodeOutlineColor -> node border color", vo.nodes.color.border === "#abcdef");
  check("cfg:edgeColor -> edge color", vo.edges.color.color === "#fedcba");
  check("cfg:physicsEnabled -> physics.enabled", vo.physics.enabled === false);

  /* ---- robustness (D9): sanitize, escaping, mixed content ---------------- */
  console.log("sanitizeSettings (untrusted persisted overrides)");
  const dirtyInput = {
    nodeSize: "55",            // numeric string -> coerced
    edgeWidth: "not-a-number", // -> dropped
    physicsEnabled: "true",    // -> coerced boolean
    evilKey: "alert(1)",       // unknown -> dropped
    edgeColor: "  #aabbcc  ",  // trimmed
  };
  const clean = IG.sanitizeSettings(dirtyInput);
  check("numeric string coerced", clean.nodeSize === 55, clean.nodeSize);
  check("invalid number dropped", !("edgeWidth" in clean), clean.edgeWidth);
  check("boolean string coerced", clean.physicsEnabled === true, clean.physicsEnabled);
  check("unknown key dropped", !("evilKey" in clean), Object.keys(clean));
  check("string trimmed", clean.edgeColor === "#aabbcc", clean.edgeColor);

  console.log("HTML escaping of tooltips (XSS hardening)");
  check("escapeHtml", IG.escapeHtml('<img src=x onerror="a">') === "&lt;img src=x onerror=&quot;a&quot;&gt;",
    IG.escapeHtml('<img src=x onerror="a">'));
  const xss = await IG.parseRdf(
    '<http://x.org/a> <http://x.org/p> "<img src=x onerror=alert(1)>" .'
  );
  const xssModel = IG.buildModel(xss.quads, IG.mergeSettings(), xss.prefixes);
  const xssLit = xssModel.nodes.find((n) => n.id.indexOf("lit:") === 0);
  check("literal tooltip escaped", xssLit && xssLit.title.indexOf("<img") === -1 && xssLit.title.indexOf("&lt;img") === 0, xssLit && xssLit.title);
  const xssSubj = xssModel.nodes.find((n) => n.id === "http://x.org/a");
  check("plain URI tooltip unchanged", xssSubj && xssSubj.title === "http://x.org/a", xssSubj && xssSubj.title);

  /* ---- image URL normalisation (D20) ------------------------------------ */
  console.log("image URLs: https upgrade + thumbnailing (D20)");
  const N400 = { imageMaxWidth: 400 };
  check("Special:FilePath gets a width",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg", N400) ===
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=400",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg", N400));
  check("an existing width is respected",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=200", N400) ===
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=200",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=200", N400));
  check("an existing query is preserved",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?x=1", N400) ===
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?x=1&width=400",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?x=1", N400));
  check("a fragment stays at the end",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg#f", N400) ===
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=400#f",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg#f", N400));
  check("non-FilePath URLs are never rewritten",
    IG.normalizeImageUrl("https://example.org/a.jpg", N400) === "https://example.org/a.jpg",
    IG.normalizeImageUrl("https://example.org/a.jpg", N400));
  check("imageMaxWidth 0 disables thumbnailing",
    IG.normalizeImageUrl("https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg", { imageMaxWidth: 0 }) ===
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg");
  check("wikimedia http upgraded even on an http page",
    IG.normalizeImageUrl("http://commons.wikimedia.org/x.jpg", {}) === "https://commons.wikimedia.org/x.jpg",
    IG.normalizeImageUrl("http://commons.wikimedia.org/x.jpg", {}));
  check("other hosts left alone unless upgradeHttpImages",
    IG.normalizeImageUrl("http://example.org/a.jpg", {}) === "http://example.org/a.jpg");
  check("look-alike host not upgraded",
    IG.normalizeImageUrl("http://notwikimedia.org/a.jpg", {}) === "http://notwikimedia.org/a.jpg",
    IG.normalizeImageUrl("http://notwikimedia.org/a.jpg", {}));
  check("host match cannot be faked from a path",
    IG.normalizeImageUrl("http://evil.example/?x=wikimedia.org/a.jpg", {}) === "http://evil.example/?x=wikimedia.org/a.jpg",
    IG.normalizeImageUrl("http://evil.example/?x=wikimedia.org/a.jpg", {}));
  check("imageMaxWidth default is 400", IG.DEFAULTS.imageMaxWidth === 400, IG.DEFAULTS.imageMaxWidth);
  const imwRound = await IG.parseConfig(IG.configToTurtle(IG.mergeSettings({ imageMaxWidth: 250 })));
  check("imageMaxWidth round-trips through configToTurtle", imwRound.imageMaxWidth === 250, imwRound.imageMaxWidth);
  check("imageMaxWidth is user-settable (not operator-only)",
    IG.sanitizeUserSettings({ imageMaxWidth: 300 }).imageMaxWidth === 300);
  const vocabHasImw = vocab.quads.some((q) => q.subject.value === IG.CFG_NS + "imageMaxWidth");
  check("ontology defines cfg:imageMaxWidth", vocabHasImw);
  const deployImw = await IG.parseConfig(read("settings.ttl"), { baseIRI: "http://host/settings.ttl" });
  check("settings.ttl sets imageMaxWidth", deployImw.imageMaxWidth === 400, deployImw.imageMaxWidth);

  // CLAUDE.md invariant 2: app.js's embedded copy (used on file:// pages,
  // where settings.ttl cannot be fetched) must produce the same settings as
  // the file itself. Compared after parsing, so formatting may differ freely.
  const appSrc = read("src/app.js");
  const dcStart = appSrc.indexOf("var DEFAULT_CONFIG = [");
  const dcEnd = appSrc.indexOf("].join('\\n');", dcStart);
  check("DEFAULT_CONFIG is findable in app.js", dcStart !== -1 && dcEnd !== -1);
  const embeddedConfig = appSrc
    .slice(appSrc.indexOf("[", dcStart) + 1, dcEnd)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => l.replace(/,$/, "").replace(/^'/, "").replace(/'$/, ""))
    .join("\n");
  const embeddedSettings = await IG.parseConfig(embeddedConfig, { baseIRI: "http://host/settings.ttl" });
  const asKeyValues = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  check("DEFAULT_CONFIG in app.js stays in sync with settings.ttl",
    asKeyValues(embeddedSettings) === asKeyValues(deployImw),
    { embedded: asKeyValues(embeddedSettings), file: asKeyValues(deployImw) });

  /* ---- size-dependent render options (D20) ------------------------------ */
  console.log("size-dependent vis options (D20)");
  const small = IG.toVisOptions(IG.mergeSettings(), { nodeCount: 50, edgeCount: 40 });
  const big = IG.toVisOptions(IG.mergeSettings(), { nodeCount: 900, edgeCount: 900 });
  check("small graph keeps the Kamada-Kawai pre-layout", small.layout.improvedLayout === true);
  check("large graph drops it (vis clusters above 150 nodes)", big.layout.improvedLayout === false);
  check("threshold is vis-network's own clusterThreshold",
    IG.LIMITS.maxImprovedLayoutNodes === 150, IG.LIMITS.maxImprovedLayoutNodes);
  check("few edges stay curved", small.edges.smooth.enabled === true);
  check("many edges go straight", big.edges.smooth.enabled === false);
  check("stabilisation on by default", small.physics.stabilization.enabled === true);
  check("stabilisation skippable for a restored layout",
    IG.toVisOptions(IG.mergeSettings({ stabilizationEnabled: false })).physics.stabilization.enabled === false);
  check("no hints: small-graph options apply", IG.toVisOptions(IG.mergeSettings()).layout.improvedLayout === true);

  console.log("performance guards + layout restore (D20)");
  const guardSmall = IG.applyPerformanceGuards(IG.mergeSettings(), { nodes: new Array(10) });
  check("small graph keeps physics", guardSmall.settings.physicsEnabled === true && guardSmall.note === "", guardSmall);
  const guardBig = IG.applyPerformanceGuards(IG.mergeSettings(), { nodes: new Array(2000) });
  check("physics off above the node limit", guardBig.settings.physicsEnabled === false, guardBig.settings.physicsEnabled);
  check("and it says so", guardBig.note.indexOf("2000 nodes") !== -1, guardBig.note);
  const guardInput = IG.mergeSettings();
  IG.applyPerformanceGuards(guardInput, { nodes: new Array(2000) });
  check("guards never mutate their argument", guardInput.physicsEnabled === true, guardInput.physicsEnabled);
  const posModel = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const posApplied = IG.applyPositions(posModel, { a: { x: 1, y: 2 }, b: { x: -3, y: 4 }, zz: { x: 9, y: 9 } });
  check("positions restored for known nodes", posApplied === 2, posApplied);
  check("coordinates copied", posModel.nodes[0].x === 1 && posModel.nodes[1].y === 4, posModel.nodes);
  check("unknown nodes untouched", posModel.nodes[2].x === undefined, posModel.nodes[2]);
  check("no positions is a no-op", IG.applyPositions(posModel, null) === 0);

  console.log("http->https image upgrade (mixed content, D9)");
  const mixed = await IG.parseRdf(
    '@prefix s: <https://schema.org/> . <http://x.org/a> s:image <http://imgs.example.org/a.jpg> .'
  );
  const up = IG.buildModel(mixed.quads, IG.mergeSettings({ upgradeHttpImages: true }), mixed.prefixes);
  const upNode = up.nodes.find((n) => n.id === "http://x.org/a");
  check("upgraded to https when enabled", upNode && upNode.image === "https://imgs.example.org/a.jpg", upNode && upNode.image);
  const noUp = IG.buildModel(mixed.quads, IG.mergeSettings(), mixed.prefixes);
  const noUpNode = noUp.nodes.find((n) => n.id === "http://x.org/a");
  check("unchanged when disabled", noUpNode && noUpNode.image === "http://imgs.example.org/a.jpg", noUpNode && noUpNode.image);

  /* ---- error propagation ------------------------------------------------ */
  console.log("parse errors");
  let threw = false;
  try {
    await IG.parseRdf("this is not turtle at all ;;;");
  } catch (e) {
    threw = true;
  }
  check("invalid input rejects", threw);

  /* ---- YASR plugin adapter (D15) ---------------------------------------- */
  console.log("YASR plugin adapter (D15)");
  const yasrRegistry = {};
  global.Yasgui = {
    Yasr: {
      registerPlugin(name, plugin) { yasrRegistry[name] = plugin; },
      plugins: yasrRegistry,
    },
  };
  require(path.join(__dirname, "..", "src", "nodica-yasr-plugin.js"));
  const Plugin = yasrRegistry.nodica;
  check("registers as 'nodica'", typeof Plugin === "function");
  check("exposed as NodicaYasrPlugin", globalThis.NodicaYasrPlugin === Plugin);

  const mockYasr = (contentType, raw) => ({
    results: {
      getOriginalResponseAsString: () => raw,
      getContentType: () => contentType,
    },
    config: { plugins: {} },
  });
  const inst = new Plugin(mockYasr("text/turtle", "@prefix ex: <http://x.org/> . ex:a ex:p ex:b ."));
  check("priority is a number", typeof inst.priority === "number", inst.priority);
  check("label present", typeof inst.label === "string", inst.label);
  check("draw is a function", typeof inst.draw === "function");
  check("destroy is a function", typeof inst.destroy === "function");
  check("hiddenPredicates starts empty", inst.hiddenPredicates && Object.keys(inst.hiddenPredicates).length === 0, inst.hiddenPredicates);
  // D18: file-mode graph controls (property filter, fix layout, unpin, fit),
  // rebuilt into the YASR results pane on every draw(). DOM-heavy behavior
  // (actual clicks, panel population) is browser-verified, not here; this
  // just locks down the interface the DOM tests below depend on.
  check("_buildChrome is a function", typeof inst._buildChrome === "function");
  check("_renderPropertyPanel is a function", typeof inst._renderPropertyPanel === "function");
  check("_applyPredicateFilter is a function", typeof inst._applyPredicateFilter === "function");

  console.log("YASR plugin canHandleResults (RDF in, SELECT out)");
  check("handles text/turtle", inst.canHandleResults() === true);
  check("handles turtle with charset param",
    new Plugin(mockYasr("text/turtle;charset=utf-8", "<http://a> <http://b> <http://c> .")).canHandleResults() === true);
  check("handles application/n-triples",
    new Plugin(mockYasr("application/n-triples", "<http://a> <http://b> <http://c> .")).canHandleResults() === true);
  check("handles application/trig",
    new Plugin(mockYasr("application/trig", "@prefix ex: <http://x.org/> . ex:g { ex:a ex:p ex:b . }")).canHandleResults() === true);
  check("declines SPARQL JSON (SELECT)",
    new Plugin(mockYasr("application/sparql-results+json", '{"head":{"vars":[]}}')).canHandleResults() === false);
  check("declines SPARQL XML",
    new Plugin(mockYasr("application/sparql-results+xml", '<?xml version="1.0"?><sparql/>')).canHandleResults() === false);
  check("text/plain sniffed as N-Triples",
    new Plugin(mockYasr("text/plain", "<http://a> <http://b> <http://c> .")).canHandleResults() === true);
  check("text/plain prose declined",
    new Plugin(mockYasr("text/plain", "hello world")).canHandleResults() === false);
  check("missing content type sniffed as Turtle",
    new Plugin(mockYasr("", "@prefix ex: <http://x.org/> . ex:a ex:p ex:b .")).canHandleResults() === true);
  check("empty response declined",
    new Plugin(mockYasr("text/turtle", "")).canHandleResults() === false);

  console.log("YASR plugin settings resolution (D8)");
  const cfgYasr = mockYasr("text/turtle", "");
  cfgYasr.config.plugins.nodica = {
    dynamicConfig: {
      configTurtle:
        '@prefix cfg: <https://kvistgaard.github.io/config#> .\n' +
        '<http://x.org/c> a cfg:Configuration ;\n' +
        '  cfg:nodeSize 42 ;\n' +
        '  cfg:imageProperty <http://www.wikidata.org/prop/direct/P18> .',
      nodeSize: 77,
      height: "600px",
      evilKey: "dropped",
    },
  };
  const resolved = await new Plugin(cfgYasr)._resolveSettings();
  check("configTurtle parsed", resolved.imageProperty === "http://www.wikidata.org/prop/direct/P18", resolved.imageProperty);
  check("flat override beats configTurtle", resolved.nodeSize === 77, resolved.nodeSize);
  check("unknown override key dropped", !("evilKey" in resolved), Object.keys(resolved));
  check("height is layout-only, not a setting", !("height" in resolved));
  check("defaults fill the gaps", resolved.edgeLength === IG.DEFAULTS.edgeLength, resolved.edgeLength);

  console.log("\n" + (failures === 0 ? "All tests passed." : failures + " test(s) FAILED."));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Harness error:", e);
  process.exit(1);
});
