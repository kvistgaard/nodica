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
    // D6: Q133028 has two P18 values - the first must win
    const richard = uModel.nodes.find((n) => n.id === "http://www.wikidata.org/entity/Q133028");
    check("first image wins for Q133028",
      richard && richard.image === "http://commons.wikimedia.org/wiki/Special:FilePath/King%20Richard%20III%20from%20NPG.jpg",
      richard && richard.image);
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

  console.log("\n" + (failures === 0 ? "All tests passed." : failures + " test(s) FAILED."));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Harness error:", e);
  process.exit(1);
});
