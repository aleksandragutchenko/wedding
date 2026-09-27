import {createSign} from 'node:crypto';

function config(name){const value=process.env[name];if(!value)throw new Error(`${name} is not configured`);return value;}
async function readJson(response,service){const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={message:text};}if(!response.ok)throw new Error(`${service}: ${data.message||data.error_description||data.error||response.status}`);return data;}
export async function db(table,{method='GET',query='',body,prefer}={}){
  const url=`${config('SUPABASE_URL').replace(/\/$/,'')}/rest/v1/${table}${query?`?${query}`:''}`;
  const key=config('SUPABASE_SECRET_KEY');
  const headers={apikey:key};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(prefer)headers.Prefer=prefer;
  const options={method,headers,body:body===undefined?undefined:JSON.stringify(body)};
  try{return await readJson(await fetch(url,options),'Supabase');}
  catch(e){
    if(method!=='GET'||!/JWT issued at future/i.test(e.message))throw e;
    await new Promise(resolve=>setTimeout(resolve,1000));
    return readJson(await fetch(url,options),'Supabase');
  }
}
export async function rpc(name,body){
  const key=config('SUPABASE_SECRET_KEY');
  return readJson(await fetch(`${config('SUPABASE_URL').replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),'Supabase');
}
export const byRef=(reference)=>`reference=eq.${encodeURIComponent(reference)}`;
export async function one(table,reference){const rows=await db(table,{query:byRef(reference)});return rows[0]||null;}

let tokenCache={value:null,expires:0};
async function googleToken(){
  if(tokenCache.value&&Date.now()<tokenCache.expires-60000)return tokenCache.value;
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({iss:config('GOOGLE_SERVICE_ACCOUNT_EMAIL'),scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})).toString('base64url');
  const unsigned=`${header}.${claims}`;
  const signature=createSign('RSA-SHA256').update(unsigned).sign(config('GOOGLE_PRIVATE_KEY').replace(/\\n/g,'\n')).toString('base64url');
  const assertion=`${unsigned}.${signature}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const data=await readJson(response,'Google OAuth');
  tokenCache={value:data.access_token,expires:Date.now()+(data.expires_in||3600)*1000};
  return tokenCache.value;
}
export async function sheetUpdate(tab,row,values){
  const id=config('GOOGLE_SHEET_ID');
  const range=encodeURIComponent(`${tab}!A${row}`);
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}?valueInputOption=USER_ENTERED`,{method:'PUT',headers:{Authorization:`Bearer ${await googleToken()}`,'Content-Type':'application/json'},body:JSON.stringify({range:`${tab}!A${row}`,majorDimension:'ROWS',values:[values]})});
  return readJson(response,'Google Sheets');
}
export async function sheetReferences(tab){
  const id=config('GOOGLE_SHEET_ID');
  const range=encodeURIComponent(`${tab}!A2:A`);
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}`,{headers:{Authorization:`Bearer ${await googleToken()}`}});
  const data=await readJson(response,'Google Sheets');
  return data.values||[];
}
export async function telegram(method,payload){
  const response=await fetch(`https://api.telegram.org/bot${config('TELEGRAM_BOT_TOKEN')}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await readJson(response,'Telegram');
  if(!data.ok)throw new Error(`Telegram: ${data.description||'request failed'}`);
  return data.result;
}
