// The click and the pitch, on the page — that they open there rather than
// closing the score, and that the metronome actually runs.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-aids-check.mjs
import puppeteer from 'puppeteer-core';
const SHELL=process.env.CHROME_SHELL ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const OUT='/private/tmp/claude-501/-Users-iankaroly/ce11cd8a-28a2-4300-aec4-2d2bcf199488/scratchpad';
const b=await puppeteer.launch({executablePath:SHELL,headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream']});
const p=await b.newPage();
await p.setViewport({width:414,height:896,deviceScaleFactor:2,hasTouch:true,isMobile:true});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
const xml=()=>{const ms=[];for(let m=1;m<=60;m++){let n='';for(let i=0;i<4;i++)n+='<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>';ms.push(`<measure number="${m}">`+(m===1?'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>':'')+n+'</measure>');}return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list><part id="P1">${ms.join('')}</part></score-partwise>`;};
await p.goto('http://localhost:5199/',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await p.evaluate(async(x)=>{
  document.querySelector('#welcome')?.remove();document.querySelector('#welcome-card')?.remove();
  const {openReader}=await import('/src/ui/reader.js');
  await openReader({id:'aids',name:'Suite No. 1',xml:x,kind:'notation'});
  await new Promise(r=>setTimeout(r,1000));
},xml());
const pick=async(name)=>p.evaluate((n)=>{
  document.querySelector('#reader-menu-btn')?.click();
  return new Promise(r=>setTimeout(()=>{
    const row=[...document.querySelectorAll('#reader-menu .reader-menu-row')].find(x=>new RegExp(n,'i').test(x.textContent));
    row?.click(); r(!!row);
  },350));
},name);
console.log('metronome row:', await pick('Metronome'));
await new Promise(r=>setTimeout(r,500));
let st=await p.evaluate(()=>{const a=document.querySelector('#reader-aids');return {hidden:a?.hidden,showing:a?.dataset.showing,bpm:a?.querySelector('.aid-bpm')?.textContent,name:a?.querySelector('.aid-tempo-name')?.textContent};});
console.log('after metronome:', JSON.stringify(st));
await p.evaluate(()=>document.querySelector('#reader-aids .aid-play')?.click());
await new Promise(r=>setTimeout(r,900));
console.log('running:', await p.evaluate(()=>document.querySelector('#reader-aids .aid-play')?.textContent));
await p.evaluate(()=>{for(let i=0;i<5;i++)[...document.querySelectorAll('#reader-aids .aid-chip')].find(c=>c.textContent==='+')?.click();});
console.log('after +:', await p.evaluate(()=>document.querySelector('#reader-aids .aid-bpm')?.textContent));
await p.screenshot({path:`${OUT}/aids-metro.png`});
await p.evaluate(()=>document.querySelector('#reader-aids .aid-play')?.click());
console.log('tuner row:', await pick('Tuner'));
await new Promise(r=>setTimeout(r,900));
st=await p.evaluate(()=>{const a=document.querySelector('#reader-aids');return {showing:a?.dataset.showing,note:a?.querySelector('.aid-note')?.textContent,cents:a?.querySelector('.aid-cents')?.textContent};});
console.log('after tuner:', JSON.stringify(st));
await p.screenshot({path:`${OUT}/aids-tuner.png`});
const ok = true;
console.log(errs.length?`ERRORS: ${[...new Set(errs)].slice(0,4).join(' | ')}`:'clean');
await b.close();

