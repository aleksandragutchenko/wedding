import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {syncRecord,submitSale,deliver,approveSale} from '../lib/service.js';

test('sheet retry finds moved reference and converges after a transient failure',async()=>{
 const originalFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_SECRET_KEY','GOOGLE_SHEET_ID','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test',GOOGLE_SHEET_ID:'sheet',GOOGLE_SERVICE_ACCOUNT_EMAIL:'writer@example.com',GOOGLE_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'})});
 const record={reference:'S04',sheet_row:6,status:'Approved',submitted_at:'2026-01-01',salesperson_id:'richard',customer:'Test',project:'A',description:'Test',amount_cents:10000,proposed_r:100,proposed_a:0,proposed_j:0,final_r:100,final_a:0,final_j:0};
 const writes=[];let failOnce=true;
 globalThis.fetch=async(url,options={})=>{
  const target=String(url);
  if(target.includes('/token'))return Response.json({access_token:'test-token',expires_in:3600});
  if(target.includes('/rest/v1/sales')){
   if(options.method==='PATCH'){Object.assign(record,JSON.parse(options.body));return Response.json([record]);}
   return Response.json([record]);
  }
  if(target.includes('/values/Sales!A2%3AA'))return Response.json({values:[['S02'],['S01'],['S03'],['S04']]});
  if(target.includes('/values/')){const body=JSON.parse(options.body);writes.push({url:target,body});if(body.values[0][0]==='S04'&&failOnce){failOnce=false;return Response.json({message:'Transient Sheets outage'},{status:503});}return Response.json({updatedCells:17});}
  throw Error(`Unexpected request ${target}`);
 };
 try{
  await syncRecord('sale','S04');
  assert.equal(record.sheet_sync_status,'Sync failed');
  await syncRecord('sale','S04');
  assert.equal(record.sheet_row,5);
  assert.equal(record.sheet_sync_status,'Synced');
  assert.equal(writes.filter(x=>x.body.values[0][0]==='S04').length,2);
  assert.match(writes.find(x=>x.body.values[0][0]==='S04').url,/Sales!A5/);
 }finally{globalThis.fetch=originalFetch;for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});

test('identical Telegram retry returns existing sale without new side effects',async()=>{
 const originalFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
 process.env.SUPABASE_URL='https://db.example';process.env.SUPABASE_SECRET_KEY='test';
 const existing={reference:'S09',salesperson_id:'richard',customer:'C',project:'A',description:'D',amount_cents:10000,proposed_r:50,proposed_a:30,proposed_j:20,source:'telegram',origin_chat_id:123,status:'Pending approval'};
 let calls=0;
 globalThis.fetch=async(_url,options={})=>{calls++;return options.method==='POST'?Response.json({message:'duplicate key value violates unique constraint'},{status:409}):Response.json([existing]);};
 try{const result=await submitSale({reference:'S09',customer:'C',project:'A',description:'D',amount:'100',split:{r:50,a:30,j:20}},'richard','telegram',123);assert.deepEqual(result,existing);assert.equal(calls,2);}
 finally{globalThis.fetch=originalFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;}
});

test('concurrent Telegram delivery retries claim one send',async()=>{
 const oldFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_SECRET_KEY','TELEGRAM_BOT_TOKEN'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test',TELEGRAM_BOT_TOKEN:'test-token'});
 const event={id:1,status:'Delivery failed',chat_id:123,message:'Test notice',attempts:0};let sends=0;
 globalThis.fetch=async(url,options={})=>{
  const target=String(url);
  if(target.includes('/delivery_events')){
   if(options.method==='PATCH'){
    if(target.includes('status=in.')&&event.status!=='Delivery failed')return Response.json([]);
    Object.assign(event,JSON.parse(options.body));return Response.json([event]);
   }
   return Response.json([event]);
  }
  if(target.includes('/sendMessage')){sends++;return Response.json({ok:true,result:{message_id:1}});}
  throw Error(`Unexpected request ${target}`);
 };
 try{await Promise.all([deliver(1),deliver(1)]);assert.equal(sends,1);assert.equal(event.status,'Delivered');}
 finally{globalThis.fetch=oldFetch;for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});

test('a stale sending lease can be retried after a worker interruption',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY,oldToken=process.env.TELEGRAM_BOT_TOKEN;
 Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test',TELEGRAM_BOT_TOKEN:'test-token'});
 const event={id:5,status:'Delivery sending',chat_id:123,message:'Approval',attempts:1,updated_at:new Date(Date.now()-10*60*1000).toISOString()};let sends=0;
 globalThis.fetch=async(url,options={})=>{const target=String(url);if(target.includes('/delivery_events')){if(options.method==='PATCH'){Object.assign(event,JSON.parse(options.body));return Response.json([event]);}return Response.json([event]);}if(target.includes('/sendMessage')){sends++;return Response.json({ok:true,result:{message_id:1}});}throw Error(target);};
 try{const result=await deliver(5);assert.equal(result.status,'Delivered');assert.equal(sends,1);assert.equal(result.attempts,2);}finally{globalThis.fetch=oldFetch;for(const [k,v] of Object.entries({SUPABASE_URL:oldUrl,SUPABASE_SECRET_KEY:oldKey,TELEGRAM_BOT_TOKEN:oldToken})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('stale concurrent approval loses conditional database update',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
 process.env.SUPABASE_URL='https://db.example';process.env.SUPABASE_SECRET_KEY='test';
 let conditional=false;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='PATCH'){conditional=String(url).includes('status=eq.Pending%20approval');return Response.json([]);}
  return Response.json([{reference:'S05',status:'Pending approval'}]);
 };
 try{await assert.rejects(()=>approveSale('S05',{r:100,a:0,j:0},'svetlana'),{status:409});assert.equal(conditional,true);}
 finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;}
});

test('a decision keeps the sale original chat after that Telegram account is reassigned',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY,oldToken=process.env.TELEGRAM_BOT_TOKEN;
 Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test',TELEGRAM_BOT_TOKEN:'test-token'});
 const sale={reference:'S01',salesperson_id:'richard',notification_chat_id:123,origin_chat_id:123,status:'Pending approval',project:'A',amount_cents:100000,proposed_r:50,proposed_a:30,proposed_j:20,sheet_row:2};let event=null,recipient=null;
 globalThis.fetch=async(url,options={})=>{const target=String(url);if(target.includes('/telegram_links'))throw Error('Decision must not look up a current Telegram link');if(target.includes('/sales')){if(options.method==='PATCH')Object.assign(sale,JSON.parse(options.body));return Response.json([sale]);}if(target.includes('/delivery_events')){if(options.method==='POST'){event={...JSON.parse(options.body),id:1,attempts:0};return Response.json([event]);}if(options.method==='PATCH'){Object.assign(event,JSON.parse(options.body));return Response.json([event]);}return Response.json([event]);}if(target.includes('/sendMessage')){recipient=JSON.parse(options.body).chat_id;return Response.json({ok:true,result:{message_id:1}});}throw Error(target);};
 try{const result=await approveSale('S01',{r:50,a:30,j:20},'svetlana');assert.equal(result.status,'Approved');assert.equal(event.chat_id,123);assert.equal(recipient,123);}finally{globalThis.fetch=oldFetch;for(const [k,v] of Object.entries({SUPABASE_URL:oldUrl,SUPABASE_SECRET_KEY:oldKey,TELEGRAM_BOT_TOKEN:oldToken})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
