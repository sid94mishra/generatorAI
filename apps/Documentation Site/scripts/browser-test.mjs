import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
const base=(process.env.DOCS_TEST_URL||'http://127.0.0.1:4317/').replace(/\/?$/,'/');
const build=path.resolve(process.env.DOCS_BUILD_DIR||'build');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const exhaustive=!process.argv.includes('--smoke');
const reportFile=process.env.DOCS_TEST_REPORT||'audit/browser-results.json';
const routes=walk(build).filter(p=>p.endsWith('/index.html')).map(p=>path.relative(build,p).replace(/index\.html$/,'').replaceAll(path.sep,'/')).sort();
const screenshots=path.resolve('audit/screenshots'); fs.mkdirSync(screenshots,{recursive:true});
const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.DOCS_BROWSER_EXECUTABLE||(fs.existsSync(macChrome)?macChrome:undefined);
const browser=await chromium.launch({headless:true,executablePath});
const errors=[],checks=[],expectedNotFoundErrors=[];
const notFoundUrl=new URL('__documentation_missing_page__/',base).href;
const paletteData=JSON.parse(fs.readFileSync('src/theme-data/palettes.json','utf8'));
const themeTokens=JSON.parse(fs.readFileSync('audit/theme-tokens.json','utf8'));
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();
page.on('pageerror',e=>errors.push({kind:'pageerror',url:page.url(),message:e.message}));
page.on('console',m=>{
 if(m.type()!=='error')return;
 const entry={kind:'console',url:page.url(),message:m.text()};
 if(m.location().url===notFoundUrl&&/Failed to load resource:.*404/.test(m.text()))expectedNotFoundErrors.push(entry);
 else errors.push(entry);
});
const run=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message.slice(0,240));}};
if(exhaustive) for(const size of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
 await page.setViewportSize(size);
 for(const [i,route] of routes.entries()){
  await run(`${size.name}: ${route||'home'}`,async()=>{
   const response=await page.goto(new URL(route,base).href,{waitUntil:'domcontentloaded'});
   await expect(page.locator('html')).toHaveAttribute('data-has-hydrated','true');
   expect(response.status()).toBe(200);
   await expect(page.locator('main h1').first()).toBeVisible();
   expect(await page.locator('main').innerText()).not.toContain('Page Not Found');
   const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,images:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)}));
   expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);
   expect(geometry.images).toEqual([]);
   await page.screenshot({path:path.join(screenshots,`${size.name}-${route.replaceAll('/','-')||'home'}.png`)});
  });
  if(i%10===0)console.log(`${size.name}: ${i+1}/${routes.length} pages checked`);
 }
}
await page.setViewportSize({width:1440,height:1000});
await page.goto(base,{waitUntil:'networkidle'});
await run('Homepage primary navigation',async()=>{await page.getByRole('link',{name:'Start building'}).click();await expect(page).toHaveURL(/guide\/quickstart/);});
await run('Search finds documented workflow content',async()=>{
 const input=page.locator('.navbar').getByLabel('Search',{exact:true});await input.fill('checkpoint');
 await expect(page.locator('[class*="suggestion"]').first()).toBeVisible({timeout:15000});
 await page.screenshot({path:path.join(screenshots,'search-results.png')});
 await input.press('ArrowDown');await input.press('Enter');
 await expect(page).not.toHaveURL(/guide\/quickstart/);
 expect(await page.locator('main').innerText()).toMatch(/checkpoint/i);
});
await run('Dark theme toggle',async()=>{
 await page.getByRole('button',{name:/Switch between dark and light mode/i}).click();
 if(await page.locator('html').getAttribute('data-theme')!=='dark')await page.getByRole('button',{name:/Switch between dark and light mode/i}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.goto(base,{waitUntil:'networkidle'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.screenshot({path:path.join(screenshots,'home-dark.png')});
});
await run('Code copy control',async()=>{
 await page.goto(new URL('guide/quickstart/',base).href,{waitUntil:'networkidle'});
 const copy=page.getByRole('button',{name:/Copy code/i}).first();await copy.click({force:true});
 await expect(page.getByRole('button',{name:/Copied/i}).first()).toBeAttached();
});
await run('Keyboard skip link',async()=>{
 await page.goto(base);await page.keyboard.press('Tab');
 await expect(page.getByRole('link',{name:/Skip to main content/i})).toBeFocused();
});
await run('Mobile drawer and navigation',async()=>{
 await page.setViewportSize({width:390,height:844});await page.goto(base,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:/Toggle navigation bar/i}).click();
 await expect(page.locator('.navbar-sidebar')).toBeVisible();
 await page.screenshot({path:path.join(screenshots,'mobile-navigation.png')});
 await page.locator('.navbar-sidebar').getByRole('link',{name:'Architecture',exact:true}).click();
 await expect(page).toHaveURL(/architecture\/overview/);
});
await run('Mobile search and result navigation',async()=>{
 await page.goto(base,{waitUntil:'networkidle'});
 const search=page.locator('.navbar').getByLabel('Search',{exact:true});
 await search.fill('workflow');await expect(page.locator('[class*=\"suggestion\"]').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:path.join(screenshots,'mobile-search.png')});
 await search.press('Enter');await expect(page).toHaveURL(/features|architecture|guide/);
});
await run('Short phone search stays within viewport',async()=>{
 await page.setViewportSize({width:360,height:640});await page.goto(base,{waitUntil:'networkidle'});
 const search=page.locator('.navbar').getByLabel('Search',{exact:true});await search.fill('workflow');
 const dropdown=page.locator('[class*=\"dropdownMenu\"]');await expect(dropdown).toBeVisible();
 expect(await dropdown.evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
 await page.screenshot({path:path.join(screenshots,'small-phone-search.png')});
 await search.press('Escape');
});
await run('Not found recovery',async()=>{
 const response=await page.goto(notFoundUrl);expect(response.status()).toBe(404);
 await expect(page.getByRole('heading',{name:/Page Not Found/i})).toBeVisible();
 await page.locator('.navbar__brand').first().click();await expect(page).toHaveURL(base);
});
await run('Tablet homepage layout',async()=>{
 await page.setViewportSize({width:820,height:1180});await page.goto(base,{waitUntil:'networkidle'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:path.join(screenshots,'home-tablet.png')});
});
const rgb=hex=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
await page.setViewportSize({width:1440,height:1000});
await page.goto(base,{waitUntil:'networkidle'});
for(const theme of paletteData.themes)for(const mode of ['light','dark'])await run(`Application theme: ${theme.id} / ${mode}`,async()=>{
 if(await page.locator('html').getAttribute('data-theme')!==mode)await page.getByRole('button',{name:/Switch between dark and light mode/i}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme',mode);
 const picker=page.locator('.docs-appearance');if(await picker.getAttribute('open')===null)await picker.locator('summary').click();
 await page.getByLabel('Documentation palette',{exact:true}).selectOption(theme.id);
 for(const accent of paletteData.accents){
  await page.getByLabel('Documentation accent',{exact:true}).selectOption(accent.id);
  const expected=themeTokens.find(t=>t.theme===theme.id&&t.mode===mode&&t.accent===accent.id);
  expect(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(rgb(expected.background));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await page.locator('body').evaluate(el=>getComputedStyle(el).color)).toBe(rgb(expected.foreground));
  expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--app-primary').trim())).toBe(expected.primary);
  expect(await page.locator('.hero-actions .button--primary').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(rgb(expected.fill));
 }
 await page.getByLabel('Documentation accent',{exact:true}).selectOption('blue');
 await picker.locator('summary').click();
 await page.screenshot({path:path.join(screenshots,`palette-${theme.id}-${mode}.png`)});
});
await run('Appearance persistence, Escape, and small-screen controls',async()=>{
 await page.locator('.docs-appearance summary').click();await page.getByLabel('Documentation palette',{exact:true}).selectOption('github');await page.getByLabel('Documentation accent',{exact:true}).selectOption('violet');
 await page.keyboard.press('Escape');await expect(page.locator('.docs-appearance')).not.toHaveAttribute('open','');
 await page.reload({waitUntil:'networkidle'});await expect(page.locator('html')).toHaveAttribute('data-palette','github');await expect(page.locator('html')).toHaveAttribute('data-accent','violet');
 await page.setViewportSize({width:360,height:640});await page.locator('.docs-appearance summary').click();
 expect(await page.locator('.appearance-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})).toBe(true);
 await page.screenshot({path:path.join(screenshots,'mobile-appearance.png')});
 await page.getByLabel('Documentation accent',{exact:true}).selectOption('blue');await page.keyboard.press('Escape');
});
await run('Configuration examples are downloadable from the served base path',async()=>{
 const examples=fs.readdirSync('static/examples').filter(f=>f.endsWith('.json'));
 for(const file of examples){const response=await context.request.get(new URL(`examples/${file}`,base).href);expect(response.status()).toBe(200);expect(await response.json()).toEqual(JSON.parse(fs.readFileSync(path.join('static/examples',file),'utf8')));}
 await page.goto(new URL('configuration/examples/',base).href,{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Worked configuration examples',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Download this JSON'}).first()).toHaveAttribute('href',new RegExp(`${new URL(base).pathname}examples/create-chat.json$`));
});
const result={base,exhaustive,routes:routes.length,checks,errors,expectedNotFoundErrors,passed:checks.every(c=>c.passed)&&errors.length===0};
fs.writeFileSync(reportFile,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({routes:routes.length,checks:checks.length,failed:checks.filter(c=>!c.passed),errors,passed:result.passed},null,2));
// Save evidence before teardown: Chrome can exit while its close handshake stalls.
let shutdownTimer;
await Promise.race([
 browser.close(),
 new Promise(resolve=>{shutdownTimer=setTimeout(()=>{console.warn('Browser cleanup timed out; results were already saved.');resolve();},15000);}),
]);
clearTimeout(shutdownTimer);
process.exit(result.passed?0:1);
