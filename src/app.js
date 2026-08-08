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

  /* ---------------- sample data (examples/influences.ttl) --------------
     The failover shown when cfg:dataSource cannot be loaded (cfg:Sample,
     D10) - which is what happens on file://, where fetch is unavailable.
     It therefore has to be inline: a file the page cannot fetch is no use
     as the fallback for a file the page could not fetch.

     Real Wikidata CONSTRUCT output - influences among people born
     1590-1750, the same graph SPARQL mode opens with, so both modes show
     the same thing when nothing else is available. Generated, not
     hand-written: regenerate with examples/influences.rq and copy the result
     over both this block and examples/influences.ttl. A test asserts the
     two stay identical, the same way it does for DEFAULT_CONFIG. */
  var SAMPLE_DATA = [
    "@prefix wd: <http://www.wikidata.org/entity/> .",
    "@prefix wdt: <http://www.wikidata.org/prop/direct/> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    "@prefix wikibase: <http://wikiba.se/ontology#> .",
    "@prefix bd: <http://www.bigdata.com/rdf#> .",
    "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix sesame: <http://www.openrdf.org/schema/sesame#> .",
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
    "@prefix fn: <http://www.w3.org/2005/xpath-functions#> .",
    "@prefix foaf: <http://xmlns.com/foaf/0.1/> .",
    "@prefix dc: <http://purl.org/dc/elements/1.1/> .",
    "@prefix hint: <http://www.bigdata.com/queryHints#> .",
    "@prefix bds: <http://www.bigdata.com/rdf/search#> .",
    "@prefix psn: <http://www.wikidata.org/prop/statement/value-normalized/> .",
    "@prefix pqn: <http://www.wikidata.org/prop/qualifier/value-normalized/> .",
    "@prefix prn: <http://www.wikidata.org/prop/reference/value-normalized/> .",
    "@prefix mwapi: <https://www.mediawiki.org/ontology#API/> .",
    "@prefix gas: <http://www.bigdata.com/rdf/gas#> .",
    "@prefix wdsubgraph: <https://query.wikidata.org/subgraph/> .",
    "@prefix wdtn: <http://www.wikidata.org/prop/direct-normalized/> .",
    "@prefix psv: <http://www.wikidata.org/prop/statement/value/> .",
    "@prefix ps: <http://www.wikidata.org/prop/statement/> .",
    "@prefix pqv: <http://www.wikidata.org/prop/qualifier/value/> .",
    "@prefix pq: <http://www.wikidata.org/prop/qualifier/> .",
    "@prefix prv: <http://www.wikidata.org/prop/reference/value/> .",
    "@prefix pr: <http://www.wikidata.org/prop/reference/> .",
    "@prefix wdno: <http://www.wikidata.org/prop/novalue/> .",
    "@prefix p: <http://www.wikidata.org/prop/> .",
    "@prefix wdata: <http://www.wikidata.org/wiki/Special:EntityData/> .",
    "@prefix wds: <http://www.wikidata.org/entity/statement/> .",
    "@prefix wdv: <http://www.wikidata.org/value/> .",
    "@prefix wdref: <http://www.wikidata.org/reference/> .",
    "@prefix schema: <http://schema.org/> .",
    "@prefix prov: <http://www.w3.org/ns/prov#> .",
    "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
    "@prefix geo: <http://www.opengis.net/ont/geosparql#> .",
    "@prefix geof: <http://www.opengis.net/def/geosparql/function/> .",
    "@prefix mediawiki: <https://www.mediawiki.org/ontology#> .",
    "@prefix ontolex: <http://www.w3.org/ns/lemon/ontolex#> .",
    "@prefix dct: <http://purl.org/dc/terms/> .",
    "@prefix wikibaseqs: <http://wikiba.se/queryService#> .",
    "",
    "wd:Q294344 wdt:P737 wd:Q6527 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Emmanuel%20Joseph%20Siey%C3%A8s%2C%20by%20Jacques%20Louis%20David.jpg> .",
    "",
    "wd:Q6527 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Jean-Jacques%20Rousseau%20%28painted%20portrait%29.jpg> .",
    "",
    "wd:Q294344 rdfs:label \"Emmanuel Joseph Sieyès\"@en .",
    "",
    "wd:Q6527 rdfs:label \"Jean-Jacques Rousseau\"@en .",
    "",
    "wdt:P737 rdfs:label \"influenced by\"@en .",
    "",
    "wd:Q767210 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Portrait%20of%20a%20Man%20with%20a%20Tall%20Hat%20and%20Gloves%2C%20Rembrandt%20van%20Rijn%2C%20c.%201656%2C%20National%20Gallery%20of%20Art%2C%20Washington.jpg> .",
    "",
    "wd:Q9191 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Frans%20Hals%20-%20Portret%20van%20Ren%C3%A9%20Descartes.jpg> .",
    "",
    "wd:Q767210 rdfs:label \"Frans van Schooten\"@en .",
    "",
    "wd:Q9191 rdfs:label \"René Descartes\"@en .",
    "",
    "wd:Q9312 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Immanuel%20Kant%20-%20Gemaelde%202.jpg> ;",
    "\trdfs:label \"Immanuel Kant\"@en .",
    "",
    "wd:Q52937 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Queen%20Christina%20%28S%C3%A9bastien%20Bourdon%29%20-%20Nationalmuseum%20-%2018075FXD.jpg> ;",
    "\trdfs:label \"Christina of Sweden\"@en .",
    "",
    "wd:Q223723 wdt:P737 wd:Q448 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Cesare%20Beccaria.jpg> .",
    "",
    "wd:Q448 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Denis%20Diderot%20-%20Alix%20-%20Vanloo.png> .",
    "",
    "wd:Q223723 rdfs:label \"Cesare Beccaria\"@en .",
    "",
    "wd:Q448 rdfs:label \"Denis Diderot\"@en .",
    "",
    "wd:Q9068 wdt:P737 wd:Q859 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Nicolas%20de%20Largilli%C3%A8re%20-%20Portrait%20de%20Voltaire%20%281694-1778%29%20en%201718%20-%20P208%20-%20Mus%C3%A9e%20Carnavalet%20-%202.jpg> .",
    "",
    "wd:Q859 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Plato%20Silanion%20Musei%20Capitolini%20MC1377.jpg> .",
    "",
    "wd:Q9068 rdfs:label \"Voltaire\"@en .",
    "",
    "wd:Q859 rdfs:label \"Plato\"@en .",
    "",
    "wd:Q9047 wdt:P737 wd:Q868 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Christoph%20Bernhard%20Francke%20-%20Bildnis%20des%20Philosophen%20Leibniz%20%28ca.%201695%29.jpg> .",
    "",
    "wd:Q868 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Aristotle%20Altemps%20Inv8575.jpg> .",
    "",
    "wd:Q9047 rdfs:label \"Gottfried Wilhelm Leibniz\"@en .",
    "",
    "wd:Q868 rdfs:label \"Aristotle\"@en .",
    "",
    "wd:Q648051 wdt:P737 wd:Q2161 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Andrzej%20maksymilian%20fredro.jpg> .",
    "",
    "wd:Q2161 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Tacitus%2C%20Cornelius%20%2850%20-%20116%29.jpg> .",
    "",
    "wd:Q648051 rdfs:label \"Andrzej Maksymilian Fredro\"@en .",
    "",
    "wd:Q2161 rdfs:label \"Tacitus\"@en .",
    "",
    "wd:Q9191 wdt:P737 wd:Q868 .",
    "",
    "wd:Q336803 wdt:P737 wd:Q859 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/%D0%93%D1%80%D0%B8%D0%B3%D0%BE%D1%80%D0%B8%D0%B9%20%D0%A1%D0%BA%D0%BE%D0%B2%D0%BE%D1%80%D0%BE%D0%B4%D0%B0.jpg> ;",
    "\trdfs:label \"Hryhorii Skovoroda\"@en .",
    "",
    "wd:Q1290 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Blaise%20Pascal%20Versailles.JPG> ;",
    "\trdfs:label \"Blaise Pascal\"@en .",
    "",
    "wd:Q7286 wdt:P737 wd:Q9068 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Emilie%20Chatelet%20portrait%20by%20Latour.jpg> ;",
    "\trdfs:label \"Émilie du Châtelet\"@en .",
    "",
    "wd:Q448 wdt:P737 wd:Q868 .",
    "",
    "wd:Q39599 wdt:P737 wd:Q307 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Christiaan-huygens4.jpg> .",
    "",
    "wd:Q307 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Galileo.arp.300pix.jpg> .",
    "",
    "wd:Q39599 rdfs:label \"Christiaan Huygens\"@en .",
    "",
    "wd:Q307 rdfs:label \"Galileo Galilei\"@en .",
    "",
    "wd:Q2421235 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Gilles-Fran%C3%A7ois-Boulduc%281675-1742%29-Portrait.jpg> ;",
    "\trdfs:label \"Gilles-François Boulduc\"@en .",
    "",
    "wd:Q5879 wdt:P737 wd:Q9068 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Goethe%20%28Stieler%201828%29.jpg> ;",
    "\trdfs:label \"Johann Wolfgang von Goethe\"@en .",
    "",
    "wd:Q192062 wdt:P737 wd:Q297 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Autorretrato%20de%20Murillo.jpg> .",
    "",
    "wd:Q297 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Diego%20Vel%C3%A1zquez%20Autorretrato%2045%20x%2038%20cm%20-%20Colecci%C3%B3n%20Real%20Academia%20de%20Bellas%20Artes%20de%20San%20Carlos%20-%20Museo%20de%20Bellas%20Artes%20de%20Valencia.jpg> .",
    "",
    "wd:Q192062 rdfs:label \"Bartolomé Esteban Murillo\"@en .",
    "",
    "wd:Q297 rdfs:label \"Diego Velázquez\"@en .",
    "",
    "wd:Q35802 wdt:P737 wd:Q859 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Spinoza.jpg> ;",
    "\trdfs:label \"Benedictus de Spinoza\"@en .",
    "",
    "wd:Q648051 wdt:P737 wd:Q12735 .",
    "",
    "wd:Q12735 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Jan%20Amos%20Comenius%20%28Komensky%29%20%281592-1670%29.%20Tsjechisch%20humanist%20en%20pedagoog.%20Als%20voorganger%20van%20de%20Moravische%20of%20Boheemse%20Broedergemeente%20verdreven%20en%20sedert%201656%20gevestigd%20te%20Amsterdam%20Rijksmuseum%20SK-A-2161.jpeg> ;",
    "\trdfs:label \"John Amos Comenius\"@en .",
    "",
    "wd:Q155547 wdt:P737 wd:Q9312 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Johann%20Gottfried%20Herder%202.jpg> ;",
    "\trdfs:label \"Johann Gottfried Herder\"@en .",
    "",
    "wd:Q9047 wdt:P737 wd:Q859 .",
    "",
    "wd:Q5879 wdt:P737 wd:Q692 .",
    "",
    "wd:Q692 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Shakespeare.jpg> ;",
    "\trdfs:label \"William Shakespeare\"@en .",
    "",
    "wd:Q9068 wdt:P737 wd:Q742 .",
    "",
    "wd:Q742 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Jean%20Racine%20-%20Versailles%20MV%202926.jpg> ;",
    "\trdfs:label \"Jean Racine\"@en .",
    "",
    "wd:Q9191 wdt:P737 wd:Q859 .",
    "",
    "wd:Q168004 wdt:P737 wd:Q5879 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Friedrich%20Heinrich%20Jacobi%20portrait.jpg> ;",
    "\trdfs:label \"Friedrich Heinrich Jacobi\"@en .",
    "",
    "wd:Q742 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Portrait%20de%20Jean%20Racine%20d%27apr%C3%A8s%20Jean-Baptiste%20Santerre.jpg> .",
    "",
    "wd:Q294344 wdt:P737 wd:Q9068 .",
    "",
    "wd:Q935 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/GodfreyKneller-IsaacNewton-1689.jpg> ;",
    "\trdfs:label \"Isaac Newton\"@en .",
    "",
    "wd:Q35802 wdt:P737 wd:Q9191 .",
    "",
    "wd:Q47208 wdt:P737 wd:Q6527 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Louis-Claude%20de%20Saint-Martin%2C%20portrait%20au%20physionotrace.jpg> ;",
    "\trdfs:label \"Louis-Claude de Saint-Martin\"@en .",
    "",
    "wd:Q72151 wdt:P737 wd:Q9312 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Marcus%20Herz2.jpg> ;",
    "\trdfs:label \"Markus Herz\"@en .",
    "",
    "wd:Q154367 wdt:P737 wd:Q6197 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Klopstock%20%28Juel%29.jpg> .",
    "",
    "wd:Q6197 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Quintus%20Horatius%20Flaccus.jpg> .",
    "",
    "wd:Q154367 rdfs:label \"Friedrich Gottlieb Klopstock\"@en .",
    "",
    "wd:Q6197 rdfs:label \"Horace\"@en .",
    "",
    "wd:Q9068 wdt:P737 wd:Q692 .",
    "",
    "wd:Q216692 wdt:P737 wd:Q687 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Ludvig%20Holberg.jpg> .",
    "",
    "wd:Q687 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Pierre%20Mignard%20-%20Portrait%20de%20Jean-Baptiste%20Poquelin%20dit%20Moli%C3%A8re%20%281622-1673%29%20-%20Google%20Art%20Project%20%28cropped%29.jpg> .",
    "",
    "wd:Q216692 rdfs:label \"Ludvig Holberg\"@en .",
    "",
    "wd:Q687 rdfs:label \"Molière\"@en .",
    "",
    "wd:Q9047 wdt:P737 wd:Q9191 .",
    "",
    "wd:Q9312 wdt:P737 wd:Q6527 .",
    "",
    "wd:Q5879 wdt:P737 wd:Q6240 .",
    "",
    "wd:Q6240 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Anselm%20Feuerbach%20Hafis%20vor%20der%20Schenke%20%28cropped%29.jpg> ;",
    "\trdfs:label \"Hafez\"@en .",
    "",
    "wd:Q192062 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Murillo%20Self-portrait.jpg> .",
    "",
    "wd:Q551894 wdt:P737 wd:Q6527 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Portrait%20de%20Ren%C3%A9-Louis%20de%20Girardin%20-%20Chaalis.jpg> ;",
    "\trdfs:label \"René de Girardin\"@en .",
    "",
    "wd:Q448 wdt:P737 wd:Q9068 .",
    "",
    "wd:Q43393 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/The%20Shannon%20Portrait%20of%20the%20Hon%20Robert%20Boyle.jpg> ;",
    "\trdfs:label \"Robert Boyle\"@en .",
    "",
    "wd:Q9312 wdt:P737 wd:Q859 .",
    "",
    "wd:Q102490 wdt:P737 wd:Q307 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Evangelista%20Torricelli%20by%20Lorenzo%20Lippi%20%28circa%201647%2C%20Galleria%20Silvano%20Lodi%20%26%20Due%29.jpg> ;",
    "\trdfs:label \"Evangelista Torricelli\"@en .",
    "",
    "wd:Q336803 wdt:P737 wd:Q868 .",
    "",
    "wd:Q214544 wdt:P737 wd:Q307 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Bonaventura%20Cavalieri.%20Fusinati%20sculp%20%28cropped%29.jpg> ;",
    "\trdfs:label \"Bonaventura Cavalieri\"@en .",
    "",
    "wd:Q43393 wdt:P737 wd:Q307 .",
    "",
    "wd:Q35802 wdt:P737 wd:Q868 .",
    "",
    "wd:Q9047 wdt:P737 wd:Q11903 .",
    "",
    "wd:Q11903 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Hipatia67.jpg> ;",
    "\trdfs:label \"Hypatia\"@en .",
    "",
    "wd:Q309818 wdt:P737 wd:Q9191 ;",
    "\twdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Nicolas%20Malebranche%20-%20Versailles%20MV%202929.jpg> ;",
    "\trdfs:label \"Nicolas Malebranche\"@en .",
    "",
    "wd:Q5879 wdt:P737 wd:Q517 .",
    "",
    "wd:Q517 wdt:P18 <http://commons.wikimedia.org/wiki/Special:FilePath/Jacques-Louis%20David%20-%20The%20Emperor%20Napoleon%20in%20His%20Study%20at%20the%20Tuileries%20-%20Google%20Art%20Project.jpg> ;",
    "\trdfs:label \"Napoleon\"@en .",
  ].join('\n');

  var SAMPLE_CONFIG = [
    '@prefix cfg:    <https://kvistgaard.github.io/config#> .',
    '@prefix wdt:    <http://www.wikidata.org/prop/direct/> .',
    '@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
    '<#influences> a cfg:Configuration ;',
    '    rdfs:label "Enlightenment influences demo"@en ;',
    '    cfg:imageProperty      wdt:P18 ;',
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
    '    cfg:dataSource         <examples/uncle-graph.ttl> ;',
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
