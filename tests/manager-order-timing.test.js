const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const context = vm.createContext({
  escapeHtml: value => String(value || ''),
  managerDateTimeInput: value => String(value || '').slice(0, 16),
  minutesBetween: (start, end) => Math.max(0, (new Date(end) - new Date(start)) / 60000),
  manualFactoryScheduleOverlapMinutes: () => 0,
})
vm.runInContext(app.slice(app.indexOf('function managerPauseEditorRow('), app.indexOf('function openSimple(', app.indexOf('function managerPauseEditorRow('))), context)

test('yönetici birden fazla ara kaydını ve saatlerini düzenleyebilir', () => {
  const pauses = [
    { start: '2026-10-02T09:00', end: '2026-10-02T09:15', reason: 'Malzeme' },
    { start: '2026-10-02T10:00', end: '2026-10-02T10:20', reason: 'Makine uygunluğu' },
  ]
  assert.equal(context.validateManagerOrderTiming('Teyit Bekliyor', '2026-10-02T08:00', '2026-10-02T11:00', pauses), '')
  const row = context.managerPauseEditorRow({...pauses[0], technicianId:'T1'}, 0, [{id:'T1',name:'Birinci Personel'}])
  assert.match(row, /data-pause-reason/)
  assert.match(row, /data-pause-technician/)
  assert.match(row, /Birinci Personel/)
  assert.match(app, /data-add-order-pause/)
  assert.match(app, /o\.pauseHistory=pauses\.map/)
})

test('çakışan veya çalışma dışındaki ara kayıtları reddedilir', () => {
  const base = { start: '2026-10-02T09:00', end: '2026-10-02T09:20', reason: 'Malzeme' }
  assert.match(context.validateManagerOrderTiming('Teyit Bekliyor', '2026-10-02T08:00', '2026-10-02T11:00', [{...base,technicianId:'T1'}, { technicianId:'T1',start: '2026-10-02T09:10', end: '2026-10-02T09:30', reason: 'Kontrol' }]), /çakışamaz/)
  assert.equal(context.validateManagerOrderTiming('Teyit Bekliyor', '2026-10-02T08:00', '2026-10-02T11:00', [{...base,technicianId:'T1'}, { technicianId:'T2',start: '2026-10-02T09:10', end: '2026-10-02T09:30', reason: 'Kontrol' }]), '')
  assert.match(context.validateManagerOrderTiming('Teyit Bekliyor', '2026-10-02T09:10', '2026-10-02T11:00', [base]), /önce olamaz/)
  assert.match(context.validateManagerOrderTiming('Teyit Bekliyor', '2026-10-02T08:00', '2026-10-02T11:00', [{ start: '2026-10-02T10:00', end: '', reason: 'Malzeme' }]), /Açık ara/)
  assert.equal(context.validateManagerOrderTiming('Beklemede', '2026-10-02T08:00', '', [{ start: '2026-10-02T10:00', end: '', reason: 'Malzeme' }]), '')
  assert.equal(context.validateManagerOrderTiming('Devam Ediyor', '2026-10-02T08:00', '', [{ technicianId:'T1',start: '2026-10-02T10:00', end: '', reason: 'Malzeme' }]), '')
})

test('manuel duruş düzeltmesi ve geçmiş kaydı yönetici formunda bulunur', () => {
  assert.match(app, /managerDowntimeOverrideMinutes/)
  assert.match(app, /Çalışma ve duruş kayıtları düzeltildi/)
  assert.match(app, /data-edit-order=.*Saat ve Duruşları Düzenle/)
})

test('onaylanmış birincil işçilik süresi ve tutarı düzeltilen saatlerle yeniden hesaplanır', () => {
  const order = {
    technicianId: 'T1', startTime: '2026-10-02T08:00', completionTime: '2026-10-02T10:00', pauseMinutes: 20,
    managerConfirmedAt: '2026-10-02T11:00', materialCost: 25, serviceCost: 0, otherCost: 0,
    laborEntries: [{ technicianId: 'T1', start: '2026-10-02T08:00', finish: '2026-10-02T09:00', hourlyRate: 60, total: 60 }],
  }
  context.recalculateManagerCorrectedLabor(order, '2026-10-02T08:00', '2026-10-02T09:00')
  assert.equal(order.laborEntries[0].netMinutes, 100)
  assert.equal(order.laborCost, 100)
  assert.equal(order.totalCost, 125)
})
