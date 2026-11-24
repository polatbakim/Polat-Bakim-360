const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

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

const context = vm.createContext({
  FAILURE_STAGE_LABELS:{electricalFault:'Elektrik Arıza Tanımı',electricalCause:'Elektrik Arıza Nedeni',mechanicalFault:'Mekanik Arıza Tanımı',mechanicalCause:'Mekanik Arıza Nedeni'},
  escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),
})
for (const name of ['isFailureMaintenanceOrder','requiredFailureGroups','applicableFailureGroups','managerFailureReviewMarkup']) vm.runInContext(extractFunction(name), context)

test('maliyet onayında mekanik iş için yalnızca mekanik arıza bilgileri gösterilir', () => {
  const markup = context.managerFailureReviewMarkup({type:'Arıza Bakım',maintenanceBranch:'Mekanik Bakım',completionDetails:{mechanicalFaults:['Rulman Arızası'],mechanicalCauses:['Yıpranma'],electricalFaults:['Motor Arızası'],electricalCauses:['Yanma Hatası'],rootCauseAnalysis:'Yağlama yetersiz',workPerformed:'Rulman değiştirildi'}})
  assert.match(markup, /Mekanik Arıza Tanımı/)
  assert.match(markup, /Rulman Arızası/)
  assert.match(markup, /Kök Neden Analizi/)
  assert.doesNotMatch(markup, /Elektrik Arıza Tanımı|Motor Arızası/)
})

test('maliyet onayında elektrik iş için yalnızca elektrik arıza bilgileri gösterilir', () => {
  const markup = context.managerFailureReviewMarkup({type:'Arıza Bakım',maintenanceBranch:'Elektrik Bakım',completionDetails:{electricalFaults:['Motor Arızası'],electricalCauses:['Yanma Hatası'],otherElectricalCause:'Aşırı yük',rootCauseAnalysis:'Akım yüksek',workPerformed:'Motor sarıldı'}})
  assert.match(markup, /Elektrik Arıza Tanımı/)
  assert.match(markup, /Diğer açıklaması: Aşırı yük/)
  assert.doesNotMatch(markup, /Mekanik Arıza Tanımı/)
})

test('arıza bakım olmayan işte kontrol bölümü açılmaz ve düzeltme düğmesi bulunur', () => {
  assert.equal(context.managerFailureReviewMarkup({type:'Diğer',maintenanceBranch:'Mekanik Bakım'}), '')
  assert.match(html, /id="managerFailureReview"/)
  assert.match(html, /id="managerFailureReturnBtn">Düzeltme İste/)
  assert.match(app, /Arıza tanımı, arıza nedeni ve kök neden bilgilerini kontrol ederek gerekli düzeltmeleri yapın\./)
})
