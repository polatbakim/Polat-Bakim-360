const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')

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

test('masraf yerleri tanımlı iştirak kodları altında birleştirilir', () => {
  const context = vm.createContext({})
  vm.runInContext(extractFunction('affiliateCompanyName'), context)

  const maintenanceCenters = [
    'Talaşlı İmalat', 'Şekillendirme', 'Kaynaklı İmalat', 'Yüzey İşlem',
    'Üretim', 'Kalite Kontrol', 'Bakım', '2230 Bakım Onarım',
    'Montaj', 'Sevkiyat', 'Helezon',
  ]
  for (const center of maintenanceCenters) {
    assert.equal(context.affiliateCompanyName(center), '2230 Bakım Onarım')
  }

  assert.equal(context.affiliateCompanyName(' POLAT TEKNİK '), '2404 Polat Technic Ortak')
  assert.equal(context.affiliateCompanyName('2404 Polat Technic Ortak'), '2404 Polat Technic Ortak')
  assert.equal(context.affiliateCompanyName('PGSolutions'), '2129 PGSolutions')
  assert.equal(context.affiliateCompanyName('PG SOLUTIONS'), '2129 PGSolutions')
  assert.equal(context.affiliateCompanyName('İDARİ İŞLER'), '2301 Genel Hizmet')
  assert.equal(context.affiliateCompanyName('PGKİMYA'), 'PGKİMYA')
})

test('ham ve konsolide iştirak kırılımları birlikte gösterilir ve dışa aktarılır', () => {
  assert.match(html, /<h2>Masraf Yeri Dağılımı<\/h2>/)
  assert.match(html, /id="affiliateShareList"/)
  assert.match(html, /<h2>Konsolide İştirak Dağılımı<\/h2>/)
  assert.match(html, /id="affiliateCompanyShareList"/)
  assert.match(app, /\['Kişi','Masraf Yeri','Konsolide İştirak','İşin Tanımı','Süre \(SA\)'\]/)
  assert.match(css, /\.report-two-column\.affiliate-breakdown-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/)
  assert.match(css, /@media\(max-width:1180px\)\{\.report-two-column\.affiliate-breakdown-grid\{grid-template-columns:1fr\}\}/)
})

test('rapor tarihleri varsayılan olarak güncel güne ayarlanır', () => {
  const fields = {reportDateFrom: {}, reportDateTo: {}}
  const context = vm.createContext({
    reportFilters: {},
    today: () => '2026-11-24',
    $: selector => fields[selector.slice(1)],
  })
  vm.runInContext(extractFunction('initReports'), context)
  context.initReports()

  assert.equal(context.reportFilters.from, '2026-11-24')
  assert.equal(context.reportFilters.to, '2026-11-24')
  assert.equal(fields.reportDateFrom.value, '2026-11-24')
  assert.equal(fields.reportDateTo.value, '2026-11-24')
})
