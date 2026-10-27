const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
const cron = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'planned-maintenance-cron.sql'), 'utf8')

test('planlı bakım önce kendi sekmesinde kaydedilir, iş emri ayrı eylemdir', () => {
  assert.match(app, /\$\('#newPlanBtn'\)\.addEventListener\('click',\(\)=>openMaintenanceCardModal\(\)\)/)
  assert.match(app, /switchView\('planned'\);toast\(existing\?'Bakım planı güncellendi/)
  assert.match(app, /if\(view==='maintenanceCards'\)view='planned'/)
  assert.match(app, /function renderPlanned\(\)\{\s*const plans=state\.maintenanceCards/)
  assert.match(app, /data-maintenance-card="\$\{escapeHtml\(c\.id\)\}"/)
  assert.match(app, /Array\.from\(\$\('#orderForm'\)\.elements\.type\.options\).*'Planlı Bakım'\)\?\.remove\(\)/)
  assert.match(html, /id="plannedView"[\s\S]*id="maintenanceCardGrid"/)
  assert.doesNotMatch(html, /id="maintenanceCardsView"/)
})

test('bakım planı listesi kart görünümüyle aynı filtreleri ve plan açma eylemini kullanır', () => {
  assert.match(html, /data-maintenance-view="cards"/)
  assert.match(html, /data-maintenance-view="list"/)
  assert.match(html, /id="maintenanceListWrap"/)
  assert.match(html, /id="maintenanceTable"/)
  assert.match(app, /data-maintenance-row="\$\{id\}"/)
  assert.match(app, /maintenanceViewMode=button\.dataset\.maintenanceView;renderMaintenanceCards\(\)/)
})

test('iş emri oluştur düğmesi kayıt açmadan önce kaydetme formunu gösterir', () => {
  const start = app.indexOf('function openMaintenanceOrderModal(')
  const end = app.indexOf('function createMaintenanceOrder(', start)
  const elements = Object.fromEntries(['cardId', 'planName', 'assetName', 'title', 'dueDate', 'branch', 'description'].map(name => [name, { value: '' }]))
  const form = { elements, reset() {} }
  let opened = false
  const context = vm.createContext({
    state: { maintenanceCards: [{ id: 'BK-1', title: 'Aylık kontrol', assetId: 'A1', branch: 'Mekanik Bakım', nextDueDate: '2026-10-20', instructions: 'Kontrol et' }], orders: [] },
    assetById: () => ({ code: 'PT001', name: 'Makine' }),
    $: selector => selector === '#maintenanceOrderForm' ? form : { classList: { remove: () => { opened = true }, add() {} } },
    setTimeout: () => {}, today: () => '2026-10-01',
  })
  vm.runInContext(app.slice(start, end), context)
  vm.runInContext("openMaintenanceOrderModal('BK-1')", context)
  assert.equal(opened, true)
  assert.equal(elements.title.value, 'Aylık kontrol')
  assert.equal(elements.dueDate.value, '2026-10-20')
  assert.equal(context.state.orders.length, 0)
  assert.match(html, /id="maintenanceOrderForm"[\s\S]*İş Emrini Kaydet/)
  assert.match(app, /if\(maintenanceOrder\)openMaintenanceOrderModal\(maintenanceOrder\.dataset\.maintenanceOrder\)/)
})

test('planlı bakım oluştururken arıza ve atama alanları gizlenir', () => {
  const start = app.indexOf('function syncOrderTypeFields(')
  const end = app.indexOf('function openOrderModal(', start)
  assert.ok(start >= 0 && end > start)
  const fields = Object.fromEntries(['type', 'period', 'intervalMonths', 'faultStart', 'notificationNo', 'purchaseOrderNo', 'notificationStatus', 'technicianId'].map(name => [name, { value: '', required: true }]))
  fields.type.value = 'Planlı Bakım'
  fields.period.value = 'Aylık'
  fields.notificationNo.value = '123'
  const form = { elements: fields }
  const labels = [fields.notificationNo, fields.technicianId].map(field => ({
    classList: { toggle(_name, hidden) { field.hidden = hidden } },
    querySelectorAll() { return [field] },
  }))
  const heading = { textContent: '', classList: { toggle() {} } }
  let assignmentSyncCount = 0
  const context = vm.createContext({
    $: selector => selector === '#orderForm' ? form : heading,
    $$: () => labels,
    syncAssignmentFields: () => { assignmentSyncCount++ },
  })
  vm.runInContext(app.slice(start, end), context)
  vm.runInContext('syncOrderTypeFields()', context)
  assert.equal(fields.notificationNo.disabled, true)
  assert.equal(fields.technicianId.disabled, true)
  assert.equal(fields.notificationNo.value, '')
  assert.equal(fields.notificationStatus.value, 'Yok')
  assert.equal(fields.technicianId.required, false)
  fields.type.value = 'Arıza Bakım'
  vm.runInContext('syncOrderTypeFields()', context)
  assert.equal(fields.notificationNo.disabled, false)
  assert.equal(assignmentSyncCount, 1)
  assert.match(html, /<input name="ptNo" readonly/)
  assert.match(app, /form\.elements\.ptNo\.value=a\.id\?compactPtCode\(a\.code\):''/)
  assert.match(app, /status:planned\?'Bekliyor':'Atandı'/)
  assert.match(app, /notificationNo:planned\?'':/)
  assert.match(app, /purchaseOrderNo:planned\?'':/)
  assert.match(app, /data-assign="\$\{escapeHtml\(o\.id\)\}">Personele Ata/)
  assert.match(html, /Varsayılan sorumlu \(isteğe bağlı\)<select name="technicianId"/)
  assert.match(html, /name="period"><option>Günlük<\/option>/)
  assert.match(html, /data-order-custom-months>Kaç ayda bir\?/)
})

test('aynı bakım kartından birden çok atanmamış iş emri oluşturulur', () => {
  const start = app.indexOf('function createMaintenanceOrder(')
  const end = app.indexOf('function completeMaintenanceCardFromOrder(', start)
  assert.ok(start >= 0 && end > start)
  const state = { maintenanceCards: [{ id: 'BK-1', assetId: 'A1', title: 'Aylık bakım', branch: 'Mekanik Bakım', nextDueDate: '2026-10-10', plannedHours: 1 }], orders: [] }
  let next = 0
  const context = vm.createContext({
    state,
    assetById: () => ({ code: 'PT001', location: 'Üretim', costCenter: '' }),
    nextOrderId: () => `IE-${++next}`,
    appendOrderEvent: () => {}, addActivity: () => {}, saveState: () => {},
    $: () => ({ classList: { add: () => {} } }),
    switchView: () => {}, showOrder: () => {}, toast: () => {},
  })
  vm.runInContext(app.slice(start, end), context)
  vm.runInContext("createMaintenanceOrder('BK-1');createMaintenanceOrder('BK-1')", context)
  assert.equal(state.orders.length, 2)
  assert.notEqual(state.orders[0].id, state.orders[1].id)
  assert.equal(state.orders[0].scheduledDate, state.orders[1].scheduledDate)
  assert.equal(state.maintenanceCards[0].nextDueDate, '2026-10-10')
  assert.ok(state.orders.every(order => order.status === 'Bekliyor' && !order.technicianId && order.ptNo === 'PT001'))
})

test('aylık periyot ay sonunu korur ve zamanlayıcı sunucuda çalışır', () => {
  const start = app.indexOf('function maintenancePeriodMonths(')
  const end = app.indexOf('function syncMaintenanceCardPeriodFields(', start)
  assert.ok(start >= 0 && end > start)
  const context = vm.createContext({ dateOffset: () => '' })
  vm.runInContext(app.slice(start, end), context)
  assert.equal(vm.runInContext("nextMaintenanceDue('2026-01-31','Aylık',0,0,31)", context), '2026-02-28')
  assert.equal(vm.runInContext("nextMaintenanceDue('2026-02-28','Aylık',0,0,31)", context), '2026-03-31')
  assert.equal(vm.runInContext("nextMaintenanceDue('2026-01-31','Özel (ay)',2,0,31)", context), '2026-03-31')
  assert.match(cron, /from public\.app_snapshots where id=p_workspace for update/)
  assert.match(cron, /insert into public\.app_sync_events/)
  assert.match(cron, /select cron\.schedule\(/)
  assert.match(cron, /coalesce\(v_card->>'autoGenerate','false'\)='true'/)
})
