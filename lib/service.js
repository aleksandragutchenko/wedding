import {db,one,byRef,sheetUpdate,sheetReferences,telegram} from './integrations.js';
import {InputError,EMPLOYEES,SALESPEOPLE,saleInput,expenseInput,split,commissions,dashboard,money} from './rules.js';

const saleHeaders=['Reference','Submission time','Salesperson','Customer','Project','Description','Amount EUR','Original Richard %','Original Anastasia %','Original Jean-Claude %','Approved Richard %','Approved Anastasia %','Approved Jean-Claude %','Richard earned EUR','Anastasia earned EUR','Jean-Claude earned EUR','Status','Record state'];
const expenseHeaders=['Reference','Submission time','Reporter','Description','Category','Amount EUR','Proposed allocation','Final allocation','Status','Record state'];
const euro=c=>(c/100).toFixed(2);
const errorMessage=e=>String(e?.message||e).slice(0,500);
async function patch(table,query,body){return db(table,{method:'PATCH',query,body,prefer:'return=representation'});}
async function enqueue(type,reference,eventType,chatId,message){
  const event={transaction_type:type,reference,event_type:eventType,chat_id:chatId||null,message,status:chatId?'Delivery pending':'No Telegram recipient linked'};
  const rows=await db('delivery_events',{method:'POST',query:'on_conflict=transaction_type,reference,event_type',body:event,prefer:'resolution=merge-duplicates,return=representation'});
  return rows[0];
}
export async function syncRecord(type,reference,{fail=false}={}){
  const table=type==='sale'?'sales':'expenses',record=await one(table,reference);
  if(!record)throw new InputError('Transaction not found.',404);
  try{
    if(fail)throw new Error('Simulated interrupted Sheets update');
    const tab=type==='sale'?'Sales':'Expenses';
    const refs=await sheetReferences(tab);
    const matches=refs.flatMap((cells,index)=>cells[0]===reference?[index+2]:[]);
    if(matches.length>1)throw new Error(`Duplicate ${reference} rows in ${tab}; repair the Sheet before retrying.`);
    const row=matches[0]??record.sheet_row;
    if(!matches.length&&refs[row-2]?.[0])throw new Error(`${tab} row ${row} contains another reference; refusing to overwrite it.`);
    if(type==='sale'){
      const c=commissions(record);
      await sheetUpdate('Sales',1,saleHeaders);
      await sheetUpdate('Sales',row,[record.reference,record.submitted_at,EMPLOYEES[record.salesperson_id],record.customer,record.project,record.description,euro(record.amount_cents),record.proposed_r,record.proposed_a,record.proposed_j,record.final_r??'',record.final_a??'',record.final_j??'',euro(c.r),euro(c.a),euro(c.j),record.status,record.archived_at?'Archived practice':'Active']);
    }else{
      await sheetUpdate('Expenses',1,expenseHeaders);
      await sheetUpdate('Expenses',row,[record.reference,record.submitted_at,EMPLOYEES[record.reporter_id],record.description,record.category,euro(record.amount_cents),record.proposed_allocation,record.final_allocation??'',record.status,record.archived_at?'Archived practice':'Active']);
    }
    await patch(table,byRef(reference),{sheet_row:row,sheet_sync_status:'Synced',sheet_sync_error:null});
  }catch(e){await patch(table,byRef(reference),{sheet_sync_status:'Sync failed',sheet_sync_error:errorMessage(e)});}
  return one(table,reference);
}
export async function deliver(eventId,{fail=false}={}){
  const rows=await db('delivery_events',{query:`id=eq.${Number(eventId)}`});let event=rows[0];
  if(!event)throw new InputError('Delivery event not found.',404);
  if(event.status==='Delivered'||!event.chat_id)return event;
  if(event.status==='Delivery sending'){
    const stale=Date.now()-new Date(event.updated_at).getTime()>5*60*1000;
    if(!stale)return event;
    const recovered=await patch('delivery_events',`id=eq.${event.id}&status=eq.Delivery%20sending&updated_at=eq.${encodeURIComponent(event.updated_at)}`,{status:'Delivery failed',error:'Previous send timed out. Retry may duplicate a message Telegram accepted.',updated_at:new Date().toISOString()});
    if(!recovered.length)return (await db('delivery_events',{query:`id=eq.${event.id}`}))[0];
    event=recovered[0];
  }
  const claimed=await patch('delivery_events',`id=eq.${event.id}&status=in.(Delivery%20pending,Delivery%20failed)`,{status:'Delivery sending',error:null,attempts:event.attempts+1,updated_at:new Date().toISOString()});
  if(claimed.length!==1)return (await db('delivery_events',{query:`id=eq.${event.id}`}))[0];
  try{
    if(fail)throw new Error('Simulated Telegram delivery failure');
    await telegram('sendMessage',{chat_id:event.chat_id,text:event.message});
    return (await patch('delivery_events',`id=eq.${event.id}&status=eq.Delivery%20sending`,{status:'Delivered',error:null,updated_at:new Date().toISOString()}))[0];
  }catch(e){return (await patch('delivery_events',`id=eq.${event.id}&status=eq.Delivery%20sending`,{status:'Delivery failed',error:errorMessage(e),updated_at:new Date().toISOString()}))[0];}
}
async function linkedChat(employeeId){
  const links=await db('telegram_links',{query:`employee_id=eq.${encodeURIComponent(employeeId)}&auth_user_id=not.is.null&order=linked_at.desc&limit=1`});
  const link=links[0];if(!link)return null;
  const roles=await db('app_user_roles',{query:`auth_user_id=eq.${encodeURIComponent(link.auth_user_id)}&employee_id=eq.${encodeURIComponent(employeeId)}&active=eq.true&limit=1`});
  return roles.length?link.chat_id:null;
}
async function sideEffects(type,reference,eventType,chatId,message,opts={}){
  const event=await enqueue(type,reference,eventType,chatId,message);
  await Promise.allSettled([syncRecord(type,reference,{fail:opts.simulateSheetFailure}),deliver(event.id,{fail:opts.simulateTelegramFailure})]);
}
export async function submitSale(body,actor,source='web',chatId=null,opts={}){
  const destination=source==='telegram'?chatId:await linkedChat(actor);
  const sale={...saleInput(body,actor),source,origin_chat_id:source==='telegram'?chatId:null,notification_chat_id:destination,is_practice:source==='web'&&body.practice===true};
  let rows;
  try{rows=await db('sales',{method:'POST',body:sale,prefer:'return=representation'});}catch(e){if(/duplicate key|23505/.test(e.message)){const existing=await one('sales',sale.reference);if(source==='telegram'&&existing&&['reference','salesperson_id','customer','project','description','amount_cents','proposed_r','proposed_a','proposed_j','source','origin_chat_id'].every(k=>String(existing[k])===String(sale[k])))return existing;throw new InputError('Reference already exists.',409);}throw e;}
  const record=rows[0];
  await sideEffects('sale',record.reference,'submission',destination,`Sale ${record.reference} recorded — ${money(record.amount_cents)}; project ${record.project}; Pending approval.`,opts);
  return one('sales',record.reference);
}
export async function submitExpense(body,actor,source='web',chatId=null,opts={}){
  const destination=source==='telegram'?chatId:await linkedChat(actor);
  const expense={...expenseInput(body,actor),source,origin_chat_id:source==='telegram'?chatId:null,notification_chat_id:destination,is_practice:source==='web'&&body.practice===true};
  let rows;
  try{rows=await db('expenses',{method:'POST',body:expense,prefer:'return=representation'});}catch(e){if(/duplicate key|23505/.test(e.message)){const existing=await one('expenses',expense.reference);if(source==='telegram'&&existing&&['reference','reporter_id','description','category','amount_cents','proposed_allocation','source','origin_chat_id'].every(k=>String(existing[k])===String(expense[k])))return existing;throw new InputError('Reference already exists.',409);}throw e;}
  const record=rows[0];
  await sideEffects('expense',record.reference,'submission',destination,`Expense ${record.reference} recorded — ${money(record.amount_cents)}; proposed allocation: ${record.proposed_allocation}; ${record.status}.`,opts);
  return one('expenses',record.reference);
}
export async function approveSale(reference,finalSplit,actor,opts={}){
  if(actor!=='svetlana')throw new InputError('Only Svetlana may approve sales.',403);
  const final=split(finalSplit),old=await one('sales',reference);
  if(!old)throw new InputError('Sale not found.',404);
  if(old.status==='Approved')throw new InputError('Sale is already approved.',409);
  const rows=await patch('sales',`${byRef(reference)}&status=eq.Pending%20approval`,{final_r:final.r,final_a:final.a,final_j:final.j,status:'Approved',decided_at:new Date().toISOString(),sheet_sync_status:'Sync pending'});
  if(rows.length!==1)throw new InputError('Sale was already approved.',409);
  const s=rows[0],c=commissions(s),changed=final.r!==s.proposed_r||final.a!==s.proposed_a||final.j!==s.proposed_j;
  const message=`Sale ${s.reference} approved${changed?' — commission split changed':''}. Sale ${money(s.amount_cents)}; total commission ${money(c.pool)}. Richard: ${s.proposed_r}% → ${s.final_r}% (${money(c.r)}). Anastasia: ${s.proposed_a}% → ${s.final_a}% (${money(c.a)}). Jean-Claude: ${s.proposed_j}% → ${s.final_j}% (${money(c.j)}).`;
  await sideEffects('sale',reference,'decision',s.notification_chat_id??s.origin_chat_id??null,message,opts);
  return one('sales',reference);
}
export async function allocateExpense(reference,allocation,actor,opts={}){
  if(actor!=='svetlana')throw new InputError('Only Svetlana may allocate expenses.',403);
  if(!['A','B','Company overhead'].includes(allocation))throw new InputError('Invalid final allocation.');
  const old=await one('expenses',reference);
  if(!old)throw new InputError('Expense not found.',404);
  if(old.status==='Allocated')throw new InputError('Expense is already allocated.',409);
  const rows=await patch('expenses',`${byRef(reference)}&status=eq.Awaiting%20allocation`,{final_allocation:allocation,status:'Allocated',decided_at:new Date().toISOString(),sheet_sync_status:'Sync pending'});
  if(rows.length!==1)throw new InputError('Expense was already allocated.',409);
  const e=rows[0],changed=e.proposed_allocation!==allocation;
  const message=`Expense ${e.reference} — allocation ${changed?'changed':'confirmed'}. ${money(e.amount_cents)}: ${e.description}. Proposed: ${e.proposed_allocation}. Approved: ${allocation}.`;
  await sideEffects('expense',reference,'decision',e.notification_chat_id??e.origin_chat_id??null,message,opts);
  return one('expenses',reference);
}
export async function snapshot(actor){
  if(!Object.hasOwn(EMPLOYEES,actor))throw new InputError('No active role assigned.',403);
  const [sales,expenses,events,links,assignments,backups]=await Promise.all([db('sales',{query:'archived_at=is.null&order=submitted_at.asc'}),db('expenses',{query:'archived_at=is.null&order=submitted_at.asc'}),db('delivery_events',{query:'order=id.asc'}),actor==='svetlana'?db('telegram_links',{query:'order=linked_at.desc'}):Promise.resolve([]),actor==='svetlana'?db('app_user_roles',{query:'order=employee_id.asc'}):Promise.resolve([]),actor==='svetlana'?db('practice_reset_backups',{query:'select=id,created_at,selected_refs,executed_at,restored_at&order=created_at.desc&limit=20'}):Promise.resolve([])]);
  const ownSales=actor==='svetlana'?sales:sales.filter(s=>s.salesperson_id===actor),ownExpenses=actor==='svetlana'?expenses:expenses.filter(e=>e.reporter_id===actor);
  return {sales:ownSales,expenses:ownExpenses,events:events.filter(e=>e.transaction_type==='sale'?ownSales.some(s=>s.reference===e.reference):ownExpenses.some(x=>x.reference===e.reference)),links,assignments,backups,dashboard:actor==='svetlana'?dashboard(sales,expenses):null,config:{displayName:process.env.DISPLAY_NAME||'Friends Included Ltd',botUrl:process.env.PUBLIC_BOT_URL||'https://t.me/weddiing_hire_task_bot',sheetUrl:actor==='svetlana'?(process.env.PUBLIC_SHEET_URL||'https://docs.google.com/spreadsheets/d/1uZKXgt7zArY6v48QflwMgLxB6mfx-tB1OHnxr_GFYzI/edit'):null,githubUrl:process.env.PUBLIC_GITHUB_URL||'https://github.com/aleksandragutchenko/wedding'}};
}
