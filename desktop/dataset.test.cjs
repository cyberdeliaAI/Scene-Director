'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('../web/dataset-core.js');
const { allowDatasetDownload } = require('./dataset-download.cjs');

test('centered crops stay in image pixels and export never enlarges them', () => {
  assert.deepEqual(C.centerCrop(500,300,1),{x:100,y:0,w:300,h:300});
  assert.deepEqual(C.cropBox({x:-10,y:90,w:200,h:100},100,100),{x:0,y:90,w:100,h:10});
  assert.deepEqual(C.exportSize({w:812,h:1024},1024),{width:812,height:1024});
  assert.deepEqual(C.exportSize({w:300,h:500},1024),{width:300,height:500});
  assert.deepEqual(C.exportSize({w:2000,h:1000},1024),{width:1024,height:512});
  assert.deepEqual(C.dimensions(812,1024,90),{width:1024,height:812});
  assert.throws(()=>C.cropBox({x:NaN,y:0,w:1,h:1},100,100));
});
test('minimums reject both insufficient crops and undersized exports', () => {
  assert.ok(C.minimumError({w:812,h:1024},{width:812,height:1024},'dimensions',1024,1024));
  assert.equal(C.minimumError({w:812,h:1024},{width:812,height:1024},'longest',1024,1024),'');
  assert.ok(C.minimumError({w:2000,h:2000},{width:512,height:512},'dimensions',1024,1024));
});
test('newer manual captions and later crop/format edits reject stale model output', () => {
  const config={maxSide:1024,format:'png',quality:95};
  const item={id:'a',captionRev:3,edit:{crop:{x:0,y:0,w:100,h:100}}};
  const job={itemId:'a',revision:3,key:C.editKey(item,config)};
  assert.equal(C.captionStillCurrent(item,job,config),true);
  item.captionRev++;assert.equal(C.captionStillCurrent(item,job,config),false);item.captionRev--;
  item.edit.crop.x++;assert.equal(C.captionStillCurrent(item,job,config),false);item.edit.crop.x--;
  assert.equal(C.captionStillCurrent(item,job,{...config,maxSide:512}),false);
});
test('dataset pairs use safe unique stems even across image formats and Unicode names', () => {
  const names=C.pairNames([{name:'../Café.jpg',ext:'jpg'},{name:'cafe\u0301.png',ext:'png'},{name:'CON.webp',ext:'webp'}]);
  assert.deepEqual(names,[{image:'Café.jpg',caption:'Café.txt'},{image:'café_2.png',caption:'café_2.txt'},{image:'_CON.webp',caption:'_CON.txt'}]);
});
test('Captioner JSON round trips placeholders and rejects other modules', () => {
  const doc={schema:1,product:'CyberHub',type:'system_prompt',module:'captioner',title:' Dataset ',prompt:'Begin with {TRIGGER}.\nDescribe the crop.',unused:'ignored'};
  assert.deepEqual(C.captionDocument(doc),{schema:1,product:'CyberHub',type:'system_prompt',module:'captioner',title:'Dataset',prompt:doc.prompt});
  for(const value of [{...doc,module:'prompt_engineer'},{...doc,schema:true},{...doc,prompt:''},[]])assert.throws(()=>C.captionDocument(value));
});
test('independent ZIP reader verifies image bytes, Unicode captions and CRC', async () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'scene-dataset-zip-'));
  try {
    const image=Uint8Array.from([0,1,2,253,254,255]),caption='my_token, a café scene.\n';
    const blob=await C.zipStore([{name:'Café.png',data:image},{name:'Café.txt',data:caption}]);
    const filename=path.join(folder,'dataset.zip');await fs.writeFile(filename,new Uint8Array(await blob.arrayBuffer()));
    execFileSync('python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("Café.png")==bytes([0,1,2,253,254,255]); assert z.read("Café.txt").decode()=="my_token, a café scene.\\n"; assert len(z.namelist())==2',filename]);
    await assert.rejects(C.zipStore([{name:'../escape.txt',data:'x'}]));
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
});
test('desktop exports only allow this app’s own ZIP and Captioner JSON blobs', () => {
  const contents={getURL:()=> 'scene-director://app/'},window={isDestroyed:()=>false,webContents:contents};
  const item={getURL:()=> 'blob:scene-director://app/test',getInitiatorOrigin:()=> 'scene-director://app',getFilename:()=> 'Scene-Director-LoRA-dataset.zip'};
  const check=value=>allowDatasetDownload({...item,...value},contents,window,url=>url==='scene-director://app/');
  assert.equal(check({}),true);assert.equal(check({getFilename:()=> 'Training.captioner.json'}),true);
  assert.equal(check({getURL:()=> 'https://example.com/archive.zip'}),false);
  assert.equal(check({getInitiatorOrigin:()=> 'https://example.com'}),false);
  assert.equal(check({getFilename:()=> 'program.app'}),false);
});
