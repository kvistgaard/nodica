/**
 * Browser regression checks for SPARQL mode (index.html).
 *
 * `npm test` covers the DOM-free core only, which is why a series of layout
 * and UI regressions shipped unnoticed: each was fixed, verified by a probe
 * that happened to measure the wrong thing, and then broke again. Every check
 * here corresponds to a defect that actually reached the user.
 *
 *   node test/browser-smoke.mjs            # needs `npm run serve` running
 *   node test/browser-smoke.mjs --url ...  # against another origin
 *
 * Notes on why the assertions are shaped the way they are:
 *
 * - Footer position is asserted as "distance from the end of the footer
 *   (INCLUDING its bottom margin) to the bottom of the window", not as
 *   document overflow. `body{min-height:100vh}` means a footer floating
 *   400px above the bottom still reports overflow === 0, so the overflow
 *   check alone silently passed while the bug was plainly visible.
 * - Every results view is exercised (Nodica / Table / Response) plus a fresh
 *   empty tab. The footer bug only appeared when the active view was NOT
 *   Nodica, because the old JS layout sized `.nodica-yasr` exclusively.
 * - Colour equality is asserted against the Run button's *computed* colour
 *   rather than a hard-coded hex, and fails loudly if either element is
 *   missing - an earlier version skipped the comparison when the button
 *   wasn't found, so it passed by doing nothing.
 */
import { createRequire } from 'node:module'
import { readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1] }
const URL = flag('--url', 'http://localhost:8090/')

function resolveChromium() {
  const roots = []
  for (const base of [join(homedir(), '.vscode-server/extensions'), join(homedir(), '.vscode/extensions')]) {
    if (!existsSync(base)) continue
    const dirs = readdirSync(base).filter((d) => d.startsWith('danielsanmedium.dscodegpt-'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    const newest = dirs[dirs.length - 1]
    if (newest) roots.push(join(base, newest, 'standalone') + '/')
  }
  roots.push(process.cwd() + '/')
  for (const root of roots) {
    try {
      const mod = createRequire(root)('patchright')
      const c = mod?.chromium ?? mod?.default?.chromium
      if (c) return c
    } catch { /* try next */ }
  }
  throw new Error('patchright not found; this check needs a Playwright/patchright install')
}

/** Everything the assertions need, read in one pass inside the page. */
const PROBE = () => {
  const el = (s) => document.querySelector(s)
  const rect = (s) => { const e = el(s); return e ? e.getBoundingClientRect() : null }
  // Visible the way a user judges it: has area, sits in the viewport, and is
  // what the browser actually hits at its center. `!!element` alone passed
  // while the whole graph pane was collapsed to 2px - existence in the DOM
  // proves nothing about being on screen.
  const visible = (e) => {
    if (!e) return false
    const r = e.getBoundingClientRect()
    if (r.width < 5 || r.height < 5 || r.bottom < 0 || r.top > window.innerHeight) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && (hit === e || e.contains(hit) || hit.contains(e))
  }
  const f = el('footer')
  const fr = f && f.getBoundingClientRect()
  const fMargin = f ? parseFloat(getComputedStyle(f).marginBottom) || 0 : 0
  const bg = (e) => (e ? getComputedStyle(e).backgroundColor : null)
  const ctrls = Array.from(document.querySelectorAll('.nodica-yasr-controls button'))
  const propsToggle = el('.nodica-yasr-props-toggle')
  const graph = rect('.nodica-yasr')
  const tp = el('.tabPanel')
  return {
    orientation: tp ? (tp.className.match(/orientation-(\w+)/) || [, '?'])[1] : null,
    propsVisible: visible(propsToggle),
    canvasVisible: visible(el('.nodica-yasr-canvas')),
    // YASR's Response view is a CodeMirror too; the editor cap must not
    // reach it (it did once - a selector wider than its target).
    resultCmCapped: (() => {
      const cm = Array.from(document.querySelectorAll('.CodeMirror')).find((c) => !c.closest('.yasqe'))
      return cm ? getComputedStyle(cm).maxHeight !== 'none' : null
    })(),
    // CodeMirror scrolls itself (.CodeMirror-scroll). Giving the .CodeMirror
    // wrapper its own overflow stacks a second, native scrollbar on top of
    // that one - which is exactly what shipped. The wrapper must not scroll.
    editorWrapperScrolls: (() => {
      const cm = el('.yasqe .CodeMirror')
      if (!cm) return null
      const o = getComputedStyle(cm).overflowY
      return /auto|scroll/.test(o) && cm.scrollHeight > cm.clientHeight + 1
    })(),
    // A stylesheet max-height here silently overrides YASQE's drag handle,
    // which resizes by writing an inline height on this element.
    editorMaxHeight: (() => {
      const cm = el('.yasqe .CodeMirror')
      return cm ? getComputedStyle(cm).maxHeight : null
    })(),
    editorHeightPx: (() => {
      const cm = el('.yasqe .CodeMirror')
      return cm ? Math.round(cm.getBoundingClientRect().height) : null
    })(),
    // Predicates the graph drew as EDGES. The image property is consumed to
    // fill nodes, so it must be absent here - which is how we can tell from
    // the outside which property the query's marker actually selected.
    edgePredicates: Array.from(document.querySelectorAll('.nodica-yasr-props-list label'))
      .map((l) => l.textContent.trim()),
    resizeHandle: (() => {
      const h = el('.horizontalResizeWrapper')
      if (!h) return null
      const r = h.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), h: Math.round(r.height) }
    })(),
    theme: document.documentElement.getAttribute('data-theme'),
    // Layout
    deadSpaceBelowFooter: fr ? Math.round(window.innerHeight - (fr.bottom + fMargin)) : null,
    overflow: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    footerLeft: fr ? Math.round(fr.left) : null,
    footerRight: fr ? Math.round(fr.right) : null,
    panelLeft: rect('.yasqe') ? Math.round(rect('.yasqe').left) : null,
    panelRight: rect('.yasqe') ? Math.round(rect('.yasqe').right) : null,
    graphHeight: graph ? Math.round(graph.height) : null,
    // Blank space between the bottom of the graph and the top of the footer.
    // Pinning the footer is not enough on its own: the graph can still stop
    // short and leave a pool of empty panel above it (observed at 296px),
    // which is the original complaint in a different disguise.
    gapGraphToFooter: graph && fr ? Math.round(fr.top - graph.bottom) : null,
    editorHeight: rect('.yasqe') ? Math.round(rect('.yasqe').height) : null,
    // Chrome / features
    hasPropsToggle: !!propsToggle,
    propsToggleText: propsToggle ? propsToggle.textContent.trim() : null,
    propsCheckboxes: document.querySelectorAll('.nodica-yasr-props-list input[type=checkbox]').length,
    controlLabels: ctrls.map((b) => b.textContent.trim()),
    // Colours
    runBg: bg(el('.yasqe_queryButton')),
    controlBgs: ctrls.map((b) => bg(b)),
  }
}

