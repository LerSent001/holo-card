import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../assets/renderer/viewer.js',import.meta.url),'utf8');
async function boot({permission='granted',secure=true,supported=true}={}) {
 const nodes=new Map(), events=new Map(); let frame, timer;
 function node(key) { if(!nodes.has(key)) nodes.set(key,{hidden:false,style:{setProperty(){}},value:'0',listeners:{},addEventListener(k,f){this.listeners[k]=f},setAttribute(k,v){this[k]=v},querySelector(k){return node(key+k)},setPointerCapture(){},hasPointerCapture(){return false}}); return nodes.get(key); }
 const context={console,URL,location:{search:''},document:{hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener:(k,f)=>events.set(k,f)},screen:{orientation:{angle:0,addEventListener(){}}},matchMedia:()=>({matches:false}),innerWidth:400,innerHeight:800,isSecureContext:secure,requestAnimationFrame:f=>(frame=f,1),cancelAnimationFrame(){},setTimeout:f=>(timer=f,1),clearTimeout(){},addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k),HOLO_MANIFEST:{name:'Test',height:829,width:569,assets:{}},HOLO_CREATE_RENDERER:async()=>({draw(){},dispose(){}})};
 if(supported) context.DeviceOrientationEvent={requestPermission:async()=>permission};
 context.window=context;vm.createContext(context);await vm.runInContext(`(async()=>{${source}\n})()`,context);
 return {node,events,context,tick:()=>frame(),timeout:()=>timer(),enable:()=>node('#motion').listeners.click(),orient:(beta,gamma)=>events.get('deviceorientation')?.({beta,gamma})};
}
let a=await boot();await a.enable();assert.equal(a.node('#motion')['aria-pressed'],'true');a.orient(40,0);a.orient(50,10);a.tick();const before=a.node('.card').style.transform;assert.match(before,/rotateX/);
const card=a.node('.card');card.listeners.pointerdown({pointerId:1,pointerType:'touch',clientX:0,clientY:0});card.listeners.pointermove({pointerId:1,pointerType:'touch',clientX:40,clientY:20});a.tick();assert.notEqual(card.style.transform,before);card.listeners.pointerup({pointerId:1});a.tick();
a.node('#reset').listeners.click();a.orient(50,10);a.context.screen.orientation.angle=90;a.orient(60,20);a.tick();assert.ok(!card.style.transform.includes('NaN'));
await a.enable();assert.equal(a.events.has('deviceorientation'),false);
a=await boot({permission:'denied'});await a.enable();assert.match(a.node('#motion-hint').textContent,/not granted/);assert.equal(a.events.has('deviceorientation'),false);
a=await boot({secure:false});await a.enable();assert.match(a.node('#motion-hint').textContent,/HTTPS/);
a=await boot({supported:false});await a.enable();assert.match(a.node('#motion-hint').textContent,/unavailable/);
a=await boot();await a.enable();a.orient(null,null);a.timeout();assert.equal(a.events.has('deviceorientation'),false);assert.match(a.node('#motion-hint').textContent,/No sensor data/);
console.log('Motion: permission, calibration, drag takeover, landscape, disable, denied, insecure, unsupported and no-data paths passed.');

a=await boot();a.context.DeviceMotionEvent={requestPermission:async()=> 'granted'};await a.enable();a.events.get('devicemotion')({accelerationIncludingGravity:{x:0,y:-5,z:-8}});a.events.get('devicemotion')({accelerationIncludingGravity:{x:3,y:-6,z:-7}});a.tick();assert.match(a.node('#motion-hint').textContent,/Motion active/);assert.ok(!a.node('.card').style.transform.includes('NaN'));console.log('Gravity fallback passed.');
