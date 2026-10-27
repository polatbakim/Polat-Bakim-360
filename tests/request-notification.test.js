const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

test('bildirim numarası SAP durumunu Var yapar, eski durumlar da sadeleştirilir', () => {
  const start = app.indexOf('function notificationStatusValue(')
  const end = app.indexOf('function shiftDateTime(', start)
  assert.ok(start >= 0 && end > start)
  const context = vm.createContext({})
  vm.runInContext(app.slice(start, end), context)
  assert.equal(vm.runInContext("notificationStatusValue('10016803','Yok')", context), 'Var')
  assert.equal(vm.runInContext("notificationStatusValue('', 'SAP Bildirimi Açıldı')", context), 'Var')
  assert.equal(vm.runInContext("notificationStatusValue('', 'Yok')", context), 'Yok')
  const form = { elements: { notificationNo: { value: '10016803' }, notificationStatus: { value: 'Yok' } } }
  context.form = form
  vm.runInContext('syncNotificationStatus(form)', context)
  assert.equal(form.elements.notificationStatus.value, 'Var')
})

test('talep tarihi ve satın alma bildirimi dönüşüm ekranına aktarılır', () => {
  const requestForm = html.match(/<form[^>]*id="requestForm"[\s\S]*?<\/form>/)?.[0]
  assert.ok(requestForm)
  assert.match(requestForm, /name="faultStart" type="datetime-local"/)
  assert.match(requestForm, /Satın Alma Bildirim Numarası<input name="purchaseOrderNo"/)
  assert.match(app, /faultStart:String\(f\.get\('faultStart'\)\|\|''\)/)
  assert.match(app, /managerDateTimeInput\(order\.faultStart\|\|order\.createdAt\)/)
  assert.match(app, /o\.faultStart=o\.type==='Planlı Bakım'\?'':String\(f\.get\('faultStart'\)\|\|''\)/)
  assert.match(html, /<option>Yok<\/option><option>Var<\/option>/)
})
