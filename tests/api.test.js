import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../api/index.js';

const base='http://localhost/api/';
const req=(path,body,token)=>new Request(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{cookie:`fi_access=${token}`}:{})},body:body?JSON.stringify(body):undefined});
const saved={};
function mock(){
  for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY']){saved[key]=process.env[key];}
  Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'secret',SUPABASE_PUBLISHABLE_KEY:'public'});
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options={})=>{
    const u=String(url),bearer=options.headers?.Authorization?.replace('Bearer ','');calls.push({url:u,options});
    if(u.endsWith('/auth/v1/user'))return bearer?.startsWith('user-')?Response.json({id:bearer,email:`${bearer}@example.org`}):Response.json({message:'bad token'},{status:401});
    if(u.includes('/auth/v1/otp'))return Response.json({});
    if(u.includes('/auth/v1/verify'))return Response.json({access_token:'user-richard',refresh_token:'refresh-token',expires_in:3600});
    if(u.includes('/rest/v1/app_user_roles')){const id=new URL(u).searchParams.get('auth_user_id')?.slice(3);return Response.json(id&&id!=='user-inactive'?[{auth_user_id:id,employee_id:id.replace('user-',''),active:true}]:[]);}
    if(u.includes('/rest/v1/sales'))return Response.json([{reference:'S01',salesperson_id:'richard',status:'Pending approval',submitted_at:'2026-09-26T00:00:00Z',amount_cents:100000}]);
    if(u.includes('/rest/v1/expenses'))return Response.json([{reference:'E01',reporter_id:'kevin',status:'Awaiting allocation',submitted_at:'2026-09-26T00:00:00Z',amount_cents:12000}]);
    if(u.includes('/rest/v1/delivery_events')||u.includes('/rest/v1/telegram_links')||u.includes('/rest/v1/practice_reset_backups'))return Response.json([]);
    throw Error(`Unexpected fetch ${u}`);
  };
  return {calls,restore(){globalThis.fetch=old;for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}};
}

