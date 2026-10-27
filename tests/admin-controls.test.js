const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('makine aktarımı ve veri kaynağı göstergesi yalnızca Admin Yöneticiye açılır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  const start = source.indexOf('function canTransferMachineCards()')
  const end = source.indexOf('function allowedManagerPages(', start)
  assert.ok(start > -1 && end > start)
  const hidden = new Map()
  const context = vm.createContext({
    PRODUCTION_MODE: true,
    accessRole: 'manager',
    currentApproverId: 'admin-1',
    window: { PolatBakimCloud: { getInfo: () => ({ connected: true, profile: { id: 'admin-1', manager_access: true, is_admin: false } }) } },
    isAdminManager: () => true,
    $: selector => ({ classList: { toggle: (name, value) => hidden.set(selector, value) } }),
  })
  vm.runInContext(source.slice(start, end), context)
  vm.runInContext('syncMachineTransferControls()', context)
  for (const selector of ['#importMachineCardsBtn', '#exportMachineCardsBtn', '#sidebarSourcePanel']) assert.equal(hidden.get(selector), true)

  context.window.PolatBakimCloud.getInfo = () => ({ connected: true, profile: { id: 'admin-1', manager_access: true, is_admin: true } })
  vm.runInContext('syncMachineTransferControls()', context)
  for (const selector of ['#importMachineCardsBtn', '#exportMachineCardsBtn', '#sidebarSourcePanel']) assert.equal(hidden.get(selector), false)

  context.accessRole = 'operator'
  vm.runInContext('syncMachineTransferControls()', context)
  for (const selector of ['#importMachineCardsBtn', '#exportMachineCardsBtn', '#sidebarSourcePanel']) assert.equal(hidden.get(selector), true)
})
