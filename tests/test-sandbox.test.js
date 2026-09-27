import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handle} from '../api/index.js';

function mockSandbox(){
  const oldFetch=globalThis.fetch,old={};
  for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET']){old[key]=process.env[key];}
  Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'secret',TELEGRAM_BOT_TOKEN:'bot-secret',TELEGRAM_WEBHOOK_SECRET:'hook-secret'});
  const tables=Object.fromEntries(['test_sessions','test_link_challenges','test_telegram_links','test_transactions','test_delivery_events'].map(k=>[k,[]]));
  const sent=[];let failNextTelegram=false,sequence=0;
  const hash=x=>createHash('sha256').update(x).digest('hex');
  const rows=(table,url)=>{
    let result=tables[table];
    for(const [key,value] of url.searchParams){
      if(['select','order','limit','on_conflict'].includes(key))continue;
      if(value.startsWith('eq.'))result=result.filter(r=>String(r[key])===value.slice(3));
      else if(value==='is.null')result=result.filter(r=>r[key]==null);
      else if(value.startsWith('gt.'))result=result.filter(r=>String(r[key])>value.slice(3));
      else if(value.startsWith('in.('))result=result.filter(r=>value.slice(4,-1).split(',').includes(String(r[key])));
    }
    if(url.searchParams.get('order')){const field=url.searchParams.get('order').split('.')[0];result=[...result].sort((a,b)=>String(a[field]).localeCompare(String(b[field])));if(url.searchParams.get('order').endsWith('.desc'))result.reverse();}
    if(url.searchParams.get('limit'))result=result.slice(0,Number(url.searchParams.get('limit')));
    return result;
  };
  globalThis.fetch=async(target,options={})=>{
    const url=new URL(String(target)),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    if(url.host==='api.telegram.org'){
      if(failNextTelegram){failNextTelegram=false;return Response.json({ok:false,description:'temporary outage'},{status:503});}
      sent.push(body);return Response.json({ok:true,result:{message_id:sent.length}});
    }
    if(url.pathname.endsWith('/rpc/claim_test_link_button')){
      const challenge=tables.test_link_challenges.find(x=>x.id===body.p_challenge_id);
      if(!challenge||challenge.used_at||challenge.expires_at<=new Date().toISOString())return Response.json({message:'This test link request has expired.'},{status:400});
      if(String(body.p_telegram_user_id)!==String(body.p_chat_id)||String(challenge.chat_id)!==String(body.p_chat_id))return Response.json({message:'Confirm only from the private chat.'},{status:400});
      challenge.used_at=new Date().toISOString();
      tables.test_telegram_links=tables.test_telegram_links.filter(x=>String(x.chat_id)!==String(body.p_chat_id));
      tables.test_telegram_links.push({telegram_user_id:body.p_chat_id,chat_id:body.p_chat_id,session_id:challenge.session_id,employee_id:challenge.employee_id,linked_at:new Date().toISOString()});
      return Response.json({employeeId:challenge.employee_id});
    }
    const table=url.pathname.split('/').pop();if(!tables[table])throw new Error(`Unexpected mock URL ${url}`);
    if(method==='GET')return Response.json(rows(table,url));
    if(method==='POST'){
      const values=Array.isArray(body)?body:[body],inserted=[];
      for(const value of values){
        if(table==='test_transactions'&&tables[table].some(x=>x.session_id===value.session_id&&x.reference===value.reference&&!x.reset_at))return Response.json({message:'duplicate key'},{status:409});
        if(table==='test_delivery_events'){
          const prior=tables[table].find(x=>x.transaction_id===value.transaction_id&&x.event_type===value.event_type);
          if(prior){if(options.headers?.Prefer?.includes('ignore-duplicates'))continue;return Response.json({message:'duplicate key'},{status:409});}
        }
        const row={...value,id:value.id||`00000000-0000-0000-0000-${String(++sequence).padStart(12,'0')}`,created_at:new Date().toISOString()};
        if(table==='test_sessions')row.expires_at=new Date(Date.now()+7*86400000).toISOString();
        if(table==='test_transactions'){row.submitted_at=new Date().toISOString();row.reset_at=null;}
        if(table==='test_delivery_events'){row.id=sequence;row.attempts=0;row.updated_at=new Date().toISOString();}
        tables[table].push(row);inserted.push(row);
      }
      return Response.json(inserted);
    }
    if(method==='PATCH'){const selected=rows(table,url);for(const row of selected)Object.assign(row,body);return Response.json(selected);}
    if(method==='DELETE'){const selected=rows(table,url);tables[table]=tables[table].filter(x=>!selected.includes(x));return Response.json([]);}
    throw Error(`Unexpected ${method} ${url}`);
  };
  const call=(path,body,cookie,headers={})=>handle(new Request(`http://localhost/api/${path}`,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)}));
  const start=async()=>{const response=await call('test/session',{});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  const confirm=(challengeId,chatId,fromId=chatId)=>call('telegram',{callback_query:{id:`callback-${sequence++}`,from:{id:fromId},message:{chat:{id:chatId,type:'private'}},data:`testlink:${challengeId}`}},undefined,{'x-telegram-bot-api-secret-token':'hook-secret'});
  const restore=()=>{globalThis.fetch=oldFetch;for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
  return {tables,sent,call,start,confirm,restore,hash,failTelegram(){failNextTelegram=true;}};
}

test('professor sandbox isolates sessions, verifies chats, keeps owners and supports recovery',async()=>{
  const m=mockSandbox();try{
    const a=await m.start(),b=await m.start();
    assert.equal((await m.call('test/state')).status,401);
    assert.equal((await m.call('test/sales',{employeeId:'richard',reference:'SX',customer:'X',project:'A',description:'X',amount:'1.00',split:{r:100,a:0,j:0}})).status,401);
    assert.equal((await m.call('test/reset',{confirm:'RESET'})).status,401);
    assert.equal((await m.call('approve-sale',{reference:'ST1',split:{r:100,a:0,j:0}},a)).status,401);
    assert.equal((await m.call('test/link/request',{employeeId:'richard',chatId:'not-a-number'},a)).status,400);
    const requested=await m.call('test/link/request',{employeeId:'richard',chatId:'12345678'},a);assert.equal(requested.status,200);
    assert.ok(!JSON.stringify(await requested.json()).includes('code:'));
    const challenge=m.sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];
    assert.equal((await m.call('test/link/status',undefined,a)).status,200);
    assert.equal((await m.confirm(challenge,99999999)).status,200);
    assert.equal(m.tables.test_telegram_links.length,0);
    assert.equal((await m.confirm(challenge,12345678)).status,200);
    assert.equal((await (await m.call('test/link/status',undefined,a)).json()).status,'verified');
    assert.equal((await m.confirm(challenge,12345678)).status,200);
    assert.equal(m.tables.test_telegram_links.length,1);
    assert.equal((await m.call('test/link/request',{employeeId:'richard',chatId:'87654321'},b)).status,200);
    const otherChallenge=m.sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];
    assert.equal((await m.confirm(otherChallenge,87654321)).status,200);
    const input={employeeId:'richard',reference:'ST1',customer:'Sample',project:'A',description:'Guests',amount:'100.00',split:{r:50,a:30,j:20}};
    assert.equal((await m.call('test/sales',{...input,customer:'Other tester'},b)).status,201);
    assert.equal((await m.call('test/sales',{...input,amount:'-1'},a)).status,400);
    assert.equal((await m.call('test/sales',{...input,split:{r:50,a:30,j:30}},a)).status,400);
    m.failTelegram();const created=await m.call('test/sales',input,a);assert.equal(created.status,201);
    let record=(await created.json()).record;assert.equal(record.employee_id,'richard');assert.equal(String(record.notification_chat_id),'12345678');
    assert.equal((await m.call('test/sales',input,a)).status,409);
    assert.equal((await m.call('test/decide',{reference:'ST1',split:{r:50,a:30,j:20}},b)).status,200);
    assert.equal((await (await m.call('test/state',undefined,a)).json()).records[0].status,'Pending approval');
    const ownEvent=m.tables.test_delivery_events.find(x=>x.session_id===m.tables.test_sessions[0].id);
    assert.equal((await m.call('test/retry',{eventId:ownEvent.id},b)).status,404);
    assert.equal((await m.call('test/state',undefined,b)).status,200);
    let state=await (await m.call('test/state',undefined,a)).json();assert.equal(state.records.length,1);assert.equal(state.events[0].status,'Delivery failed');
    assert.equal((await m.call('test/retry',{eventId:state.events[0].id},a)).status,200);
    state=await (await m.call('test/state',undefined,a)).json();assert.equal(state.events[0].status,'Delivered');
    const original=m.tables.test_transactions.find(x=>x.session_id===m.tables.test_sessions[0].id);assert.equal(original.employee_id,'richard');assert.equal(String(original.notification_chat_id),'12345678');
    m.tables.test_link_challenges[0].created_at='2020-01-01T00:00:00Z';
    const requested2=await m.call('test/link/request',{employeeId:'kevin',chatId:'12345678'},a);assert.equal(requested2.status,200);
    const challenge2=m.sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];assert.equal((await m.confirm(challenge2,12345678)).status,200);
    assert.equal((await m.call('test/decide',{reference:'ST1',split:{r:60,a:20,j:20}},a)).status,200);
    assert.equal(String(m.sent.at(-1).chat_id),'12345678');assert.match(m.sent.at(-1).text,/ST1 approved/);
    assert.equal((await m.call('test/decide',{reference:'ST1',split:{r:60,a:20,j:20}},a)).status,409);
    state=await (await m.call('test/state',undefined,a)).json();assert.equal(state.dashboard.income,10000);assert.equal(state.dashboard.commissionExpense,1000);assert.equal(state.dashboard.companyResult,9000);
    assert.equal(original.employee_id,'richard');assert.equal(String(original.notification_chat_id),'12345678');
    const expenseInput={employeeId:'kevin',reference:'ET1',description:'Costume',category:'Materials',amount:'25.00',allocation:'A'};
    const expense=await m.call('test/expenses',expenseInput,a);assert.equal(expense.status,201);
    assert.equal((await m.call('test/reset',{confirm:'RESET'},a)).status,200);
    state=await (await m.call('test/state',undefined,a)).json();assert.equal(state.records.length,0);
    assert.equal(m.tables.test_transactions.length,3);assert.equal((await (await m.call('test/state',undefined,b)).json()).records.length,1);
    assert.equal((await m.call('test/expenses',expenseInput,a)).status,201);
  }finally{m.restore();}
});