let failures = 0
let checks = 0
const fail = (label, msg) => { failures++; console.log(`  FAIL ${label}\n       ${msg}`) }
const pass = (label) => { checks++; console.log(`  ok   ${label}`) }

function assertLayout(scenario, m) {
  const label = `${scenario}: footer sits at the bottom`
  if (m.deadSpaceBelowFooter === null) return fail(label, 'no <footer> found')
  if (m.deadSpaceBelowFooter > 1) fail(label, `${m.deadSpaceBelowFooter}px of dead space below the footer`)
  else if (m.overflow > 1) fail(label, `page overflows by ${m.overflow}px (scrollbar)`)
  else pass(label)
}

function assertGraphFills(scenario, m) {
  const label = `${scenario}: graph fills the results panel`
  if (m.gapGraphToFooter === null) return fail(label, 'no graph container found')
  // 16px is #yasgui's bottom padding; anything much beyond that is blank panel.
  if (m.gapGraphToFooter > 40) fail(label, `${m.gapGraphToFooter}px of blank space between graph and footer`)
  else pass(label)
}

function assertEditorScrollbars(scenario, m) {
  const label = `${scenario}: query editor has one scrollbar, not two`
  if (m.editorWrapperScrolls === null) return fail(label, 'no query editor found')
  if (m.editorWrapperScrolls) fail(label, '.CodeMirror wrapper scrolls natively on top of CodeMirror\'s own scroller')
  else pass(label)
}

function assertEditorResizable(scenario, m) {
  const label = `${scenario}: query editor is not height-capped by our CSS`
  if (m.editorMaxHeight === null) return fail(label, 'no query editor found')
  // Any max-height here overrides the inline height YASQE's drag handle sets.
  if (m.editorMaxHeight !== 'none') fail(label, `max-height ${m.editorMaxHeight} would override YASQE's resize handle`)
  else if (!m.resizeHandle) fail(label, 'no .horizontalResizeWrapper drag handle found')
  else pass(label)
}

function assertAlignment(scenario, m) {
  const label = `${scenario}: footer aligned to the content column`
  if (m.footerLeft !== m.panelLeft || m.footerRight !== m.panelRight) {
    fail(label, `footer ${m.footerLeft}..${m.footerRight} vs editor panel ${m.panelLeft}..${m.panelRight}`)
  } else pass(label)
}

