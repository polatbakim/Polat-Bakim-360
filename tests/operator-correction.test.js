const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

test('yönetici düzeltmesinde operatör yeniden işe başlamaz, yalnızca düzeltme formunu açar', () => {
  const start = app.indexOf('function operatorTimingSummary(')
  const end = app.indexOf('function operatorAction(', start)
  const context = vm.createContext({
    assetById: () => ({ name: 'Makine', code: 'PT001', location: 'Üretim' }),
    operatorCanStart: () => false,
    operatorCanAddPerson: () => false,
    operatorIsWorking: () => true,
    operatorIsWaiting: () => false,
    operatorClock: () => null,
    operatorHasStarted: () => true,
    orderAssignedToTechnician: () => true,
    operatorTechId: 'T1',
    techById: () => ({ name: 'Operatör' }),
    escapeHtml: value => String(value || ''),
    visibleWorkOrderNo: order => order.id,
    slug: value => value,
    formatDate: () => '',
    formatDateTime: () => '',
  })
  vm.runInContext(app.slice(start, end), context)
  const card = vm.runInContext("operatorCard({id:'WO-1',title:'Kontrol',assetId:'A1',status:'Devam Ediyor',priority:'Orta',type:'Arıza Bakım',technicianId:'T1',managerCorrectionPending:true,managerCorrectionNote:'Sonucu düzelt'})", context)
  assert.match(card, /data-operator-action="correct"/)
  assert.match(card, /data-operator-action="correction-request"/)
  assert.doesNotMatch(card, /data-operator-action="start"/)
  assert.doesNotMatch(card, /data-operator-action="complete"/)
  assert.doesNotMatch(card, /data-operator-action="hold"/)
})

test('başlamış iş eski kişi listesi boş olsa bile tekrar İşe Başla göstermez', () => {
  const logic = app.slice(app.indexOf('function operatorHasStarted('), app.indexOf('function assignmentFromForm('))
  const context = vm.createContext({ operatorCanSeeOrder: () => true, operatorClock: () => null, orderAssignedToTechnician: () => true })
  vm.runInContext(logic, context)
  const order = {status:'Devam Ediyor',technicianId:'T1',startedTechnicians:[],startTime:'2026-10-06T08:00'}
  assert.equal(context.operatorHasStarted(order, 'T1'), true)
  assert.equal(context.operatorCanStart(order, 'T1'), false)
  order.operatorCorrectionPending = true
  assert.equal(context.operatorCanStart(order, 'T2'), false)
  order.operatorCorrectionPending = false
  order.startedTechnicians = ['T2']
  assert.equal(context.operatorHasStarted(order, 'T1'), false)
  assert.equal(context.operatorHasStarted(order, 'T2'), true)
  order.startedTechnicians = []
  order.safetyConfirmations = [{technicianId:'T2',confirmedAt:'2026-10-06T08:30'}]
  assert.equal(context.operatorHasStarted(order, 'T2'), true)
})

test('operatör kartı başlangıç ve tüm ara saatlerini her iş durumunda gösterir', () => {
  const start = app.indexOf('function operatorTimingSummary(')
  const end = app.indexOf('function operatorAction(', start)
  const context = vm.createContext({
    assetById: () => ({name:'Makine',code:'PT001',location:'Üretim'}),
    operatorCanStart: () => false,
    operatorCanAddPerson: () => false,
    operatorIsWorking: () => false,
    operatorIsWaiting: () => false,
    operatorClock: () => null,
    operatorHasStarted: () => true,
    orderAssignedToTechnician: () => true,
    operatorTechId: 'T1',
    techById: () => ({name:'Operatör'}),
    escapeHtml: value => String(value || ''),
    visibleWorkOrderNo: order => order.id,
    slug: value => value,
    formatDate: value => value || '',
    formatDateTime: value => value || '—',
  })
  vm.runInContext(app.slice(start, end), context)
  for(const status of ['Devam Ediyor','Beklemede','Teyit Bekliyor','Tamamlandı']){
    const order = {id:'WO-1',title:'Kontrol',assetId:'A1',status,priority:'Orta',technicianId:'T1',startTime:'2026-10-06T08:00',pauseHistory:[{start:'2026-10-06T09:00',end:'2026-10-06T09:15'},{start:'2026-10-06T10:00',end:''}]}
    const card = context.operatorCard(order)
    assert.match(card, /İşe başlama.*2026-10-06T08:00/)
    assert.match(card, /1\. ara başlangıcı \/ bitişi.*2026-10-06T09:00 → 2026-10-06T09:15/)
    assert.match(card, /2\. ara başlangıcı \/ bitişi.*2026-10-06T10:00 → —/)
  }
  context.operatorTechId = 'T2'
  const shared = {id:'WO-2',title:'Kontrol',assetId:'A1',status:'Devam Ediyor',priority:'Orta',technicianId:'T1',startTime:'2026-10-06T08:00',startedAtByTechnician:{T1:'2026-10-06T08:00',T2:'2026-10-06T08:30'}}
  assert.match(context.operatorCard(shared), /İşe başlama.*2026-10-06T08:30/)
  assert.match(context.operatorCard(shared, false), /İşe başlama.*2026-10-06T08:00/)
})

test('operatör saatleri değiştiremez; duruş seçimi boş başlar ve zorunludur', () => {
  assert.match(app, /button\.disabled=true;button\.title='Saatler otomatik kaydedilir/)
  assert.match(app, /function operatorCompletionTimeValues\(/)
  assert.match(app, /persistedStart:savedStart\|\|clockStart/)
  assert.match(app, /persistedPauseStart:savedPauseStart\|\|pauseStart/)
  assert.match(html, /name="hasDowntime" value="yes" required/)
  assert.match(html, /name="hasDowntime" value="no" required/)
  assert.doesNotMatch(html, /name="hasDowntime"[^>]*checked/)
  assert.match(app, /operatorCorrectionPending=true/)
  assert.match(app, /operatorCorrectionPending=false/)
  assert.match(html, /data-operator-status="Tamamlandı">Tamamlanan/)
  assert.match(app, /isActive\(order\)\|\|order\.status==='Tamamlandı'/)
})

test('operatör düzeltme isteği yönetici bildirimine girer ve Supabase doğrulanmadan gönderildi denmez', () => {
  assert.match(app, /const corrections=state\.orders\.filter\(order=>order\.operatorCorrectionPending\)/)
  assert.match(app, /return\[\.\.\.corrections,\.\.\.approvals,\.\.\.requests,\.\.\.overdue\]/)
  assert.match(app, /o\.status==='Teyit Bekliyor'\|\|o\.operatorCorrectionPending/)
  assert.match(app, /await cloud\.pushOperatorOrder\(nextOrder\)/)
  assert.match(app, /const remote=await cloud\.pullOperatorState\(\),saved=/)
  assert.match(app, /saved\.operatorCorrectionRequestedAt!==now/)
  assert.match(html, /id="operatorCorrectionError" role="alert"/)
})
