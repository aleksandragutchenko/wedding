import test from 'node:test';
import assert from 'node:assert/strict';
import {cents,split,dashboard} from '../lib/rules.js';

test('money accepts exact cents and rejects malformed, negative, zero and unsafe values',()=>{
 assert.equal(cents('120.05'),12005);
 for(const value of ['', '0', '-1', '1.234', '1,20', '€1.00', '999999999999999999999'])assert.throws(()=>cents(value));
});
test('splits require three bounded whole numbers totalling exactly 100',()=>{
 assert.deepEqual(split({r:'100',a:'0',j:'0'}),{r:100,a:0,j:0});
 for(const value of [{r:60,a:30,j:20},{r:-1,a:51,j:50},{r:50.5,a:49.5,j:0},{r:101,a:0,j:0},{r:'',a:50,j:50}])assert.throws(()=>split(value));
});
test('pending sale excluded and awaiting expense reduces company but not project result',()=>{
 const result=dashboard([{status:'Pending approval',project:'A',amount_cents:100000}], [{status:'Awaiting allocation',amount_cents:14000}]);
 assert.equal(result.income,0);assert.equal(result.awaiting,14000);assert.equal(result.companyResult,-14000);assert.equal(result.projects.A.result,0);
});
