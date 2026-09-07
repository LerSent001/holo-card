import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {Store,kinds} from '../src/store.mjs';
import {normalize,saveInput,persistMask,assemble,cardDirectory} from '../src/images.mjs';
test('Grayscale/alpha sources become consistent RGBA, and mask aspect mismatch is rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'holo-image-test-')),store=new Store(dir);
 try{
  const gray=await sharp({create:{width:20,height:30,channels:4,background:{r:80,g:80,b:80,alpha:.5}}}).greyscale().png().toBuffer();
  const source=await normalize(gray);const metadata=await sharp(source.bytes).metadata();assert.equal(metadata.channels,4);
  const card={id:'image-test',width:20,height:30};await saveInput(store,card.id,gray,source.bytes);
  const white=await sharp({create:{width:20,height:30,channels:3,background:'white'}}).png().toBuffer();
  for(const kind of kinds)await persistMask(store,card,kind,white);
  await assemble(store,card);const image=await sharp(await readFile(join(cardDirectory(store,card.id),'character.png'))).raw().toBuffer();assert.deepEqual([...image.subarray(0,4)],[80,80,80,128]);
  const square=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(persistMask(store,card,'character',square),/MASK_ASPECT_MISMATCH/);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
