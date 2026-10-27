const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const context = vm.createContext({ operatorClock: (order, id) => order.operatorWorkByTechnician?.[id] || null })
vm.runInContext(app.slice(app.indexOf('function operatorCompletionTimeValues('), app.indexOf('function notificationStatusValue(')), context)

test('iş sonuç formu sessiz kalmak yerine görünür hata alanı gösterir', () => {
  assert.match(html, /id="completionSubmitError"/)
  assert.match(html, /id="completionSubmitBtn"/)
  assert.match(app, /addEventListener\('invalid'.*showCompletionSubmitError/)
  assert.match(app, /Kırmızı işaretli zorunlu alanları tamamlayın/)
})

test('Supabase yanıt vermezse gönderim süre sınırına uğrar, düğme açılır ve hata gösterilir', () => {
  assert.match(app, /function operatorRequestWithTimeout/)
  assert.match(app, /operatorRequestWithTimeout\(cloud\.pushOperatorOrder\(o\)/)
  assert.match(app, /operatorRequestWithTimeout\(cloud\.pullOperatorState\(\)/)
  assert.match(app, /Kayıt gönderiliyor…/)
  assert.match(app, /Kayıt doğrulanıyor…/)
  assert.doesNotMatch(app, /await cloud\.checkOperatorSharedCompletionGuard\(\)/)
  assert.match(app, /catch\(error\).*showCompletionSubmitError/s)
  assert.match(app, /finally\{setCompletionSubmitState\(false\)\}/)
})

test('operatör kapanışta kayıtlı başlama ve ara saatlerinin saniyelerini değiştirmez', () => {
  const order = {
    startTime: '2026-10-26T08:00:00', pauseStart: '2026-10-26T09:00:00', pauseEnd: '2026-10-26T09:10:00',
    operatorWorkByTechnician: { T2: { start: '2026-10-26T08:15:00' } },
  }
  const values = context.operatorCompletionTimeValues(order, 'T2', '2026-10-26T10:30')
  assert.equal(values.start, '2026-10-26T08:00')
  assert.equal(values.ownStart, '2026-10-26T08:15')
  assert.equal(values.persistedStart, '2026-10-26T08:00:00')
  assert.equal(values.persistedOwnStart, '2026-10-26T08:15:00')
  assert.equal(values.persistedPauseStart, '2026-10-26T09:00:00')
  assert.equal(values.persistedPauseEnd, '2026-10-26T09:10:00')
  assert.equal(values.persistedFinish, '2026-10-26T10:30')
  assert.doesNotMatch(app, /o\.startTime=start;o\.completionTime=finish/)
})

test('yönetici düzeltmesinden dönen işte mevcut bitiş saati de aynen korunur', () => {
  const values = context.operatorCompletionTimeValues({
    startTime: '2026-10-26T08:00:45', completionTime: '2026-10-26T10:30:30', managerCorrectionPending: true,
    operatorWorkByTechnician: { T1: { start: '2026-10-26T08:00:45' } },
  }, 'T1', '2026-10-26T11:00')
  assert.equal(values.finish, '2026-10-26T10:30')
  assert.equal(values.persistedFinish, '2026-10-26T10:30:30')
})
