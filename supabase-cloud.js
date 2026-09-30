(function(){
  const config=window.POLAT_BAKIM_CONFIG||{};
  const configured=Boolean(config.supabaseUrl&&config.supabasePublishableKey);
  let client=null,profile=null,version=0,syncReady=false,saveTimer=null,activeSaves=0,subscription=null,initializing=null;
  const listeners=new Set();

  function emit(status,detail={}){
    const payload={status,configured,profile,version,...detail};
    listeners.forEach(fn=>{try{fn(payload)}catch{}});
    window.dispatchEvent(new CustomEvent('polat-cloud-status',{detail:payload}));
  }
  async function init(){
    if(initializing)return initializing;
    initializing=(async()=>{
      if(!configured||config.syncEnabled===false){emit('local');return false}
      try{
        const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        client=createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
        client.auth.onAuthStateChange((_event,session)=>{if(!session){profile=null;syncReady=false;stopRealtime();emit('signed-out')}});
        const {data}=await client.auth.getSession();
        if(data.session)await loadProfile();else emit('signed-out');
        return true
      }catch(error){emit('error',{message:error.message});return false}
    })();
    return initializing
  }
  async function loadProfile(){
    const {data:{user}}=await client.auth.getUser();
    if(!user){profile=null;emit('signed-out');return null}
    const {data,error}=await client.from('profiles').select('id,email,full_name,role,technician_id,active,manager_access,operator_access,is_admin,must_change_password,visible_pages,delete_permissions,specialty,phone,hourly_rate').eq('id',user.id).single();
    if(error)throw error;profile=data;emit('ready');return profile
  }
  async function signIn(email,password){
    await init();if(!client)throw new Error('Supabase bağlantısı henüz yapılandırılmamış.');
    const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
    await loadProfile();if(!profile?.active||!profile?.manager_access){await signOut();throw new Error('Bu hesap için yönetici girişi açık değil.');}
    if(profile.must_change_password)stopRealtime();else await startRealtime();return profile
  }
  async function signInOperator(technicianId,password){
    await init();if(!client)throw new Error('Supabase bağlantısı henüz yapılandırılmamış.');
    const domain=config.operatorEmailDomain||'operators.polat.local',email=`${String(technicianId).toLocaleLowerCase('en-US')}@${domain}`;
    const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
    await loadProfile();if(!profile?.active||!profile?.operator_access||String(profile.technician_id)!==String(technicianId)){await signOut();throw new Error('Supabase operatör hesabı seçilen personelle eşleşmiyor.');}
    if(profile.must_change_password)stopRealtime();else await startRealtime();return profile
  }
  async function signInOperatorEmail(email,password){
    await init();if(!client)throw new Error('Supabase bağlantısı yapılandırılmamış.');
    const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
    await loadProfile();if(!profile?.active||!profile?.operator_access||!profile.technician_id){await signOut();throw new Error('Bu hesap için operatör girişi açık değil.');}
    if(profile.must_change_password)stopRealtime();else await startRealtime();return profile
  }
  async function listProfiles(){
    await init();if(!client||!profile?.manager_access)return[];
    const {data,error}=await client.from('profiles').select('id,email,full_name,role,technician_id,active,manager_access,operator_access,is_admin,must_change_password,visible_pages,delete_permissions,specialty,phone,hourly_rate').order('full_name');
    if(error)throw error;return data||[]
  }
  async function callManageUser(payload){
    const {data,error}=await client.functions.invoke('manage-user',{body:payload});
    if(error){let message=error.message;try{const body=await error.context?.json();message=body?.error||message}catch{}throw new Error(message)}
    if(data?.error)throw new Error(data.error);return data
  }
  async function manageUser(payload){
    await init();if(!client||!profile?.is_admin)throw new Error('Admin Yönetici yetkisi gerekir.');
    return callManageUser(payload)
  }
  async function changeOwnPassword(currentPassword,newPassword){
    await init();if(!client||!profile?.must_change_password)throw new Error('İlk giriş şifresi değiştirme işlemi beklenmiyor.');
    const result=await callManageUser({action:'change-own-password',currentPassword,newPassword});
    await loadProfile();return result
  }
  async function uploadLayout(file){
    if(!client||!profile?.manager_access)throw new Error('Yönetici girişi gerekir.');
    const path=`scada/main-${crypto.randomUUID()}.pdf`;
    const {error}=await client.storage.from('maintenance-attachments').upload(path,file,{contentType:'application/pdf',upsert:false});
    if(error)throw error;return path
  }
  async function downloadLayout(path){
    if(!client||!profile?.manager_access)throw new Error('Yönetici girişi gerekir.');
    const {data,error}=await client.storage.from('maintenance-attachments').download(path);
    if(error)throw error;return data
  }
  async function deleteLayout(path){
    if(!client||!profile?.manager_access)throw new Error('Yönetici girişi gerekir.');
    const {error}=await client.storage.from('maintenance-attachments').remove([path]);if(error)throw error
  }
  async function signOut(){if(client)await client.auth.signOut();profile=null;syncReady=false;stopRealtime();emit('signed-out')}
  async function pullState(){
    await init();if(!client||!profile?.manager_access)return null;
    emit('syncing');
    const {data,error}=await client.from('app_snapshots').select('payload,version,updated_at').eq('id',config.workspaceId||'polat-bakim-main').maybeSingle();
    if(error)throw error;if(!data){version=0;syncReady=true;emit('empty');return null}
    version=Number(data.version||0);syncReady=true;emit('synced',{updatedAt:data.updated_at});return data.payload
  }
  async function pushState(payload,expectedVersion=version){
    await init();if(!client||!profile?.manager_access)return null;
    emit('syncing');
    const {data,error}=await client.rpc('save_app_snapshot',{p_id:config.workspaceId||'polat-bakim-main',p_payload:payload,p_expected_version:expectedVersion});
    if(error)throw error;version=Number(data?.version??data?.[0]?.version??version+1);syncReady=true;emit('synced',{updatedAt:new Date().toISOString()});return data
  }
  async function pullOperatorState(){
    await init();if(!client||!profile?.operator_access)return null;emit('syncing');
    const workspace=config.workspaceId||'polat-bakim-main';
    const [{data,error},{data:eventRow,error:eventError}]=await Promise.all([client.rpc('get_operator_snapshot',{p_id:workspace}),client.from('app_sync_events').select('version,updated_at').eq('id',workspace).maybeSingle()]);
    if(error)throw error;if(eventError)throw eventError;version=Number(eventRow?.version||0);syncReady=true;emit('synced',{updatedAt:eventRow?.updated_at});return data
  }
  async function pushOperatorOrder(order){
    if(!client||!profile?.operator_access||!order?.id)return null;emit('syncing');
    const {data,error}=await client.rpc('update_operator_order',{p_id:config.workspaceId||'polat-bakim-main',p_order_id:order.id,p_patch:order});
    if(error)throw error;version=Number(data||version+1);emit('synced',{updatedAt:new Date().toISOString()});return data
  }
  function queueState(payload){
    if(!configured||config.syncEnabled===false||!profile?.manager_access||!syncReady)return;
    clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;activeSaves++;pushState(payload).catch(error=>emit('error',{message:error.message})).finally(()=>{activeSaves--})},900)
  }
  async function startRealtime(onRemote){
    if(!client||!profile)return;stopRealtime();
    subscription=client.channel('polat-bakim-sync').on('postgres_changes',{event:'*',schema:'public',table:'app_sync_events',filter:`id=eq.${config.workspaceId||'polat-bakim-main'}`},async payload=>{
      const next=payload.new;if(Number(next?.version||0)<=version)return;
      try{const remote=profile?.manager_access?await pullState():await pullOperatorState();if(remote)onRemote?.(remote);emit('synced',{updatedAt:next.updated_at,remote:true})}catch(error){emit('error',{message:error.message})}
    }).subscribe()
  }
  function stopRealtime(){if(client&&subscription)client.removeChannel(subscription);subscription=null}
  function onStatus(fn){listeners.add(fn);return()=>listeners.delete(fn)}
  function getInfo(){return{configured,connected:Boolean(client&&profile),profile,version,syncReady,pendingSave:Boolean(saveTimer)||activeSaves>0}}

  window.PolatBakimCloud={configured,init,signIn,signInOperator,signInOperatorEmail,listProfiles,manageUser,changeOwnPassword,uploadLayout,downloadLayout,deleteLayout,signOut,pullState,pullOperatorState,pushState,pushOperatorOrder,queueState,startRealtime,onStatus,getInfo};
})();
