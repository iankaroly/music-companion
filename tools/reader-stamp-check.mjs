// A stamp you have just placed, resized by pinching it.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-stamp-check.mjs
import puppeteer from 'puppeteer-core';
const SHELL=process.env.CHROME_SHELL ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const W=414,H=896,MID=440;
const b=await puppeteer.launch({executablePath:SHELL,headless:true,args:['--no-sandbox']});
const p=await b.newPage();
await p.setViewport({width:W,height:H,deviceScaleFactor:2,hasTouch:true,isMobile:true});
const cdp=await p.createCDPSession();
p.on('pageerror',e=>console.log('ERR',String(e)));
const xml=()=>{const ms=[];for(let m=1;m<=40;m++){let n='';for(let i=0;i<4;i++)n+='<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>';ms.push(`<measure number="${m}">`+(m===1?'<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>':'')+n+'</measure>');}return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list><part id="P1">${ms.join('')}</part></score-partwise>`;};
await p.goto(`http://localhost:${process.env.PORT ?? 5199}/`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await p.evaluate(async(x)=>{
  document.querySelector('#welcome')?.remove();document.querySelector('#welcome-card')?.remove();
  const {openReader}=await import('/src/ui/reader.js');
  const {saveAnnotations}=await import('/src/store/db.js');
  await saveAnnotations('stamp',[]);
  await openReader({id:'stamp',name:'Stamp',xml:x,kind:'notation'});
  await new Promise(r=>setTimeout(r,1000));
  document.querySelector('#reader-annotate')?.click();
  await new Promise(r=>setTimeout(r,200));
  document.querySelector('#reader-stamps')?.click();
  await new Promise(r=>setTimeout(r,300));
  document.querySelector('.pick-pop .pick-row')?.click();   // the sharp
  await new Promise(r=>setTimeout(r,300));
},xml());
const marks=()=>p.evaluate(async()=>{const {loadAnnotations}=await import('/src/store/db.js');
  const all=await loadAnnotations('stamp');return all.map(s=>({t:s.type,size:s.size}));});
// place it with the pencil
const pen=(t,x,y)=>cdp.send('Input.dispatchMouseEvent',{type:t,x,y,button:t==='mouseMoved'?'none':'left',buttons:t==='mouseReleased'?0:1,pointerType:'pen'});
await pen('mousePressed',W*0.4,MID); await pen('mouseReleased',W*0.4,MID);
await new Promise(r=>setTimeout(r,900));
console.log('placed:', JSON.stringify(await marks()));
console.log('picked up?', await p.evaluate(()=>{const b=document.querySelector('#reader-selection');return b && !b.hidden ? b.textContent.trim().slice(0,20):'no';}));
// pinch it bigger
const t=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts});
await t('touchStart',[{x:W*0.35,y:MID,id:1},{x:W*0.45,y:MID,id:2}]);
for(let i=1;i<=10;i++) await t('touchMove',[{x:W*0.35-i*6,y:MID,id:1},{x:W*0.45+i*6,y:MID,id:2}]);
await t('touchEnd',[{x:W*0.45+60,y:MID,id:2}]);
await t('touchEnd',[]);
await new Promise(r=>setTimeout(r,1200));
const after=await marks();
console.log('after pinching out:', JSON.stringify(after));
const before=(await p.evaluate(()=>0),null);
const grew = after[0] && after[0].size > 2.0;
console.log(grew?'ALL PASS — the stamp grew':'SOME FAILED');
await b.close();
process.exit(grew?0:1);
