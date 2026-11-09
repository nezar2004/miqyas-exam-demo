import express from 'express';
import { resolve } from 'node:path';
import { handleApi } from './index.mjs';

for (const name of ['ADMIN_EMAIL','ADMIN_PASSWORD']) {
  if (!process.env[name]) throw new Error('Set '+name+' before starting Miqyas.');
}

const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','same-origin');
  res.set('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});
app.get('/health',(_req,res)=>res.send('ok'));
app.use(express.json({limit:'32kb',verify(req,_res,body){req.rawBody=body;}}));
app.all('/api/{*path}',handleApi);
app.use(express.static(resolve(import.meta.dirname,'../dist')));
app.listen(Number(process.env.PORT || 3000),'0.0.0.0');
