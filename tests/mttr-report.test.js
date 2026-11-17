const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

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

test('MTTR için personel süreleri toplanmaz, en uzun net süre seçilir', () => {
  const context = vm.createContext({
    managerLaborEntriesForOrder: () => [
      {technicianId:'T1',name:'Birinci Personel',start:'2026-01-10T08:00',finish:'2026-01-10T10:00',netMinutes:120},
      {technicianId:'T2',name:'İkinci Personel',start:'2026-01-10T08:30',finish:'2026-01-10T09:45',netMinutes:75},
    ],
    laborIntervalMetrics: () => ({netMinutes:0}),
    techById: () => ({name:'Atanmadı'}),
  })
  vm.runInContext(extractFunction('orderMttrLaborSummary'), context)
  vm.runInContext(extractFunction('orderLongestLaborNetMinutes'), context)

  const summary = context.orderMttrLaborSummary({technicianId:'T1'})
  assert.equal(summary.minutes, 120)
  assert.deepEqual([...summary.names], ['Birinci Personel'])
  assert.equal(context.orderLongestLaborNetMinutes({technicianId:'T1'}), 120)
})

test('iş emri saatleri değişince MTTR eski kayıtlı net süre yerine güncel süreyi kullanır', () => {
  const order = {
    technicianId:'T1',
    laborEntries:[{technicianId:'T1',name:'Birinci Personel',start:'2026-01-10T08:00',finish:'2026-01-10T09:15',netMinutes:75}],
    operatorWorkByTechnician:{T1:{start:'2026-01-10T08:00',finish:'2026-01-10T11:00',pauses:[]}},
  }
  const context = vm.createContext({
    workOrderParticipantIds: () => ['T1'],
    workOrderPersonTiming: () => ({technicianId:'T1',name:'Birinci Personel',start:'2026-01-10T08:00',finish:'2026-01-10T11:00',clock:order.operatorWorkByTechnician.T1,labor:order.laborEntries[0]}),
    orderPersonPauseWindows: () => [],
    operatorClockPauseMinutes: () => 0,
    techById: () => ({name:'Birinci Personel',hourlyRate:0}),
  })
  vm.runInContext(extractFunction('laborIntervalMetrics'), context)
  vm.runInContext(extractFunction('currentManagerLaborMetrics'), context)
  vm.runInContext(extractFunction('managerLaborEntriesForOrder'), context)
  vm.runInContext(extractFunction('orderMttrLaborSummary'), context)

  assert.equal(context.managerLaborEntriesForOrder(order)[0].netMinutes, 180)
  assert.equal(context.orderMttrLaborSummary(order).minutes, 180)
})

test('MTTR kapsamı yalnızca dahil seçili tamamlanan arızaları ve seçili ayı alır', () => {
  const orders = [
    {id:'A1',status:'Tamamlandı',type:'Arıza Bakım',includeInMttr:true,completionTime:'2026-01-10T10:00'},
    {id:'A2',status:'Tamamlandı',type:'Arıza Bakım',completionTime:'2026-01-20T10:00'},
    {id:'A3',status:'Tamamlandı',type:'Arıza Bakım',includeInMttr:false,completionTime:'2026-01-21T10:00'},
    {id:'A4',status:'Devam Ediyor',type:'Arıza Bakım',includeInMttr:true,completionTime:'2026-01-22T10:00'},
    {id:'A5',status:'Tamamlandı',type:'Planlı Bakım',includeInMttr:true,completionTime:'2026-01-23T10:00'},
    {id:'A6',status:'Tamamlandı',type:'Arıza Bakım',includeInMttr:true,completionTime:'2026-02-01T10:00'},
    {id:'A7',status:'Tamamlandı',type:'Arıza Bakım',includeInMttr:true,resolutionOpen:true,completionTime:'2026-01-25T10:00'},
  ]
  const context = vm.createContext({
    state:{orders},
    mttrReportPeriod:{year:'2026',month:'01'},
    reportFilters:{search:'',person:'',assetId:''},
    assetById: () => ({name:'Makine',code:'PT1'}),
    visibleWorkOrderNo: order => order.id,
    isWorkOrder: () => true,
    reportIsFailure: order => /arıza/i.test(order.type),
    orderResolutionOpen: order => order.resolutionOpen===true,
    reportOrderPeople: () => [],
  })
  vm.runInContext(extractFunction('mttrCompletionDate'), context)
  vm.runInContext(extractFunction('mttrScopeOrders'), context)

  assert.deepEqual([...context.mttrScopeOrders().map(order=>order.id)], ['A1','A2'])
  assert.deepEqual([...context.mttrScopeOrders({includeExcluded:true}).map(order=>order.id)], ['A1','A2','A3'])

  orders[0].includeInMttr = false
  orders[1].completionTime = '2026-02-20T10:00'
  assert.deepEqual([...context.mttrScopeOrders().map(order=>order.id)], [])
})

test('MTTR raporu yıllık ve aylık filtre, eğilim ve dışa aktarma içerir', () => {
  assert.match(html, /data-report-tab="mttr"[^>]*>MTTR Raporu</)
  assert.match(html, /id="mttrYearFilter"/)
  assert.match(html, /id="mttrMonthFilter"/)
  assert.match(html, /id="mttrMonthlyBars"/)
  assert.match(html, /MTTR = Σ \(iş emrindeki en uzun net personel süresi\)/)
  assert.match(app, /activeReportSection==='mttr'/)
  assert.match(app, /name='mttr-raporu'/)
  assert.match(app, /totalRepairMinutes=mttrFailures\.reduce\(\(sum,o\)=>sum\+orderLongestLaborNetMinutes\(o\)/)
  assert.match(app, /repairMinutes=mttrFailures\.reduce\(\(sum,order\)=>sum\+orderLongestLaborNetMinutes\(order\)/)
})

test('MTTR raporundaki süreler iki ondalıklı dakika olarak gösterilir', () => {
  const render = extractFunction('renderMttrReport')
  assert.match(render, /reportNumber\(mttrMinutes,2\).*dk/)
  assert.match(render, /reportNumber\(row\.mttrMinutes,2\)\+' dk'/)
  assert.match(render, /reportNumber\(row\.minutes,2\)/)
  assert.doesNotMatch(render, /mttrMinutes\/60|row\.mttrMinutes\/60|row\.minutes\/60/)
  const exportSection = app.slice(app.indexOf("activeReportSection==='mttr'"), app.indexOf("else{name='ariza-sayilari'"))
  assert.doesNotMatch(exportSection, /MTTR \(SA\)|MTTR Net Süre \(SA\)/)
})
