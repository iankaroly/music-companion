// Ten taps in the same spot: does every one turn a page, and does the page
// number keep up with the finger rather than lagging and then jumping?
//
//   npm run dev            (in another terminal, on port 5199)
//   SLOW=6 node tools/reader-taps-check.mjs      # on an iPad-ish processor
// FIRST one take to be visible?
import puppeteer from 'puppeteer-core';
const SHELL=process.env.CHROME_SHELL ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const W=414,H=896;
const SLOW=Number(process.env.SLOW ?? 6);
const b=await puppeteer.launch({executablePath:SHELL,headless:true,args:['--no-sandbox']});
const p=await b.newPage();
await p.setViewport({width:W,height:H,deviceScaleFactor:2,hasTouch:true,isMobile:true});
const cdp=await p.createCDPSession();
if (SLOW>1) await cdp.send('Emulation.setCPUThrottlingRate',{rate:SLOW});
p.on('pageerror',e=>console.log('ERR',String(e)));
await p.goto(`http://localhost:${process.env.PORT ?? 5199}/`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2500));
await p.evaluate(async(SETTLE)=>{
  document.querySelector('#welcome')?.remove();document.querySelector('#welcome-card')?.remove();
  const db=await import('/src/store/db.js');const reader=await import('/src/ui/reader.js');
  // A real PDF: rasterising a page is what competes with a turn.
  const PW=612,PH=1600,N=16;
  let content='0 0 0 RG 2 w\n';
  for(let s2=0;s2<16;s2++){const top=PH-190-s2*86;
    for(let l=0;l<5;l++) content+=`110 ${top-l*9} m 500 ${top-l*9} l S\n`;
    for(let d=0;d<40;d++) content+=`${120+d*9} ${top-20} m ${124+d*9} ${top-20} l S\n`;}
  const objs=[];objs[1]='<</Type/Catalog/Pages 2 0 R>>';
  const kids=[];for(let i=0;i<N;i++)kids.push(`${3+i*2} 0 R`);
  objs[2]=`<</Type/Pages/Kids[${kids.join(' ')}]/Count ${N}>>`;
  for(let i=0;i<N;i++){objs[3+i*2]=`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PW} ${PH}]/Contents ${4+i*2} 0 R/Resources<<>>>>`;
    objs[4+i*2]=`<</Length ${content.length}>>\nstream\n${content}\nendstream`;}
  let pdf='%PDF-1.4\n';const offs=[];const last=2+N*2;
  for(let i=1;i<=last;i++){offs[i]=pdf.length;pdf+=`${i} 0 obj\n${objs[i]}\nendobj\n`;}
  const xref=pdf.length;pdf+=`xref\n0 ${last+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=last;i++)pdf+=`${String(offs[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<</Size ${last+1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes=new Uint8Array(pdf.length);for(let i=0;i<pdf.length;i++)bytes[i]=pdf.charCodeAt(i)&0xff;
  const id=await db.savePagesScore({name:'Taps',source:'pdf',pageCount:N,data:bytes.buffer});
  await reader.openReader({id,name:'Taps',kind:'pages',source:'pdf'});
  await new Promise(r=>setTimeout(r,Number(SETTLE)));
}, process.env.SETTLE ?? 3000);
const where=()=>p.evaluate(()=>document.querySelector('#reader-count')?.textContent??'?');
const bare=()=>p.evaluate(()=>document.querySelector('#reader')?.classList.contains('bare'));
const tap=async(x,y,id)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
if(!(await bare())) { await tap(W*0.5,H*0.5,1); await new Promise(r=>setTimeout(r,350)); }
console.log('start:', await where(), '| CPU x'+SLOW);
const from=await where();
const n=(t)=>Number((t.match(/p\. (\d+)/)??[])[1]??0);
const start=n(from);
// Ten taps in the same spot, as fast as a finger can, sampling the page number
// after EACH one — the complaint is that the reader stops answering partway
// through and then jumps, which only a sample per tap can show.
const seen=[];
for(let i=0;i<10;i++){
  await tap(W*0.9,H*0.7,10+i);
  await new Promise(r=>setTimeout(r,Number(process.env.GAP ?? 90)));
  seen.push(n(await where())-start);
}
console.log('pages turned after each tap:', seen.join(', '));
const lagged = seen.some((v,i)=>v < i+1);
console.log(lagged ? 'LAGGED — the reader stopped answering partway' : 'every tap landed at once');
await new Promise(r=>setTimeout(r,4000));
console.log('after settling:', await where());
const moved=n(await where())-start;
console.log(`moved ${moved} pages for 10 taps`);
const ok = moved===10 && !lagged;
console.log(ok?'ALL PASS':'SOME FAILED');
await b.close();
process.exit(ok?0:1);
