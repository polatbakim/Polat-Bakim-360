const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const XLSX = require('../vendor/xlsx.full.min.js')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const technicians = {
  T1: { name: 'Birinci Personel' },
  T2: { name: 'İkinci Personel' },
}
const assets = { A1: { name: 'CNC Tezgahı', code: 'PT101', category: 'CNC' } }
const context = vm.createContext({
  state: { orders: [] },
  isWorkOrder: () => true,
  assetById: id => assets[id] || { name: 'Ekipman seçilmedi', code: '', category: '' },
  techById: id => technicians[id] || { name: 'Atanmadı' },
  canonicalAssetCategory: value => value || '',
  visibleWorkOrderNo: order => order.id,
  notificationStatusValue: (number, status) => status || (number ? 'Var' : 'Yok'),
  minutesBetween: (start, end) => start && end ? Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000)) : 0,
  formatMinutesLabel: value => `${Number(value) || 0} dk`,
  Intl,
  Date,
})
vm.runInContext(app.slice(app.indexOf('function orderExportNumber('), app.indexOf('function downloadOrderWorkbook(')), context)

function column(rows, name, row = 1) {
  const index = rows[0].indexOf(name)
  assert.notEqual(index, -1, `${name} sütunu bulunamadı`)
  return rows[row][index]
}

test('iş emri Excel satırı kişi bazlı ve toplam işçilik sürelerini içerir', () => {
  const rows = context.buildOrderExportRows([{
    id: 'IE-1', title: 'Bakım', assetId: 'A1', type: 'Arıza Bakım', status: 'Tamamlandı',
    technicianId: 'T1', assignedTechnicians: ['T1', 'T2'], laborCost: 180, materialCost: 50, totalCost: 230, laborEntries: [
      { technicianId: 'T1', start: '2026-10-20T08:00:00', finish: '2026-10-20T10:00:00', grossMinutes: 120, pauseMinutes: 15, netMinutes: 105 },
      { technicianId: 'T2', start: '2026-10-20T08:30:00', finish: '2026-10-20T10:15:00', grossMinutes: 105, pauseMinutes: 30, netMinutes: 75 },
    ],
  }])
  assert.equal(rows.length, 3)
  assert.equal(column(rows, 'İşçilik Personeli', 1), 'Birinci Personel')
  assert.equal(column(rows, 'İşçilik Personeli', 2), 'İkinci Personel')
  assert.equal(column(rows, 'Brüt İşçilik (dk)', 1), 120)
  assert.equal(column(rows, 'Ara Süresi (dk)', 1), 15)
  assert.equal(column(rows, 'Net İşçilik (dk)', 1), 105)
  assert.equal(column(rows, 'Brüt İşçilik (dk)', 2), 105)
  assert.equal(column(rows, 'Ara Süresi (dk)', 2), 30)
  assert.equal(column(rows, 'Net İşçilik (dk)', 2), 75)
  assert.match(column(rows, 'İş Ekibi', 1), /Birinci Personel.*İkinci Personel/)
  assert.equal(column(rows, 'Personel Satırı', 1), '1/2')
  assert.equal(column(rows, 'Personel Satırı', 2), '2/2')
  assert.equal(column(rows, 'Personel İşçilik Maliyeti', 1), 105)
  assert.equal(column(rows, 'Personel İşçilik Maliyeti', 2), 75)
  assert.equal(column(rows, 'Malzeme Maliyeti (ilk satır)', 1), 50)
  assert.equal(column(rows, 'Malzeme Maliyeti (ilk satır)', 2), '')
  assert.equal(column(rows, 'Toplam Maliyet (ilk satır)', 1), 230)
  assert.equal(column(rows, 'Toplam Maliyet (ilk satır)', 2), '')
})

test('arıza tanım ve nedenleri ayrı sütunlara aktarılır', () => {
  const rows = context.buildOrderExportRows([{
    id: 'IE-2', title: 'Arıza', assetId: 'A1', type: 'Arıza Bakım', status: 'Tamamlandı', technicianId: 'T1',
    completionDetails: {
      electricalFaults: ['Motor Arızası'], electricalCauses: ['Kablo Kopması'],
      mechanicalFaults: ['Rulman Arızası'], mechanicalCauses: ['Aşınma'],
      otherMechanicalCause: 'Yağsız kalmış', rootCauseAnalysis: 'Periyodik kontrol eksik', workPerformed: 'Rulman değişti',
    },
  }])
  assert.equal(column(rows, 'Elektrik Arıza Tanımı'), 'Motor Arızası')
  assert.equal(column(rows, 'Elektrik Arıza Nedeni'), 'Kablo Kopması')
  assert.equal(column(rows, 'Mekanik Arıza Tanımı'), 'Rulman Arızası')
  assert.equal(column(rows, 'Mekanik Arıza Nedeni'), 'Aşınma')
  assert.equal(column(rows, 'Diğer Mekanik Arıza Nedeni'), 'Yağsız kalmış')
  assert.equal(column(rows, 'Kök Neden Analizi'), 'Periyodik kontrol eksik')
})

test('maliyetler metne dönüşmeden iki ondalıklı sayı olarak aktarılır', () => {
  const rows = context.buildOrderExportRows([{
    id: 'IE-3', title: 'Maliyet', assetId: 'A1', type: 'Arıza Bakım', status: 'Tamamlandı', technicianId: 'T1',
    laborCost: 2578.33333333333, materialCost: 10.125, serviceCost: 0, otherCost: 2, totalCost: 2590.45833333333,
  }])
  assert.equal(column(rows, 'Personel İşçilik Maliyeti'), 2578.33)
  assert.equal(typeof column(rows, 'Personel İşçilik Maliyeti'), 'number')
  assert.equal(column(rows, 'Malzeme Maliyeti (ilk satır)'), 10.13)
  assert.equal(column(rows, 'Toplam Maliyet (ilk satır)'), 2590.46)
})

test('indirilen Excel dosyasında maliyet hücreleri gerçek sayı ve para biçimindedir', () => {
  const rows = context.buildOrderExportRows([{
    id: 'IE-4', title: 'Excel', assetId: 'A1', type: 'Arıza Bakım', status: 'Tamamlandı', technicianId: 'T1', laborCost: 2578.33333333333,
  }])
  let saved
  context.window = { XLSX: { utils: XLSX.utils, writeFile: (book, name) => { saved = { book, name } } } }
  vm.runInContext(app.slice(app.indexOf('function downloadOrderWorkbook('), app.indexOf('function exportOrders(')), context)
  assert.equal(context.downloadOrderWorkbook('is-emirleri.xlsx', rows), true)
  assert.equal(saved.name, 'is-emirleri.xlsx')
  const sheet = saved.book.Sheets['İş Emirleri']
  const costColumn = rows[0].indexOf('Personel İşçilik Maliyeti')
  const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: costColumn })]
  assert.equal(cell.t, 'n')
  assert.equal(cell.v, 2578.33)
  assert.equal(cell.z, '#,##0.00 ₺')
})
