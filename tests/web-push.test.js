const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createECDH, webcrypto } = require('node:crypto')

const root = path.join(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('çift tıklanabilir sayfa geçerli VAPID anahtarlarını çevrimdışı üretir', async () => {
  const page = read('generate-vapid-keys-offline.html')
  assert.match(page, /connect-src 'none'/)
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  const elements = Object.fromEntries(['generate', 'status', 'keys', 'public-key', 'private-key', 'generate-hook-token', 'hook-token', 'hook-token-wrap'].map(id => [id, { hidden: true, value: '', textContent: '', addEventListener(_event, fn) { this.click = fn } }]))
  const context = vm.createContext({ document: { getElementById: id => elements[id] }, crypto: webcrypto, Uint8Array, btoa })
  vm.runInContext(script, context)
  await elements.generate.click()
  const publicKey = elements['public-key'].value
  const privateKey = elements['private-key'].value
  const derived = createECDH('prime256v1')
  derived.setPrivateKey(Buffer.from(privateKey, 'base64url'))
  assert.equal(derived.getPublicKey(undefined, 'uncompressed').toString('base64url'), publicKey)
  assert.equal(elements.keys.hidden, false)
  elements['generate-hook-token'].click()
  assert.equal(Buffer.from(elements['hook-token'].value, 'base64url').length, 32)
  assert.notEqual(elements['hook-token'].value, privateKey)
  assert.equal(elements['hook-token-wrap'].hidden, false)
})

test('bildirim kuyruğu yalnızca yeni atama, düzeltme ve teyit geçişlerinde dolar', () => {
  const sql = read('supabase/web-push.sql')
  assert.match(sql, /create table if not exists public\.push_subscriptions/)
  assert.match(sql, /alter table public\.push_subscriptions enable row level security/)
  assert.match(sql, /recipient_id uuid not null references auth\.users/)
  assert.match(sql, /previous_order->>'assignmentMode' is distinct from 'all'/)
  assert.match(sql, /not exists\(select 1 from public\.push_order_targets\(previous_order\)/)
  assert.match(sql, /operatorCorrectionPending/)
  assert.match(sql, /current_order->>'status'='Teyit Bekliyor'/)
  assert.match(sql, /if new\.id <> 'polat-bakim-main'/)
  assert.match(sql, /on conflict\(event_key\) do nothing/)
})

test('gönderici tam yetkili API anahtarını webhookta istemez', () => {
  const sender = read('supabase/functions/send-web-push/index.ts')
  const workflow = read('.github/workflows/deploy.yml')
  assert.match(sender, /withSupabase\(\{ auth: 'none' \}/)
  assert.match(sender, /Deno\.env\.get\('WEB_PUSH_HOOK_TOKEN'\)/)
  assert.match(sender, /req\.headers\.get\('x-polat-push-token'\)/)
  assert.match(sender, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(sender, /Deno\.env\.get\('WEB_PUSH_PRIVATE_KEY'\)/)
  assert.match(sender, /allowedPushHosts = new Set\(\['fcm\.googleapis\.com'\]\)/)
  assert.match(sender, /eq\('status', 'pending'\)/)
  assert.match(sender, /responseBody = String\(\(error as \{ body\?: string \}\)\?\.body/)
  assert.doesNotMatch(sender, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/)
  assert.match(workflow, /pushVapidPublicKey:process\.env\.WEB_PUSH_PUBLIC_KEY/)
  assert.doesNotMatch(workflow, /WEB_PUSH_PRIVATE_KEY/)
  assert.doesNotMatch(workflow, /WEB_PUSH_HOOK_TOKEN/)
})

test('telefon aboneliği kullanılan VAPID anahtarı değişince yenilenir', () => {
  const cloud = read('supabase-cloud.js')
  assert.match(cloud, /subscriptionUsesCurrentVapidKey\(subscription\)/)
  assert.match(cloud, /subscription\?\.options\?\.applicationServerKey/)
  assert.match(cloud, /await subscription\.unsubscribe\(\)/)
})

test('bildirime dokununca GitHub Pages proje yolu korunur', async () => {
  const handlers = {}
  const navigated = []
  const scope = 'https://polatbakim.github.io/Polat-Bakim-360/'
  const context = vm.createContext({
    self: { registration: { scope }, location: { origin: 'https://polatbakim.github.io' }, addEventListener: (name, handler) => { handlers[name] = handler } },
    clients: { matchAll: async () => [{ url: scope + 'index.html', navigate: async url => { navigated.push(url) }, focus: async () => {} }] },
    URL,
  })
  vm.runInContext(read('sw.js'), context)
  let pending
  handlers.notificationclick({ notification: { data: { url: './index.html?role=manager&view=manager' }, close() {} }, waitUntil: promise => { pending = promise } })
  await pending
  assert.equal(navigated[0], scope + 'index.html?role=manager&view=manager')
})
