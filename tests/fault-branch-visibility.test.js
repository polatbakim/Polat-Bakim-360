const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

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

const context = vm.createContext({})
vm.runInContext(extractFunction('isFailureMaintenanceOrder'), context)
vm.runInContext(extractFunction('requiredFailureGroups'), context)
vm.runInContext(extractFunction('applicableFailureGroups'), context)

test('mekanik arıza bakımında yalnızca mekanik alanlar uygulanır', () => {
  assert.deepEqual({...context.applicableFailureGroups({type:'Arıza Bakım',maintenanceBranch:'Mekanik Bakım'})}, {electrical:false,mechanical:true})
})

test('elektrik arıza bakımında yalnızca elektrik alanları uygulanır', () => {
  assert.deepEqual({...context.applicableFailureGroups({type:'Arıza Bakım',maintenanceBranch:'Elektrik Bakım'})}, {electrical:true,mechanical:false})
})

test('genel branşta iki grup kullanılabilir, arıza bakım olmayan işte ikisi de kapanır', () => {
  assert.deepEqual({...context.applicableFailureGroups({type:'Arıza Bakım',maintenanceBranch:'Genel Bakım'})}, {electrical:true,mechanical:true})
  assert.deepEqual({...context.applicableFailureGroups({type:'Diğer',maintenanceBranch:'Mekanik Bakım'})}, {electrical:false,mechanical:false})
  assert.match(app, /field\.classList\.toggle\('hidden',!visible\);field\.disabled=!visible/)
  assert.match(app, /failureMaintenance&&failureGroups\.electrical\?f\.getAll\('electricalFault'\):\[\]/)
  assert.match(app, /failureMaintenance&&failureGroups\.mechanical\?f\.getAll\('mechanicalFault'\):\[\]/)
})
