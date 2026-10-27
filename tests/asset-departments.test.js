const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'normalize-asset-departments.sql'), 'utf8')
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
const pairs = sql.match(/v_map jsonb := jsonb_build_object\(([\s\S]*?)\n  \);/)[1]
const mapping = Object.fromEntries([...pairs.matchAll(/'([^']+)', '([^']+)'/g)].map(match => [match[1],match[2]]))

test('istenen bölüm eşleştirmeleri uygulanır ve Polat Technic adı tekleştirilir', () => {
  assert.equal(Object.keys(mapping).length,11)
  assert.equal(mapping['2103 Metal İşleri'],'KAYNAKLI İMALAT')
  assert.equal(mapping['2107 Talaşlı İmalat CNC'],'TALAŞLI İMALAT')
  assert.equal(mapping['2108 Talaşlı İmalat 5 Eksen'],'TALAŞLI İMALAT')
  assert.equal(mapping['2201 Kalite Kontrol'],'KALİTE KONTROL')
  assert.equal(mapping['2209 Yardımcı Üretim (Planlama, Üretim, Montaj)'],'ÜRETİM')
  assert.equal(mapping['2402 Polat Technic Zeytinyağı'],'POLAT TECHNIC')
  assert.equal(mapping['Polat Technic (SSH)'],'POLAT TECHNIC')
  assert.equal(mapping['POLAT TEKNİK'],'POLAT TECHNIC')
  assert.equal(mapping['HELEZON'],'HELEZON HATTI')
  assert.equal(mapping['Polat Makina'],'ÜRETİM')
  assert.equal(mapping['Üretim yeri 2000'],'ÜRETİM')
  assert.doesNotMatch(sql,/POLAT TEHNIC/)
})

test('bölüm güncellemesi canlı snapshot içinde kilitli, yedekli ve yinelenebilir', () => {
  assert.match(sql,/where id = v_id for update/)
  assert.match(sql,/jsonb_set\(asset, '\{department\}'/)
  assert.match(sql,/backup-departments-20261007/)
  assert.match(sql,/if v_changed = 0 then/)
  assert.match(sql,/version = v_version \+ 1/)
  assert.match(sql,/insert into public\.app_sync_events/)
  assert.doesNotMatch(sql,/\{location\}/)
})

test('makine kartı tam birim listesini seçim ve yeni birim ekleme olarak sunar', () => {
  const required = ['KAYNAKLI İMALAT','TALAŞLI İMALAT','KALİTE KONTROL','ÜRETİM','POLAT TECHNIC','AR-GE','DCM','DEPO','ELEKTRİK BÖLÜMÜ','HELEZON HATTI','İDARİ İŞLER','MONTAJ','PG SOLUTION','SEVKİYAT','ŞEKİLLENDİRME','ÜRETİM TEKNOLOJİLERİ','YÜZEY İŞLEM']
  required.forEach(department => assert.match(app, new RegExp(department.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
  assert.match(html,/id="assetDepartmentSelect" name="department"/)
  assert.match(html,/id="addAssetDepartmentBtn">＋ Birim Ekle/)
  assert.match(app,/function migrateAssetDepartments\(target\)/)
  assert.match(app,/simpleMode==='asset-department'/)
  assert.match(app,/function enhanceAssetDepartmentSelect\(\)/)
  assert.match(app,/class="department-picker-option/)
  assert.doesNotMatch(html,/assetDepartmentOptions/)
})
