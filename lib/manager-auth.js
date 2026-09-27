import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {InputError} from './rules.js';

const cookieName='fi_manager';
const sessionSeconds=8*60*60;

function accessCode(){
  const code=process.env.MANAGER_ACCESS_CODE;
  if(!code||code.length<16)throw new InputError('Manager access is not configured. Set a private code of at least 16 characters in Vercel.',503);
  return code;
}
function signature(value,code){return createHmac('sha256',code).update(value).digest('base64url');}
function equal(a,b){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function cookie(value,request,maxAge){
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure}`;
}
export function loginResponse(request,submitted){
  const code=accessCode();
  const actual=createHash('sha256').update(String(submitted??'')).digest();
  const expected=createHash('sha256').update(code).digest();
  if(!timingSafeEqual(actual,expected))throw new InputError('Incorrect manager access code.',401);
  const expires=Math.floor(Date.now()/1000)+sessionSeconds;
  const payload=`v1.${expires}`;
  return Response.json({authenticated:true},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie(`${payload}.${signature(payload,code)}`,request,sessionSeconds)}});
}
export function logoutResponse(request){return Response.json({authenticated:false},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie('',request,0)}});}
export function managerSignedIn(request){
  let code;
  try{code=accessCode();}catch{return false;}
  const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const match=raw?.match(/^v1\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if(!match||Number(match[1])<=Math.floor(Date.now()/1000))return false;
  return equal(match[2],signature(`v1.${match[1]}`,code));
}
export function requireManager(request){if(!managerSignedIn(request))throw new InputError('Manager sign-in required.',401);}

