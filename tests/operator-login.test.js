const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('operatörün sınırlı Supabase paketi eksik yönetim alanları yüzünden girişte çökmez', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  const defaults = source.slice(source.indexOf('function emptyProductionState()'), source.indexOf('let orderResetAppliedAtLoad'))
  const apply = source.slice(source.indexOf('function applyCloudState(value)'), source.indexOf('function renderCloudStatus(', source.indexOf('function applyCloudState(value)')))
  assert.ok(defaults && apply)

  let rendered = false
  const context = vm.createContext({
    PRODUCTION_MODE: true,
    SCADA_DEFAULT_DEPARTMENTS: [],
    ASSET_STATUS_RESET_VERSION: 1,
    ORDER_RESET_VERSION: 'test',
    MAINTENANCE_RESET_VERSION: 'test',
    ASSET_PT_FILTER_VERSION: 'test',
    productionProfiles: [],
    operatorOrderBaseline: new Map(),
    applyingCloudState: false,
    validCloudState: value => Array.isArray(value?.orders) && Array.isArray(value?.assets) && Array.isArray(value?.technicians),
    window: { PolatBakimCloud: { getInfo: () => ({ profile: { operator_access: true } }) } },
    renderAll: () => { rendered = true },
  })
  vm.runInContext(`${defaults}\n${apply}`, context)
  vm.runInContext('applyCloudState({orders:[], assets:[], technicians:[], materials:[]})', context)
  assert.equal(rendered, true)
  assert.equal(vm.runInContext('Array.isArray(state.activities)', context), true)
  assert.equal(vm.runInContext('Array.isArray(state.purchaseRecords)', context), true)
  assert.equal(vm.runInContext('Array.isArray(state.approvers)', context), true)
})
