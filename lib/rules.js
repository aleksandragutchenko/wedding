export const SALESPEOPLE = ['richard','anastasia','jean-claude'];
export const EMPLOYEES = {richard:'Richard Darling',anastasia:'Anastasia Ferrari','jean-claude':'Jean-Claude Bērziņš',kevin:'Kevin von Whatever',svetlana:'Svetlana de Monte Carlo'};
export class InputError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function money(cents){return `€${(cents/100).toFixed(2)}`;}
export function cents(value){
  const s=String(value??'').trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw new InputError('Enter a positive euro amount with at most two decimal places.');
  const [euros,fraction='']=s.split('.');
  const n=Number(euros)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(n)||n<=0)throw new InputError('Amount must be greater than zero.');
  return n;
}
function required(v,label){const s=String(v??'').trim();if(!s)throw new InputError(`${label} is required.`);return s;}
export function split(input){
  const vals=['r','a','j'].map(k=>/^\d+$/.test(String(input?.[k]??''))?Number(input[k]):NaN);
  if(vals.some(v=>!Number.isInteger(v)||v<0||v>100)||vals.reduce((a,b)=>a+b,0)!==100)throw new InputError('Commission percentages must be whole numbers from 0 to 100 and total exactly 100%.');
  return {r:vals[0],a:vals[1],j:vals[2]};
}
export function saleInput(body,actor){
  if(!SALESPEOPLE.includes(actor))throw new InputError('Only salespeople may submit sales.',403);
  const reference=required(body.reference,'Reference').toUpperCase();
  if(!/^S[0-9A-Z_-]+$/.test(reference))throw new InputError('Sale reference must start with S and contain letters, numbers, _ or -.');
  const project=required(body.project,'Project').toUpperCase();
  if(!['A','B'].includes(project))throw new InputError('Project must be A or B.');
  return {reference,salesperson_id:actor,customer:required(body.customer,'Customer'),project,description:required(body.description,'Description'),amount_cents:cents(body.amount),...Object.fromEntries(Object.entries(split(body.split)).map(([k,v])=>[`proposed_${k}`,v]))};
}
export function expenseInput(body,actor){
  if(actor!=='kevin')throw new InputError('Only Kevin may submit expenses.',403);
  const reference=required(body.reference,'Reference').toUpperCase();
  if(!/^E[0-9A-Z_-]+$/.test(reference))throw new InputError('Expense reference must start with E and contain letters, numbers, _ or -.');
  const category=required(body.category,'Category');
  if(!['Materials','Travel','Other'].includes(category))throw new InputError('Category must be Materials, Travel, or Other.');
  const allocation=required(body.allocation,'Proposed allocation');
  if(!['A','B','Company overhead'].includes(allocation))throw new InputError('Invalid proposed allocation.');
  return {reference,reporter_id:actor,description:required(body.description,'Description'),category,amount_cents:cents(body.amount),proposed_allocation:allocation,final_allocation:allocation==='Company overhead'?allocation:null,status:allocation==='Company overhead'?'Allocated':'Awaiting allocation'};
}
export function commissions(sale){
  if(sale.status!=='Approved')return {pool:0,r:0,a:0,j:0};
  const pool=Math.round(sale.amount_cents/10),pct=[sale.final_r,sale.final_a,sale.final_j];
  const shares=pct.map(p=>Math.round(pool*p/100));
  const largest=pct.indexOf(Math.max(...pct));
  shares[largest]+=pool-shares.reduce((a,b)=>a+b,0);
  return {pool,r:shares[0],a:shares[1],j:shares[2]};
}
export function dashboard(sales,expenses){
  const projects={A:{income:0,commissions:0,expenses:0,result:0},B:{income:0,commissions:0,expenses:0,result:0}};
  const earned={richard:0,anastasia:0,'jean-claude':0};
  let overhead=0,awaiting=0,totalExpenses=0;
  for(const s of sales){if(s.status!=='Approved')continue;const c=commissions(s);projects[s.project].income+=s.amount_cents;projects[s.project].commissions+=c.pool;earned.richard+=c.r;earned.anastasia+=c.a;earned['jean-claude']+=c.j;}
  for(const e of expenses){totalExpenses+=e.amount_cents;if(e.status==='Awaiting allocation')awaiting+=e.amount_cents;else if(e.final_allocation==='Company overhead')overhead+=e.amount_cents;else projects[e.final_allocation].expenses+=e.amount_cents;}
  for(const p of Object.values(projects))p.result=p.income-p.commissions-p.expenses;
  const income=projects.A.income+projects.B.income,commissionExpense=projects.A.commissions+projects.B.commissions;
  return {projects,overhead,awaiting,totalExpenses,income,commissionExpense,companyResult:income-commissionExpense-totalExpenses,earned};
}
