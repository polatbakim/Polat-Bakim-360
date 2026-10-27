const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

test('PT kodu olmayan gerçek makine kartları seçilebilir kalır', () => {
  const source = app.slice(app.indexOf('function isSelectableAsset('), app.indexOf('function purgeAssetCardsFromState('))
  const context = vm.createContext({})
  vm.runInContext(source, context)
  assert.equal(context.isSelectableAsset({id:'A1',name:'Kodsuz Pres',code:''}), true)
  assert.equal(context.isSelectableAsset({id:'A2',name:'SAP Kodlu Tezgah',code:'10007367'}), true)
  assert.equal(context.isSelectableAsset({id:'A3',name:'Elle girilen alan',manualEquipment:true}), false)
  assert.match(app,/state\.assets\.filter\(isSelectableAsset\)/)
  assert.match(app,/a\.code\|\|a\.sapEquipmentNo\|\|'Kodsuz'/)
})

test('eski PT filtresi artık kart silmez ve kod alanı isteğe bağlıdır', () => {
  const migration = app.slice(app.indexOf('function enforcePtAssetFilter('), app.indexOf('function ensureDefaultApprovers('))
  assert.doesNotMatch(migration,/purgeAssetCardsFromState/)
  assert.doesNotMatch(migration,/PT kodu olmayan makine kartı sistemden silindi/)
  assert.match(html,/PT \/ SAP \/ varlık kodu <span class="optional-label">\(isteğe bağlı\)<\/span><input name="code"/)
  assert.match(app,/if\(code&&state\.assets\.some/)
})
