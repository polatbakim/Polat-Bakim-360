const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('bildirim geçmişi yalnızca oturum sahibinin kayıtlarını okur', async () => {
  const source = read('supabase-cloud.js')
  const method = source.match(/async function listOwnPushEvents\(\)\{[\s\S]*?\n  \}/)?.[0]
  assert.ok(method)
  const calls = []
  const query = {
    select(columns) { calls.push(['select', columns]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    order(column, options) { calls.push(['order', column, options.ascending]); return this },
    limit(count) { calls.push(['limit', count]); return Promise.resolve({ data: [{ id: 'one' }], error: null }) },
  }
  const context = vm.createContext({
    init: async () => {},
    client: { from(table) { calls.push(['from', table]); return query } },
    profile: { id: 'operator-user', active: true, operator_access: true },
  })
  const result = await vm.runInContext(`${method}; listOwnPushEvents()`, context)
  assert.equal(result[0].id, 'one')
  assert.deepEqual(calls.find(call => call[0] === 'eq'), ['eq', 'recipient_id', 'operator-user'])
  assert.deepEqual(calls.find(call => call[0] === 'from'), ['from', 'push_events'])
  context.profile.operator_access = false
  await assert.rejects(vm.runInContext('listOwnPushEvents()', context), /Operatör girişi gerekir/)
})

test('Supabase RLS yalnızca alıcının kendi bildirimlerini gösterir', () => {
  for (const file of ['supabase/web-push.sql', 'supabase/operator-notification-inbox.sql']) {
    const sql = read(file)
    assert.match(sql, /alter table public\.push_events enable row level security/)
    assert.match(sql, /create policy push_events_own_select on public\.push_events for select to authenticated/)
    assert.match(sql, /recipient_id = \(select auth\.uid\(\)\) and public\.can_use_app\(\)/)
    assert.match(sql, /grant select on public\.push_events to authenticated/)
  }
})

test('operatör bildirimi açar, güvenli biçimde listeler ve iş emrine geçer', () => {
  const html = read('index.html'), app = read('app.js')
  assert.match(html, /id="operatorInboxBtn"/)
  assert.match(html, /id="operatorInboxModal"/)
  assert.match(html, /id="operatorInboxList"/)
  assert.match(app, /cloud\.listOwnPushEvents\(\)/)
  assert.match(app, /escapeHtml\(item\.body\|\|''\)/)
  assert.match(app, /operatorCanSeeOrder\(value,operatorTechId\)/)
  assert.match(app, /target\.origin===page\.origin&&target\.pathname===page\.pathname/)
})
