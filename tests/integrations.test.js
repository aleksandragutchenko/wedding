import test from 'node:test';
import assert from 'node:assert/strict';
import {db} from '../lib/integrations.js';

test('Supabase read retries one transient future-JWT response',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
 process.env.SUPABASE_URL='https://db.example';process.env.SUPABASE_SECRET_KEY='test';let calls=0;
 globalThis.fetch=async()=>++calls===1?Response.json({message:'JWT issued at future'},{status:401}):Response.json([{reference:'S01'}]);
 try{assert.deepEqual(await db('sales'),[{reference:'S01'}]);assert.equal(calls,2);}
 finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;}
});

