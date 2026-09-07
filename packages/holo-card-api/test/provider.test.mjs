import test from 'node:test';
import assert from 'node:assert/strict';
import {Gemini,ProviderFailure,imageFrom} from '../src/provider.mjs';
test('Gemini adapter uses bounded background requests and parses returned image content',async()=>{
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async(url,options)=>{requests++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(options.headers['x-goog-api-key'],'test-secret');assert.equal(options.headers['Api-Revision'],'2026-05-20');const body=JSON.parse(options.body);assert.equal(body.background,true);assert.equal(body.store,true);assert.equal(body.response_format.image_size,'1K');assert.equal(body.input[1].data,Buffer.from('source').toString('base64'));assert.ok(body.input[0].text.includes('structural contour'));return Response.json({id:'opaque-id',status:'in_progress'});};
 try{const result=await new Gemini('test-secret').submit('structure',Buffer.from('source'));assert.equal(result.id,'opaque-id');assert.equal(requests,1);assert.equal(imageFrom({steps:[{type:'model_output',content:[{type:'image',data:'abc',mime_type:'image/png'}]}]}).data,'abc');}finally{globalThis.fetch=original;}
});
test('Gemini adapter distinguishes unknown submission from retriable reads, without POST retries',async()=>{
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('Connection reset');};
 try{const api=new Gemini('test-secret');await assert.rejects(api.submit('ui',Buffer.from('source')),e=>e instanceof ProviderFailure&&e.uncertain);assert.equal(requests,1);await assert.rejects(api.retrieve('existing-id'),e=>e instanceof ProviderFailure&&e.retryable);assert.equal(requests,2);}finally{globalThis.fetch=original;}
});
