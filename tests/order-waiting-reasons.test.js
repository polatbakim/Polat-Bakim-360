const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
const start = app.indexOf('function orderWaitingReasons(')
const end = app.indexOf('\nfunction deleteWorkOrder(', start)

function loadContext(status = 'Beklemede') {
  const context = vm.createContext({
    currentOrderStatus: status,
    assetById: () => ({name:'Makine'}),
    techById: () => ({name:'Usta',initials:'US'}),
    orderManagementLabel: () => '',
    visibleWorkOrderNo: order => order.id,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    formatDate: value => value || '',
    formatMoney: value => value,
    slug: value => value,
  })
  vm.runInContext(app.slice(start, end), context)
  return context
}

test('Beklemede sekmesinde bakım branşı yerine açık bekleme nedeni ve açıklaması gösterilir', () => {
  const context = loadContext()
  const order = {id:'WO-1',title:'Kontrol',assetId:'A1',technicianId:'T1',maintenanceBranch:'Mekanik Bakım',status:'Beklemede',priority:'Orta',pauseHistory:[{technicianId:'T1',start:'2026-11-24T09:00',end:'',reason:'Malzeme / yedek parça bekleniyor — rulman sipariş edildi'}]}
  const row = context.orderRow(order)
  assert.match(row, /Bekleme:<\/b> Malzeme \/ yedek parça bekleniyor — rulman sipariş edildi/)
  assert.doesNotMatch(row, /Mekanik Bakım/)
})

test('diğer sekmeler bakım branşını göstermeye devam eder', () => {
  const context = loadContext('')
  const row = context.orderRow({id:'WO-2',title:'Kontrol',assetId:'A1',technicianId:'T1',maintenanceBranch:'Elektrik Bakım',status:'Beklemede',priority:'Orta',waitingReason:'Dış servis bekleniyor — pazartesi gelecek'})
  assert.match(row, /Elektrik Bakım/)
  assert.doesNotMatch(row, /Dış servis bekleniyor/)
})

test('aynı açık bekleme kaydı iki kaynakta varsa tekrar edilmez ve eski kayıtlar boş kalmaz', () => {
  const context = loadContext()
  const pause = {start:'2026-11-24T09:00',end:'',reason:'Dış servis bekleniyor — servis çağrıldı'}
  assert.deepEqual([...context.orderWaitingReasons({pauseHistory:[{...pause,technicianId:'T1'}],operatorWorkByTechnician:{T1:{pauses:[pause]}}})], [pause.reason])
  assert.match(context.orderWaitingSubtitle({legacyLaborImport:true}), /Eski kayıtta beklemede; açıklama bulunmuyor/)
  assert.match(styles, /\.order-waiting-subtext\{[^}]*white-space:normal/)
})
