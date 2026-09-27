const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=cents=>`€${(Number(cents||0)/100).toFixed(2)}`;
const name={richard:'Richard',anastasia:'Anastasia','jean-claude':'Jean-Claude',kevin:'Kevin'};
let state={records:[],events:[],links:[],dashboard:null};
let linkPollTimer=null;

async function api(path,body){
  const response=await fetch(`/api/test/${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await response.json();}catch{throw new Error(`The server returned ${response.status}. Try again.`);}
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status}).`);
  return data;
}
function feedback(id,message,error=false){const node=$(id);node.textContent=message;node.classList.toggle('error',error);}
async function action(form,id,work){
  const button=form.querySelector('button[type=submit],button:not([type])');
  if(button?.disabled)return;
  if(button)button.disabled=true;
  feedback(id,'Working…');
  try{const message=await work();feedback(id,message);}catch(e){feedback(id,e.message,true);}
  finally{if(button)button.disabled=false;}
}
function splitValue(form){return {r:form.elements.r.value,a:form.elements.a.value,j:form.elements.j.value};}
function render(){
  $('linkedAccounts').innerHTML=state.links.length?`<p><strong>Verified links in this workspace:</strong> ${state.links.map(l=>`${escapeHtml(name[l.employeeId])} → chat ending ${escapeHtml(String(l.chatId).slice(-4))}`).join(' · ')}</p>`:'<p>No Telegram chat linked yet. Verify your chat before submitting a test transaction.</p>';
  const pending=state.records.filter(r=>r.status==='Pending approval'||r.status==='Awaiting allocation');
  $('testManager').innerHTML=pending.length?pending.map(r=>r.type==='sale'?`<form class="test-decision" data-reference="${escapeHtml(r.reference)}" data-type="sale"><h3>${escapeHtml(r.reference)} · ${escapeHtml(name[r.employee_id])} · ${euro(r.amount_cents)}</h3><p>Proposed split: ${r.proposed_r}/${r.proposed_a}/${r.proposed_j}. Set the final split:</p><div class="test-split"><label>Richard %<input name="r" type="number" min="0" max="100" step="1" value="${r.proposed_r}" required></label><label>Anastasia %<input name="a" type="number" min="0" max="100" step="1" value="${r.proposed_a}" required></label><label>Jean-Claude %<input name="j" type="number" min="0" max="100" step="1" value="${r.proposed_j}" required></label></div><button>Approve this test sale</button></form>`:`<form class="test-decision" data-reference="${escapeHtml(r.reference)}" data-type="expense"><h3>${escapeHtml(r.reference)} · Kevin · ${euro(r.amount_cents)}</h3><p>Proposed allocation: ${escapeHtml(r.proposed_allocation)}.</p><label>Final allocation<select name="allocation"><option>A</option><option>B</option><option>Company overhead</option></select></label><button>Confirm test allocation</button></form>`).join(''):'<p class="empty">No pending test decisions. Submit a sale or expense in step 3, then refresh.</p>';
  const d=state.dashboard;
  $('testTotals').innerHTML=d?`<div class="test-summary"><span>Approved income <strong>${euro(d.income)}</strong></span><span>Commission expense <strong>${euro(d.commissionExpense)}</strong></span><span>All recorded expenses <strong>${euro(d.totalExpenses)}</strong></span><span>Company result <strong>${euro(d.companyResult)}</strong></span></div><p class="field-help">Company result = approved income − 10% commission on approved sales − every recorded expense. Pending sales are excluded; expenses awaiting allocation still reduce the company result.</p>`:'';
  $('testRecords').innerHTML=state.records.length?state.records.slice().reverse().map(r=>{
    const events=state.events.filter(e=>e.transaction_id===r.id);
    return `<article class="test-record"><h3>${escapeHtml(r.reference)} · ${escapeHtml(r.status)}</h3><p>${escapeHtml(name[r.employee_id])} · ${r.type==='sale'?'Sale':'Expense'} · ${euro(r.amount_cents)} · ${escapeHtml(r.description)}</p><p>Source: ${escapeHtml(r.source)} · Original notification chat: ${r.notification_chat_id?'ending '+escapeHtml(String(r.notification_chat_id).slice(-4)):'not linked when submitted'}</p>${r.type==='sale'?`<p>Proposed split ${r.proposed_r}/${r.proposed_a}/${r.proposed_j}${r.status==='Approved'?` · Final split ${r.final_r}/${r.final_a}/${r.final_j}`:''}</p>`:`<p>Proposed ${escapeHtml(r.proposed_allocation)}${r.final_allocation?` · Final ${escapeHtml(r.final_allocation)}`:''}</p>`}<div class="test-events">${events.length?events.map(e=>`<p>${escapeHtml(e.event_type)} notification: <strong>${escapeHtml(e.status)}</strong>${e.error?` · ${escapeHtml(e.error)}`:''}${e.status==='Delivery failed'?` <button class="secondary retry-test" data-id="${e.id}">Retry</button>`:''}</p>`).join(''):'<p>Notification is being prepared. Refresh shortly.</p>'}</div></article>`;
  }).join(''):'<p class="empty">No test records yet. Submit one in step 3.</p>';
}
async function refresh(){state=await api('state');render();}
async function pollLink(){
  try{
    const result=await api('link/status');
    if(result.status==='pending'){
      feedback('confirmLinkStatus',result.message);
      linkPollTimer=setTimeout(pollLink,2000);
    }else if(result.status==='verified'){
      await refresh();feedback('confirmLinkStatus',result.message);
    }else if(result.status==='expired')feedback('confirmLinkStatus',result.message,true);
  }catch(e){feedback('confirmLinkStatus',`Could not check Telegram confirmation: ${e.message}`,true);}
}
function startLinkPolling(){if(linkPollTimer)clearTimeout(linkPollTimer);linkPollTimer=null;pollLink();}
async function init(){
  $('testContent').classList.remove('hidden');
  try{await api('session',{});await refresh();feedback('testStatus','Your private test workspace is ready. Follow the steps below.');startLinkPolling();}
  catch(e){feedback('testStatus',`Could not start the test workspace: ${e.message}`,true);}
}

