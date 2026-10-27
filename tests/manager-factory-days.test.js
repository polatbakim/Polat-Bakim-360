const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const context = vm.createContext({
  localDateKey: value => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const pad = number => String(number).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  },
})
vm.runInContext(app.slice(app.indexOf('function managerLaborScheduleDates('), app.indexOf('function buildFactoryScheduleEntries(')), context)

test('maliyet onayında arıza açılışından itibaren bütün günler oluşturulmaz', () => {
  const dates = context.managerLaborScheduleDates(
    '2026-07-02T08:00',
    '2026-10-12T11:00',
    [{start:'2026-10-12T09:48', finish:'2026-10-12T11:00'}],
  )
  assert.deepEqual(Array.from(dates), ['2026-10-12'])
})

test('yalnızca farklı işçilik kayıtlarının bulunduğu tarihler listelenir', () => {
  const dates = context.managerLaborScheduleDates('', '', [
    {start:'2026-10-10T08:00', finish:'2026-10-10T10:00'},
    {start:'2026-10-12T13:00', finish:'2026-10-12T15:00'},
  ])
  assert.deepEqual(Array.from(dates), ['2026-10-10', '2026-10-12'])
})

test('işçilik satırı yoksa ana başlangıç ve bitiş tarihleri kullanılır', () => {
  const dates = context.managerLaborScheduleDates('2026-10-12T09:00', '2026-10-13T10:00', [])
  assert.deepEqual(Array.from(dates), ['2026-10-12', '2026-10-13'])
})