test('anonymous and forged roles cannot access state or manager mutations',async()=>{
  const m=mock();try{
    assert.equal((await handle(req('state?role=svetlana'))).status,401);
    for(const path of ['approve-sale','allocate-expense','retry-sheet','retry-delivery','access/assign','access/revoke','telegram/unlink-user','practice/mark','reset/execute'])assert.equal((await handle(req(path,{role:'svetlana'}))).status,401,path);
    for(const role of ['richard','anastasia','jean-claude','kevin'])for(const path of ['approve-sale','allocate-expense','retry-sheet','retry-delivery','access/assign','access/revoke','telegram/unlink-user','practice/mark','reset/execute'])assert.equal((await handle(req(path,{role:'svetlana'},`user-${role}`))).status,403,`${role} ${path}`);
  }finally{m.restore();}
});
test('verified account decides role; employee views only own records',async()=>{
  const m=mock();try{
    const sale=await handle(req('sales',{role:'richard',reference:'S99',customer:'T',project:'A',description:'T',amount:'1.00',split:{r:100,a:0,j:0}},'user-kevin'));
    assert.equal(sale.status,403);
    const invalid=await handle(req('sales',{reference:'S99',customer:'T',project:'A',description:'T',amount:'1.00',split:{r:60,a:30,j:20}},'user-richard'));
    assert.equal(invalid.status,400);
    const richard=await (await handle(req('state?role=svetlana',undefined,'user-richard'))).json();
    assert.deepEqual(richard.sales.map(x=>x.reference),['S01']);assert.equal(richard.expenses.length,0);assert.equal(richard.dashboard,null);
    const kevin=await (await handle(req('state',undefined,'user-kevin'))).json();
    assert.equal(kevin.sales.length,0);assert.deepEqual(kevin.expenses.map(x=>x.reference),['E01']);
    assert.equal((await handle(req('state',undefined,'user-inactive'))).status,403);
  }finally{m.restore();}
});
test('OTP does not create accounts and session cookie is HttpOnly',async()=>{
  const m=mock();try{
    const sent=await handle(req('auth/request-otp',{email:'richard@example.org'}));assert.equal(sent.status,200);
    assert.equal(JSON.parse(m.calls.find(x=>x.url.endsWith('/auth/v1/otp')).options.body).create_user,false);
    const verified=await handle(req('auth/verify-otp',{email:'richard@example.org',token:'123456'}));assert.equal(verified.status,200);
    assert.match(verified.headers.get('set-cookie'),/HttpOnly/);assert.equal((await verified.json()).employeeId,'richard');
  }finally{m.restore();}
});
test('manager access is accepted but malformed decision is rejected before mutation',async()=>{
  const m=mock();try{const response=await handle(req('approve-sale',{reference:'S01',split:{r:60,a:30,j:20}},'user-svetlana'));assert.equal(response.status,400);assert.match((await response.json()).error,/100%/);assert.equal((await handle(req('access/assign',{email:'other@example.org',employeeId:'svetlana'},'user-svetlana'))).status,400);}finally{m.restore();}
});
test('existing homework records cannot be selected for practice reset',async()=>{
  const m=mock();try{const response=await handle(req('reset/preview',{references:['S01']},'user-svetlana'));assert.equal(response.status,400);assert.match((await response.json()).error,/practice/);}finally{m.restore();}
});
test('bare Telegram commands show formats',async()=>{
  const old=globalThis.fetch,oldToken=process.env.TELEGRAM_BOT_TOKEN,oldSecret=process.env.TELEGRAM_WEBHOOK_SECRET,sent=[];
  process.env.TELEGRAM_BOT_TOKEN='test';process.env.TELEGRAM_WEBHOOK_SECRET='hook';
  globalThis.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{}});};
  try{for(const command of ['/sale','/expense','/help']){const response=await handle(new Request(base+'telegram',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'hook'},body:JSON.stringify({message:{from:{id:123},chat:{id:123,type:'private'},text:command}})}));assert.equal(response.status,200);}assert.match(sent[0].text,/\/sale S06/);assert.match(sent[1].text,/\/expense E08/);assert.match(sent[2].text,/\/link CODE/);}finally{globalThis.fetch=old;if(oldToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=oldToken;if(oldSecret===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=oldSecret;}
});
test('Telegram link accepts only matching private IDs and passes a hash, not the code',async()=>{
  const old=globalThis.fetch,token=process.env.TELEGRAM_BOT_TOKEN,secret=process.env.TELEGRAM_WEBHOOK_SECRET,url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'hook',SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'secret'});
  const calls=[],code='1234567890abcdef';let used=false;
  globalThis.fetch=async(target,options)=>{const u=String(target);if(u.includes('/rpc/claim_telegram_link')){const body=JSON.parse(options.body);calls.push(body);if(used)return Response.json({message:'already used'},{status:400});used=true;return Response.json({employee_name:'Richard'});}if(u.includes('/sendMessage'))return Response.json({ok:true,result:{}});throw Error(u);};
  const send=(chat)=>handle(new Request(base+'telegram',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'hook'},body:JSON.stringify({message:{from:{id:123},chat:{id:chat,type:'private'},text:`/link ${code}`}})}));
  try{assert.equal((await send(999)).status,200);assert.equal(calls.length,0);assert.equal((await send(123)).status,200);assert.equal(calls.length,1);assert.notEqual(calls[0].p_code_hash,code);assert.equal(calls[0].p_chat_id,'123');assert.equal((await send(123)).status,200);assert.equal(calls.length,2);}finally{globalThis.fetch=old;for(const [name,value] of Object.entries({TELEGRAM_BOT_TOKEN:token,TELEGRAM_WEBHOOK_SECRET:secret,SUPABASE_URL:url,SUPABASE_SECRET_KEY:key})){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
