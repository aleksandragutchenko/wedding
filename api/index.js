import {InputError} from '../lib/rules.js';
import {db,telegram} from '../lib/integrations.js';
import {submitSale,submitExpense,approveSale,allocateExpense,snapshot,linkTelegram,syncRecord,deliver} from '../lib/service.js';
import {loginResponse,logoutResponse,managerSignedIn,requireManager} from '../lib/manager-auth.js';

const saleUsage='To record a sale, send one message in this format:\n/sale S06 | Customer name | A | Description | 1000.00 | 50/30/20\nUse A or B for the project. The last numbers are Richard/Anastasia/Jean-Claude percentages and must total 100.';
const expenseUsage='To record an expense, send one message in this format:\n/expense E08 | Description | Materials | 120.00 | A\nCategory: Materials, Travel, or Other. Allocation: A, B, or Company overhead.';
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
function role(body,request){return body?.role||new URL(request.url).searchParams.get('role');}
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
  const message=update?.message;if(!message?.from?.id||!message?.chat?.id)return;
  const chatId=message.chat.id,userId=message.from.id,text=String(message.text||'').trim();
  if(message.chat.type!=='private'){await telegram('sendMessage',{chat_id:chatId,text:'Use this bot in a private chat.'});return;}
  if(/^\/(start|help)(?:@\w+)?(?:\s+\S+)?$/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:`Friends Included\n/id — show your Telegram IDs for manager linking\n\n${saleUsage}\n\n${expenseUsage}\n\nThe manager must link your ID before submissions.`});return;}
  if(/^\/id\b/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:`Telegram user ID: ${userId}\nChat ID: ${chatId}`});return;}
  if(/^\/cancel(?:@\w+)?$/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:'There is no unfinished entry to cancel. Send a complete /sale or /expense message when ready.'});return;}
  const match=text.match(/^\/(sale|expense)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if(!match){await telegram('sendMessage',{chat_id:chatId,text:'Unknown command. Send /help for formats.'});return;}
  if(!match[2]?.trim()){await telegram('sendMessage',{chat_id:chatId,text:match[1].toLowerCase()==='sale'?saleUsage:expenseUsage});return;}
  try{
    const links=await db('telegram_links',{query:`telegram_user_id=eq.${userId}&limit=1`}),actor=links[0]?.employee_id;
    if(!actor||String(links[0].chat_id)!==String(chatId))throw new InputError('This Telegram user and private chat are not linked together. Send /id and ask the manager to link both IDs.',403);
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
    if(request.method==='GET'&&path==='/manager-session')return json({authenticated:managerSignedIn(request)});
    if(request.method==='GET'&&path==='/state'){
      const actor=role(null,request);
      if(actor==='svetlana')requireManager(request);
      return json(await snapshot(actor));
    }
    if(request.method!=='POST')return json({error:'Not found'},404);
    const body=await request.json(),actor=role(body,request);
    if(path==='/manager-login')return loginResponse(request,body.code);
    if(path==='/manager-logout')return logoutResponse(request);
    if(['/connect-telegram','/approve-sale','/allocate-expense','/link-telegram','/retry-sheet','/retry-delivery'].includes(path)){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may perform manager actions.',403);
      if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new InputError('Cross-site manager request refused.',403);
      requireManager(request);
    }
    if(path==='/connect-telegram'){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may connect the Telegram bot.',403);
      if(!process.env.TELEGRAM_WEBHOOK_SECRET)throw new Error('TELEGRAM_WEBHOOK_SECRET is not configured');
      const site=(process.env.PUBLIC_SITE_URL||'https://friends-included.vercel.app').replace(/\/$/,'');
      if(!/^https:\/\/[a-z0-9.-]+$/i.test(site))throw new Error('PUBLIC_SITE_URL must be an HTTPS origin');
      await telegram('setWebhook',{url:`${site}/api/telegram`,secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message']});
      return json({ok:true,webhook:`${site}/api/telegram`});
    }
    if(path==='/sales')return json(await submitSale(body,actor,'web',null,body.test||{}),201);
    if(path==='/expenses')return json(await submitExpense(body,actor,'web',null,body.test||{}),201);
    if(path==='/approve-sale')return json(await approveSale(String(body.reference||'').toUpperCase(),body.split,actor,body.test||{}));
    if(path==='/allocate-expense')return json(await allocateExpense(String(body.reference||'').toUpperCase(),body.allocation,actor,body.test||{}));
    if(path==='/link-telegram')return json(await linkTelegram(body.userId,body.chatId,body.employeeId,actor));
    if(path==='/retry-sheet'){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may retry synchronization.',403);
      if(!['sale','expense'].includes(body.type))throw new InputError('Invalid transaction type.');
      return json(await syncRecord(body.type,String(body.reference||'').toUpperCase()));
    }
    if(path==='/retry-delivery'){
      if(actor!=='svetlana')throw new InputError('Only Svetlana may retry delivery.',403);
      return json(await deliver(body.eventId));
    }
    return json({error:'Not found'},404);
  }catch(e){return json({error:e.message||'Unexpected error'},e.status||(/not configured/i.test(e.message)?503:500));}
}
export default {fetch:handle};

