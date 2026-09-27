import {InputError} from '../lib/rules.js';
import {db,rpc,telegram} from '../lib/integrations.js';
import {submitSale,submitExpense,approveSale,allocateExpense,snapshot,syncRecord,deliver} from '../lib/service.js';
import {requestOtp,verifyOtp,refresh,identity,sessionCookies,clearCookies,randomLinkCode,hashCode} from '../lib/auth.js';
import {testSession,testState,requestTestLink,testLinkStatus,confirmTestLinkButton,submitTest,decideTest,retryTest,retryTestSheet,resetTest,unlinkTest,testBotLink} from '../lib/test-sandbox.js';

const saleUsage='To record a sale, send one message in this format:\n/sale S06 | Customer name | A | Description | 1000.00 | 50/30/20\nUse A or B for the project. The last numbers are Richard/Anastasia/Jean-Claude percentages and must total 100.';
const expenseUsage='To record an expense, send one message in this format:\n/expense E08 | Description | Materials | 120.00 | A\nCategory: Materials, Travel, or Other. Allocation: A, B, or Company overhead.';
function json(data,status=200,headers={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});}
function secureJson(data,status,headers){return Response.json(data,{status,headers});}
function sameOrigin(request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new InputError('Cross-site request refused.',403);}
function manager(actor){if(actor!=='svetlana')throw new InputError('Only Svetlana may perform manager actions.',403);}
function parseBotSale(parts){
  if(parts.length!==6)throw new InputError('Use /sale S01 | Customer | A | Description | 1000.00 | 50/30/20');
  const [reference,customer,project,description,amount,shares]=parts;
  const percentages=shares.split('/').map(x=>x.trim());
  if(percentages.length!==3)throw new InputError('Split format: Richard/Anastasia/Jean-Claude, such as 50/30/20.');
  return {reference,customer,project,description,amount,split:{r:percentages[0],a:percentages[1],j:percentages[2]}};
}
function parseBotExpense(parts){
  if(parts.length!==5)throw new InputError('Use /expense E01 | Description | Materials | 120.00 | A');
  const [reference,description,category,amount,allocation]=parts;
  return {reference,description,category,amount,allocation};
}
async function bot(update){
  const callback=update?.callback_query;
  if(callback){
    const challenge=String(callback.data||'').match(/^testlink:([0-9a-f-]{36})$/i);
    if(!challenge)return;
    const chat=callback.message?.chat;
    try{
      if(chat?.type!=='private'||String(callback.from?.id)!==String(chat?.id))throw new InputError('Confirm from your own private chat.',403);
      const result=await confirmTestLinkButton(challenge[1],callback.from.id,chat.id);
      await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Test chat linked.'});
      await telegram('sendMessage',{chat_id:chat.id,text:`Your chat is linked to fictional ${result.employeeId} in your private test workspace. Send a complete /sale or /expense command for this role, then refresh the Test this system page.`});
    }catch(e){await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:`Link refused: ${e.message}`.slice(0,190),show_alert:true});}
    return;
  }
  const message=update?.message;if(!message?.from?.id||!message?.chat?.id)return;
  const chatId=message.chat.id,userId=message.from.id,text=String(message.text||'').trim();
  if(message.chat.type!=='private'){await telegram('sendMessage',{chat_id:chatId,text:'Use this bot in a private chat.'});return;}
  if(/^\/(start|help)(?:@\w+)?(?:\s+\S+)?$/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:`Friends Included\nYour private Chat ID: ${chatId}\n\nTo try the homework without an account or manager code: open https://friends-included.vercel.app/test.html, choose a fictional employee, enter this Chat ID, then tap the confirmation button I send here. The website will link automatically.\n\n/id — show your Telegram IDs again\n/link CODE — connect an invited real website account\n\n${saleUsage}\n\n${expenseUsage}`});return;}
  if(/^\/id\b/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:`Telegram user ID: ${userId}\nChat ID: ${chatId}`});return;}
  if(/^\/cancel(?:@\w+)?$/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:'There is no unfinished entry to cancel. Send a complete /sale or /expense message when ready.'});return;}
  const linking=text.match(/^\/link(?:@\w+)?\s+([A-Za-z0-9_-]{16,40})$/i);
  if(linking){try{if(String(userId)!==String(chatId))throw new InputError('Link only from your own private chat.',403);const result=await rpc('claim_telegram_link',{p_code_hash:hashCode(linking[1]),p_telegram_user_id:String(userId),p_chat_id:String(chatId)});await telegram('sendMessage',{chat_id:chatId,text:`Linked to ${result.employee_name}. Future submissions use this account's role. Existing transaction owners and notification destinations stay unchanged.`});}catch(e){await telegram('sendMessage',{chat_id:chatId,text:`Link refused: ${e.message}`});}return;}
  const match=text.match(/^\/(sale|expense)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if(!match){await telegram('sendMessage',{chat_id:chatId,text:'Unknown command. Send /help for formats.'});return;}
  if(!match[2]?.trim()){await telegram('sendMessage',{chat_id:chatId,text:match[1].toLowerCase()==='sale'?saleUsage:expenseUsage});return;}
  try{
    const testLink=await testBotLink(userId,chatId);
    if(testLink){
      const parts=match[2].split('|').map(s=>s.trim()),type=match[1].toLowerCase();
      const result=await submitTest(testLink.session_id,type,type==='sale'?parseBotSale(parts):parseBotExpense(parts),testLink.employee_id,'telegram',chatId);
      await telegram('sendMessage',{chat_id:chatId,text:`Test ${type} ${result.record.reference} recorded — ${result.record.status}. Open Test this system on the website to review it.`});
      return;
    }
    const links=await db('telegram_links',{query:`telegram_user_id=eq.${userId}&limit=1`}),actor=links[0]?.employee_id;
    if(!actor||!links[0].auth_user_id||String(links[0].chat_id)!==String(chatId))throw new InputError('This Telegram chat is not linked. For a self-service test, open https://friends-included.vercel.app/test.html, enter the Chat ID shown by /id, and tap the confirmation button sent here.',403);
    const assignments=await db('app_user_roles',{query:`auth_user_id=eq.${encodeURIComponent(links[0].auth_user_id)}&employee_id=eq.${encodeURIComponent(actor)}&active=eq.true&limit=1`});
    if(!assignments.length)throw new InputError('The linked website account is inactive. Ask the administrator to restore access.',403);
    const parts=match[2].split('|').map(s=>s.trim());
    if(match[1].toLowerCase()==='sale')await submitSale(parseBotSale(parts),actor,'telegram',chatId);
    else await submitExpense(parseBotExpense(parts),actor,'telegram',chatId);
  }catch(e){await telegram('sendMessage',{chat_id:chatId,text:`Submission refused: ${e.message}`});}
}
export async function handle(request){
  try{
    const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');
    if(path==='/health')return json({ok:true,configured:{supabase:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY),telegram:!!process.env.TELEGRAM_BOT_TOKEN,sheets:!!(process.env.GOOGLE_SHEET_ID&&process.env.GOOGLE_PRIVATE_KEY)}});
    if(path==='/telegram'&&request.method==='POST'){
      if(!process.env.TELEGRAM_WEBHOOK_SECRET||request.headers.get('x-telegram-bot-api-secret-token')!==process.env.TELEGRAM_WEBHOOK_SECRET)return json({error:'Unauthorized webhook'},401);
      await bot(await request.json());return json({ok:true});
    }
    if(path==='/test/session'&&request.method==='POST'){
      sameOrigin(request);
      const session=await testSession(request,{create:true});
      return json({ok:true,message:session.created?'Your private test workspace is ready.':'Your test workspace is ready.'},200,session.cookie?{'Set-Cookie':session.cookie}:{});
    }
    if(path==='/test/state'&&request.method==='GET'){
      const session=await testSession(request);return json(await testState(session.id));
    }
    if(path==='/test/link/status'&&request.method==='GET'){
      const session=await testSession(request);return json(await testLinkStatus(session.id));
    }
    if(path.startsWith('/test/')&&request.method==='POST'){
      sameOrigin(request);
      const session=await testSession(request),body=await request.json();
      if(path==='/test/link/request')return json(await requestTestLink(session.id,body));
      if(path==='/test/link/unlink')return json(await unlinkTest(session.id));
      if(path==='/test/sales')return json(await submitTest(session.id,'sale',body,String(body.employeeId||'')),201);
      if(path==='/test/expenses')return json(await submitTest(session.id,'expense',body,String(body.employeeId||'')),201);
      if(path==='/test/decide')return json(await decideTest(session.id,body));
      if(path==='/test/retry')return json(await retryTest(session.id,body.eventId));
      if(path==='/test/retry-sheet')return json(await retryTestSheet(session.id,body.transactionId));
      if(path==='/test/reset')return json(await resetTest(session.id,body));
      return json({error:'Not found'},404);
    }
    if(request.method==='GET'&&path==='/session'){const who=await identity(request);return json({employeeId:who.employeeId,email:who.email});}
    if(request.method==='GET'&&path==='/state'){const who=await identity(request);return json(await snapshot(who.employeeId));}
    if(request.method==='GET'&&path==='/reset/download'){
      const who=await identity(request);manager(who.employeeId);
      const id=url.searchParams.get('id');if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new InputError('Invalid backup ID.');
      const rows=await db('practice_reset_backups',{query:`id=eq.${id}&limit=1`});if(!rows.length)throw new InputError('Backup not found.',404);
      return json(rows[0]);
    }
    if(request.method!=='POST')return json({error:'Not found'},404);
    sameOrigin(request);
    const body=await request.json();
    if(path==='/auth/request-otp')return json(await requestOtp(body.email));
    if(path==='/auth/verify-otp'){const result=await verifyOtp(body.email,body.token);return secureJson({employeeId:result.identity.employeeId,email:result.identity.email},200,sessionCookies(result.session));}
    if(path==='/auth/refresh'){const result=await refresh(request);return secureJson({employeeId:result.identity.employeeId,email:result.identity.email},200,sessionCookies(result.session));}
    if(path==='/auth/logout')return secureJson({ok:true},200,clearCookies());
    const who=await identity(request),actor=who.employeeId;
    if(['/connect-telegram','/approve-sale','/allocate-expense','/retry-sheet','/retry-delivery','/access/assign','/access/revoke','/telegram/unlink-user','/practice/mark','/reset/preview','/reset/backup','/reset/execute','/reset/restore'].includes(path))manager(actor);
    if(path==='/connect-telegram'){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may connect the Telegram bot.',403);
      if(!process.env.TELEGRAM_WEBHOOK_SECRET)throw new Error('TELEGRAM_WEBHOOK_SECRET is not configured');
      const site=(process.env.PUBLIC_SITE_URL||'https://friends-included.vercel.app').replace(/\/$/,'');
      if(!/^https:\/\/[a-z0-9.-]+$/i.test(site))throw new Error('PUBLIC_SITE_URL must be an HTTPS origin');
      await telegram('setWebhook',{url:`${site}/api/telegram`,secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query']});
      return json({ok:true,webhook:`${site}/api/telegram`});
    }
    if(path==='/sales')return json(await submitSale(body,actor,'web'),201);
    if(path==='/expenses')return json(await submitExpense(body,actor,'web'),201);
    if(path==='/approve-sale')return json(await approveSale(String(body.reference||'').toUpperCase(),body.split,actor,body.test||{}));
    if(path==='/allocate-expense')return json(await allocateExpense(String(body.reference||'').toUpperCase(),body.allocation,actor,body.test||{}));
    if(path==='/telegram/link-code'){
      const code=randomLinkCode(),expiresAt=new Date(Date.now()+10*60*1000).toISOString();
      await db('telegram_link_challenges',{method:'POST',body:{code_hash:hashCode(code),auth_user_id:who.userId,employee_id:actor,expires_at:expiresAt},prefer:'return=minimal'});
      return json({command:`/link ${code}`,expiresAt});
    }
    if(path==='/telegram/unlink'){
      await db('telegram_links',{method:'DELETE',query:`auth_user_id=eq.${encodeURIComponent(who.userId)}`,prefer:'return=minimal'});
      return json({ok:true});
    }
    if(path==='/telegram/unlink-user'){
      if(!/^\d+$/.test(String(body.userId||'')))throw new InputError('Enter a numeric Telegram user ID.');
      await db('telegram_links',{method:'DELETE',query:`telegram_user_id=eq.${encodeURIComponent(body.userId)}`,prefer:'return=minimal'});
      return json({ok:true});
    }
    if(path==='/access/assign'){
      if(!['richard','anastasia','jean-claude','kevin'].includes(body.employeeId)||!/^[-\w]+@[-\w.]+\.[A-Za-z]{2,}$/.test(String(body.email||'')))throw new InputError('Choose a non-manager role and invited email.');
      return json(await rpc('assign_app_user',{p_email:String(body.email).toLowerCase(),p_employee_id:body.employeeId}));
    }
    if(path==='/access/revoke'){
      if(!['richard','anastasia','jean-claude','kevin'].includes(body.employeeId))throw new InputError('Revoke a non-manager role.');
      await db('app_user_roles',{method:'PATCH',query:`employee_id=eq.${encodeURIComponent(body.employeeId)}`,body:{active:false},prefer:'return=minimal'});
      return json({ok:true});
    }
    if(path==='/practice/mark'){
      const reference=String(body.reference||'').toUpperCase();
      if(!/^[SE][0-9A-Z_-]+$/.test(reference)||typeof body.practice!=='boolean')throw new InputError('Choose a transaction and practice state.');
      const table=reference.startsWith('S')?'sales':'expenses';
      const rows=await db(table,{method:'PATCH',query:`reference=eq.${encodeURIComponent(reference)}&archived_at=is.null`,body:{is_practice:body.practice},prefer:'return=representation'});
      if(rows.length!==1)throw new InputError('Active transaction not found.',404);
      return json({reference,is_practice:rows[0].is_practice});
    }
    if(path==='/reset/preview'){
      const refs=Array.isArray(body.references)?body.references:[];
      if(!refs.length||new Set(refs).size!==refs.length)throw new InputError('Select distinct practice records.');
      const state=await snapshot(actor),records=[...state.sales,...state.expenses].filter(x=>refs.includes(x.reference));
      if(records.length!==refs.length||records.some(x=>!x.is_practice))throw new InputError('Only active practice records can be reset.');
      return json({records:records.map(x=>({reference:x.reference,owner:x.salesperson_id||x.reporter_id,amount_cents:x.amount_cents,status:x.status,sheet_sync_status:x.sheet_sync_status,notification_chat_id:x.notification_chat_id}))});
    }
    if(path==='/reset/backup'){
      if(!Array.isArray(body.references))throw new InputError('Select practice records.');
      const refs=body.references;
      const state=await snapshot(actor),records=[...state.sales,...state.expenses].filter(x=>refs.includes(x.reference));
      if(!refs.length||new Set(refs).size!==refs.length||records.length!==refs.length||records.some(x=>!x.is_practice))throw new InputError('Only active practice records can be backed up.');
      return json(await rpc('prepare_practice_reset',{p_refs:refs}));
    }
    if(path==='/reset/execute'){
      if(!/^[0-9a-f-]{36}$/i.test(String(body.backupId||'')))throw new InputError('Create a backup first.');
      const result=await rpc('execute_practice_reset',{p_backup_id:body.backupId});
      const sync=await Promise.all(result.references.map(async ref=>{const type=ref.startsWith('S')?'sale':'expense';return syncRecord(type,ref);}));
      return json({backupId:result.backupId,references:result.references,sheetSync:sync.map(x=>({reference:x.reference,status:x.sheet_sync_status,error:x.sheet_sync_error}))});
    }
    if(path==='/reset/restore'){
      if(!/^[0-9a-f-]{36}$/i.test(String(body.backupId||'')))throw new InputError('Invalid backup ID.');
      const result=await rpc('restore_practice_reset',{p_backup_id:body.backupId});
      const sync=await Promise.all(result.references.map(async ref=>syncRecord(ref.startsWith('S')?'sale':'expense',ref)));
      return json({backupId:result.backupId,references:result.references,sheetSync:sync.map(x=>({reference:x.reference,status:x.sheet_sync_status,error:x.sheet_sync_error}))});
    }
    if(path==='/retry-sheet'){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may retry synchronization.',403);
      if(!['sale','expense'].includes(body.type))throw new InputError('Invalid transaction type.');
      return json(await syncRecord(body.type,String(body.reference||'').toUpperCase()));
    }
    if(path==='/retry-delivery'){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may retry delivery.',403);
      if(!Number.isSafeInteger(Number(body.eventId))||Number(body.eventId)<=0)throw new InputError('Choose a delivery event.');
      const events=await db('delivery_events',{query:`id=eq.${Number(body.eventId)}&limit=1`}),event=events[0];
      if(!event)throw new InputError('Delivery event not found.',404);
      const table=event.transaction_type==='sale'?'sales':'expenses';
      const records=await db(table,{query:`reference=eq.${encodeURIComponent(event.reference)}&archived_at=is.null&limit=1`});
      if(!records.length)throw new InputError('Archived or missing transactions cannot send notifications.',409);
      return json(await deliver(body.eventId));
    }
    return json({error:'Not found'},404);
  }catch(e){return json({error:e.message||'Unexpected error'},e.status||(/not configured/i.test(e.message)?503:500));}
}
export default {fetch:handle};
