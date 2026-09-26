import test from 'node:test';
import assert from 'node:assert/strict';
import {saleInput,expenseInput,commissions,dashboard} from '../lib/rules.js';
const sale=(reference,project,amount,split,status='Approved')=>({reference,project,amount_cents:amount*100,status,final_r:split[0],final_a:split[1],final_j:split[2]});
const expense=(reference,amount,allocation,status='Allocated')=>({reference,amount_cents:amount*100,status,final_allocation:allocation});
test('Test 1 before and after manager decisions',()=>{
 const sales=[sale('S01','A',1000,[50,30,20],'Pending approval'),sale('S02','B',2000,[20,40,40],'Pending approval')];
 const expenses=[expense('E01',120,null,'Awaiting allocation'),expense('E02',80,null,'Awaiting allocation'),expense('E03',100,'Company overhead')];
 let d=dashboard(sales,expenses);assert.equal(d.companyResult,-30000);assert.equal(d.projects.A.result,0);assert.equal(d.projects.B.result,0);
 sales.forEach(s=>s.status='Approved');expenses[0].status=expenses[1].status='Allocated';expenses[0].final_allocation=expenses[1].final_allocation='A';
 d=dashboard(sales,expenses);assert.equal(d.projects.A.result,70000);assert.equal(d.projects.B.result,180000);assert.equal(d.companyResult,240000);assert.deepEqual(d.earned,{richard:9000,anastasia:11000,'jean-claude':10000});
});
test('Test 2 cumulative results leave S05 and E07 pending',()=>{
 const sales=[sale('S01','A',1000,[50,30,20]),sale('S02','B',2000,[20,40,40]),sale('S03','A',1500,[20,30,50]),sale('S04','B',800,[25,25,50]),sale('S05','B',600,[100,0,0],'Pending approval')];
 const expenses=[expense('E01',120,'A'),expense('E02',80,'A'),expense('E03',100,'Company overhead'),expense('E04',250,'B'),expense('E05',90,'B'),expense('E06',60,'Company overhead'),expense('E07',140,null,'Awaiting allocation')];
 const d=dashboard(sales,expenses);assert.equal(d.projects.A.result,205000);assert.equal(d.projects.B.result,218000);assert.equal(d.companyResult,393000);assert.equal(d.overhead,16000);assert.equal(d.awaiting,14000);assert.deepEqual(d.earned,{richard:14000,anastasia:17500,'jean-claude':21500});
});
test('validation refuses invalid amounts, splits and roles',()=>{
 const input={reference:'S01',customer:'Olivia',project:'A',description:'Guests',amount:'1000',split:{r:60,a:30,j:20}};
 assert.throws(()=>saleInput(input,'richard'),/total exactly 100/);
 input.split={r:50,a:30,j:20};assert.throws(()=>saleInput(input,'kevin'),/Only salespeople/);
 assert.throws(()=>expenseInput({reference:'E01',description:'Suits',category:'Materials',amount:'0',allocation:'A'},'kevin'),/greater than zero/);
 assert.throws(()=>expenseInput({reference:'E01',description:'Suits',category:'Materials',allocation:'A'},'kevin'),/positive euro amount/);
});
test('rounding difference goes to largest share then Richard on a tie',()=>{
 assert.deepEqual(commissions({status:'Approved',amount_cents:5,final_r:50,final_a:50,final_j:0}),{pool:1,r:0,a:1,j:0});
});
