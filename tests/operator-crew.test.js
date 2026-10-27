const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const sql = fs.readFileSync(path.join(root, 'supabase', 'open-work-orders.sql'), 'utf8')
const context = vm.createContext({
  isActive: order => ['Atandı', 'Devam Ediyor', 'Beklemede', 'Teyit Bekliyor'].includes(order.status),
  techById: id => ({name:id}),
  minutesBetween: (start, end) => start && end ? Math.max(0, Math.round((new Date(end)-new Date(start))/60000)) : 0,
})
vm.runInContext(app.slice(app.indexOf('function orderAssignedToTechnician('), app.indexOf('function assignmentFromForm(')), context)
vm.runInContext(app.slice(app.indexOf('function orderPauseMinutes('), app.indexOf('function localDateTimeValue(')), context)

test('atanmış, devam eden veya bekleyen işe mevcut ekip korunarak yeni kişi eklenebilir', () => {
  const order = {technicianId:'T1',assignedTechnicians:['T1'],additionalTechnicians:[],assignmentMode:'selected',status:'Atandı'}
  assert.equal(context.operatorCanAddPerson(order,'T1'),true)
  order.status='Devam Ediyor'
  order.startTime='2026-10-12T08:00'
  assert.equal(context.operatorCanAddPerson(order,'T1'),true)
  order.status='Beklemede'
  assert.equal(context.operatorCanAddPerson(order,'T1'),true)
  order.assignedTechnicians.push('T2')
  order.additionalTechnicians.push('T2')
  assert.equal(context.operatorCanAddPerson(order,'T1'),true)
  assert.equal(context.operatorCanSeeOrder(order,'T2'),true)
  order.status='Teyit Bekliyor'
  order.completedByTechnicianId='T1'
  assert.equal(context.operatorCanSeeOrder(order,'T1'),true)
  assert.equal(context.operatorCanSeeOrder(order,'T2'),true)
})

test('her operatörün başlangıcı ve beklemesi ayrı hesaplanır; tek teyit her ikisini kapatır', () => {
  const order = {
    technicianId:'T1',assignedTechnicians:['T1','T2'],additionalTechnicians:['T2'],
    status:'Devam Ediyor',startTime:'2026-10-12T08:00',
    operatorWorkByTechnician:{
      T1:{start:'2026-10-12T08:00',state:'active',pauses:[{start:'2026-10-12T09:00',end:'2026-10-12T09:10'},{start:'2026-10-12T10:00',end:''}]},
      T2:{start:'2026-10-12T09:30',state:'waiting',pauses:[{start:'2026-10-12T10:15',end:''}]},
    },
    pauseHistory:[{technicianId:'T1',start:'2026-10-12T09:00',end:'2026-10-12T09:10'},{technicianId:'T1',start:'2026-10-12T10:00',end:''},{technicianId:'T2',start:'2026-10-12T10:15',end:''}],
  }
  const rows = context.finishOperatorClocks(order,'2026-10-12T11:00')
  assert.equal(rows.length,2)
  assert.equal(rows.find(row=>row.technicianId==='T1').netMinutes,110)
  assert.equal(rows.find(row=>row.technicianId==='T2').netMinutes,45)
  assert.equal(order.operatorWorkByTechnician.T1.state,'finished')
  assert.equal(order.operatorWorkByTechnician.T2.state,'finished')
  assert.equal(context.orderPauseMinutes(order),70)
  assert.ok(order.pauseHistory.every(pause=>pause.end))
})

test('bir operatör beklerken diğeri çalışabilir; yalnızca kendi düğmeleri değişir', () => {
  const order = {technicianId:'T1',assignedTechnicians:['T1','T2'],additionalTechnicians:['T2'],assignmentMode:'selected',status:'Devam Ediyor',operatorWorkByTechnician:{T1:{start:'2026-10-12T08:00',state:'waiting',pauses:[{start:'2026-10-12T09:00',end:''}]},T2:{start:'2026-10-12T08:30',state:'active',pauses:[]}}}
  assert.equal(context.operatorCanStart(order,'T1'),true)
  assert.equal(context.operatorIsWorking(order,'T1'),false)
  assert.equal(context.operatorCanStart(order,'T2'),false)
  assert.equal(context.operatorIsWorking(order,'T2'),true)
  order.status='Beklemede'
  assert.equal(context.operatorIsWorking(order,'T2'),true)
  assert.equal(context.operatorIsWorking(order,'T1'),false)
  assert.match(app,/technicianId:workerId,start:now/)
})

test('atanmış ama henüz başlamamış kişiye işçilik süresi yazılmaz', () => {
  const order = {technicianId:'T1',assignedTechnicians:['T1','T2'],additionalTechnicians:['T2'],startTime:'2026-10-12T08:00',operatorWorkByTechnician:{T1:{start:'2026-10-12T08:00',state:'active',pauses:[]}},pauseHistory:[]}
  const rows = context.finishOperatorClocks(order,'2026-10-12T09:00')
  assert.equal(rows.length,1)
  assert.equal(rows[0].technicianId,'T1')
  assert.equal(order.operatorWorkByTechnician.T2,undefined)
})

test('arayüz ikinci kişiyi seçtirir, sunucu atamayı ve kişi saatlerini denetler', () => {
  assert.match(html,/id="operatorAddPersonModal"/)
  assert.match(app,/data-operator-action="add-person"/)
  assert.match(app,/checkOperatorCrewGuard/)
  assert.match(sql,/adding_person=.*additionalTechnicians/)
  assert.match(sql,/jsonb_set\(patched,'\{assignedTechnicians\}'/)
  assert.match(sql,/jsonb_array_length\(requested_extras\)<>jsonb_array_length\(current_extras\)\+1/)
  assert.match(sql,/Mevcut ekip üyesi atamadan çıkarılamaz/)
  assert.match(sql,/operatorWorkByTechnician/)
  assert.match(sql,/operator_crew_guard_v1/)
  assert.match(sql,/operator_shared_completion_guard_v2/)
  assert.match(sql,/jsonb_each\(case when jsonb_typeof\(patched->'startedAtByTechnician'\)/)
  assert.match(app,/operatorRequestWithTimeout\(cloud\.pushOperatorOrder\(o\)/)
  assert.match(app,/Ortak kapanış Supabase kaydında doğrulanamadı/)
  assert.doesNotMatch(sql,/\bkey text;/)
  assert.match(sql,/patch_field text;/)
})
