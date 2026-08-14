// The click strip: compact by default, and draggable to wherever it is not in
// the way of the music.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-drag-check.mjs
import puppeteer from 'puppeteer-core';
const SHELL=process.env.CHROME_SHELL ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const OUT='/private/tmp/claude-501/-Users-iankaroly/ce11cd8a-28a2-4300-aec4-2d2bcf199488/scratchpad';
const W=414,H=896;
const b=await puppeteer.launch({executablePath:SHELL,headless:true,args:['--no-sandbox']});
const p=await b.newPage();
await p.setViewport({width:W,height:H,deviceScaleFactor:2,hasTouch:true,isMobile:true});
const cdp=await p.createCDPSession();
p.on('pageerror',e=>console.log('ERR',String(e)));
const xml=()=>{const ms=[];for(let m=1;m<=60;m++){let n='';for(let i=0;i<4;i++)n+='<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>';ms.push(`<measure number="${m}">`+(m===1?'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>':'')+n+'</measure>');}return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list><part id="P1">${ms.join('')}</part></score-partwise>`;};
await p.goto(`http://localhost:${process.env.PORT ?? 5199}/`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await p.evaluate(async(x)=>{
  document.querySelector('#welcome')?.remove();document.querySelector('#welcome-card')?.remove();
  localStorage.removeItem('readerAidsAt');
  const {openReader}=await import('/src/ui/reader.js');
  await openReader({id:'drag',name:'Suite No. 1',xml:x,kind:'notation'});
  await new Promise(r=>setTimeout(r,1000));
  document.querySelector('#reader-menu-btn')?.click();
  await new Promise(r=>setTimeout(r,350));
  [...document.querySelectorAll('#reader-menu .reader-menu-row')].find(n=>/Metronome/i.test(n.textContent))?.click();
  await new Promise(r=>setTimeout(r,400));
},xml());
const box=()=>p.evaluate(()=>{const n=document.querySelector('#reader-aids');const r=n.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)};});
console.log('compact strip:', JSON.stringify(await box()));
await p.screenshot({path:`${OUT}/drag-before.png`});
// drag the grip to the top-left
const g=await p.evaluate(()=>{const n=document.querySelector('.aid-grip');const r=n.getBoundingClientRect();
  window.__hits=[];
  n.addEventListener('pointerdown',()=>window.__hits.push('grip pointerdown'),true);
  document.addEventListener('pointerdown',(e)=>window.__hits.push('doc pointerdown target='+(e.target.className||e.target.id||e.target.tagName)),true);
  return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,cs:getComputedStyle(n).display};});
console.log('grip box:', JSON.stringify(g));
const pen=(t,x,y)=>cdp.send('Input.dispatchMouseEvent',{type:t,x,y,button:t==='mouseMoved'?'none':'left',buttons:t==='mouseReleased'?0:1,pointerType:'touch'});
await pen('mousePressed',g.x,g.y);
for(let i=1;i<=12;i++) await pen('mouseMoved',g.x-(g.x-30)*i/12, g.y-(g.y-120)*i/12);
await pen('mouseReleased',30,120);
await new Promise(r=>setTimeout(r,400));
console.log('hits:', JSON.stringify(await p.evaluate(()=>window.__hits)));
console.log('after drag:', JSON.stringify(await box()));
await p.screenshot({path:`${OUT}/drag-after.png`});
// does it come back there?
const kept=await p.evaluate(()=>localStorage.getItem('readerAidsAt'));
console.log('remembered:', kept);
await p.evaluate(async()=>{
  const {hideAids,showAids}=await import('/src/ui/score-aids.js');
  hideAids(); await new Promise(r=>setTimeout(r,200)); showAids('metronome');
  await new Promise(r=>setTimeout(r,400));
});
console.log('after reopen:', JSON.stringify(await box()));
// and the extras open
await p.evaluate(()=>[...document.querySelectorAll('#reader-aids .aid-chip')].find(c=>c.textContent==='⋯')?.click());
await new Promise(r=>setTimeout(r,300));
console.log('with extras:', JSON.stringify(await box()));
await p.screenshot({path:`${OUT}/drag-extras.png`});
const moved = await p.evaluate(()=>{const r=document.querySelector('#reader-aids').getBoundingClientRect();
  return r.x < 60 && r.y < 200;});
const kept2 = await p.evaluate(()=>localStorage.getItem('readerAidsAt'));
console.log(moved && kept2 ? 'ALL PASS' : 'SOME FAILED');
await b.close();
process.exit(moved && kept2 ? 0 : 1);
