const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

test('arıza kapanışı ile yönetim takibi ana iş emri durumundan ayrıdır', () => {
  const start = app.indexOf('function orderResolutionOpen(')
  const end = app.indexOf('function orderManagementLabel(', start)
  const context = vm.createContext({})
  vm.runInContext(app.slice(start, end), context)
  assert.equal(context.orderResolutionOpen({status:'Tamamlandı', resolutionStatus:'open', managementStatus:'Servis Bekleniyor'}), true)
  assert.equal(context.orderResolutionOpen({status:'Tamamlandı', resolutionStatus:'resolved', managementStatus:''}), false)
  assert.equal(context.orderResolutionOpen({status:'Beklemede', resolutionStatus:'open', managementStatus:'Parça Bekliyor'}), true)
})

test('yönetici onayı arıza kapanış tarihi ve takip alanlarını içerir', () => {
  assert.match(html, /name="managerFaultClosedAt"/)
  assert.match(html, /name="managerManagementStatus"/)
  assert.match(html, /name="managerManagementOwnerId"/)
  assert.match(html, /name="managerManagementDueAt"/)
  assert.match(app, /Arıza kapanış tarihi boşsa yönetim durumu, sorumlu ve takip tarihi zorunludur/)
  assert.match(app, /applyOrderManagementTracking\(o,\{faultClosedAt,managementStatus,managementOwnerId,managementDueAt,managementNote\}\)/)
})

test('dashboard, iş emri listesi ve takip konuları aynı yönetim kaydını kullanır', () => {
  assert.match(html, /id="managementTrackingSummary"/)
  assert.match(html, /id="orderManagementFilter"/)
  assert.match(html, /Yönetim Takibi/)
  assert.match(app, /managementTrackingOrders\(\)\.map\(managementFollowUpForOrder\)/)
  assert.match(app, /data-management-status=/)
  assert.match(app, /data-management-drill=/)
})

test('takip konularında talep açılışı otomatik gösterilir ve yalnızca Admin Yönetici düzeltebilir', () => {
  assert.match(html, /name="requestOpenedAt" required/)
  assert.match(html, /yalnızca Admin Yönetici düzeltebilir/)
  assert.match(app, /function followUpRequestOpenedAt\(item\)/)
  assert.match(app, /class="follow-up-opened"><small>Açılış tarihi<\/small>/)
  assert.ok(app.indexOf('class="follow-up-opened"') < app.indexOf('class="follow-up-owner"'))
  assert.match(app, /requestOpenedAt\.readOnly=!isAdminManager\(\)/)
  assert.match(app, /requestOpenedAt=isAdminManager\(\)\?/)
  assert.match(app, /requestOpenedAt:order\.requestOpenedAt\|\|order\.createdAt/)
})

test('tüm takip özetleri tıklanarak ilgili kayıtları süzer', () => {
  assert.match(app, /counts\.open,'Açık','open'/)
  assert.match(app, /counts\.today,'Bugün','today'/)
  assert.match(app, /counts\.overdue,'Geciken','overdue'/)
  assert.match(app, /counts\.completed,'Tamamlanan','completed'/)
  assert.match(app, /followUpStatusFilter=button\.dataset\.followUpSummaryStatus/)
  assert.match(app, /\$\('#followUpStatusFilter'\)\.value=followUpStatusFilter/)
  assert.match(app, /followUpStatusFilter==='today'/)
  assert.match(app, /followUpStatusFilter==='overdue'/)
  assert.match(html, /option value="today">Bugün/)
  assert.match(html, /option value="overdue">Gecikenler/)
})

test('işçiliği bitmiş fakat arızası açık iş SCADA ve makine kartında açık kalır', () => {
  assert.match(app, /state\.orders\.filter\(order=>isActive\(order\)\|\|orderResolutionOpen\(order\)\)/)
  assert.match(app, /openJobs=jobs\.filter\(order=>isActive\(order\)\|\|orderResolutionOpen\(order\)\)/)
  assert.match(app, /order\.faultClosedAt\|\|\(orderResolutionOpen\(order\)\?new Date\(\)\.toISOString\(\):order\.completionTime/)
})
