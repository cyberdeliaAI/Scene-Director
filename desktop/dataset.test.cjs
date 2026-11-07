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
test('pixel-area exports snap to training buckets without enlarging or distorting', () => {
  const area={resize:'area',targetArea:1024,snap:64};
  let plan=C.exportPlan({x:0,y:0,w:2000,h:3000},area);
  assert.deepEqual([plan.width,plan.height],[832,1216]);
  assert.deepEqual(plan.crop,{x:0,y:38,w:2000,h:2923});
  assert.ok(Math.abs(plan.crop.w/plan.crop.h-832/1216)<0.001);
  plan=C.exportPlan({x:10,y:20,w:1800,h:3200},area);assert.deepEqual([plan.width,plan.height],[768,1344]);
  plan=C.exportPlan({x:0,y:0,w:3000,h:2000},area);assert.deepEqual([plan.width,plan.height],[1216,832]);
  plan=C.exportPlan({x:5,y:5,w:2000,h:2000},area);assert.deepEqual([plan.width,plan.height],[1024,1024]);assert.deepEqual(plan.crop,{x:5,y:5,w:2000,h:2000});
  plan=C.exportPlan({x:0,y:0,w:900,h:700},area);assert.deepEqual([plan.width,plan.height],[832,640]);assert.ok(plan.crop.w>=832&&plan.crop.h>=640);
  plan=C.exportPlan({x:0,y:0,w:2000,h:1000},{maxSide:1024});
  assert.deepEqual([plan.crop,plan.width,plan.height],[{x:0,y:0,w:2000,h:1000},1024,512]);
  plan=C.exportPlan({x:0,y:0,w:1500,h:1000},{maxSide:1024,snap:64});
  assert.deepEqual([plan.width,plan.height],[1024,704]);assert.ok(plan.crop.w>=1024&&plan.crop.h===1000);
});
test('crops cannot be drawn below the minimum and move inward near an edge', () => {
  const square={mode:'dimensions',width:1024,height:1024};
  assert.deepEqual(C.dragCrop({x:100,y:100},{x:300,y:250},3000,2000,1,square),{x:100,y:100,w:1024,h:1024});
  assert.deepEqual(C.dragCrop({x:2900,y:1900},{x:2950,y:1950},3000,2000,1,square),{x:1976,y:976,w:1024,h:1024});
  assert.deepEqual(C.dragCrop({x:0,y:0},{x:2000,y:200},3000,2000,0,square),{x:0,y:0,w:2000,h:1024});
  const area=C.dragCrop({x:0,y:0},{x:400,y:600},3000,3000,0,{mode:'area',width:1024});
  assert.ok(area.w*area.h>=1024*1024&&Math.abs(area.w/area.h-2/3)<0.01);
  assert.deepEqual(C.dragCrop({x:100,y:100},{x:300,y:250},3000,2000,1,{mode:'off'}),{x:100,y:100,w:200,h:200});
  assert.deepEqual(C.dragCrop({x:0,y:0},{x:50,y:50},800,600,1,square),{x:0,y:0,w:600,h:600});
});
test('ratio and minimum changes adapt existing crops around their own center', () => {
  const box=C.constrainCrop({x:1000,y:1000,w:600,h:600},3000,4000,2/3,{mode:'off'});
  assert.ok(C.matchesRatio(box,2/3));
  assert.ok(Math.abs(box.x+box.w/2-1300)<=1&&Math.abs(box.y+box.h/2-1300)<=1&&Math.abs(box.w*box.h-360000)<2000);
  assert.deepEqual(C.constrainCrop({x:10,y:20,w:1200,h:1800},3000,4000,2/3,{mode:'dimensions',width:1024,height:1024}),{x:10,y:20,w:1200,h:1800});
  assert.deepEqual(C.constrainCrop({x:2800,y:0,w:200,h:200},3000,4000,1,{mode:'dimensions',width:1024,height:1024}),{x:1976,y:0,w:1024,h:1024});
  assert.deepEqual(C.constrainCrop(null,500,300,1),{x:100,y:0,w:300,h:300});
});
test('size problems separate small sources, small crops and export settings', () => {
  const square={mode:'dimensions',width:1024,height:1024};
  assert.ok(C.sourceProblem(900,1400,1,square).includes('too small'));
  assert.equal(C.sourceProblem(900,1400,0,{mode:'longest',width:1024}),'');
  assert.ok(C.sourceProblem(900,1400,0,{mode:'shortest',width:1024}));
  const area={mode:'area',width:1024},config={resize:'area',targetArea:1024,snap:64},big={x:0,y:0,w:2000,h:3000};
  assert.equal(C.exportProblem(big,C.exportPlan(big,config),area),'');
  assert.ok(C.exportProblem({x:0,y:0,w:900,h:1100},C.exportPlan({x:0,y:0,w:900,h:1100},config),area).includes('crop'));
  assert.ok(C.exportProblem({x:0,y:0,w:2000,h:2000},C.exportPlan({x:0,y:0,w:2000,h:2000},{maxSide:768}),square).includes('export'));
  assert.deepEqual(C.minimumSpec({minimum:'bogus'}).mode,'off');
});
test('default export settings keep existing caption keys valid', () => {
  const item={edit:{crop:{x:0,y:0,w:10,h:10}}},base={maxSide:1024,format:'png',quality:95};
  assert.equal(C.editKey(item,{...base,resize:'longest',snap:0,targetArea:2048}),JSON.stringify([item.edit,1024,'png',95]));
  assert.notEqual(C.editKey(item,{...base,snap:64}),C.editKey(item,base));
  assert.notEqual(C.editKey(item,{...base,resize:'area',targetArea:1024}),C.editKey(item,{...base,resize:'area',targetArea:768}));
});
test('edge handles keep the minimum, the ratio and the opposite edge', () => {
  const square={mode:'dimensions',width:1024,height:1024};
  assert.deepEqual(C.edgeCrop({x:100,y:100,w:1024,h:1024},'e',{x:600,y:500},3000,2000,1,square),{x:100,y:100,w:1024,h:1024});
  assert.deepEqual(C.edgeCrop({x:100,y:100,w:1200,h:1500},'e',{x:2000,y:500},3000,2000,0,square),{x:100,y:100,w:1900,h:1500});
  assert.deepEqual(C.edgeCrop({x:100,y:100,w:1200,h:1500},'w',{x:900,y:500},3000,2000,0,square),{x:276,y:100,w:1024,h:1500});
  assert.deepEqual(C.edgeCrop({x:500,y:500,w:600,h:600},'n',{x:700,y:100},3000,2000,1,{mode:'off'}),{x:300,y:100,w:1000,h:1000});
  assert.equal(C.minAlong(500,{mode:'area',width:1000},true),2000);
});
test('auto crops surround the located region with padding, ratio and minimum', () => {
  const box=C.cropAround({x:1000,y:300,w:300,h:400},3000,2000,2/3,{mode:'area',width:1024},0.15);
  assert.deepEqual(box,{x:732,y:0,w:837,h:1255});
  const free=C.cropAround({x:100,y:100,w:200,h:100},1000,1000,0,{mode:'off'},0);
  assert.deepEqual(free,{x:100,y:100,w:200,h:100});
});
test('export names, Kohya folders and metadata files', () => {
  assert.equal(C.kohyaFolder(10,'tok','woman'),'10_tok woman');
  assert.equal(C.kohyaFolder('', '', ''),'1_dataset');
  assert.equal(C.kohyaFolder(5,'a/b','..'),'5_a_b');
  assert.deepEqual(C.datasetNames([{name:'a.jpg',ext:'jpg'},{name:'b.png',ext:'png'}],{naming:'numbered',prefix:'my tok'}),
    [{image:'my_tok_0001.jpg',caption:'my_tok_0001.txt'},{image:'my_tok_0002.png',caption:'my_tok_0002.txt'}]);
  assert.deepEqual(C.datasetNames([{name:'a.jpg',ext:'jpg'}],{naming:'original'}),[{image:'a.jpg',caption:'a.txt'}]);
  const rows=[{image:'a.png',caption:'tok, "quoted", text'}];
  assert.equal(C.metadataJsonl(rows),'{"file_name":"a.png","text":"tok, \\"quoted\\", text"}\n');
  assert.equal(C.captionsCsv(rows),'file_name,caption\n"a.png","tok, ""quoted"", text"\n');
  assert.equal(C.validZipName('10_tok woman/a.png'),true);
  for (const bad of ['../a','a/b/c','a\\b','/a','a/']) assert.equal(C.validZipName(bad),false,bad);
});
test('caption checks and bulk edits', () => {
  assert.deepEqual(C.captionWarnings('tok, a woman with red hair','red hair, freckles',false),['mentions “red hair”']);
  assert.deepEqual(C.captionWarnings('tok, a woman with green eyes','',true),['describes identity: “green eyes”']);
  assert.deepEqual(C.captionWarnings('tok, a woman with green eyes','',false),[]);
  assert.equal(C.replaceText('A Red car (red)','red','blue',false),'A blue car (blue)');
  assert.equal(C.replaceText('A Red car (red)','red','blue',true),'A Red car (blue)');
  assert.equal(C.renameTrigger('old_tok, a woman','old_tok','new_tok'),'new_tok, a woman');
  assert.equal(C.renameTrigger('old_tokens, a woman','old_tok','new_tok'),'old_tokens, a woman');
  assert.equal(C.renameTrigger('old_tok, a woman','old_tok',''),'a woman');
  assert.equal(C.addAffixes('a woman','tok','photo'),'tok, a woman, photo');
  assert.equal(C.addAffixes('tok, a woman','tok',''),'tok, a woman');
});
test('ZIP exports can place pairs in one Kohya folder', async () => {
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'scene-dataset-kohya-'));
  try {
    const blob=await C.zipStore([{name:'10_tok woman/a.png',data:Uint8Array.from([1,2])},{name:'10_tok woman/a.txt',data:'tok, a\n'}]);
    const filename=path.join(folder,'k.zip');await fs.writeFile(filename,new Uint8Array(await blob.arrayBuffer()));
    execFileSync('python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.namelist()==["10_tok woman/a.png","10_tok woman/a.txt"]',filename]);
  } finally { await fs.rm(folder,{recursive:true,force:true}); }
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
