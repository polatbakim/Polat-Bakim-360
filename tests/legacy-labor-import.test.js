const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const XLSX = require('../vendor/xlsx.full.min.js')

function importer() {
  const elements = new Map()
  function element(id) {
    return { id, value: '', files: [], disabled: false, textContent: '', innerHTML: '',
      classList: { add() {}, remove() {} }, addEventListener() {}, querySelectorAll() { return [] } }
  }
  for (const id of ['legacyLaborFile', 'legacyLaborModal', 'importLegacyLaborBtn', 'legacyLaborMode',
    'legacyLaborSummary', 'legacyLaborDetails', 'legacyLaborFileName', 'legacyLaborError', 'confirmLegacyLaborBtn']) elements.set(id, element(id))
  const context = { document: { getElementById: id => elements.get(id) }, window: { XLSX }, state: {}, toast() {}, console }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'legacy-labor-import.js'), 'utf8'), context)
  return context.window.PolatLegacyLaborImport
}

const HEADERS = ['IsNo', 'IsTanimi', 'Kisi', 'ArızaBaslangic', 'Durum', 'Yıl', 'PT No Yeni', 'BildirimNo',
  'EkipmanTanimi', 'MasrafYeriYeni', 'BaslangicSaati', 'BitisSaati', 'NetCalismaSuresi', 'NetCalismaSuresi-YemekMolalari', 'AraBaslangic', 'AraBitis']
function workbook(rows) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'Sayfa1')
  return book
}
function row(no, person, status = 'Tamamlandı') {
  return [no, `İş ${no}`, person, '2026-02-05T08:20:00', status, 2026, 'PT214', 10010000 + no,
    'CNC', 'TALAŞLI İMALAT', '2026-02-05T09:00:00', '2026-02-05T10:00:00', 60, 50, '', '']
}

test('Excel beklemesini gösterir, eski ara saatlerini canlı işçilikten ayrı tutar ve dokunulmamış aktarımı düzeltir', () => {
  const api = importer()
  const waiting = row(301, 'Ali Yılmaz', 'Beklemede')
  waiting[11] = ''
  waiting[14] = '2026-02-05T09:30:00'
  const groups = api.readGroups(workbook([waiting]))
  const base = { orders: [], assets: [{ id: 'A214', code: 'PT214' }], technicians: [{ id: 'T1', name: 'Ali Yılmaz' }] }
  const first = api.planImport(groups, base)
  const order = first.next.orders[0]
  assert.equal(order.status, 'Beklemede')
  assert.equal(order.legacyImportedWaiting, true)
  assert.equal(order.legacyLaborEntries[0].pauseStart, '2026-02-05T09:30:00')
  assert.equal(order.legacyLaborEntries[0].pauseEnd, '')
  assert.equal(order.startTime, '')
  assert.equal(order.pauseHistory, undefined)
  assert.equal(first.summary.waiting, 1)
  const old = structuredClone(order)
  old.status = 'Atandı'
  old.legacyImportedWaiting = false
  const repair = api.planImport(groups, { ...base, orders: [old] })
  assert.equal(repair.summary.repaired, 1)
  assert.equal(repair.next.orders[0].status, 'Beklemede')
  assert.equal(repair.next.orders[0].legacyLaborEntries[0].pauseStart, old.legacyLaborEntries[0].pauseStart)
  assert.equal(api.planImport(groups, repair.next).summary.repaired, 0)
})

test('aktarımdan sonra işlem gören işin beklemesini yeniden içe aktarırken değiştirmez', () => {
  const api = importer()
  const groups = api.readGroups(workbook([row(302, 'Ali Yılmaz', 'Beklemede')]))
  const base = { orders: [], assets: [], technicians: [{ id: 'T1', name: 'Ali Yılmaz' }] }
  const old = structuredClone(api.planImport(groups, base).next.orders[0])
  old.status = 'Atandı'
  old.events.push({ eventType: 'edited' })
  const repair = api.planImport(groups, { ...base, orders: [old] })
  assert.equal(repair.summary.editedSkipped, 1)
  assert.equal(repair.next.orders[0].status, 'Atandı')
})

