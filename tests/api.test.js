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

