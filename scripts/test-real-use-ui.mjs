import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import os from 'os';
const BASE='http://127.0.0.1:5174';
const exe=path.join(os.homedir(),'AppData','Local','ms-playwright','chromium-1247','chrome-win64','chrome.exe');
const ALL_PAGES = [
  '/pos', '/sells', '/inventory', '/purchases', '/purchase-history',
  '/crm', '/reports', '/pharmarack-cart', '/live-cart', '/investigation',
  '/ai-engineering', '/learning', '/dispatch', '/website-orders', '/online-catalog',
  '/portal', '/returns', '/database', '/phone-sales', '/dashboard',
  '/migration', '/mail', '/settings', '/audit'
];
const PAGES = process.env.PAGES
  ? process.env.PAGES.split(',').filter(Boolean).map(x => '/' + x.replace(/^\/+/, ''))
  : ALL_PAGES;
if (!fs.existsSync('test-shots')) fs.mkdirSync('test-shots', { recursive: true });
const DANGER=/delete|remove|clear|reset|logout|log out|sign out|send|pay|save|submit|confirm|restore|wipe|purge|cancel order|checkout|print|backup now|sync|import|disconnect|unlink|approve|reject|mark|complete|order now|place|dispatch now|retrain|run|start|scan|upload|export|download|\bclose\b|workspace|staff\s*workspace/i;
const browser=await chromium.launch({executablePath:exe,headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:false});
ctx.setDefaultTimeout(2000);
let page;let cur='';const issues=[];
const wire=pg=>{pg.on('dialog',d=>(d.type()==='beforeunload'?d.accept():d.dismiss()).catch(()=>{}));
pg.on('pageerror',e=>issues.push({page:cur,type:'pageerror',msg:e.message}));
pg.on('console',m=>{if(m.type()==='error'&&!/beforeunload/.test(m.text()))issues.push({page:cur,type:'console',msg:m.text().slice(0,200)})});
pg.on('response',r=>{if(r.status()>=400&&r.url().includes('/api/'))issues.push({page:cur,type:'http'+r.status(),msg:r.url().replace(BASE,'')})});
};
const rows=[];
for(const p of PAGES){
  if(page)await page.close().catch(()=>{});page=await ctx.newPage();wire(page);
  cur=p;const row={page:p,buttonsClicked:0,tabsClicked:0,inputsTyped:0,crashed:false,blank:false};
  try{
    await page.goto(BASE+p,{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForTimeout(1500);
    const txt=(await page.locator('body').innerText()).trim();
    row.blank=txt.length<40; row.errorBoundary=/something went wrong|application error|unexpected error/i.test(txt);
    await page.screenshot({path:`test-shots/${p.slice(1)}.png`});
    // type in visible text inputs
    const inputs=page.locator('input[type=text]:visible,input[type=search]:visible,input:not([type]):visible');
    const n=Math.min(await inputs.count(),4);
    for(let i=0;i<n;i++){const el=inputs.nth(i);if(await el.isVisible({timeout:500}).catch(()=>false)&&await el.isEditable({timeout:500}).catch(()=>false)){await el.fill('para',{timeout:1000}).catch(()=>{});await page.waitForTimeout(200);await el.fill('',{timeout:1000}).catch(()=>{});row.inputsTyped++;}}
    // click safe buttons in main
    const btns=page.locator('button:visible:not(aside button):not(nav button):not(header button)');
    const total=Math.min(await btns.count(),20);
    for(let i=0;i<total;i++){
      const b=btns.nth(i);
      const label=((await b.innerText({timeout:500}).catch(()=>''))+' '+(await b.getAttribute('title',{timeout:500}).catch(()=>'')||'')+' '+(await b.getAttribute('aria-label',{timeout:500}).catch(()=>'')||'')).trim();
      if(DANGER.test(label)||await b.isDisabled({timeout:500}).catch(()=>true))continue;
      const url0=page.url();let reqs=0;const onReq=()=>reqs++;page.on('request',onReq);
      const h0=await page.evaluate(()=>document.body.innerHTML.length+'|'+document.querySelectorAll('*').length).catch(()=>'');
      await b.click({timeout:1500,noWaitAfter:true}).catch(()=>{});
      row.buttonsClicked++;
      await page.waitForTimeout(350);
      const h1=await page.evaluate(()=>document.body.innerHTML.length+'|'+document.querySelectorAll('*').length).catch(()=>'');
      page.off('request',onReq);
      if(h0===h1&&reqs===0&&page.url()===url0){(row.noEffect=row.noEffect||[]).push(label.replace(/\s+/g,' ').slice(0,50)||'(icon)');}
      await page.keyboard.press('Escape').catch(()=>{});
      if(!page.url().startsWith(BASE+p.split('?')[0])){await page.goto(BASE+p,{waitUntil:'domcontentloaded'});await page.waitForTimeout(600);}
    }
    const after=(await page.locator('body').innerText()).trim();
    if(/something went wrong|application error/i.test(after))row.crashed=true;
  }catch(e){row.crashed=true;row.error=e.message.slice(0,150)}
  rows.push(row);console.log(p,JSON.stringify(row));
}
await browser.close();
fs.writeFileSync('test-report-real-use-'+(process.env.TAG||'x')+'.json',JSON.stringify({rows,issues},null,1));
console.log('\nISSUES:',issues.length);
const seen=new Set();for(const i of issues){const k=i.page+i.type+i.msg;if(seen.has(k))continue;seen.add(k);console.log(i.page,i.type,i.msg)}
