import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { createService } from '../src/app.mjs';
const exec=promisify(execFile);
// Repository client is sibling to packages; resolve without embedding machine paths.
const cli=new URL('../../../skills/holo-card/scripts/api.py',import.meta.url).pathname;
test('Skill CLI runs upload, stable generation, wait, ZIP extraction and secret-free output over HTTP',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'holo-cli-'));const mask=await sharp({create:{width:80,height:100,channels:3,background:'white'}}).png().toBuffer();
 let submissions=0;const provider={configured:true,async submit(kind){submissions++;return{id:kind,status:'in_progress'};},async retrieve(){return{status:'completed',steps:[{type:'model_output',content:[{type:'image',mime_type:'image/png',data:mask.toString('base64')}]}]};}};
 const service=await createService({dataDir:join(dir,'data'),provider,interval:10});const token=service.store.token();await service.listen(0);
 const config=join(dir,'client.json');await writeFile(config,JSON.stringify({api_url:service.baseUrl,api_token:token.token}),{mode:0o600});const input=join(dir,'input.png');await writeFile(input,await sharp({create:{width:80,height:100,channels:3,background:'#19a4da'}}).png().toBuffer());
 const run=async args=>{const {stdout}=await exec('python3',[decodeURIComponent(cli),...args],{env:{...process.env,HOLO_CONFIG:config},timeout:10000});assert.ok(!stdout.includes(token.token));return stdout.trim().split('\n').map(line=>JSON.parse(line));};
 try{
  const [doctor]=await run(['doctor']);assert.equal(doctor.provider_configured,true);
  const [card]=await run(['upload',input]);assert.equal(submissions,0);
  const [job]=await run(['generate',card.id,'--max-image-calls','4']);const results=await run(['wait',job.id,'--timeout','3','--interval','1']);assert.equal(results.at(-1).status,'completed');
  const [replayed]=await run(['generate',card.id,'--max-image-calls','4']);assert.equal(replayed.id,job.id);assert.equal(submissions,4);
  const [download]=await run(['download',card.id,'--output',join(dir,'result.zip'),'--extract']);const html=await readFile(download.html,'utf8');assert.ok(html.includes('data:image/png;base64,'));assert.ok(!html.includes('src="viewer.js'));assert.ok(!html.includes(token.token));
  const [preview]=await run(['preview',card.id]);assert.equal((await fetch(preview.preview_url)).status,200);
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});
