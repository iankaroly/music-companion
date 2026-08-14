// Break the drawing path on purpose and check the stroke survives anyway.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-rescue-check.mjs
//
// The pencil has lost strokes on a real iPad in ways nothing here could
// reproduce, three times. So rather than only testing the path that works,
// this SABOTAGES it — getCoalescedEvents is made to throw on every single
// move, which is the shape of the failure — and asserts the mark is made
// regardless, rebuilt from the raw positions the outermost handler recorded.
import puppeteer from 'puppeteer-core';
const SHELL=process.env.CHROME_SHELL ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const W=414,H=896,MID=430;
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
  localStorage.removeItem('readerPencilSeen');
  const {openReader}=await import('/src/ui/reader.js');
  const {saveAnnotations}=await import('/src/store/db.js');
  await saveAnnotations('rescue',[]);
  await openReader({id:'rescue',name:'Rescue',xml:x,kind:'notation'});
  await new Promise(r=>setTimeout(r,1000));
  document.querySelector('#reader-annotate')?.click();
},xml());
await new Promise(r=>setTimeout(r,400));
const marks=()=>p.evaluate(async()=>{const {loadAnnotations}=await import('/src/store/db.js');
  return (await loadAnnotations('rescue')).length;});
const pen=(t,x,y)=>cdp.send('Input.dispatchMouseEvent',{type:t,x,y,button:t==='mouseMoved'?'none':'left',buttons:t==='mouseReleased'?0:1,pointerType:'pen',force:0.6});
const draw=async(y)=>{await pen('mousePressed',W*0.2,y);
  for(let i=1;i<=16;i++) await pen('mouseMoved',W*0.2+i*14,y+Math.sin(i/3)*8);
  await pen('mouseReleased',W*0.2+224,y); await new Promise(r=>setTimeout(r,900));};

console.log('--- normal ---');
let a=await marks(); await draw(MID); console.log('marks', a, '->', await marks());

// Now sabotage getCoalescedEvents so the whole move handler throws, which is
// the failure mode the net exists for.
await p.evaluate(()=>{ PointerEvent.prototype.getCoalescedEvents = function(){ throw new TypeError('sabotage'); }; });
console.log('--- with the move handler throwing every time ---');
a=await marks(); await draw(MID+70);
const after=await marks();
console.log('marks', a, '->', after, after===a+1 ? 'RESCUED' : 'LOST');
await b.close();
process.exit(after===a+1?0:1);
