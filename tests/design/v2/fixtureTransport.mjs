// Browser UI fixtures only. Serves the SAME built application and fixture map as
// serve.mjs, in-process, when Windows loopback cannot be reached. No backend proof.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {routes} from './fixtures.mjs'
const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../client/dist')
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png'}
export async function installFixtureTransport(context, { root = dist } = {}){
 await context.route('http://127.0.0.1:4332/**',async route=>{
  const req=route.request(),u=new URL(req.url())
  if(u.pathname.startsWith('/api/')){
   let handler=routes[req.method()+' '+u.pathname]
   if(!handler)for(const [key,fn]of Object.entries(routes)){const [method,p]=key.split(' ');if(method===req.method()&&p.includes(':')&&new RegExp('^'+p.replace(/:[^/]+/g,'[^/]+')+'$').test(u.pathname)){handler=fn;break}}
   return route.fulfill({status:handler?200:404,contentType:'application/json',body:JSON.stringify(handler?handler(u,{method:req.method(),headers:req.headers()}):{error:'not_in_fixture'})})
  }
  let f=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html')
  return route.fulfill({status:200,contentType:types[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)})
 })
}
