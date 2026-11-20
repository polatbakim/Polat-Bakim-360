const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

function extractFunction(name) {
  const start = app.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} bulunamadı`)
  const bodyStart = app.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1
    if (app[index] === '}') depth -= 1
    if (depth === 0) return app.slice(start, index + 1)
  }
  throw new Error(`${name} tamamlanamadı`)
}

const context = vm.createContext({ Date, Number, Math })
for (const name of [
  'localDateKey',
  'clockMinutes',
  'datedClock',
  'mergedLaborPauseRanges',
  'laborIntervalMetrics',
  'manualFactoryScheduleOverlapMinutes',
  'factorySchedulePauseOverlapMinutes',
  'laborFactoryScheduleEntries',
  'currentManagerLaborMetrics',
]) vm.runInContext(extractFunction(name), context)

test('uzun ara kaydı yalnızca fabrika çalışma saatleriyle kesiştiği kadar düşülür', () => {
  const timing = { start: '2026-10-16T14:30', finish: '2026-11-19T15:50' }
  const schedule = [
    { date: '2026-10-16', start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
    { date: '2026-11-19', start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
  ]
  const pauses = [
    { start: '2026-10-16T15:30', end: '2026-11-19T14:50' },
  ]

  const result = context.currentManagerLaborMetrics({ factoryScheduleEntries: schedule }, timing, pauses)

  assert.deepEqual({
    grossMinutes: result.grossMinutes,
    factoryBreakMinutes: result.factoryBreakMinutes,
    pauseMinutes: result.pauseMinutes,
    netMinutes: result.netMinutes,
  }, {
    grossMinutes: 14480,
    factoryBreakMinutes: 1440,
    pauseMinutes: 12920,
    netMinutes: 120,
  })
})

test('PT101 örneğindeki çoklu aralar iki personelin net süresini ayrı hesaplar', () => {
  const schedule = [
    { date: '2026-10-16', start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
    { date: '2026-11-19', start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
  ]
  const order = { factoryScheduleEntries: schedule }
  const ugur = context.currentManagerLaborMetrics(order, {
    start: '2026-10-16T14:30', finish: '2026-11-19T15:20',
  }, [
    { start: '2026-10-16T14:44', end: '2026-11-09T13:00' },
    { start: '2026-11-09T17:55', end: '2026-11-10T11:02' },
    { start: '2026-11-10T16:57', end: '2026-11-11T10:30' },
    { start: '2026-11-11T18:00', end: '2026-11-19T10:45' },
  ])
  const ismet = context.currentManagerLaborMetrics(order, {
    start: '2026-10-16T14:30', finish: '2026-11-19T15:50',
  }, [
    { start: '2026-10-19T13:06', end: '2026-10-19T13:12' },
    { start: '2026-10-20T10:14', end: '2026-11-09T13:00' },
    { start: '2026-11-09T17:55', end: '2026-11-10T10:30' },
    { start: '2026-11-10T17:00', end: '2026-11-11T11:00' },
    { start: '2026-11-11T18:00', end: '2026-11-13T16:21' },
    { start: '2026-11-13T16:21', end: '2026-11-19T11:00' },
  ])

  assert.equal(ugur.netMinutes, 1209)
  assert.equal(ismet.netMinutes, 2093)
})

test('çakışan birden fazla ara kaydı takvim hesabında iki kez düşülmez', () => {
  const timing = { start: '2026-11-19T08:00', finish: '2026-11-19T18:00' }
  const schedule = [
    { date: '2026-11-19', start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
  ]
  const pauses = [
    { start: '2026-11-19T09:00', end: '2026-11-19T11:00' },
    { start: '2026-11-19T10:30', end: '2026-11-19T13:30' },
  ]

  const result = context.currentManagerLaborMetrics({ factoryScheduleEntries: schedule }, timing, pauses)

  assert.equal(result.grossMinutes, 600)
  assert.equal(result.factoryBreakMinutes, 60)
  assert.equal(result.pauseMinutes, 210)
  assert.equal(result.netMinutes, 330)
})
