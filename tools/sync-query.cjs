/**
 * Copy examples/influences.rq into index.html's DEFAULT_QUERY_INLINE block.
 *
 * The .rq file is the source of truth (D28); index.html keeps an inline copy
 * because a `file://` page cannot fetch a sibling file. Two copies drift, so
 * a test asserts they are identical - and this script is how you satisfy it
 * after editing the query.
 *
 *   node tools/sync-query.cjs        (or: npm run sync:query)
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const rqPath = path.join(root, 'examples', 'influences.rq')
const htmlPath = path.join(root, 'index.html')

const query = fs.readFileSync(rqPath, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '')
if (query.indexOf('CONSTRUCT') === -1) {
  throw new Error(rqPath + ': no CONSTRUCT found - refusing to sync a query that would not render')
}

let html = fs.readFileSync(htmlPath, 'utf8')
const start = html.indexOf('var DEFAULT_QUERY_INLINE = [')
if (start < 0) throw new Error('DEFAULT_QUERY_INLINE not found in index.html')
const open = html.indexOf('[', start)
const close = html.indexOf('].join("\\n");', open)
if (close < 0) throw new Error('DEFAULT_QUERY_INLINE terminator not found')

const before = new Function('return ' + html.slice(open, close + 1))().join('\n')
if (before === query) {
  console.log('already in sync - nothing to do')
  process.exit(0)
}

// Match the surrounding indentation so the file stays readable.
const lines = query.split('\n').map((l) => '        ' + JSON.stringify(l)).join(',\n')
html = html.slice(0, open) + '[\n' + lines + ',\n      ' + html.slice(close)
fs.writeFileSync(htmlPath, html)

console.log('synced examples/influences.rq -> index.html (' + query.split('\n').length + ' lines)')
console.log('run `npm test` to confirm')
