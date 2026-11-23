const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

function extractFunction(name) {
  const start = app.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} bulunamadı`)
  const bodyStart = app.indexOf('{', app.indexOf(')', start) + 1)
  let depth = 0
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1
    if (app[index] === '}') depth -= 1
    if (depth === 0) return app.slice(start, index + 1)
  }
  throw new Error(`${name} tamamlanamadı`)
}

const context = vm.createContext({ $: () => null })
vm.runInContext(extractFunction('isFailureMaintenanceOrder'), context)
vm.runInContext(extractFunction('requiredFailureGroups'), context)
vm.runInContext(extractFunction('validateFailureSelections'), context)

test('arıza alanları yalnızca bakım türü Arıza Bakım olduğunda kullanılır', () => {
  assert.equal(context.isFailureMaintenanceOrder({type:'Arıza Bakım'}), true)
  assert.equal(context.isFailureMaintenanceOrder({type:'Diğer', maintenanceBranch:'Mekanik Bakım'}), false)
  assert.deepEqual({...context.requiredFailureGroups({type:'Diğer', maintenanceBranch:'Mekanik Bakım'})}, {electrical:false, mechanical:false})
  assert.equal(context.validateFailureSelections(null, {type:'Kontrol'}), true)
  assert.match(html, /id="completionResultHeading"/)
  assert.match(html, /data-failure-only[^>]*>Kök Neden Analizi/)
  assert.match(app, /setCompletionFailureVisibility\(o\)/)
  assert.match(app, /rootCauseDetail=failureMaintenance\?/)
})

test('Diğer arıza açıklamaları en az altı karakter ister', () => {
  for (const name of ['otherElectricalFault','otherElectricalCause','otherMechanicalFault','otherMechanicalCause']) {
    assert.match(html, new RegExp(`name="${name}" minlength="6"`))
  }
  assert.match(app, /field\.minLength=visible\?6:0/)
  assert.match(app, /trim\(\)\.length<6/)
  assert.match(app, /Diğer arıza açıklamasını en az 6 karakter olarak yazın/)
})

test('arıza bakım olmayan kapanışta eski arıza alanları yeniden kaydedilmez', () => {
  assert.match(app, /electricalFaults=failureMaintenance\?f\.getAll\('electricalFault'\):\[\]/)
  assert.match(app, /rootCauseAnalysis:faultValue\('rootCauseAnalysis'\)/)
  assert.match(app, /failureCodes=failureMaintenance\?failureCodeEntries/)
})
