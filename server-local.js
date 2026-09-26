import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {handle} from './api/index.js';
const base=new URL('./public/',import.meta.url),port=Number(process.env.PORT||3000);
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await handle(new Request(`http://localhost:${port}${req.url}`,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const file=files[req.url.split('?')[0]];if(!file){res.writeHead(404);res.end();return;}
    const data=await readFile(new URL(file,base));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});res.end(data);
  }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(port,()=>console.log(`http://localhost:${port}`));
