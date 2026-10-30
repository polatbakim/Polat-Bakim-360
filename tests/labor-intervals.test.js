const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const start = app.indexOf('function minutesBetween(')
const end = app.indexOf('function orderPersonPauseWindows(', start)
const context = vm.createContext({})
vm.runInContext(app.slice(start, end), context)

test('işçilik, ara öncesi ve ara sonrası aktif sürelerin toplamıdır', () => {
  const result = context.laborIntervalMetrics(
    '2026-10-22T08:55',
    '2026-10-27T17:00',
    [{ start: '2026-10-22T12:00', end: '2026-10-27T13:40' }],
  )

  assert.equal(result.netMinutes, 385)
  assert.equal(result.netMinutes, 185 + 200)
  assert.equal(result.pauseMinutes, result.grossMinutes - 385)
})

test('ara yoksa başlangıç ve bitiş arasındaki süre kullanılır', () => {
  const result = context.laborIntervalMetrics('2026-10-22T13:45', '2026-10-22T17:26')
  assert.equal(result.netMinutes, 221)
  assert.equal(result.pauseMinutes, 0)
})

test('çakışan ara kayıtları iki kez düşülmez', () => {
  const result = context.laborIntervalMetrics('2026-10-22T08:00', '2026-10-22T12:00', [
    { start: '2026-10-22T09:00', end: '2026-10-22T10:00' },
    { start: '2026-10-22T09:30', end: '2026-10-22T10:30' },
  ])
  assert.equal(result.pauseMinutes, 90)
  assert.equal(result.netMinutes, 150)
})

test('rapor ve işçilik ekranları ortak net süre hesabını kullanır', () => {
  assert.match(app, /function buildAnalyticsRows\([\s\S]*laborIntervalMetrics/)
  assert.match(app, /function managerLaborEntriesForOrder\([\s\S]*laborIntervalMetrics/)
  assert.match(app, /function laborCalculation\([\s\S]*laborIntervalMetrics/)
  assert.match(app, /totalRepairMinutes=mttrFailures\.reduce\(\(sum,o\)=>sum\+orderLaborNetMinutes\(o\)/)
})