function assertPropertiesFilter(scenario, m) {
  const label = `${scenario}: Properties filter visible on screen`
  if (!m.hasPropsToggle) fail(label, 'the Properties toggle is missing from the DOM')
  else if (!m.propsVisible) fail(label, 'toggle is in the DOM but not visible at its screen position')
  else if (!m.canvasVisible) fail(label, 'toggle visible but the graph canvas is not')
  else if (!/propert/i.test(m.propsToggleText || '')) fail(label, `unexpected toggle label ${JSON.stringify(m.propsToggleText)}`)
  else pass(label)
}

function assertControls(scenario, m) {
  const label = `${scenario}: layout controls present`
  const want = ['Unpin all', 'Fit']
  const missing = want.filter((w) => !m.controlLabels.includes(w))
  // "Fix layout" toggles to "Release layout", so match it loosely.
  const hasToggle = m.controlLabels.some((l) => /(Fix|Release) layout/.test(l))
  if (missing.length || !hasToggle) fail(label, `have ${JSON.stringify(m.controlLabels)}`)
  else pass(label)
}

function assertColours(scenario, m) {
  const label = `${scenario}: graph buttons match the Run button colour`
  if (!m.runBg) return fail(label, 'Run button (.yasqe_queryButton) not found - cannot compare')
  if (!m.controlBgs.length) return fail(label, 'no .nodica-yasr-controls buttons found - cannot compare')
  const odd = m.controlBgs.filter((c) => c !== m.runBg)
  if (odd.length) fail(label, `Run=${m.runBg} but controls are ${JSON.stringify(m.controlBgs)}`)
  else pass(label)
}

const chromium = resolveChromium()
const browser = await chromium.launch({
  headless: true, channel: 'chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

/**
 * Canned CONSTRUCT result, served in place of the live endpoint.
 *
 * Earlier runs queried Wikidata for real and started failing with 502s and
 * timeouts once the suite ran often enough to be throttled - which reports as
 * a product failure and buries the real ones. A layout suite has no business
 * depending on a public endpoint being up: the shape of the response is all
 * that matters here. Images are data: URIs so nothing else leaves the page.
 */
const FIXTURE_TTL = `
@prefix wd:   <http://www.wikidata.org/entity/> .
@prefix wdt:  <http://www.wikidata.org/prop/direct/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
wd:Q1339 rdfs:label "Johann Sebastian Bach" .
wd:Q1339 wdt:P18 <data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==> .
wd:Q57226 rdfs:label "Carl Philipp Emanuel Bach" ; wdt:P737 wd:Q1339 .
wd:Q59379 rdfs:label "Wilhelm Friedemann Bach" ; wdt:P737 wd:Q1339 .
wd:Q57332 rdfs:label "Johann Christian Bach" ; wdt:P737 wd:Q1339 .
wd:Q76428 rdfs:label "Johann Christoph Friedrich Bach" ; wdt:P737 wd:Q1339 .
wd:Q88257 rdfs:label "Gottfried Heinrich Bach" ; wdt:P737 wd:Q1339 .
wd:Q92027 rdfs:label "Elisabeth Juliana Frederica Bach" ; wdt:P737 wd:Q1339 .
`

async function stubEndpoint(page) {
  await page.route('**/query.wikidata.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/turtle', body: FIXTURE_TTL }))
}

