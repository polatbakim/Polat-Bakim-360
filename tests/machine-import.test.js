const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('JSON aktarımı aynı kodu günceller, yeni kodu ekler ve mevcut bağlantıları korur', async () => {
  const elements = new Map()
  function element(id) {
    const classes = new Set(['hidden'])
    return {
      id, listeners: {}, files: [], value: '', textContent: '', innerHTML: '', disabled: false,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      addEventListener(name, fn) { this.listeners[name] = fn },
      querySelectorAll: () => [],
      click() { this.clicked = true },
    }
  }
  for (const id of ['importMachineCardsFile', 'importMachineCardsBtn', 'machineImportModal',
    'machineImportError', 'machineImportFileName', 'machineImportSummary', 'confirmMachineImportBtn']) {
    elements.set(id, element(id))
  }
  const initial = {
    assets: [{ id: 'A1', code: 'PT 101', name: 'Eski ad', machineScore: 3,
      status: 'Arızalı / Bakımda', events: [{ id: 'E1' }], criticalPartIds: ['M1'] }],
    orders: [{ id: 'WO1', assetId: 'A1' }], activities: [], deletedAssetCodes: ['PT999'],
  }
  const backup = { version: 3, machines: [
    { code: 'PT101', name: 'Yeni ad', machineScore: 1, status: 'Aktif', location: 'Atölye' },
    { code: 'PT102', name: 'Yeni makine', machineScore: 2, status: 'Aktif', location: 'Atölye' },
    { code: 'PT999', name: 'Önceden silinen' },
  ] }
  let uploaded, uploadedVersion, applied, uuid = 0
  const info = { connected: true, profile: { is_admin: true, manager_access: true }, pendingSave: false, version: 5 }
  const context = {
    document: { getElementById: id => elements.get(id) },
    window: { PolatBakimCloud: {
      getInfo: () => info,
      pullState: async () => JSON.parse(JSON.stringify(initial)),
      pushState: async (next, version) => { uploaded = next; uploadedVersion = version },
    } },
    state: initial,
    crypto: { randomUUID: () => `new-${++uuid}` },
    canonicalAssetCategory: value => value,
    normalizeMachineScore: value => Number(value),
    toast: () => {},
    applyCloudState: next => { applied = next },
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'machine-import.js'), 'utf8')
  vm.runInNewContext(source, context)
  const input = elements.get('importMachineCardsFile')
  input.files = [{ name: 'yedek.json', size: 100, text: async () => JSON.stringify(backup) }]
  await input.listeners.change()
  assert.equal(elements.get('machineImportModal').classList.contains('hidden'), false)
  await elements.get('confirmMachineImportBtn').listeners.click({ currentTarget: elements.get('confirmMachineImportBtn') })
  assert.equal(uploadedVersion, 5)
  assert.equal(uploaded.assets.length, 2)
  assert.equal(uploaded.assets[0].name, 'Yeni ad')
  assert.equal(uploaded.assets[0].machineScore, 3)
  assert.equal(uploaded.assets[0].status, 'Arızalı / Bakımda')
  assert.equal(JSON.stringify(uploaded.assets[0].criticalPartIds), JSON.stringify(['M1']))
  assert.equal(uploaded.assets[1].code, 'PT102')
  assert.equal(uploaded.assets[1].status, 'Çalışıyor')
  assert.equal(uploaded.orders[0].assetId, 'A1')
  assert.equal(applied, uploaded)
})
