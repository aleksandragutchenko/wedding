import {createHash, randomBytes} from 'node:crypto';
import {db} from './integrations.js';
import {InputError} from './rules.js';

const base=()=>{if(!process.env.SUPABASE_URL)throw new Error('SUPABASE_URL is not configured');return process.env.SUPABASE_URL.replace(/\/$/,'');};
const key=()=>{const value=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;if(!value)throw new Error('SUPABASE_PUBLISHABLE_KEY is not configured');return value;};
const cookie=(name,value,maxAge)=>`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function cookies(request){return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2).map(([k,v])=>[k,decodeURIComponent(v)]));}
export function sessionCookies(session){const h=new Headers({'Cache-Control':'no-store'});h.append('Set-Cookie',cookie('fi_access',session.access_token,Math.max(1,session.expires_in||3600)));h.append('Set-Cookie',cookie('fi_refresh',session.refresh_token,60*60*24*30));return h;}
export function clearCookies(){const h=new Headers({'Cache-Control':'no-store'});for(const name of ['fi_access','fi_refresh'])h.append('Set-Cookie',cookie(name,'',0));return h;}
async function authFetch(path,body,token){const response=await fetch(`${base()}/auth/v1/${path}`,{method:body?'POST':'GET',headers:{apikey:key(),...(token?{Authorization:`Bearer ${token}`}:{Authorization:`Bearer ${key()}`}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw new InputError(data.msg||data.error_description||data.message||'Authentication failed.',response.status===429?429:401);return data;}
export async function requestOtp(email){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||'')))throw new InputError('Enter a valid email address.');await authFetch('otp',{email:String(email).trim().toLowerCase(),create_user:false});return {message:'If this email has an invited account, a sign-in code has been sent.'};}
export async function verifyOtp(email,token){if(!/^\d{6,8}$/.test(String(token||'')))throw new InputError('Enter the code from your email.');const session=await authFetch('verify',{email:String(email||'').trim().toLowerCase(),token:String(token),type:'email'});if(!session.access_token||!session.refresh_token)throw new InputError('Sign-in did not return a session.',401);const identity=await identityForToken(session.access_token);return {session,identity};}
export async function refresh(request){const token=cookies(request).fi_refresh;if(!token)throw new InputError('Sign in first.',401);const session=await authFetch('token?grant_type=refresh_token',{refresh_token:token});const identity=await identityForToken(session.access_token);return {session,identity};}
export async function identityForToken(token){const user=await authFetch('user',undefined,token);if(!user?.id)throw new InputError('Sign in first.',401);const roles=await db('app_user_roles',{query:`auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`});const assignment=roles[0];if(!assignment)throw new InputError('This account has no active Friends Included role. Ask the administrator to assign one.',403);return {userId:user.id,email:user.email,employeeId:assignment.employee_id};}
export async function identity(request){const token=cookies(request).fi_access;if(!token)throw new InputError('Sign in first.',401);return identityForToken(token);}
export function accessToken(request){return cookies(request).fi_access;}
export function randomLinkCode(){return randomBytes(12).toString('base64url');}
export function hashCode(code){return createHash('sha256').update(String(code)).digest('hex');}