test('aynı iş numarasındaki işçilikleri birleştirir, boş kişiyi talep yapar ve tekrar aktarmaz', () => {
  const api = importer()
  const groups = api.readGroups(workbook([row(101, 'Ali Yılmaz'), row(101, 'Veli Demir'), row(102, 'BOŞ', 'Yeni')]))
  assert.equal(groups.rowCount, 3)
  assert.equal(groups.items.length, 2)
  const base = { orders: [], assets: [{ id: 'A214', code: 'PT214', name: 'CNC tezgâhı', category: 'CNC' }],
    technicians: [{ id: 'T1', name: 'Ali Yılmaz' }, { id: 'T2', name: 'Veli Demir' }] }
  const first = api.planImport(groups, base)
  assert.equal(first.summary.orders, 1)
  assert.equal(first.summary.requests, 1)
  const order = first.next.orders.find(item => item.type !== 'İş Talebi')
  assert.equal(order.status, 'Atandı')
  assert.equal(order.technicianId, 'T1')
  assert.deepEqual(Array.from(order.assignedTechnicians), ['T1', 'T2'])
  assert.equal(order.legacyLaborEntries.length, 2)
  assert.equal(order.legacyLaborEntries[0].netMinutes, 50)
  const request = first.next.orders.find(item => item.type === 'İş Talebi')
  assert.equal(request.status, 'Bekliyor')
  assert.equal(request.technicianId, '')
  const second = api.planImport(groups, first.next)
  assert.equal(second.summary.skipped, 2)
  assert.equal(second.next.orders.length, 2)
})

test('eşleşmeyen kişiyi saptar ve kodu olmayan ekipmanı geçmiş referans olarak saklar', () => {
  const api = importer()
  const groups = api.readGroups(workbook([row(201, 'Eski Çalışan')]))
  const base = { orders: [], assets: [], technicians: [] }
  const result = api.planImport(groups, base)
  assert.equal(result.unmatchedPeople[0], 'Eski Çalışan')
  assert.equal(result.summary.placeholderAssets, 1)
  assert.equal(result.next.orders[0].status, 'Atandı')
  assert.equal(result.next.orders[0].startTime, '')
  assert.equal(result.next.orders[0].legacyLaborEntries.length, 1)
  assert.equal(result.next.technicians.length, 0)
})

if (process.env.LEGACY_SOURCE_WORKBOOK) test('verilen gerçek Excel iş ve personel satırları okunur', () => {
  const api = importer()
  const book = XLSX.read(fs.readFileSync(process.env.LEGACY_SOURCE_WORKBOOK), { type: 'buffer', cellDates: true })
  const groups = api.readGroups(book)
  assert.ok(groups.rowCount > 0)
  assert.ok(groups.items.length > 0)
  const names = [...new Set(groups.items.flatMap(group => group.rows.map(row => row.Kisi)).filter(value => value && value !== 'BOŞ'))]
  const technicians = names.map((name, index) => ({ id: `T${index + 1}`, name }))
  const preview = api.planImport(groups, { orders: [], assets: [], technicians })
  assert.equal(preview.summary.requests + preview.summary.orders, groups.items.length)
  assert.equal(preview.unmatchedPeople.length, 0)
  assert.equal(preview.summary.waiting, 17)
  assert.equal(preview.summary.assigned, 1)
  assert.equal(preview.next.orders.flatMap(order => order.legacyLaborEntries || []).filter(entry => entry.pauseStart).length, 23)
  assert.equal(preview.next.orders.filter(order => ['Atandı', 'Beklemede'].includes(order.status)).length, preview.summary.orders)
  console.log(`Kaynak Excel: ${groups.rowCount} satır, ${groups.items.length} iş, ${preview.summary.requests} talep, ${preview.summary.orders} iş emri`)
})

test('yayın dosyası dahil edilir ve ilk aktarımda toplu push bildirimi engellenir', () => {
  const root = path.join(__dirname, '..')
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8')
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8')
  const pushSql = fs.readFileSync(path.join(root, 'supabase', 'web-push.sql'), 'utf8')
  const cloud = fs.readFileSync(path.join(root, 'supabase-cloud.js'), 'utf8')
  assert.match(workflow, /legacy-labor-import\.js/)
  assert.match(serviceWorker, /legacy-labor-import\.js/)
  assert.match(pushSql, /previous_order is null and current_order->>'legacyLaborImport'='true' then continue/)
  assert.match(pushSql, /legacy_labor_import_guard_v1/)
  assert.match(cloud, /checkLegacyLaborImportGuard/)
})
