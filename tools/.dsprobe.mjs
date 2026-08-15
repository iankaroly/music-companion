import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const OUT = '/private/tmp/claude-501/-Users-iankaroly/3cf48b2a-5a9c-4612-b149-47b748b870f7/scratchpad';
const b = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1500));
const png = await p.evaluate(async () => {
  const space=14, systems=2, sysGap=16, gapSpaces=6.6, noteGap=2.2;
  const down=1;
  const plan=(sys)=>[0,1,2,3,4].map((grp)=>({beams:1+((sys+grp)%3),steps:[8,10,12,8].map((s)=>s-(grp%3)),dir:down}));
  const layouts=[]; for(let s=0;s<systems;s++) layouts.push(plan(s));
  const spans=layouts.map(u=>u.reduce((a,x,i)=>a+(x.steps.length-1)*noteGap+(i?gapSpaces:0),0));
  const W=Math.round(space*Math.max(50,12+Math.max(...spans)));
  const H=Math.round(space*12+systems*space*sysGap+space*8);
  const c=document.createElement('canvas'); c.width=W;c.height=H;
  const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,W,H);
  for(let sys=0;sys<systems;sys++){
    const base=space*12+sys*space*sysGap;
    const lineY=(l,x)=>base+l*space;
    g.fillStyle='#111';
    for(let l=0;l<5;l++) for(let x=space*3;x<W-space*3;x+=4) g.fillRect(x,lineY(l,x),5,Math.max(1,space*0.1));
    let cursor=space*6;
    for(const unit of layouts[sys]){
      const n=unit.steps.length, dir=unit.dir, xs=[], ys=[];
      for(let i=0;i<n;i++){const x=cursor+i*space*noteGap; const y=lineY(4,x)-unit.steps[i]*space/2; xs.push(x);ys.push(y);
        g.save();g.translate(x,y);g.rotate(-0.28);g.beginPath();g.ellipse(0,0,space*0.62,space*0.46,0,0,Math.PI*2);g.fillStyle='#111';g.fill();g.restore();}
      g.fillStyle='#111'; const stemW=Math.max(1.3,space*0.11);
      const sx=(i)=>xs[i]+(dir<0?space*0.55:-space*0.55);
      const rise=(ys[n-1]-ys[0])*0.5; const at=(i)=>rise*(i/(n-1));
      const yBase=Math.max(...ys.map((y,i)=>y-at(i)))+space*3.2;
      const beamY=(i)=>yBase+at(i);
      for(let i=0;i<n;i++){const e=beamY(i); g.fillRect(sx(i),Math.min(ys[i],e),stemW,Math.abs(ys[i]-e));}
      const t=Math.max(1.8,space*0.5);
      for(let bm=0;bm<unit.beams;bm++){const off=-bm*space*0.75;
        const x1=sx(0),x2=sx(n-1)+stemW,y1=beamY(0)+off,y2=beamY(n-1)+off;
        g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.lineTo(x2,y2+t);g.lineTo(x1,y1+t);g.closePath();g.fillStyle='#111';g.fill();}
      cursor+=(n-1)*space*noteGap+space*gapSpaces;
    }
  }
  return c.toDataURL('image/png');
});
fs.writeFileSync(`${OUT}/dsprobe.png`, Buffer.from(png.split(',')[1],'base64'));
await b.close();
