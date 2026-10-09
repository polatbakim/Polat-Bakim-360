(function () {
  'use strict'

  const byId = id => document.getElementById(id)
  const input = byId('legacyLaborFile')
  const modal = byId('legacyLaborModal')
  if (!input || !modal) return

  const REQUIRED = ['IsNo', 'IsTanimi', 'Kisi', 'ArızaBaslangic', 'Durum']
  const blank = value => value === null || value === undefined || String(value).trim() === ''
  const text = value => blank(value) ? '' : String(value).trim().replace(/\s+/g, ' ')
  const norm = value => text(value).toLocaleLowerCase('tr-TR')
  const code = value => text(value).replace(/\s+/g, '').toLocaleUpperCase('tr-TR')
  const missingPerson = value => !text(value) || ['boş', 'bos', 'yok', '-', 'atanmadı'].includes(norm(value))
  const safe = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const hash = value => { let h = 2166136261; for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) }
  const number = value => { const n = Number(value); return Number.isFinite(n) ? n : 0 }
  const simpleNo = value => typeof value === 'number' && Number.isInteger(value) ? String(value) : text(value).replace(/\.0+$/, '')
  const unique = values => [...new Set(values.filter(Boolean))]
  const stamp = value => {
    if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
      const part = n => String(n).padStart(2, '0')
      return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}:${part(value.getSeconds())}`
    }
    const raw = text(value)
    if (/^\d{4}-\d\d-\d\d/.test(raw)) return raw.replace(' ', 'T').slice(0, 19)
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const date = window.XLSX.SSF.parse_date_code(value)
      if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}T${String(date.H).padStart(2, '0')}:${String(date.M).padStart(2, '0')}:${String(date.S).padStart(2, '0')}`
    }
    return ''
  }
  let groups = null
  let preview = null
  let previewSnapshot = null
  let previewPersonnel = []
  let personMapping = {}
  const rosterFromProfiles = profiles => (profiles || []).filter(row => row.active && row.operator_access && row.technician_id)
    .map(row => ({ id: String(row.technician_id), name: text(row.full_name), inactive: false, loginEnabled: true }))

  function readGroups(workbook) {
    const sheetName = workbook.SheetNames?.find(name => {
      const sheet = workbook.Sheets[name]
      const first = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', range: 0, blankrows: false })[0] || []
      return REQUIRED.every(header => first.map(text).includes(header))
    })
    if (!sheetName) throw new Error(`Excel'de gerekli sütunlar bulunamadı: ${REQUIRED.join(', ')}`)
    const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: false })
    if (matrix.length > 10000) throw new Error('Tek seferde en fazla 10.000 işçilik satırı aktarılabilir.')
    const headers = matrix[0].map(text)
    const grouped = new Map()
    let rowCount = 0
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i]
      if (!cells.some(value => !blank(value))) continue
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]))
      const workNo = simpleNo(row.IsNo)
      if (!workNo || !text(row.IsTanimi)) throw new Error(`${i + 1}. satırda iş numarası veya iş tanımı eksik. Dosyayı düzeltip yeniden seçin.`)
      const year = simpleNo(row['Yıl']) || stamp(row['ArızaBaslangic']).slice(0, 4)
      if (!/^\d{4}$/.test(year)) throw new Error(`${i + 1}. satırın yılı okunamadı.`)
      const key = `LEGACY-LABOR-${year}-${workNo}`
      if (!grouped.has(key)) grouped.set(key, { key, year, workNo, rows: [], sourceRows: [] })
      grouped.get(key).rows.push(row)
      grouped.get(key).sourceRows.push(i + 1)
      rowCount++
    }
    if (!grouped.size) throw new Error('Excel dosyasında aktarılacak iş bulunamadı.')
    return { sheetName, rowCount, items: [...grouped.values()] }
  }

  function priority(value) {
    const label = code(value)
    if (label.startsWith('A')) return 'Yüksek'
    if (label.startsWith('C')) return 'Düşük'
    return 'Orta'
  }
  function faultDetails(rows) {
    const fields = {
      mechanicalFaults: 'MekanikArızaTanımı', mechanicalCauses: 'MekanikArızaNedeni',
      electricalFaults: 'ElektrikArızaTanımı', electricalCauses: 'ElektrikArızaNedeni',
    }
    const result = {}
    for (const [target, source] of Object.entries(fields)) result[target] = unique(rows.map(row => text(row[source])))
    const extras = ['DiğerArızaTanımı', 'DiğerElektrikArızaNedeni', 'DiğerElektrikArızaTanımı', 'DiğerMekanikArızaNedeni', 'DiğerMekanikArızaTanımı']
    result.otherFault = unique(rows.flatMap(row => extras.map(field => text(row[field])))).join(' · ')
    result.workPerformed = ''
    return result
  }

  function planImport(source, snapshot, mapping = {}, personnel = snapshot?.technicians) {
    if (!snapshot || !Array.isArray(snapshot.orders) || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.technicians)) throw new Error('Canlı kayıtlar okunamadı.')
    const next = JSON.parse(JSON.stringify(snapshot))
    const techByName = new Map(), ambiguousNames = new Set()
    for (const person of personnel || []) {
      const key = norm(person.name)
      if (!key || person.historicalOnly || person.inactive || person.loginEnabled === false) continue
      if (techByName.has(key)) ambiguousNames.add(key)
      else techByName.set(key, person)
    }
    const assetByCode = new Map(), ambiguousCodes = new Set()
    for (const asset of next.assets) {
      const key = code(asset.code)
      if (!key || asset.historicalOnly) continue
      if (assetByCode.has(key)) ambiguousCodes.add(key)
      else assetByCode.set(key, asset)
    }
    const importedByKey = new Map(next.orders.filter(order => order.legacyLaborSourceKey).map(order => [order.legacyLaborSourceKey, order]))
    const existingIds = new Set(next.orders.map(order => order.id))
    const knownLegacyAssets = new Map(next.assets.filter(a => a.historicalOnly).map(a => [a.legacyAssetKey, a]))
    const unmatchedPeople = new Set(), ambiguousPeople = new Set(), unmatchedAssets = new Set()
    const summary = { sourceRows: source.rowCount, jobs: source.items.length, requests: 0, orders: 0, assigned: 0, waiting: 0, repaired: 0, editedSkipped: 0, skipped: 0, placeholderAssets: 0 }
    const now = new Date().toISOString().slice(0, 19)
    for (const group of source.items) {
      const first = group.rows[0], names = unique(group.rows.map(row => missingPerson(row.Kisi) ? '' : text(row.Kisi)))
      const isRequest = names.length === 0
      const sourceWaiting = !isRequest && group.rows.some(row => norm(row.Durum) === 'beklemede')
      const id = `${isRequest ? 'HIST-TLP' : 'HIST-IE'}-${group.year}-${group.workNo}`
      const imported = importedByKey.get(group.key)
      if (imported) {
        const untouched = imported.legacyLaborImport === true && imported.id === id && imported.status === 'Atandı'
          && !imported.startTime && !imported.completionTime && !(imported.pauseHistory || []).length
          && !(imported.laborEntries || []).length && !(imported.startedTechnicians || []).length
          && Array.isArray(imported.events) && imported.events.length === 1 && imported.events[0]?.eventType === 'imported'
          && imported.updatedAt === imported.faultStart
        if (sourceWaiting && untouched) {
          imported.status = 'Beklemede'
          imported.legacyImportedWaiting = true
          imported.legacySourceStatus = 'Beklemede'
          imported.legacyWaitRepairVersion = 1
          summary.repaired++
        } else if (sourceWaiting && imported.status !== 'Beklemede' && !untouched) summary.editedSkipped++
        else summary.skipped++
        continue
      }
      if (existingIds.has(id)) { summary.skipped++; continue }
      const faultStart = stamp(first['ArızaBaslangic'])
      if (!faultStart) throw new Error(`${group.workNo} numaralı işin arıza tarihi okunamadı.`)
      const ptNo = [first['PT No Yeni'], first.PTNo].map(code).find(value => value && !['YOK', 'BOŞ', 'BOS', '-'].includes(value)) || ''
      const equipmentName = text(first.EkipmanTanimi) || 'Diğer Ekipmanlar'
      const location = text(first.MasrafYeriYeni) || text(first.MasrafYeri)
      let asset = ptNo && !ambiguousCodes.has(ptNo) ? assetByCode.get(ptNo) : null
      if (!asset) {
        const assetKey = ptNo || `${norm(equipmentName)}|${norm(location)}`
        asset = knownLegacyAssets.get(assetKey)
        if (!asset) {
          asset = { id: `HIST-ASSET-${hash(assetKey)}`, code: `ESKI-${hash(assetKey)}`, name: ptNo ? `${ptNo} · ${equipmentName}` : equipmentName, category: equipmentName, department: location, location, status: 'Çalışıyor', manualEquipment: true, historicalOnly: true, legacyAssetKey: assetKey, createdAt: now, events: [] }
          if (next.assets.some(item => item.id === asset.id)) throw new Error('Geçmiş ekipman kodu çakıştı; aktarım durduruldu.')
          next.assets.push(asset)
          knownLegacyAssets.set(assetKey, asset)
          summary.placeholderAssets++
        }
        unmatchedAssets.add(ptNo || equipmentName)
      }
      const people = names.map(name => {
        const key = norm(name)
        const mapped = mapping[key] && (personnel || []).find(item => item.id === mapping[key] && !item.inactive && item.loginEnabled !== false && !item.historicalOnly)
        if (mapped) return mapped
        if (ambiguousNames.has(key)) { ambiguousPeople.add(name); return null }
        const current = techByName.get(key)
        if (current) return current
        unmatchedPeople.add(name)
        return null
      }).filter(Boolean)
      const status = isRequest ? 'Bekliyor' : sourceWaiting ? 'Beklemede' : 'Atandı'
      const laborEntries = group.rows.filter(row => !missingPerson(row.Kisi)).map(row => {
        const person = people.find(item => norm(item.name) === norm(row.Kisi))
        const start = stamp(row.BaslangicSaati), finish = stamp(row.BitisSaati)
        const pauseStart = stamp(row.AraBaslangic), pauseEnd = stamp(row.AraBitis)
        const grossMinutes = number(row.NetCalismaSuresi)
        const netMinutes = number(row['NetCalismaSuresi-YemekMolalari'])
        return { technicianId: person?.id || '', name: text(row.Kisi), start, finish, pauseStart, pauseEnd, grossMinutes, netMinutes, pauseMinutes: Math.max(0, grossMinutes - netMinutes), hourlyRate: 0, total: 0, sourceRow: group.sourceRows[group.rows.indexOf(row)] }
      })
      const starts = laborEntries.map(entry => entry.start).filter(Boolean).sort()
      const finishes = laborEntries.map(entry => entry.finish).filter(Boolean).sort()
      const notificationNo = simpleNo(first.BildirimNo)
      const order = {
        id, title: text(first.IsTanimi), description: text(first.IsTanimi), type: isRequest ? 'İş Talebi' : text(first.BakimTuru) || 'Arıza Bakım',
        assetId: asset.id, equipmentCategory: asset.category || equipmentName, activityType: equipmentName,
        location, costCenter: text(first['MasrafYeriYeni Sıralama']) || location,
        maintenanceBranch: text(first['BildirimTürü']) || (group.rows.some(row => text(row['ElektrikArızaTanımı'])) ? 'Elektrik Bakım' : 'Mekanik Bakım'),
        priority: priority(first['Önem Derecesi']), assignmentMode: 'selected', technicianId: people[0]?.id || '',
        assignedTechnicians: people.map(person => person.id), additionalTechnicians: people.slice(1).map(person => person.id),
        claimedTechnicians: [], startedTechnicians: [], dueDate: faultStart.slice(0, 10), faultStart,
        notificationNo, notificationStatus: notificationNo ? 'Var' : 'Yok', ptNo,
        purchaseOrderNo: '', sapSyncStatus: 'Yerel', status, createdAt: faultStart,
        updatedAt: faultStart, startTime: '', completionTime: '',
        laborEntries: [], legacyLaborEntries: laborEntries, legacyFaultDetails: faultDetails(group.rows),
        legacySourceStatus: text(first.Durum), legacySourceStart: starts[0] || '', legacySourceFinish: finishes.at(-1) || '', legacyImportedWaiting: sourceWaiting,
        laborCost: 0, materialCost: 0, serviceCost: 0, otherCost: 0, totalCost: 0,
        legacyLaborImport: true, legacyLaborSourceKey: group.key, legacyLaborSourceFile: source.fileName || '', legacyLaborSourceRows: group.sourceRows,
        events: [{ id: `EV-${group.key}`, orderId: id, assetId: asset.id, eventType: 'imported', title: 'Geçmiş Excel kaydı aktarıldı', detail: `${group.rows.length} işçilik satırı · Kaynak iş ${group.workNo}`, statusFrom: '', statusTo: status, actorId: 'SYSTEM', actorName: 'Sistem', actorRole: 'Aktarım', source: 'legacy-labor-xlsx', metadata: { sourceKey: group.key }, timestamp: now }],
      }
      next.orders.push(order)
      existingIds.add(id)
      if (isRequest) summary.requests++
      else { summary.orders++; if (sourceWaiting) summary.waiting++; else summary.assigned++ }
    }
    return { next, summary, unmatchedPeople: [...unmatchedPeople].sort((a, b) => a.localeCompare(b, 'tr')), ambiguousPeople: [...ambiguousPeople], unmatchedAssets: [...unmatchedAssets].sort((a, b) => a.localeCompare(b, 'tr')) }
  }

  function render(plan) {
    const { summary } = plan
    byId('legacyLaborSummary').innerHTML = [
      ['İş', summary.jobs], ['Talep olarak eklenecek', summary.requests], ['İş emri eklenecek', summary.orders],
      ['Atanmış / açık', summary.assigned], ['Beklemede açılacak', summary.waiting], ['Eski bekleme düzeltilecek', summary.repaired], ['Değişmiş kayıt / korunacak', summary.editedSkipped], ['Mükerrer / atlanacak', summary.skipped],
    ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')
    const people = plan.unmatchedPeople.length || plan.ambiguousPeople.length ? `Eşleşmeyen kişi adlarını mevcut operatörlerle eşleştirin. Seçilmeden aktarım yapılamaz.` : 'Tüm kişi adları mevcut personelle eşleşti.'
    const mappingRows = [...new Set([...plan.unmatchedPeople, ...plan.ambiguousPeople])].map(name => `<label>${safe(name)}<select data-legacy-person="${safe(name)}"><option value="">Personel seçin</option>${previewPersonnel.filter(person => !person.inactive && person.loginEnabled !== false && !person.historicalOnly).map(person => `<option value="${safe(person.id)}" ${personMapping[norm(name)] === person.id ? 'selected' : ''}>${safe(person.name)}</option>`).join('')}</select></label>`).join('')
    const assets = plan.unmatchedAssets.length ? `Eşleşmeyen ekipmanlar (${plan.unmatchedAssets.length}): Geçmiş referans kartı oluşturulacak; mevcut makine kartları değiştirilmez.` : 'Ekipman kodları mevcut kartlarla eşleşti.'
    const warning = 'Excel durumu Beklemede olan ve kişisi bulunan işler Beklemede açılır; kişisi olmayanlar İş Talebi olarak kalır. Eski ara başlangıç/bitişleri kaynak kayıt olarak görünür, canlı işçilik hesabına katılmaz. Önceden yüklenen ve sonradan değiştirilmemiş Atandı kayıtları güvenle düzeltilir; üzerinde işlem yapılanlar korunur.'
    byId('legacyLaborDetails').innerHTML = `<p>${people}</p>${mappingRows ? `<div class="legacy-labor-mappings">${mappingRows}</div>` : ''}<p>${assets}</p><p class="legacy-labor-warning">${warning}</p>`
    byId('confirmLegacyLaborBtn').disabled = !summary.requests && !summary.orders && !summary.repaired || Boolean(plan.ambiguousPeople.length || plan.unmatchedPeople.length)
  }
  function close() { modal.classList.add('hidden'); input.value = ''; groups = null; preview = null; previewSnapshot = null; previewPersonnel = []; personMapping = {}; byId('legacyLaborError').classList.add('hidden') }
  function errorMessage(message) { const node = byId('legacyLaborError'); node.textContent = message; node.classList.remove('hidden') }
  const authorized = () => { const info = window.PolatBakimCloud?.getInfo?.(); return Boolean(info?.connected && info.profile?.is_admin && info.profile?.manager_access) }

  byId('importLegacyLaborBtn').addEventListener('click', () => {
    if (!authorized()) { toast('Geçmiş işçilik aktarımı için Admin Yönetici girişi gerekir.'); return }
    input.click()
  })
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      if (!authorized()) throw new Error('Admin Yönetici girişi gerekir.')
      if (!window.XLSX) throw new Error('Excel okuma bileşeni yüklenemedi.')
      if (file.size > 10 * 1024 * 1024) throw new Error('Excel dosyası en fazla 10 MB olabilir.')
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      groups = readGroups(workbook)
      groups.fileName = file.name
      const [remote, profiles] = await Promise.all([window.PolatBakimCloud.pullState(), window.PolatBakimCloud.listProfiles()])
      if (!remote) throw new Error('Supabase üzerindeki mevcut kayıtlar okunamadı.')
      previewSnapshot = remote
      previewPersonnel = rosterFromProfiles(profiles)
      personMapping = {}
      preview = planImport(groups, remote, personMapping, previewPersonnel)
      byId('legacyLaborFileName').textContent = `${file.name} · ${groups.sheetName} · ${groups.rowCount} işçilik satırı`
      render(preview)
      modal.classList.remove('hidden')
    } catch (error) { input.value = ''; groups = null; toast(error.message || 'Excel okunamadı.') }
  })
  byId('legacyLaborDetails').addEventListener('change', event => {
    const selector = event.target.closest('[data-legacy-person]')
    if (!selector || !groups || !previewSnapshot) return
    personMapping[norm(selector.dataset.legacyPerson)] = selector.value
    preview = planImport(groups, previewSnapshot, personMapping, previewPersonnel)
    render(preview)
  })
  byId('confirmLegacyLaborBtn').addEventListener('click', async event => {
    if (!groups || !authorized()) return
    const button = event.currentTarget
    button.disabled = true
    byId('legacyLaborError').classList.add('hidden')
    try {
      const api = window.PolatBakimCloud
      if (api.getInfo().pendingSave) throw new Error('Devam eden eşitleme bitince tekrar deneyin.')
      if (!await api.checkLegacyLaborImportGuard?.()) throw new Error('Toplu bildirim koruması kurulmamış. Önce güncel supabase/web-push.sql dosyasını Supabase SQL Editor’da çalıştırın.')
      const [remote, profiles] = await Promise.all([api.pullState(), api.listProfiles()])
      if (!remote) throw new Error('Supabase kayıtları okunamadı.')
      const version = api.getInfo().version
      const currentPersonnel = rosterFromProfiles(profiles)
      const current = planImport(groups, remote, personMapping, currentPersonnel)
      const assigned = plan => plan.next.orders.filter(order => order.legacyLaborImport && !previewSnapshot.orders.some(old => old.id === order.id)).map(order => [order.id, order.assignedTechnicians])
      if (JSON.stringify(current.summary) !== JSON.stringify(preview.summary) || JSON.stringify(assigned(current)) !== JSON.stringify(assigned(preview))) {
        previewSnapshot = remote; previewPersonnel = currentPersonnel; preview = current; render(current)
        throw new Error('Canlı veriler değişti. Güncel sayıları kontrol edip tekrar onaylayın.')
      }
      if (current.ambiguousPeople.length || current.unmatchedPeople.length) throw new Error('Personel eşleşmeleri tamamlanmadan aktarım yapılamaz.')
      const count = current.summary.requests + current.summary.orders + current.summary.repaired
      if (!count) { close(); toast('Yeni kayıt yok; aynı Excel daha önce aktarılmış.'); return }
      current.next.activities = Array.isArray(current.next.activities) ? current.next.activities : []
      current.next.activities.unshift({ text: `Geçmiş işçilik Excel'inden ${current.summary.orders} iş emri ve ${current.summary.requests} talep aktarıldı; ${current.summary.repaired} eski bekleme durumu düzeltildi.`, date: new Date().toISOString() })
      current.next.activities = current.next.activities.slice(0, 40)
      await api.pushState(current.next, version)
      applyCloudState(current.next)
      const result = current.summary
      close()
      toast(`${result.orders} iş emri, ${result.requests} talep eklendi; ${result.repaired} bekleme durumu düzeltildi.`)
    } catch (error) { errorMessage(String(error.message || error).includes('SNAPSHOT_CONFLICT') ? 'Başka biri bu sırada kayıt değiştirdi. Yeniden kontrol edip tekrar deneyin.' : error.message || 'Aktarım yapılamadı.') }
    finally { button.disabled = false }
  })
  modal.querySelectorAll('.legacy-labor-close').forEach(button => button.addEventListener('click', close))
  modal.addEventListener('click', event => { if (event.target === modal) close() })
  window.PolatLegacyLaborImport = { readGroups, planImport }
})()
