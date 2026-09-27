import {randomBytes,createHash} from 'node:crypto';
import {db,rpc,telegram} from './integrations.js';
import {InputError,saleInput,expenseInput,split,dashboard,commissions,money,EMPLOYEES} from './rules.js';

const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const q=value=>encodeURIComponent(String(value));
const own=(sessionId)=>`session_id=eq.${q(sessionId)}`;
const active=(sessionId)=>`${own(sessionId)}&reset_at=is.null`;
const isDuplicate=e=>/duplicate key|23505/i.test(String(e?.message));
const cleanError=e=>String(e?.message||e).slice(0,300);
const employees=['richard','anastasia','jean-claude','kevin'];
const publicRow=({session_id,...rest})=>rest;

function cookieToken(request){return request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('fi_test='))?.slice(8)||'';}
export async function testSession(request,{create=false}={}){
  const token=cookieToken(request);
  if(/^[a-f0-9]{64}$/.test(token)){
    const rows=await db('test_sessions',{query:`token_hash=eq.${hash(token)}&expires_at=gt.${q(new Date().toISOString())}&limit=1`});
    if(rows[0])return {id:rows[0].id,created:false};
  }
  if(!create)throw new InputError('Test session missing or expired. Reload the test page to begin again.',401);
  const fresh=randomBytes(32).toString('hex');
  const rows=await db('test_sessions',{method:'POST',body:{token_hash:hash(fresh)},prefer:'return=representation'});
  return {id:rows[0].id,created:true,cookie:`fi_test=${fresh}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${new URL(request.url).protocol==='https:'?'; Secure':''}`};
}
export async function testState(sessionId){
  const [records,events,links]=await Promise.all([
    db('test_transactions',{query:`${active(sessionId)}&order=submitted_at.asc`}),
    db('test_delivery_events',{query:`${own(sessionId)}&order=id.asc`}),
    db('test_telegram_links',{query:`${own(sessionId)}&order=linked_at.desc`})
  ]);
  const sales=records.filter(x=>x.type==='sale').map(x=>({...x,salesperson_id:x.employee_id}));
  const expenses=records.filter(x=>x.type==='expense').map(x=>({...x,reporter_id:x.employee_id}));
  return {records:records.map(publicRow),events:events.filter(e=>records.some(r=>r.id===e.transaction_id)).map(publicRow),links:links.map(x=>({employeeId:x.employee_id,chatId:String(x.chat_id).slice(-4),linkedAt:x.linked_at})),dashboard:dashboard(sales,expenses)};
}
export function assertEmployee(employeeId,type){
  if(!employees.includes(employeeId))throw new InputError('Choose a fictional test employee.');
  if(type==='sale'&&employeeId==='kevin')throw new InputError('Choose Richard, Anastasia, or Jean-Claude for a sale.',403);
  if(type==='expense'&&employeeId!=='kevin')throw new InputError('Choose Kevin for an expense.',403);
}
async function linkedChat(sessionId,employeeId){
  const rows=await db('test_telegram_links',{query:`${own(sessionId)}&employee_id=eq.${q(employeeId)}&order=linked_at.desc&limit=1`});
  return rows[0]?.chat_id||null;
}
export async function requestTestLink(sessionId,body){
  const chat=String(body.chatId||'').trim(),employeeId=String(body.employeeId||'');
  if(!/^[1-9]\d{3,19}$/.test(chat)||!Number.isSafeInteger(Number(chat)))throw new InputError('Enter the numeric private Chat ID shown by /id.');
  if(!employees.includes(employeeId))throw new InputError('Choose a fictional test employee.');
  const sinceMinute=new Date(Date.now()-60_000).toISOString(),sinceHour=new Date(Date.now()-3_600_000).toISOString();
  const [recentSession,recentChat]=await Promise.all([
    db('test_link_challenges',{query:`${own(sessionId)}&created_at=gt.${q(sinceMinute)}&limit=1`}),
    db('test_link_challenges',{query:`chat_id=eq.${chat}&created_at=gt.${q(sinceHour)}&select=id&limit=5`})
  ]);
  if(recentSession.length)throw new InputError('Wait one minute before requesting another confirmation button.',429);
  if(recentChat.length>=5)throw new InputError('This chat has received too many confirmation requests. Try again in one hour.',429);
  const expiresAt=new Date(Date.now()+10*60_000).toISOString();
  const rows=await db('test_link_challenges',{method:'POST',body:{session_id:sessionId,chat_id:chat,employee_id:employeeId,expires_at:expiresAt},prefer:'return=representation'});
  try{
    const site=(process.env.PUBLIC_SITE_URL||'https://friends-included.vercel.app').replace(/\/$/,'');
    if(!/^https:\/\/[a-z0-9.-]+$/i.test(site)||!process.env.TELEGRAM_WEBHOOK_SECRET)throw new Error('Telegram webhook is not configured');
    await telegram('setWebhook',{url:`${site}/api/telegram`,secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query']});
    await telegram('sendMessage',{chat_id:chat,text:`Friends Included test link request for ${EMPLOYEES[employeeId]}. Tap the button below to link this private chat to your own website test workspace. It expires in 10 minutes. If you did not request this, ignore it.`,reply_markup:{inline_keyboard:[[{text:'Confirm this test link',callback_data:`testlink:${rows[0].id}`}]]}});
  }
  catch(e){await db('test_link_challenges',{method:'DELETE',query:`id=eq.${rows[0].id}`,prefer:'return=minimal'});throw new InputError('Telegram could not reach that chat. Open the bot, press Start, send /id, and use the Chat ID it shows.',422);}
  return {expiresAt,message:'Confirmation button sent to your Telegram chat. Tap it there; this page will update automatically.'};
}
export async function testLinkStatus(sessionId){
  const rows=await db('test_link_challenges',{query:`${own(sessionId)}&order=created_at.desc&limit=1`}),challenge=rows[0];
  if(!challenge)return {status:'none'};
  if(challenge.used_at){
    const links=await db('test_telegram_links',{query:`${own(sessionId)}&chat_id=eq.${challenge.chat_id}&employee_id=eq.${q(challenge.employee_id)}&limit=1`});
    return links.length?{status:'verified',employeeId:challenge.employee_id,message:`Telegram chat verified for ${EMPLOYEES[challenge.employee_id]}.`}:{status:'none',message:'This test link is no longer active.'};
  }
  if(new Date(challenge.expires_at).getTime()<=Date.now())return {status:'expired',message:'The Telegram confirmation expired. Request a new button.'};
  return {status:'pending',expiresAt:challenge.expires_at,message:'Waiting for you to tap Confirm this test link in Telegram.'};
}
export async function confirmTestLinkButton(challengeId,userId,chatId){
  if(!/^[0-9a-f-]{36}$/i.test(String(challengeId)))throw new InputError('Invalid confirmation button.');
  try{return await rpc('claim_test_link_button',{p_challenge_id:challengeId,p_telegram_user_id:String(userId),p_chat_id:String(chatId)});}
  catch(e){throw new InputError(e.message.replace(/^Supabase:\s*/,''),400);}
}
async function oneRecord(sessionId,reference){
  const rows=await db('test_transactions',{query:`${active(sessionId)}&reference=eq.${q(reference)}&limit=1`});
  return rows[0]||null;
}
async function enqueue(sessionId,record,eventType,message){
  const rows=await db('test_delivery_events',{method:'POST',query:'on_conflict=transaction_id,event_type',body:{session_id:sessionId,transaction_id:record.id,event_type:eventType,chat_id:record.notification_chat_id,message,status:record.notification_chat_id?'Delivery pending':'No Telegram recipient linked'},prefer:'resolution=ignore-duplicates,return=representation'});
  return rows[0]||(await db('test_delivery_events',{query:`${own(sessionId)}&transaction_id=eq.${record.id}&event_type=eq.${eventType}&limit=1`}))[0];
}
export async function sendTestEvent(sessionId,eventId,{fail=false}={}){
  const query=`${own(sessionId)}&id=eq.${Number(eventId)}&limit=1`;
  let event=(await db('test_delivery_events',{query}))[0];
  if(!event)throw new InputError('Test notification not found.',404);
  if(event.status==='Delivered'||!event.chat_id)return event;
  if(event.status==='Delivery sending'&&Date.now()-new Date(event.updated_at).getTime()<5*60_000)return event;
  if(event.status==='Delivery sending'){
    const recovered=await db('test_delivery_events',{method:'PATCH',query:`${own(sessionId)}&id=eq.${event.id}&status=eq.Delivery%20sending&updated_at=eq.${q(event.updated_at)}`,body:{status:'Delivery failed',error:'Previous send timed out. Retrying could duplicate a Telegram message.',updated_at:new Date().toISOString()},prefer:'return=representation'});
    if(!recovered.length)return (await db('test_delivery_events',{query}))[0];
    event=recovered[0];
  }
  const claimed=await db('test_delivery_events',{method:'PATCH',query:`${own(sessionId)}&id=eq.${event.id}&status=in.(Delivery%20pending,Delivery%20failed)`,body:{status:'Delivery sending',error:null,attempts:event.attempts+1,updated_at:new Date().toISOString()},prefer:'return=representation'});
  if(!claimed.length)return (await db('test_delivery_events',{query}))[0];
  try{
    if(fail)throw new Error('Simulated Telegram delivery failure');
    await telegram('sendMessage',{chat_id:event.chat_id,text:event.message});
    return (await db('test_delivery_events',{method:'PATCH',query:`${own(sessionId)}&id=eq.${event.id}&status=eq.Delivery%20sending`,body:{status:'Delivered',error:null,updated_at:new Date().toISOString()},prefer:'return=representation'}))[0];
  }catch(e){return (await db('test_delivery_events',{method:'PATCH',query:`${own(sessionId)}&id=eq.${event.id}&status=eq.Delivery%20sending`,body:{status:'Delivery failed',error:cleanError(e),updated_at:new Date().toISOString()},prefer:'return=representation'}))[0];}
}
export async function submitTest(sessionId,type,body,employeeId,source='web',chatId=null){
  assertEmployee(employeeId,type);
  const valid=type==='sale'?saleInput(body,employeeId):expenseInput(body,employeeId);
  const existing=await oneRecord(sessionId,valid.reference);
  if(existing){
    const fields=type==='sale'?['reference','customer','project','description','amount_cents','proposed_r','proposed_a','proposed_j']:['reference','description','category','amount_cents','proposed_allocation'];
    if(source==='telegram'&&existing.source==='telegram'&&existing.type===type&&existing.employee_id===employeeId&&String(existing.notification_chat_id)===String(chatId)&&fields.every(k=>String(existing[k])===String(valid[k]))){
      const message=type==='sale'?`Test sale ${existing.reference} recorded — ${money(existing.amount_cents)}; Pending approval.`:`Test expense ${existing.reference} recorded — ${money(existing.amount_cents)}; ${existing.status}.`;
      const event=await enqueue(sessionId,existing,'submission',message);
      if(event.status==='Delivery pending'||event.status==='Delivery failed')await sendTestEvent(sessionId,event.id);
      return {record:publicRow(existing),notification:publicRow((await db('test_delivery_events',{query:`id=eq.${event.id}&limit=1`}))[0]),replayed:true};
    }
    throw new InputError('That reference already exists in your test session. Choose a new reference.',409);
  }
  const destination=source==='telegram'?chatId:await linkedChat(sessionId,employeeId);
  if(source==='web'&&!destination)throw new InputError(`Verify your Telegram chat for ${EMPLOYEES[employeeId]} before submitting. The notification destination is saved when the record is created.`,409);
  const row={session_id:sessionId,reference:valid.reference,type,employee_id:employeeId,source,notification_chat_id:destination,...valid,status:type==='sale'?'Pending approval':valid.status};
  delete row.salesperson_id;delete row.reporter_id;
  try{
    const rows=await db('test_transactions',{method:'POST',body:row,prefer:'return=representation'}),record=rows[0];
    const message=type==='sale'?`Test sale ${record.reference} recorded — ${money(record.amount_cents)}; Pending approval.`:`Test expense ${record.reference} recorded — ${money(record.amount_cents)}; ${record.status}.`;
    const event=await enqueue(sessionId,record,'submission',message);
    await sendTestEvent(sessionId,event.id);
    return {record:publicRow(record),notification:publicRow((await db('test_delivery_events',{query:`id=eq.${event.id}&limit=1` }))[0])};
  }catch(e){
    if(isDuplicate(e))throw new InputError('That reference already exists in your test session.',409);
    throw e;
  }
}
export async function decideTest(sessionId,body){
  const reference=String(body.reference||'').trim().toUpperCase();
  if(!/^[SE][0-9A-Z_-]+$/.test(reference))throw new InputError('Choose a valid test reference.');
  const old=await oneRecord(sessionId,reference);
  if(!old)throw new InputError('Test record not found in your session.',404);
  let patch,message;
  if(old.type==='sale'){
    if(old.status!=='Pending approval')throw new InputError('Sale already approved.',409);
    const final=split(body.split);
    const calculated=commissions({...old,status:'Approved',final_r:final.r,final_a:final.a,final_j:final.j});
    patch={status:'Approved',final_r:final.r,final_a:final.a,final_j:final.j,decided_at:new Date().toISOString()};
    message=`Test sale ${reference} approved. Commission ${money(calculated.pool)}: Richard ${final.r}% (${money(calculated.r)}), Anastasia ${final.a}% (${money(calculated.a)}), Jean-Claude ${final.j}% (${money(calculated.j)}).`;
  }else{
    if(old.status!=='Awaiting allocation')throw new InputError('Expense already allocated.',409);
    if(!['A','B','Company overhead'].includes(body.allocation))throw new InputError('Choose A, B, or Company overhead.');
    patch={status:'Allocated',final_allocation:body.allocation,decided_at:new Date().toISOString()};
    message=`Test expense ${reference} allocation confirmed: ${body.allocation}. Amount ${money(old.amount_cents)}.`;
  }
  const changed=await db('test_transactions',{method:'PATCH',query:`${active(sessionId)}&reference=eq.${q(reference)}&status=eq.${q(old.status)}`,body:patch,prefer:'return=representation'});
  if(changed.length!==1)throw new InputError('This record was already decided. Refresh the page.',409);
  const record=changed[0],event=await enqueue(sessionId,record,'decision',message);
  await sendTestEvent(sessionId,event.id);
  return {record:publicRow(record),notification:publicRow((await db('test_delivery_events',{query:`id=eq.${event.id}&limit=1` }))[0])};
}
export async function retryTest(sessionId,eventId){
  if(!Number.isSafeInteger(Number(eventId))||Number(eventId)<=0)throw new InputError('Choose a notification to retry.');
  const events=await db('test_delivery_events',{query:`${own(sessionId)}&id=eq.${Number(eventId)}&limit=1`}),event=events[0];
  if(!event)throw new InputError('Notification not found in your session.',404);
  if(event.status!=='Delivery failed')throw new InputError('Only failed notifications can be retried.',409);
  const rows=await db('test_transactions',{query:`${active(sessionId)}&id=eq.${event.transaction_id}&limit=1`});
  if(!rows.length)throw new InputError('Reset records cannot send notifications.',409);
  return publicRow(await sendTestEvent(sessionId,event.id));
}
export async function resetTest(sessionId,body){
  if(body.confirm!=='RESET')throw new InputError('Type RESET to remove your disposable records from the active test view.');
  const rows=await db('test_transactions',{method:'PATCH',query:active(sessionId),body:{reset_at:new Date().toISOString()},prefer:'return=representation'});
  return {resetCount:rows.length,message:`${rows.length} of your test records removed from the active view. Other sessions and homework records were not changed.`};
}
export async function unlinkTest(sessionId){
  await db('test_telegram_links',{method:'DELETE',query:own(sessionId),prefer:'return=minimal'});
  return {message:'Test bot link disconnected from this workspace. Existing record owners and notification destinations remain saved.'};
}
export async function testBotLink(userId,chatId){
  if(String(userId)!==String(chatId))return null;
  const links=await db('test_telegram_links',{query:`telegram_user_id=eq.${q(userId)}&chat_id=eq.${q(chatId)}&limit=1`});
  if(!links.length)return null;
  const sessions=await db('test_sessions',{query:`id=eq.${links[0].session_id}&expires_at=gt.${q(new Date().toISOString())}&limit=1`});
  return sessions.length?links[0]:null;
}
