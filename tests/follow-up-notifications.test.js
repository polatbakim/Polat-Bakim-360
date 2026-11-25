const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

function extractFunction(name) {
  const start = app.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} bulunamadı`)
  const bodyStart = app.indexOf('{', app.indexOf(')', start) + 1)
  let depth = 0
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1
    if (app[index] === '}') depth -= 1
    if (depth === 0) return app.slice(start, index + 1)
  }
  throw new Error(`${name} tamamlanamadı`)
}

test('bildirim listesi yalnızca günü gelmiş açık takip kayıtlarını alır', () => {
  const manualItems = [
    {id:'TKP-TODAY',title:'Bugünkü takip',status:'open',dueAt:'2026-11-25T09:00'},
    {id:'TKP-OVERDUE',title:'Geciken takip',status:'open',dueAt:'2026-11-24T09:00'},
    {id:'TKP-FUTURE',title:'Gelecek takip',status:'open',dueAt:'2026-11-26T09:00'},
    {id:'TKP-DONE',title:'Tamamlanan takip',status:'completed',dueAt:'2026-11-25T08:00'},
  ]
  const managementItems = [
    {id:'YNT-ORDER-1',title:'İş emri yönetim takibi',status:'open',dueAt:'2026-11-25T10:00'},
  ]
  const context = vm.createContext({
    state: {followUps: manualItems},
    today: () => '2026-11-25',
    managementTrackingOrders: () => managementItems,
    managementFollowUpForOrder: item => item,
  })
  vm.runInContext(extractFunction('followUpDueKind'), context)
  vm.runInContext(extractFunction('notificationFollowUpRecords'), context)

  assert.deepEqual([...context.notificationFollowUpRecords().map(item => item.id)], [
    'TKP-OVERDUE', 'TKP-TODAY', 'YNT-ORDER-1',
  ])
})

test('bildirim paneli iş emri havuzu yerine takip kaynağını kullanır', () => {
  const source = extractFunction('notificationItems')
  assert.match(source, /notificationFollowUpRecords\(\)/)
  assert.match(source, /Geciken Takip/)
  assert.match(source, /Bugünkü Takip/)
  assert.doesNotMatch(source, /operatorCorrectionPending|isActive\(|Geciken İş|İş Talebi|Yönetici Onayı/)
  assert.match(app, /Bugün için takip bildirimi yok/)
  assert.match(app, /notificationFollowUp:followUpId/)
  assert.match(app, /followUpSearch=followUpId;renderFollowUps\(\)/)
  assert.match(app, /function checkNewOperatorAssignments\(\)/)
  assert.match(app, /title='Yeni iş emri atandı'/)
  assert.match(html, /20261125-manager-follow-ups-only-v40/)
})
