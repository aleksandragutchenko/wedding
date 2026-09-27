import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../api/index.js';

async function post(path,body){return handle(new Request(`http://localhost/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}
test('processing layer rejects a sale from Kevin before database access',async()=>{
 const response=await post('sales',{role:'kevin',reference:'S99',customer:'Test',project:'A',description:'Test',amount:'100',split:{r:50,a:30,j:20}});
 assert.equal(response.status,403);assert.match((await response.json()).error,/Only salespeople/);
});
test('processing layer rejects approval from Richard before database access',async()=>{
 const response=await post('approve-sale',{role:'richard',reference:'S01',split:{r:50,a:30,j:20}});
 assert.equal(response.status,403);assert.match((await response.json()).error,/Only Svetlana/);
});
test('processing layer rejects a sale with invalid split',async()=>{
 const response=await post('sales',{role:'richard',reference:'S99',customer:'Test',project:'A',description:'Test',amount:'100',split:{r:60,a:30,j:20}});
 assert.equal(response.status,400);assert.match((await response.json()).error,/total exactly 100/);
});
test('manager state and every manager mutation require a signed session',async()=>{
 const old=process.env.MANAGER_ACCESS_CODE;process.env.MANAGER_ACCESS_CODE='a-long-private-test-code';
 try{
  const state=await handle(new Request('http://localhost/api/state?role=svetlana'));
  assert.equal(state.status,401);
  for(const path of ['connect-telegram','approve-sale','allocate-expense','link-telegram','retry-sheet','retry-delivery']){
   const response=await post(path,{role:'svetlana'});
   assert.equal(response.status,401,path);
  }
  assert.equal((await post('manager-login',{code:'wrong'})).status,401);
  const login=await post('manager-login',{code:'a-long-private-test-code'});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const origin=new Request('http://localhost/api/approve-sale',{method:'POST',headers:{cookie,origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify({role:'svetlana'})});
  assert.equal((await handle(origin)).status,403);
  const employee=new Request('http://localhost/api/approve-sale',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({role:'richard'})});
  assert.equal((await handle(employee)).status,403);
 }finally{if(old===undefined)delete process.env.MANAGER_ACCESS_CODE;else process.env.MANAGER_ACCESS_CODE=old;}
});

test('bare Telegram sale and expense commands return their formats',async()=>{
 const originalFetch=globalThis.fetch;
 const originalToken=process.env.TELEGRAM_BOT_TOKEN;
 const originalSecret=process.env.TELEGRAM_WEBHOOK_SECRET;
 const sent=[];
 process.env.TELEGRAM_BOT_TOKEN='test-token';
 process.env.TELEGRAM_WEBHOOK_SECRET='test-secret';
 globalThis.fetch=async(_url,options)=>{
  sent.push(JSON.parse(options.body));
  return Response.json({ok:true,result:{}});
 };
 try{
  for(const command of ['/sale','/expense','/sale@weddiing_hire_task_bot']){
   const request=new Request('http://localhost/api/telegram',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({message:{from:{id:123},chat:{id:123,type:'private'},text:command}})});
   const response=await handle(request);
   assert.equal(response.status,200);
  }
  assert.match(sent[0].text,/\/sale S06/);
  assert.match(sent[1].text,/\/expense E08/);
  assert.match(sent[2].text,/\/sale S06/);
  assert.ok(sent.every(message=>!message.text.includes('Unknown command')));
 }finally{
  globalThis.fetch=originalFetch;
  if(originalToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=originalToken;
  if(originalSecret===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=originalSecret;
 }
});

