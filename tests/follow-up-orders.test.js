const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

test('iş emri olmayan açık takipte iş emri oluşturma eylemi görünür', () => {
  const start = app.indexOf('function followUpLinkedOrder(')
  const end = app.indexOf('function renderFollowUps(', start)
  const context = vm.createContext({ state: { orders: [] }, escapeHtml: value => String(value) })
  vm.runInContext(app.slice(start, end), context)
  const withoutOrder = vm.runInContext("followUpActionButtons({id:'TKP-1'},false,false)", context)
  assert.match(withoutOrder, /data-follow-up-order="TKP-1"/)
  context.state.orders.push({ id: 'IE-1' })
  const withOrder = vm.runInContext("followUpActionButtons({id:'TKP-1',linkedOrderId:'IE-1'},false,false)", context)
  assert.match(withOrder, /data-order="IE-1"/)
  assert.doesNotMatch(withOrder, /data-follow-up-order/)
})

test('takip tamamlanmadan önce kullanıcı onayı gerekir', () => {
  const start = app.indexOf('function followUpLinkedOrder(')
  const end = app.indexOf('function deleteFollowUp(', start)
  const item = { id: 'TKP-1', title: 'Servis aranacak', status: 'open' }
  let allow = false
  let saved = 0
  const context = vm.createContext({
    state: { orders: [], followUps: [item] },
    currentApproverId: 'Y1',
    approverById: () => ({ id: 'Y1', name: 'Yönetici' }),
    confirm: () => allow,
    addActivity: () => {},
    saveState: () => { saved++ },
    toast: () => {},
    openSimple: () => {},
    $: () => ({ elements: {} }),
    today: () => '2026-11-16',
    switchView: () => {},
    showOrder: () => {},
  })
  vm.runInContext(app.slice(start, end), context)
  vm.runInContext("toggleFollowUp('TKP-1')", context)
  assert.equal(item.status, 'open')
  assert.equal(saved, 0)
  allow = true
  vm.runInContext("toggleFollowUp('TKP-1')", context)
  assert.equal(item.status, 'completed')
  assert.equal(saved, 1)
})

test('takipten oluşturulan iş emri kısa atama ekranını kullanır ve iki yönlü bağlanır', () => {
  assert.match(app, /openSimple\('follow-up-assign',item\.id\)/)
  assert.match(app, /simpleMode==='follow-up-assign'/)
  assert.match(app, /followUp\.linkedOrderId=id/)
  assert.match(app, /sourceFollowUpId:followUp\.id/)
  assert.match(app, /notificationNo:String\(data\.get\('notificationNo'\)/)
  assert.match(app, /data-follow-up-order/)
})

test('takipten iş emri oluştururken normal aranabilir ekipman seçimi kullanılır', () => {
  assert.match(app, /id="followUpAssetSelect"/)
  assert.match(app, /if\(mode==='follow-up-assign'\)enhanceSearchableAssetSelects\(\)/)
  assert.match(app, /fields\.querySelector\('\.searchable-select-input'\)\?\.focus\(\)/)
})

test('bildirim numarası yeni iş emrinin görünen numarası olur', () => {
  const start = app.indexOf('function visibleWorkOrderNo(')
  const end = app.indexOf('function orderRow(', start)
  const context = vm.createContext({})
  vm.runInContext(app.slice(start, end), context)
  assert.equal(vm.runInContext("visibleWorkOrderNo({id:'IE-2026-0001',notificationNo:'10017325'})", context), '10017325')
  assert.equal(vm.runInContext("visibleWorkOrderNo({id:'IE-2026-0002',notificationNo:''})", context), 'IE-2026-0002')
  assert.match(app, /secondary=o\.ptNo\|\|o\.type\|\|o\.id/)
})
