const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('yayında gömülü arıza listeleri korunur, Admin değişiklikleri uygulanır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  const defaults = source.slice(source.indexOf('const FAILURE_OPTIONS='), source.indexOf('const EVENT_LABELS='))
  const productionSetup = source.match(/^if\(PRODUCTION_MODE\)\{DEFAULT_APPROVERS\.length=0;.*$/m)?.[0]
  assert.ok(defaults && productionSetup)

  const context = vm.createContext({
    PRODUCTION_MODE: true,
    DEFAULT_APPROVERS: [], DEFAULT_MATERIALS: [], DEFAULT_ASSET_CATEGORIES: [], SCADA_DEFAULT_DEPARTMENTS: [],
    state: { failureOptionAdditions: { electricalFault: ['Yeni Arıza'] }, failureOptionRemovals: { electricalFault: ['Motor Arızası'] } },
  })
  vm.runInContext(defaults + productionSetup, context)
  const counts = vm.runInContext('Object.fromEntries(Object.keys(FAILURE_OPTIONS).map(key => [key, failureOptionsFor(key).length]))', context)
  for (const stage of ['electricalFault', 'electricalCause', 'mechanicalFault', 'mechanicalCause']) {
    assert.ok(counts[stage] > 0, `${stage} boş olmamalı`)
  }
  assert.equal(vm.runInContext('failureOptionsFor("electricalFault").includes("Yeni Arıza")', context), true)
  assert.equal(vm.runInContext('failureOptionsFor("electricalFault").includes("Motor Arızası")', context), false)
})

test('diğer arıza açıklamaları ilgili seçimlere bağlıdır ve kök neden kaydedilir', () => {
  const root = path.join(__dirname, '..')
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  for (const stage of ['electricalFault', 'electricalCause', 'mechanicalFault', 'mechanicalCause']) {
    assert.match(html, new RegExp(`data-fault-other="${stage}"`))
  }
  assert.match(app, /const FAILURE_OTHER_FIELDS=/)
  assert.match(app, /function syncOtherFailureFields\(/)
  assert.match(app, /rootCauseAnalysis:f\.get\('rootCauseAnalysis'\)\.trim\(\)/)
  assert.match(html, /name="rootCauseAnalysis"/)
  assert.match(app, /Kök Neden Analizi/)
})
