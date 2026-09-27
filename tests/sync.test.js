import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {syncRecord,submitSale,deliver} from '../lib/service.js';

test('sheet retry finds existing reference after row movement and updates it once',async()=>{
 const originalFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_SECRET_KEY','GOOGLE_SHEET_ID','GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test',GOOGLE_SHEET_ID:'sheet',GOOGLE_SERVICE_ACCOUNT_EMAIL:'writer@example.com',GOOGLE_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'})});
 const record={reference:'S04',sheet_row:6,status:'Approved',submitted_at:'2026-01-01',salesperson_id:'richard',customer:'Test',project:'A',description:'Test',amount_cents:10000,proposed_r:100,proposed_a:0,proposed_j:0,final_r:100,final_a:0,final_j:0};
 const writes=[];
 globalThis.fetch=async(url,options={})=>{
  const target=String(url);
  if(target.includes('/token'))return Response.json({access_token:'test-token',expires_in:3600});
  if(target.includes('/rest/v1/sales')){
   if(options.method==='PATCH'){Object.assign(record,JSON.parse(options.body));return Response.json([record]);}
   return Response.json([record]);
  }
  if(target.includes('/values/Sales!A2%3AA'))return Response.json({values:[['S02'],['S01'],['S03'],['S04']]});
  if(target.includes('/values/')){writes.push({url:target,body:JSON.parse(options.body)});return Response.json({updatedCells:17});}
  throw Error(`Unexpected request ${target}`);
 };
 try{
  await syncRecord('sale','S04');
  assert.equal(record.sheet_row,5);
  assert.equal(record.sheet_sync_status,'Synced');
  assert.equal(writes.filter(x=>x.body.values[0][0]==='S04').length,1);
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

