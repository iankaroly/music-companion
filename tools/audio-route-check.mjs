// Does a PARKED microphone still pin the output to the recording route?
//
// That pin is what made the metronome inaudible: a stream is kept open between
// uses so restarting costs nothing, so once anything had touched the mic the
// app claimed the record session for the rest of its life — and iOS plays that
// one quietly.
import puppeteer from 'puppeteer-core';
const SHELL=process.env.CHROME_SHELL ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const b=await puppeteer.launch({executablePath:SHELL,headless:true,args:['--no-sandbox']});
const p=await b.newPage();
await p.setViewport({width:414,height:896,deviceScaleFactor:2});
p.on('pageerror',e=>console.log('ERR',String(e)));
await p.goto(`http://localhost:${process.env.PORT ?? 5199}/`,{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
const out=await p.evaluate(async()=>{
  const c=await import('/src/audio/context.js');
  const said=[];
  // A microphone that IS listening: the record route is correct and must hold.
  c.watchMic(()=>true, ()=>true);
  c.setAudioSessionType('play-and-record');
  c.holdAudio('probe');
  c.wakeAudio();
  said.push('while listening: '+c.audioState().session);
  // …and now it stops and is PARKED: held, but not listening.
  c.watchMic(()=>false, ()=>true);
  c.wakeAudio();
  said.push('once parked:    '+c.audioState().session);
  said.push('reported as:    '+JSON.stringify({listening:c.audioState().micListening,parked:c.audioState().micParked}));
  c.releaseAudio('probe');
  return said;
});
out.forEach(l=>console.log(l));
const ok = out[0].includes('play-and-record') && out[1].includes('playback');
console.log(ok?'ALL PASS':'SOME FAILED');
await b.close();
process.exit(ok?0:1);
