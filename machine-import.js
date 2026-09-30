(function () {
  'use strict'

  const byId = id => document.getElementById(id)
  const fileInput = byId('importMachineCardsFile')
  const modal = byId('machineImportModal')
  if (!fileInput || !modal) return

  let pending = null
  let preview = null
  const codeKey = value => String(value || '').replace(/\s+/g, '').toLocaleUpperCase('tr-TR')
  const hasValue = value => value !== undefined && value !== null && String(value).trim() !== ''
  const compactCode = value => String(value || '').trim().replace(/^PT\s+(?=\d)/i, 'PT')

  function closeModal() {
    modal.classList.add('hidden')
    fileInput.value = ''
    pending = null
    preview = null
    byId('machineImportError').classList.add('hidden')
  }

  function showError(message) {
    const element = byId('machineImportError')
    element.textContent = message
    element.classList.remove('hidden')
  }

  function readBackup(value) {
    if (!value || value.version !== 3 || !Array.isArray(value.machines) || !value.machines.length) {
      throw new Error('Bu dosya, makine kartları içeren Polat Bakım 360 JSON yedeği değil.')
    }
    if (value.machines.length > 5000) throw new Error('Tek seferde en fazla 5000 makine kartı aktarılabilir.')
    const seen = new Set()
    for (const machine of value.machines) {
      if (!machine || typeof machine !== 'object' || !hasValue(machine.code) || !hasValue(machine.name)) {
        throw new Error('Dosyada kodu veya adı boş olan makine kartı var. Aktarım yapılmadı.')
      }
      const key = codeKey(machine.code)
      if (seen.has(key)) throw new Error(`Dosyada aynı kod birden fazla kez geçiyor: ${machine.code}`)
      seen.add(key)
    }
    return value.machines
  }

  function planImport(machines, snapshot) {
    const next = JSON.parse(JSON.stringify(snapshot))
    if (!Array.isArray(next.assets)) throw new Error('Buluttaki makine kartı verisi okunamadı.')
    const byCode = new Map()
    const ambiguous = new Set()
    for (const asset of next.assets) {
      const key = codeKey(asset.code)
      if (!key) continue
      if (byCode.has(key)) ambiguous.add(key)
      else byCode.set(key, asset)
    }
    const deleted = new Set((next.deletedAssetCodes || []).map(codeKey))
    const summary = { added: 0, updated: 0, unchanged: 0, skippedDeleted: 0, skippedAmbiguous: 0 }

    for (const source of machines) {
      const key = codeKey(source.code)
      if (ambiguous.has(key)) { summary.skippedAmbiguous++; continue }
      let asset = byCode.get(key)
      if (!asset && deleted.has(key)) { summary.skippedDeleted++; continue }
      const isNew = !asset
      if (isNew) {
        asset = {
          id: `AIMP-${crypto.randomUUID()}`,
          code: compactCode(source.code),
          name: String(source.name).trim(),
          category: 'Diğer Ekipmanlar',
          assetLevel: 'Makine', parentAssetId: '', department: '', location: '',
          machineScore: '', status: source.status === 'Pasif' ? 'Devre Dışı' : 'Çalışıyor',
          createdAt: new Date().toISOString().slice(0, 19),
          events: [], meterReadings: [], criticalPartIds: [],
        }
        next.assets.push(asset)
        byCode.set(key, asset)
      }
      const before = JSON.stringify(asset)
      const fields = {
        name: source.name, category: source.type, serialNo: source.serial,
        manufacturer: source.manufacturer, model: source.model,
        location: source.location, commissionDate: source.commission,
        responsibleUnit: source.responsible, sapEquipmentNo: source.sapEquipmentNo,
        technicalDescription: source.notes,
      }
      for (const [field, value] of Object.entries(fields)) {
        if (!hasValue(value)) continue
        asset[field] = field === 'category' ? canonicalAssetCategory(value) : String(value).trim()
      }
      if (!hasValue(asset.department) && hasValue(source.location)) asset.department = String(source.location).trim()
      if (hasValue(source.period) && Number.isFinite(Number(source.period)) && Number(source.period) > 0) {
        asset.maintenanceInterval = Number(source.period)
      }
      if (hasValue(source.equipmentKw) && Number.isFinite(Number(source.equipmentKw)) && Number(source.equipmentKw) >= 0) {
        asset.equipmentKw = Number(source.equipmentKw)
      }
      if (isNew) {
        if (hasValue(source.machineScore)) asset.machineScore = normalizeMachineScore(source.machineScore)
        if (hasValue(source.image)) asset.image = String(source.image)
        summary.added++
      } else if (before === JSON.stringify(asset)) summary.unchanged++
      else summary.updated++
    }
    return { next, summary }
  }

  function renderSummary(summary) {
    byId('machineImportSummary').innerHTML = [
      ['Yeni kart', summary.added], ['Güncellenecek', summary.updated],
      ['Değişmeyen', summary.unchanged], ['Önceden silinmiş kod', summary.skippedDeleted],
      ['Çakışan mevcut kod', summary.skippedAmbiguous],
    ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')
  }

  byId('importMachineCardsBtn').addEventListener('click', () => {
    const info = window.PolatBakimCloud?.getInfo?.()
    if (!info?.connected || !info.profile?.is_admin || !info.profile?.manager_access) {
      toast('JSON aktarımı için Admin Yönetici girişi gerekir.')
      return
    }
    fileInput.click()
  })

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('JSON dosyası en fazla 10 MB olabilir.')
      const machines = readBackup(JSON.parse(await file.text()))
      const plan = planImport(machines, state)
      pending = machines
      preview = plan.summary
      byId('machineImportFileName').textContent = `${file.name} · ${machines.length} makine kartı`
      renderSummary(preview)
      byId('machineImportError').classList.add('hidden')
      modal.classList.remove('hidden')
    } catch (error) {
      fileInput.value = ''
      toast(error instanceof SyntaxError ? 'JSON dosyası okunamadı.' : error.message)
    }
  })

  byId('confirmMachineImportBtn').addEventListener('click', async event => {
    if (!pending) return
    const button = event.currentTarget
    button.disabled = true
    byId('machineImportError').classList.add('hidden')
    try {
      const api = window.PolatBakimCloud
      const info = api?.getInfo?.()
      if (!info?.connected || !info.profile?.is_admin) throw new Error('Admin Yönetici oturumu gerekli.')
      if (info.pendingSave) throw new Error('Önce devam eden kayıt eşitlemesinin bitmesini bekleyip tekrar deneyin.')
      const remote = await api.pullState()
      if (!remote) throw new Error('Supabase üzerinde merkezi veri paketi bulunamadı.')
      const expectedVersion = api.getInfo().version
      const plan = planImport(pending, remote)
      if (JSON.stringify(plan.summary) !== JSON.stringify(preview)) {
        preview = plan.summary
        renderSummary(preview)
        throw new Error('Buluttaki kayıtlar değişti. Güncel sayıları kontrol edip aktarımı tekrar onaylayın.')
      }
      if (plan.summary.added + plan.summary.updated === 0) {
        closeModal()
        toast('Yeni veya değişen makine kartı yok.')
        return
      }
      plan.next.activities = Array.isArray(plan.next.activities) ? plan.next.activities : []
      plan.next.activities.unshift({
        text: `${pending.length} kartlık JSON yedeğinden ${plan.summary.added} makine eklendi, ${plan.summary.updated} makine güncellendi.`,
        date: new Date().toISOString(),
      })
      plan.next.activities = plan.next.activities.slice(0, 40)
      await api.pushState(plan.next, expectedVersion)
      applyCloudState(plan.next)
      const result = plan.summary
      closeModal()
      toast(`Supabase'e aktarıldı: ${result.added} yeni, ${result.updated} güncel kart.`)
    } catch (error) {
      showError(String(error.message || error).includes('SNAPSHOT_CONFLICT')
        ? 'Başka biri bu sırada kayıt değiştirdi. Aktarım yapılmadı; yeniden deneyin.'
        : error.message || 'Aktarım başarısız oldu.')
    } finally {
      button.disabled = false
    }
  })

  modal.querySelectorAll('.machine-import-close').forEach(button => button.addEventListener('click', closeModal))
  modal.addEventListener('click', event => { if (event.target === modal) closeModal() })
})()
