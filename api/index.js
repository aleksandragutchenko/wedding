import {InputError} from '../lib/rules.js';
import {db,telegram} from '../lib/integrations.js';
import {submitSale,submitExpense,approveSale,allocateExpense,snapshot,linkTelegram,syncRecord,deliver} from '../lib/service.js';

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
  if(/^\/(start|help)/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:'Friends Included\n/id — show your Telegram IDs for manager linking\n/sale S01 | Customer | A | Description | 1000.00 | 50/30/20\n/expense E01 | Description | Materials | 120.00 | A\nThe manager must link your ID before submissions.'});return;}
  if(/^\/id\b/i.test(text)){await telegram('sendMessage',{chat_id:chatId,text:`Telegram user ID: ${userId}\nChat ID: ${chatId}`});return;}
  const match=text.match(/^\/(sale|expense)(?:@\w+)?\s+([\s\S]+)$/i);
  if(!match){await telegram('sendMessage',{chat_id:chatId,text:'Unknown command. Send /help for formats.'});return;}
  try{
    const links=await db('telegram_links',{query:`telegram_user_id=eq.${userId}&limit=1`}),actor=links[0]?.employee_id;
    if(!actor)throw new InputError('Your Telegram user ID is not linked. Send /id and ask the manager to link it.',403);
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
    if(request.method==='GET'&&path==='/state')return json(await snapshot(role(null,request)));
    if(request.method!=='POST')return json({error:'Not found'},404);
    const body=await request.json(),actor=role(body,request);
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