$('requestLinkForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;await action(form,'requestLinkStatus',async()=>{const result=await api('link/request',{employeeId:form.elements.employeeId.value,chatId:form.elements.chatId.value.trim()});startLinkPolling();return `${result.message} Expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`;});});
$('saleTestForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;await action(form,'saleTestStatus',async()=>{const p=splitValue(form),sum=Number(p.r)+Number(p.a)+Number(p.j);if(sum!==100)throw new Error(`Commission split totals ${sum}%. Adjust it to exactly 100%.`);const data=await api('sales',{employeeId:form.elements.employeeId.value,reference:form.elements.reference.value,customer:form.elements.customer.value,project:form.elements.project.value,description:form.elements.description.value,amount:form.elements.amount.value,split:p});await refresh();return `${data.record.reference} saved: Pending approval. Submission notification: ${data.notification?.status||'pending'}. Continue to step 4.`;});});
$('expenseTestForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;await action(form,'expenseTestStatus',async()=>{const data=await api('expenses',{employeeId:'kevin',reference:form.elements.reference.value,description:form.elements.description.value,category:form.elements.category.value,amount:form.elements.amount.value,allocation:form.elements.allocation.value});await refresh();return `${data.record.reference} saved: ${data.record.status}. Submission notification: ${data.notification?.status||'pending'}. Continue to step 4 if allocation is awaiting.`;});});
$('testManager').addEventListener('submit',async event=>{const form=event.target.closest('form');if(!form)return;event.preventDefault();await action(form,'managerTestStatus',async()=>{const body={reference:form.dataset.reference};if(form.dataset.type==='sale'){body.split=splitValue(form);const total=Number(body.split.r)+Number(body.split.a)+Number(body.split.j);if(total!==100)throw new Error(`Final split totals ${total}%. Adjust it to exactly 100%.`);}else body.allocation=form.elements.allocation.value;const result=await api('decide',body);await refresh();return `${result.record.reference}: ${result.record.status}. Decision notification: ${result.notification?.status||'pending'}. Check your Telegram chat, then step 5.`;});});
$('testRecords').addEventListener('click',async event=>{const button=event.target.closest('button.retry-test');if(!button)return;button.disabled=true;try{const result=await api('retry',{eventId:Number(button.dataset.id)});await refresh();feedback('testStatus',`Notification retry: ${result.status}.`,result.status==='Delivery failed');}catch(e){feedback('testStatus',e.message,true);}finally{button.disabled=false;}});
$('refreshTest').addEventListener('click',async()=>{try{await refresh();feedback('testStatus','Your test records are up to date.');}catch(e){feedback('testStatus',e.message,true);}});
$('unlinkTest').addEventListener('click',async()=>{const button=$('unlinkTest');button.disabled=true;try{const result=await api('link/unlink',{});if(linkPollTimer)clearTimeout(linkPollTimer);linkPollTimer=null;await refresh();feedback('confirmLinkStatus',result.message);}catch(e){feedback('confirmLinkStatus',e.message,true);}finally{button.disabled=false;}});
$('resetTestForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;await action(form,'resetTestStatus',async()=>{const result=await api('reset',{confirm:form.elements.confirm.value});form.elements.confirm.value='';await refresh();return result.message;});});
for(const field of $('saleTestForm').querySelectorAll('.test-split input'))field.addEventListener('input',()=>{const f=$('saleTestForm'),sum=['r','a','j'].reduce((n,k)=>n+Number(f.elements[k].value||0),0);$('testSplitTotal').textContent=`${sum}% allocated · ${100-sum}% remaining. Exact total required: 100%.`;});
init();
