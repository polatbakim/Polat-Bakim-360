const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')

test('ekipman seçimi tarayıcı datalist yerine görsel arama paneli kullanır', () => {
  assert.match(app,/function renderSearchableAssetOptions\(select,query=''/)
  assert.match(app,/class="searchable-asset-option"/)
  assert.match(app,/asset\?\.department,asset\?\.category/)
  assert.match(css,/\.searchable-asset-panel/)
  assert.match(css,/\.searchable-asset-code/)
  assert.doesNotMatch(app,/createElement\('datalist'\)/)
})

test('talep açıklaması isteğe bağlıdır', () => {
  const requestModal = html.match(/<div class="modal-backdrop hidden" id="requestModal"[\s\S]*?<div class="modal-backdrop hidden" id="detailModal"/)[0]
  assert.match(requestModal,/Açıklama <span class="optional-label">\(isteğe bağlı\)<\/span>/)
  assert.match(requestModal,/<textarea name="description"/)
  assert.doesNotMatch(requestModal,/<textarea required name="description"/)
})
