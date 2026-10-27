const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const notificationLogic = app.slice(app.indexOf('function operatorAssignmentStorageKey('), app.indexOf('function validCloudState('))

function notificationContext(showNotification, pushConfigured = false) {
  const messages = []
  const shown = []
  const button = { classList: { toggle() {} }, disabled: false, textContent: '' }
  function Notification() { throw new TypeError('Notification constructor is unsupported on Android') }
  Notification.permission = 'granted'
  Notification.requestPermission = async () => 'granted'
  const registration = { showNotification: async (...args) => { shown.push(args); await showNotification?.(...args) } }
  let pushEnabled = false
  const cloud = { getInfo: () => ({ pushConfigured, pushEnabled }), enableWebPush: async () => { pushEnabled = true } }
  const context = vm.createContext({
    operatorTechId: 'T1', accessRole: 'operator',
    window: { Notification, PolatBakimCloud: cloud }, Notification,
    navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } },
    location: { protocol: 'https:' },
    $: () => button,
    toast: message => messages.push(message),
    console: { warn() {} },
  })
  vm.runInContext(notificationLogic, context)
  return { context, messages, shown, button }
}

test('Android bildirim izni verildikten sonra constructor yerine service worker test bildirimi gösterilir', async () => {
  const { context, messages, shown, button } = notificationContext()
  await vm.runInContext('enableOperatorNotifications()', context)
  assert.equal(shown.length, 1)
  assert.equal(shown[0][0], 'Polat Bakım 360')
  assert.match(button.textContent, /Bildirimi Test Et/)
  assert.ok(messages.some(message => /[Tt]est bildirimi gönderildi/.test(message)))
  assert.ok(!messages.some(message => /izin alınamadı/.test(message)))
})

test('yapılandırılmış Web Push telefona bağlanınca arka plan durumu gösterilir', async () => {
  const { context, messages, button } = notificationContext(undefined, true)
  await vm.runInContext('enableOperatorNotifications()', context)
  assert.match(button.textContent, /Arka Plan Bildirimleri Açık/)
  assert.ok(messages.some(message => /arka plan bildirimleri açıldı/.test(message)))
})

test('bildirim gösterme hatası izin hatası gibi sunulmaz', async () => {
  const { context, messages } = notificationContext(() => { throw new Error('display failed') })
  await vm.runInContext('enableOperatorNotifications()', context)
  assert.ok(messages.some(message => /İzin verildi ancak test bildirimi gösterilemedi/.test(message)))
  assert.ok(!messages.some(message => /Bildirim izni alınamadı/.test(message)))
})
