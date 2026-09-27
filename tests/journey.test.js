import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../api/index.js';

test('Richard and Kevin keep separate records; Svetlana decides and totals survive refresh',async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY,oldPublic=process.env.SUPABASE_PUBLISHABLE_KEY;
  Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'secret',SUPABASE_PUBLISHABLE_KEY:'public'});
  const sales=new Map(),expenses=new Map(),events=[];
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(String(url)),table=u.pathname.split('/').pop(),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    if(u.pathname.endsWith('/auth/v1/user')){const id=options.headers.Authorization.replace('Bearer ','');return Response.json({id,email:`${id}@example.org`});}
    if(table==='app_user_roles')return Response.json([{auth_user_id:u.searchParams.get('auth_user_id')?.slice(3),employee_id:u.searchParams.get('auth_user_id')?.slice(8),active:true}]);
    if(table==='telegram_links'||table==='practice_reset_backups')return Response.json([]);
    if(table==='sales'||table==='expenses'){
      const store=table==='sales'?sales:expenses,ref=u.searchParams.get('reference')?.slice(3);
      if(method==='POST'){if(store.has(body.reference))return Response.json({message:'duplicate key'},{status:409});const row={...body,submitted_at:'2026-09-27T12:00:00Z',sheet_row:store.size+2,sheet_sync_status:'Sync pending',sheet_sync_error:null,status:table==='sales'?'Pending approval':body.status};store.set(row.reference,row);return Response.json([row]);}
      if(method==='PATCH'){const row=store.get(ref);if(!row)return Response.json([]);if(u.searchParams.has('status')&&row.status!==(table==='sales'?'Pending approval':'Awaiting allocation'))return Response.json([]);Object.assign(row,body);return Response.json([row]);}
      return Response.json(ref?(store.has(ref)?[store.get(ref)]:[]):[...store.values()]);
    }
    if(table==='delivery_events'){if(method==='POST'){const prior=events.find(x=>x.transaction_type===body.transaction_type&&x.reference===body.reference&&x.event_type===body.event_type);if(prior)return Response.json([prior]);const row={...body,id:events.length+1,attempts:0};events.push(row);return Response.json([row]);}const id=u.searchParams.get('id')?.slice(3);return Response.json(id?events.filter(x=>x.id===Number(id)):events);}
    throw Error(`Unexpected request ${u}`);
  };
  const call=(path,token,body)=>handle(new Request(`http://localhost/api/${path}`,{method:body?'POST':'GET',headers:{cookie:`fi_access=user-${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}));
  try{
    const s=await call('sales','richard',{reference:'S90',customer:'Test guest',project:'A',description:'Practice',amount:'100.00',practice:true,split:{r:50,a:30,j:20}});assert.equal(s.status,201);
    const e=await call('expenses','kevin',{reference:'E90',description:'Practice prop',category:'Materials',amount:'20.00',allocation:'A',practice:true});assert.equal(e.status,201);
    assert.equal((await call('sales','kevin',{reference:'S91'})).status,403);
    const ownR=await (await call('state','richard')).json(),ownK=await (await call('state','kevin')).json();
    assert.deepEqual(ownR.sales.map(x=>x.reference),['S90']);assert.equal(ownR.expenses.length,0);
    assert.deepEqual(ownK.expenses.map(x=>x.reference),['E90']);assert.equal(ownK.sales.length,0);
    assert.equal((await call('sales','richard',{reference:'S90',customer:'Test guest',project:'A',description:'Practice',amount:'100.00',split:{r:50,a:30,j:20}})).status,409);
    assert.equal((await call('approve-sale','svetlana',{reference:'S90',split:{r:50,a:30,j:20}})).status,200);
    const refreshed=await (await call('state','svetlana')).json();
    assert.equal(refreshed.sales[0].status,'Approved');assert.equal(refreshed.dashboard.income,10000);assert.equal(refreshed.dashboard.commissionExpense,1000);assert.equal(refreshed.dashboard.totalExpenses,2000);assert.equal(refreshed.dashboard.companyResult,7000);
    assert.equal(refreshed.sales[0].is_practice,true);assert.equal(refreshed.expenses[0].is_practice,true);
  }finally{globalThis.fetch=oldFetch;for(const [name,value] of Object.entries({SUPABASE_URL:oldUrl,SUPABASE_SECRET_KEY:oldKey,SUPABASE_PUBLISHABLE_KEY:oldPublic})){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
