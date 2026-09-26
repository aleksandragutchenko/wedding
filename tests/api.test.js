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
