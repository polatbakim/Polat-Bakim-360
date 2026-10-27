const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'open-work-orders.sql'), 'utf8')
const logic = app.slice(app.indexOf('function orderAssignedToTechnician('), app.indexOf('function assignmentFromForm('))
const context = vm.createContext({isActive: order => ['Atandı','Devam Ediyor','Beklemede','Teyit Bekliyor'].includes(order.status),techById: () => ({name:'Operatör'})})
vm.runInContext(logic, context)

test('herkese açık iş ilk iki operatörde görünür, üçüncüye kapanır', () => {
  const order = {assignmentMode:'all',status:'Atandı',claimedTechnicians:[],startedTechnicians:[],startTime:''}
  for(const id of ['T1','T2','T3']){
    assert.equal(context.operatorCanSeeOrder(order,id),true)
    assert.equal(context.operatorCanStart(order,id),true)
  }
  order.status='Devam Ediyor'
  order.claimedTechnicians=['T1']
  order.startedTechnicians=['T1']
  order.technicianId='T1'
  order.startTime='2026-10-06T08:00'
  assert.equal(context.operatorCanSeeOrder(order,'T2'),true)
  assert.equal(context.operatorCanStart(order,'T2'),true)
  order.claimedTechnicians.push('T2')
  order.startedTechnicians.push('T2')
  order.additionalTechnicians=['T2']
  assert.equal(context.operatorCanSeeOrder(order,'T3'),false)
  assert.equal(context.operatorCanSeeOrder(order,'T1'),true)
  assert.equal(context.operatorCanSeeOrder(order,'T2'),true)
  order.status='Beklemede'
  assert.equal(context.operatorCanStart(order,'T1'),true)
  assert.equal(context.operatorCanStart(order,'T3'),false)
  order.status='Teyit Bekliyor'
  order.claimedTechnicians=[]
  assert.equal(context.operatorCanSeeOrder(order,'T1'),true)
  assert.equal(context.operatorCanSeeOrder(order,'T2'),true)
})

test('Supabase açık işi gönderir, ilk iki sahiplenmeyi sunucuda atomik kaydeder', () => {
  assert.match(sql,/create or replace function public\.operator_can_view_order/)
  assert.match(sql,/if public\.operator_can_view_order\(item,tid\) then/)
  assert.match(sql,/jsonb_array_length\(claims\)<2/)
  assert.match(sql,/from public\.app_snapshots where id=p_id for update/)
  assert.match(sql,/claims=claims\|\|to_jsonb\(tid\)/)
  assert.match(sql,/patched=jsonb_set\(patched,'\{claimedTechnicians\}',claims,true\)/)
  assert.match(sql,/patched=jsonb_set\(patched,'\{startedTechnicians\}',starts,true\)/)
  assert.match(sql,/if joining and .*startTime/s)
})

test('işe başlama ancak Supabase üstlenmeyi kaydedince başarılı gösterilir', async () => {
  const start = app.indexOf('async function startOperatorOrder(')
  const end = app.indexOf('function openSafetyConfirmModal(', start)
  const order = {id:'WO-1',assignmentMode:'all',status:'Atandı',claimedTechnicians:[],startedTechnicians:[],startTime:'',pauseHistory:[],events:[]}
  const messages = []
  let resolvePush
  const cloud = {
    getInfo: () => ({connected:true}),
    pushOperatorOrder: () => new Promise(resolve => {resolvePush = resolve}),
    pullOperatorState: async () => ({orders:[order]}),
  }
  const testContext = vm.createContext({
    state: {orders:[order],activities:[]}, operatorTechId:'T1', PRODUCTION_MODE:true,
    window: {PolatBakimCloud:cloud},operatorOrderBaseline:new Map(),
    operatorCanStart:() => true,orderAssignedToTechnician:() => false,
    operatorIsWaiting:() => false,
    currentLocalDateTime:() => '2026-10-06T08:00',techById:() => ({name:'Operatör'}),
    appendOrderEvent:() => {},addActivity:() => {},renderAll:() => {},
    applyCloudState:() => {},renderCloudStatus:() => {},toast:message => messages.push(message),
  })
  vm.runInContext(app.slice(start,end),testContext)
  const pending = testContext.startOperatorOrder('WO-1',{areaSecured:true})
  assert.deepEqual(messages,[])
  assert.equal(order.claimedTechnicians[0],'T1')
  assert.equal(order.startedAtByTechnician.T1,'2026-10-06T08:00')
  resolvePush()
  await pending
  assert.match(messages[0],/iş başlatıldı/)
})
