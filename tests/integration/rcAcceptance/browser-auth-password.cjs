'use strict';
// Real stack, the RELEASE sign-in build (VITE_PASSWORD_AUTH_ENABLED=true): register → (confirmation gate) →
// sign in → account → sign out revokes the server session; the screens fit a phone. NON-production Auth:
// the local GoTrue auto-confirms (no mail server), so the confirmation step is asserted as the screen the
// person sees, not as a delivered email. Synthetic addresses only.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto'),{chromium}=require('playwright-core');
const results=[];let browser;const origin='http://127.0.0.1:4335',target=new URL(process.env.BASE_URL);
const proxy=http.createServer((req,res)=>{const up=http.request(new URL(req.url,target),{method:req.method,headers:{...req.headers,host:target.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up)});
const pass=(name,extra={})=>{results.push({case:name,status:'PASS',...extra});fs.writeFileSync('/evidence/BROWSER_AUTH_PASSWORD.json',JSON.stringify({backend:'real app + local GoTrue (non-production)',results},null,2));console.log('PASS '+name)};
(async()=>{
 await new Promise(r=>proxy.listen(4335,'127.0.0.1',r));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const email='pw.ui.'+Date.now()+'@example.invalid',password='Ui-'+crypto.randomBytes(9).toString('hex');
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const ctx=await browser.newContext({viewport});await ctx.addInitScript(()=>{localStorage.setItem('hf_lang','en')});const page=await ctx.newPage();
  await page.goto(origin+'/login',{waitUntil:'networkidle'});
  assert.equal(await page.locator('input[type=password]').count(),1,'release build shows the password screen');
  assert.equal(await page.getByRole('heading',{name:'Sign in',exact:true}).count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' no horizontal overflow');
  await page.screenshot({path:`/evidence/auth-login-${name}.png`,fullPage:true});
  await page.goto(origin+'/register',{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' register no overflow');
  await page.screenshot({path:`/evidence/auth-register-${name}.png`,fullPage:true});
  await ctx.close();
 }
 pass('desktop and phone: the sign-in and registration screens render with the password form and no overflow');
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addInitScript(()=>{localStorage.setItem('hf_lang','en')});const page=await ctx.newPage();
 await page.goto(origin+'/register',{waitUntil:'networkidle'});
 await page.locator('input[type=email]').fill(email);
 const pwds=page.locator('input[type=password]');assert.equal(await pwds.count(),2,'password + repeat');
 await pwds.nth(0).fill(password);await pwds.nth(1).fill(password+'x');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 assert.ok(await page.locator('[role=alert]').count(),'mismatched passwords are refused before any request');
 await pwds.nth(1).fill(password);
 const [reg]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/password/register')&&r.request().method()==='POST'),page.getByRole('button',{name:'Create account',exact:true}).click()]);
 assert.equal(reg.status(),200);await page.getByRole('heading',{name:'Confirm your email'}).waitFor();
 assert.equal(await page.evaluate(()=>!!localStorage.getItem('hf_token')),false,'registration alone never signs in');
 pass('registration through the screen ends at "Confirm your email" without signing in');
 await page.goto(origin+'/login',{waitUntil:'networkidle'});
 await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill('Wrong-'+password);
 const [bad]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/password/login')),page.getByRole('button',{name:'Sign in',exact:true}).click()]);
 assert.equal(bad.status(),401);await page.locator('[role=alert]').waitFor();
 await page.locator('input[type=password]').fill(password);
 const [ok]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/password/login')),page.getByRole('button',{name:'Sign in',exact:true}).click()]);
 assert.equal(ok.status(),200);await page.waitForURL('**/account');
 const token=await page.evaluate(()=>localStorage.getItem('hf_token'));assert.ok(token);
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/^sb-|supabase/i.test(k))),false,'no Supabase session in the browser');
 await page.screenshot({path:'/evidence/auth-account-after-signin.png',fullPage:true});
 pass('a wrong password shows an error; the right one opens the account page with no Supabase session in the browser');
 const [out]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/logout')),page.getByRole('button',{name:'Sign out',exact:true}).click()]);
 assert.equal(out.status(),200);await page.waitForURL('**/login');
 assert.equal(await page.evaluate(()=>localStorage.getItem('hf_token')),null);
 const after=await fetch(process.env.BASE_URL+'/api/workspaces',{headers:{authorization:'Bearer '+token}});assert.equal(after.status,401,'server session revoked');
 pass('sign out returns to the sign-in screen and the server refuses the old token (401)');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();proxy.close()});
