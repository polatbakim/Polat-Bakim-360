const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')

test('SCADA bilgi kartı noktadan boş alana geçildiğinde kapanır', () => {
  assert.match(app, /function scheduleScadaNodePopoverClose/)
  assert.match(app, /element\.onmouseleave=.*scheduleScadaNodePopoverClose\(machine\.id\)/)
  assert.match(app, /canvas\.onpointermove=.*scheduleScadaNodePopoverClose\(selectedScadaId,90\)/)
  assert.match(app, /closeScadaNodePopover\(machineId\)/)
})

test('imleç bilgi kartına giderse gecikmeli kapanma iptal edilir', () => {
  assert.match(app, /popover\.onmouseenter=cancelScadaNodePopoverClose/)
  assert.match(app, /popover\.onmouseleave=.*scheduleScadaNodePopoverClose\(machine\.id\)/)
  assert.match(app, /\.scada-node:hover,\.scada-node-popover:hover/)
})
