const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const technicians = {T1:{name:'Birinci Personel',hourlyRate:300},T2:{name:'İkinci Personel',hourlyRate:350}}
const context = vm.createContext({
  techById: id => technicians[id] || {name:'Atanmadı',hourlyRate:0},
  minutesBetween: (start, end) => start && end ? Math.max(0, Math.round((new Date(end)-new Date(start))/60000)) : 0,
  operatorClockPauseMinutes: clock => (clock?.pauses||[]).reduce((sum,pause)=>sum+(pause.start&&pause.end?Math.max(0,Math.round((new Date(pause.end)-new Date(pause.start))/60000)):0),0),
  manualFactoryScheduleOverlapMinutes: () => 0,
})
vm.runInContext(app.slice(app.indexOf('function operatorClock('), app.indexOf('function operatorCanAddPerson(')), context)
vm.runInContext(app.slice(app.indexOf('function validateManagerPersonTimes('), app.indexOf('function managerPauseEditorRow(')), context)

test('atanmış iki kişi, yalnızca bir işçilik satırı bulunsa da ayrı ayrı hazırlanır', () => {
  const order = {
    technicianId:'T1', assignedTechnicians:['T1','T2'], additionalTechnicians:['T2'],
    startTime:'2026-10-16T08:00', completionTime:'2026-10-16T12:00',
    operatorWorkByTechnician:{
      T1:{start:'2026-10-16T08:00',finish:'2026-10-16T12:00',pauses:[]},
      T2:{start:'2026-10-16T09:00',finish:'2026-10-16T11:30',pauses:[]},
    },
    laborEntries:[{technicianId:'T1',name:'Birinci Personel',start:'2026-10-16T08:00',finish:'2026-10-16T12:00'}],
  }
  const rows = context.managerLaborEntriesForOrder(order)
  assert.equal(rows.length, 2)
  assert.equal(rows.find(row=>row.technicianId==='T2').start, '2026-10-16T09:00')
  assert.equal(rows.find(row=>row.technicianId==='T2').finish, '2026-10-16T11:30')
})

test('kapanan işte her atanmış kişinin başlangıç ve bitişi zorunludur', () => {
  const error = context.validateManagerPersonTimes('Teyit Bekliyor', [
    {technicianId:'T1',name:'Birinci Personel',assigned:true,start:'2026-10-16T08:00',finish:'2026-10-16T12:00'},
    {technicianId:'T2',name:'İkinci Personel',assigned:true,start:'',finish:''},
  ])
  assert.match(error, /İkinci Personel/)
})

test('yönetici iki kişinin saatlerini ayrı kaydeder ve genel zaman aralığını hesaplar', () => {
  const order = {technicianId:'T1',status:'Teyit Bekliyor',pauseHistory:[{technicianId:'T1',start:'2026-10-16T09:00',end:'2026-10-16T09:15'},{technicianId:'T2',start:'2026-10-16T10:00',end:'2026-10-16T10:30'}],laborEntries:[],operatorWorkByTechnician:{},startedAtByTechnician:{}}
  context.applyManagerPersonTimes(order, [
    {technicianId:'T1',name:'Birinci Personel',assigned:true,start:'2026-10-16T08:00',finish:'2026-10-16T12:00'},
    {technicianId:'T2',name:'İkinci Personel',assigned:true,start:'2026-10-16T09:00',finish:'2026-10-16T13:00'},
  ])
  assert.equal(order.laborEntries.length, 2)
  assert.equal(order.startTime, '2026-10-16T08:00')
  assert.equal(order.completionTime, '2026-10-16T13:00')
  assert.equal(order.operatorWorkByTechnician.T2.finish, '2026-10-16T13:00')
  assert.equal(order.operatorWorkByTechnician.T1.pauses.length, 1)
  assert.equal(order.operatorWorkByTechnician.T2.pauses.length, 1)
  assert.equal(order.laborEntries.find(row=>row.technicianId==='T1').pauseMinutes, 15)
  assert.equal(order.laborEntries.find(row=>row.technicianId==='T2').pauseMinutes, 30)
})

test('maliyet onayında düzenlenen kişi saatleri operatör saatlerine de aktarılır', () => {
  const order = {operatorWorkByTechnician:{T1:{start:'2026-10-16T08:00',finish:'2026-10-16T12:00',pauses:[]}},startedAtByTechnician:{}}
  context.syncOperatorClocksFromLabor(order, [
    {technicianId:'T1',start:'2026-10-16T08:15',finish:'2026-10-16T12:15'},
    {technicianId:'T2',start:'2026-10-16T09:00',finish:'2026-10-16T13:00'},
  ])
  assert.equal(order.operatorWorkByTechnician.T1.start, '2026-10-16T08:15')
  assert.equal(order.operatorWorkByTechnician.T2.finish, '2026-10-16T13:00')
  assert.deepEqual([...order.startedTechnicians], ['T1','T2'])
})

test('ara verme seçeneklerinde başka işe geçme bulunur', () => {
  assert.match(html, /<option>Başka işe geçme<\/option>/)
})