test('expired link, cross-site write, and repeated bot webhook are safe',async()=>{
  const m=mockSandbox();try{
    const cookie=await m.start();
    assert.equal((await m.call('test/sales',{employeeId:'richard'},cookie,{origin:'https://other.example'})).status,403);
    await m.call('test/link/request',{employeeId:'richard',chatId:'22222222'},cookie);
    const challenge=m.sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];m.tables.test_link_challenges[0].expires_at='2020-01-01T00:00:00Z';
    assert.equal((await m.confirm(challenge,22222222)).status,200);
    assert.equal((await (await m.call('test/link/status',undefined,cookie)).json()).status,'expired');
    m.tables.test_link_challenges[0].created_at='2020-01-01T00:00:00Z';
    await m.call('test/link/request',{employeeId:'richard',chatId:'22222222'},cookie);
    const fresh=m.sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];assert.equal((await m.confirm(fresh,22222222)).status,200);
    const update={update_id:17,message:{from:{id:22222222},chat:{id:22222222,type:'private'},text:'/sale STBOT | Sample | A | Guests | 100.00 | 50/30/20'}};
    for(let i=0;i<2;i++)assert.equal((await m.call('telegram',update,undefined,{'x-telegram-bot-api-secret-token':'hook-secret'})).status,200);
    assert.equal(m.tables.test_transactions.length,1);
    assert.equal(m.tables.test_delivery_events.length,1);
    assert.equal(m.tables.test_delivery_events[0].status,'Delivered');
    assert.equal((await m.call('test/state',undefined,cookie)).status,200);
  }finally{m.restore();}
});