async function load(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.nodica-yasr-canvas', { timeout: 30000 })
      await page.waitForTimeout(1800)
      return true
    } catch {
      if (attempt === 3) return false
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[1366, 620], [1920, 930]]) {
    const scenarioBase = `${theme} ${w}x${h}`
    console.log(`\n${scenarioBase}`)
    const ctx = await browser.newContext({
      locale: 'en-US', viewport: { width: w, height: h }, colorScheme: theme,
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 160)) })
    await stubEndpoint(page)
    await page.addInitScript((t) => {
      localStorage.setItem('yasgui_theme', JSON.stringify({ namespace: 'yasgui', val: t, exp: null, time: 1 }))
    }, theme)

    if (!(await load(page))) { fail(scenarioBase, 'page never rendered a graph (endpoint unreachable?)'); await ctx.close(); continue }

    let m = await page.evaluate(PROBE)
    assertLayout(`${scenarioBase} Nodica view`, m)
    assertGraphFills(`${scenarioBase} Nodica view`, m)
    assertAlignment(`${scenarioBase} Nodica view`, m)
    assertPropertiesFilter(`${scenarioBase} Nodica view`, m)
    assertControls(`${scenarioBase} Nodica view`, m)
    assertColours(`${scenarioBase} Nodica view`, m)
    assertEditorScrollbars(`${scenarioBase} Nodica view`, m)
    assertEditorResizable(`${scenarioBase} Nodica view`, m)

    // Actually drag the resize grip: the static checks above can both pass
    // while the handle still does nothing. Only a real drag proves it.
    if (m.resizeHandle) {
      const before = m.editorHeightPx
      const { x, y } = m.resizeHandle
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + 120, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(600)
      const after = (await page.evaluate(PROBE)).editorHeightPx
      const dlabel = `${scenarioBase}: dragging the grip actually enlarges the editor`
      if (after > before + 40) pass(dlabel)
      else fail(dlabel, `height ${before}px -> ${after}px after a 120px drag`)
      // Reload rather than dragging back: a reverse drag does not land on the
      // exact original height, and every later assertion then inherits a
      // taller editor and reports an overflow the product does not have.
      // (That false alarm happened, and cost a debugging round.)
      if (!(await load(page))) fail(`${scenarioBase}: reload after drag`, 'page did not re-render')
    }

    // The Properties panel must actually open and list predicates (D12/D18).
    await page.locator('.nodica-yasr-props-toggle').click()
    await page.waitForTimeout(400)
    m = await page.evaluate(PROBE)
    const plabel = `${scenarioBase}: Properties panel lists predicates`
    if (m.propsCheckboxes < 1) fail(plabel, `panel opened but has ${m.propsCheckboxes} checkboxes`)
    else pass(plabel)

    // D26: the default query marks wdt:P18 with `# nodica:image`, so P18 must
    // be filling nodes (absent from the edge list) while P737 is drawn as an
    // edge. If the marker stopped being honoured, P18 would appear here.
    const dlabel2 = `${scenarioBase}: query's image marker selects the property`
    const edges = m.edgePredicates.join(' ')
    if (!/P737/.test(edges)) fail(dlabel2, `expected P737 as an edge, got ${JSON.stringify(m.edgePredicates)}`)
    else if (/P18/.test(edges)) fail(dlabel2, `P18 drawn as an edge - the marker was not applied: ${JSON.stringify(m.edgePredicates)}`)
    else pass(dlabel2)
    await page.locator('.nodica-yasr-props-toggle').click()
    await page.waitForTimeout(250)

    // The footer must stay put in every results view, not just Nodica's.
    for (const view of ['Table', 'Response', 'Nodica']) {
      await page.getByText(view, { exact: true }).first().click()
      await page.waitForTimeout(1100)
      const vm = await page.evaluate(PROBE)
      assertLayout(`${scenarioBase} ${view} view`, vm)
      if (view === 'Response') {
        const rlabel = `${scenarioBase} Response view: result pane not capped by the editor rule`
        if (vm.resultCmCapped === true) fail(rlabel, 'the non-editor CodeMirror has a max-height')
        else pass(rlabel)
      }
    }

    // The fork's Horizontal Layout (hamburger menu) is a real user state: the
    // graph collapsed to 2px there while every vertical check was green -
    // "the Properties filter was completely removed" was this orientation.
    const toggled = await page.evaluate(() => {
      const i = document.querySelector('.layoutMenuItem'); if (!i) return false; i.click(); return true
    })
    if (toggled) {
      await page.waitForTimeout(1500)
      const hm = await page.evaluate(PROBE)
      assertLayout(`${scenarioBase} horizontal layout`, hm)
      assertGraphFills(`${scenarioBase} horizontal layout`, hm)
      assertPropertiesFilter(`${scenarioBase} horizontal layout`, hm)
      await page.evaluate(() => document.querySelector('.layoutMenuItem').click())
      await page.waitForTimeout(1200)
      const back = await page.evaluate(PROBE)
      assertLayout(`${scenarioBase} back to vertical`, back)
      assertGraphFills(`${scenarioBase} back to vertical`, back)
    } else {
      fail(`${scenarioBase}: horizontal layout scenario`, 'no .layoutMenuItem found to toggle')
    }

    // Returning user: reload restores tabs and results from localStorage
    // WITHOUT querying the endpoint (D20) - a distinct draw path.
    if (await load(page)) {
      const rm = await page.evaluate(PROBE)
      assertLayout(`${scenarioBase} reload (restored)`, rm)
      assertGraphFills(`${scenarioBase} reload (restored)`, rm)
      assertPropertiesFilter(`${scenarioBase} reload (restored)`, rm)
    } else fail(`${scenarioBase} reload (restored)`, 'page did not render after reload')

    // ...and on a brand-new tab that has no results at all.
    await page.locator('button.addTab').click()
    await page.waitForTimeout(1400)
    assertLayout(`${scenarioBase} new empty tab`, await page.evaluate(PROBE))

    if (errors.length) fail(`${scenarioBase}: no console errors`, errors.join(' | '))
    else pass(`${scenarioBase}: no console errors`)

    await ctx.close()
  }
}

await browser.close()
console.log(`\n${checks} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
