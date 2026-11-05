(() => {
  'use strict';
  const C = window.SceneDatasetCore, $ = id => document.getElementById(id);
  const BUILTINS = {
    character: ['Character LoRA', 'Write a natural-language training caption for a character LoRA. Describe visible changing details: clothing, pose, expression, action, setting, framing, camera angle and light. Leave stable character identity, such as characteristic hair, face and body traits, to the supplied trigger token. If no trigger is supplied, refer to the subject naturally without inventing an identity. Use plain factual English, usually 40 to 80 words. Do not infer hidden details, names, backstory or emotions without visible evidence. Avoid quality slogans, LoRA syntax, tags and commentary. Return only one caption.'],
    general: ['General image caption', 'Write one accurate English caption for an image-training dataset. Describe only visible subjects, their appearance, clothing, actions, spatial relationships, setting, framing, medium, colors and lighting. Use concise natural sentences and enough detail to distinguish this image, without guessing identities, invisible details or backstory. No quality slogans or introductory text. Return the caption only.'],
    style: ['Style LoRA', 'Write a concise natural-language caption for a style LoRA training image. Describe the changing scene content: visible subjects, action, objects, setting, arrangement, viewpoint and colors. Let the trigger token represent the consistent target style instead of repeatedly naming it. Keep explicit visible composition details. Do not add unseen details, artist names, quality slogans or interpretation. Write plain English and output only one caption.'],
  };
  const DEFAULTS = { aspect: '0', maxSide: 1024, minimum: 'off', minWidth: 1024, minHeight: 1024, format: 'original', quality: 95,
    preset: 'character', title: BUILTINS.character[0], system: BUILTINS.character[1], trigger: '', extra: '' };
  const state = { items: [], index: -1, config: { ...DEFAULTS }, stage: 'prepare', active: null, loading: false,
    loadId: 0, batch: false, exporting: false, restoring: true, stop: false, job: null, drag: null, view: null, shared: [], db: null };
  const canvas = $('dsCanvas'), context = canvas.getContext('2d');
  const current = () => state.items[state.index];
  const clone = value => JSON.parse(JSON.stringify(value));
  const status = message => { $('dsStatus').textContent = message; };
  const key = item => C.editKey(item, state.config);
  const ready = item => !!item.caption.trim() && item.captionKey === key(item);
  const controls = { aspect:'dsAspect', maxSide:'dsMaxSide', minimum:'dsMinimum', minWidth:'dsMinWidth', minHeight:'dsMinHeight', format:'dsFormat', quality:'dsQuality', trigger:'dsTrigger', extra:'dsExtra', title:'dsScriptTitle', system:'dsSystem' };
  async function api(route, body) {
    const response = await fetch(route, body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok || value.ok === false) throw new Error(value.error || 'The app service could not complete this request.');
    return value;
  }
  function showTool(dataset) {
    $('promptWorkspace').hidden = dataset; $('datasetWorkspace').hidden = !dataset;
    $('showPrompts').setAttribute('aria-pressed', String(!dataset)); $('showDataset').setAttribute('aria-pressed', String(dataset));
    try { localStorage.setItem('scene-director-active-tool', dataset ? 'dataset' : 'prompts'); } catch {}
    if (dataset) { requestAnimationFrame(draw); refreshShared(); }
  }
  $('showPrompts').addEventListener('click', () => showTool(false));
  $('showDataset').addEventListener('click', () => showTool(true));
  $('dsSettings').addEventListener('click', () => $('connPill').click());
  function stage(value) { state.stage = value; render(); requestAnimationFrame(draw); }
  $('dsPrepareTab').addEventListener('click', () => stage('prepare'));
  $('dsCaptionTab').addEventListener('click', () => stage('caption'));
  $('dsContinue').addEventListener('click', () => stage('caption'));

  // Session snapshots include source files, crop edits and manual captions, on this origin only.
  let saveTimer, saveChain = Promise.resolve(), storageRevision = 0;
  async function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('scene-director-lora-dataset', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('session');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction('session', mode), store = tx.objectStore('session');
      const request = action(store); let result;
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Session storage failed.'));
    });
  }
  function saveNow() {
    clearTimeout(saveTimer); if (!state.db) return Promise.resolve();
    const revision = ++storageRevision;
    const snapshot = { config:clone(state.config), index:state.index, stage:state.stage, job:state.job ? clone(state.job) : null,
      items:state.items.map(item => ({ id:item.id, name:item.name, file:item.file, width:item.width, height:item.height,
        edit:clone(item.edit), undo:clone(item.undo), caption:item.caption, captionKey:item.captionKey, captionRev:item.captionRev })) };
    $('dsStorage').textContent = 'Saving this dataset session locally…';
    saveChain = saveChain.catch(() => {}).then(async () => {
      if (revision !== storageRevision) return;
      await transaction('readwrite', store => store.put(snapshot, 'current'));
      if (revision === storageRevision) $('dsStorage').textContent = 'Dataset session saved on this computer. Originals are unchanged.';
    }).catch(() => { $('dsStorage').textContent = 'Session could not be saved locally. Export your work before closing the app.'; });
    return saveChain;
  }
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 350); }
  async function restore() {
    try {
      state.db = await openDB(); const saved = await transaction('readonly', store => store.get('current'));
      if (saved && Array.isArray(saved.items)) {
        Object.assign(state.config, saved.config || {});
        state.items = saved.items.filter(item => item.file instanceof Blob && typeof item.caption === 'string').slice(0,1000)
          .map(item => ({ ...item, url:URL.createObjectURL(item.file), undo:item.undo || [], captionRev:Number(item.captionRev) || 0 }));
        state.stage = saved.stage === 'caption' ? 'caption' : 'prepare';
        state.index = state.items.length ? C.clamp(Number(saved.index) || 0,0,state.items.length-1) : -1;
        state.job = saved.job || null;
      }
      $('dsStorage').textContent = 'Dataset session saved locally in this app. Clear session removes its local copy.';
    } catch { $('dsStorage').textContent = 'Local session storage is unavailable. Keep this window open and export your work.'; }
    for (const [name,id] of Object.entries(controls)) $(id).value = state.config[name];
    state.restoring = false; renderPresets(); queue(); render(); if (current()) await select(state.index);
    try { if (localStorage.getItem('scene-director-active-tool') === 'dataset') showTool(true); } catch {}
    if (state.job) { showTool(true); resumeJob(); }
  }

  // Decode only the active image or the image currently being processed.
  async function imageCanvas(item) {
    const bitmap = await createImageBitmap(item.file, { imageOrientation:'from-image' });
    try {
      if (bitmap.width * bitmap.height > 40000000) throw new Error('This image exceeds 40 megapixels. Resize it before adding it to this dataset.');
      if (!item.width || !item.height) { item.width = bitmap.width; item.height = bitmap.height; }
      const edit = item.edit || (item.edit = { rotation:0, flipH:false, flipV:false, crop:null });
      const size = C.dimensions(bitmap.width,bitmap.height,edit.rotation);
      if (!edit.crop) edit.crop = C.centerCrop(size.width,size.height,Number(state.config.aspect));
      const result = document.createElement('canvas'); result.width = size.width; result.height = size.height;
      const ctx = result.getContext('2d'); ctx.translate(size.width/2,size.height/2);
      ctx.scale(edit.flipH ? -1 : 1,edit.flipV ? -1 : 1); ctx.rotate(edit.rotation*Math.PI/180); ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);
      return result;
    } finally { bitmap.close(); }
  }
  async function select(index) {
    if (index < 0 || index >= state.items.length) return;
    state.index = index; state.loading = true; state.active = null; const ticket = ++state.loadId;
    render();
    try { const image = await imageCanvas(current()); if (ticket !== state.loadId) return; state.active = image; }
    catch (error) { if (ticket === state.loadId) status(error.message || 'Could not decode this image.'); }
    finally { if (ticket === state.loadId) { state.loading = false; render(); draw(); persist(); } }
  }
  function addFiles(files) {
    if (state.batch || state.exporting || state.restoring) return;
    let added = 0, skipped = 0;
    for (const file of Array.from(files)) {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > 100*1024*1024 || state.items.length >= 1000) { skipped++; continue; }
      state.items.push({ id:crypto.randomUUID(), name:file.name, file, url:URL.createObjectURL(file), width:0, height:0,
        edit:{ rotation:0, flipH:false, flipV:false, crop:null }, undo:[], caption:'', captionKey:'', captionRev:0 }); added++;
    }
    queue(); if (state.index < 0 && state.items.length) select(0); else render();
    status(`${added} images added.${skipped ? ` ${skipped} unsupported, empty, oversized or extra files skipped.` : ''}`); persist();
  }
  $('dsAdd').addEventListener('click', () => $('dsFiles').click());
  $('dsFiles').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  const dropzone = $('dsDropzone');
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag-over'); });
  dropzone.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); dropzone.classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
  $('dsPrev').addEventListener('click', () => select(state.index-1)); $('dsNext').addEventListener('click', () => select(state.index+1));
  $('dsRemove').addEventListener('click', () => {
    if (!current() || state.batch || state.exporting) return;
    URL.revokeObjectURL(current().url); state.items.splice(state.index,1); ++state.loadId; state.active = null;
    state.index = Math.min(state.index,state.items.length-1); queue(); render(); if (current()) select(state.index); persist();
  });
  $('dsClear').addEventListener('click', () => {
    if (state.batch || state.exporting || !state.items.length) return;
    if (!confirm('Clear this local dataset session? Original files and exported datasets are kept.')) return;
    state.items.forEach(item => URL.revokeObjectURL(item.url)); state.items = []; state.index = -1; state.active = null; ++state.loadId;
    queue(); render(); draw(); saveNow(); status('Dataset session cleared.');
  });
  function queue() {
    $('dsQueue').replaceChildren();
    for (const [index,item] of state.items.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ds-thumb'; button.dataset.id = item.id;
      const image = document.createElement('img'); image.src = item.url; image.alt = ''; image.loading = 'lazy';
      const text = document.createElement('span'); text.textContent = item.name; button.title = item.name; button.setAttribute('aria-label',`Dataset image ${index+1}: ${item.name}`);
      button.append(image,text); button.addEventListener('click', () => select(index)); $('dsQueue').appendChild(button);
    }
  }
  function validation(item = current()) {
    if (!item?.edit.crop) return '';
    const size = C.exportSize(item.edit.crop,Number(state.config.maxSide));
    return C.minimumError(item.edit.crop,size,state.config.minimum,Number(state.config.minWidth),Number(state.config.minHeight));
  }
  function render() {
    const item = current(), busy = state.batch || state.exporting || state.restoring, caption = state.stage === 'caption';
    $('dsPrepareControls').hidden = caption; $('dsCaptionControls').hidden = !caption; $('dsEditor').hidden = !caption;
    $('dsContinue').hidden = caption; $('dsPrepareTab').setAttribute('aria-pressed',String(!caption)); $('dsCaptionTab').setAttribute('aria-pressed',String(caption));
    $('dsEmpty').hidden = !!state.active; $('dsPosition').textContent = item ? `${state.index+1} / ${state.items.length} · ${item.name}` : 'No images';
    $('dsPrev').disabled = state.index <= 0; $('dsNext').disabled = state.index < 0 || state.index >= state.items.length-1;
    for (const id of ['dsRemove','dsResetCrop','dsRotateLeft','dsRotateRight','dsFlipH','dsFlipV']) $(id).disabled = !item || busy || state.loading;
    $('dsUndo').disabled = !item?.undo.length || busy || state.loading;
    for (const id of ['dsAdd','dsClear','dsSquare',...Object.values(controls), 'dsPreset']) $(id).disabled = busy;
    $('dsClear').disabled = busy || !state.items.length;
    $('dsImportScript').disabled = busy;
    $('dsExport').disabled = !state.items.length || busy;
    $('dsCaptionCurrent').disabled = !item || busy || !state.config.system.trim() || !!validation();
    $('dsCaptionPending').disabled = !state.items.length || busy || !state.config.system.trim(); $('dsStop').hidden = !state.batch;
    $('dsCaptionText').disabled = !item; $('dsCopy').disabled = !item?.caption.trim(); $('dsReviewed').disabled = !item?.caption.trim() || ready(item);
    if (document.activeElement !== $('dsCaptionText')) $('dsCaptionText').value = item?.caption || '';
    $('dsCaptionState').textContent = !item?.caption.trim() ? 'No caption yet.' : ready(item) ? 'Caption reviewed for this crop.' : 'Preparation changed. Review or regenerate this caption before export.';
    $('dsValidation').textContent = validation();
    if (item?.edit.crop) { const size = C.exportSize(item.edit.crop,Number(state.config.maxSide)); $('dsDimensions').textContent = `${item.width} × ${item.height} source → ${item.edit.crop.w} × ${item.edit.crop.h} crop → ${size.width} × ${size.height} export`; }
    else $('dsDimensions').textContent = state.loading ? 'Loading image…' : 'Source → Crop → Export dimensions appear here.';
    const complete = state.items.filter(ready).length, stale = state.items.filter(i => i.caption.trim() && !ready(i)).length;
    $('dsSummary').textContent = `${state.items.length} images · ${complete} reviewed captions${stale ? ` · ${stale} need review` : ''}`;
    for (const button of $('dsQueue').children) { const value = state.items.find(i => i.id === button.dataset.id); button.setAttribute('aria-current',String(value === item)); button.dataset.state = ready(value) ? 'ready' : value.caption.trim() ? 'stale' : 'empty'; }
    requestAnimationFrame(draw);
  }
  function readConfig() {
    const config = { ...state.config };
    for (const [name,id] of Object.entries(controls)) config[name] = $(id).value;
    for (const name of ['maxSide','minWidth','minHeight','quality']) {
      config[name] = Number(config[name]);
      if (!Number.isInteger(config[name]) || config[name] < (name === 'maxSide' ? 0 : name === 'quality' ? 10 : 1) || config[name] > (name === 'quality' ? 100 : 32768)) throw new Error('Enter valid crop size and quality values.');
    }
    return config;
  }
  for (const [name,id] of Object.entries(controls)) $(id).addEventListener('input', () => {
    if (state.batch || state.exporting) return;
    try { const previous = state.config.aspect; state.config = readConfig(); if (name === 'system' || name === 'title') { state.config.preset = 'custom'; $('dsPreset').value = 'custom'; }
      if (name === 'aspect' && previous !== state.config.aspect && state.active && current()?.edit.crop) { pushUndo(); current().edit.crop = C.centerCrop(state.active.width,state.active.height,Number(state.config.aspect)); }
      render(); persist();
    } catch (error) { status(error.message); }
  });
  function pushUndo() { const item = current(); if (item) { item.undo.push(clone(item.edit)); item.undo = item.undo.slice(-30); } }
  async function transform(action) { if (!current() || state.loading || state.batch || state.exporting) return; pushUndo(); action(current().edit); current().edit.crop = null; await select(state.index); }
  $('dsRotateLeft').addEventListener('click', () => transform(edit => { edit.rotation = (edit.rotation+270)%360; }));
  $('dsRotateRight').addEventListener('click', () => transform(edit => { edit.rotation = (edit.rotation+90)%360; }));
  $('dsFlipH').addEventListener('click', () => transform(edit => { edit.flipH = !edit.flipH; }));
  $('dsFlipV').addEventListener('click', () => transform(edit => { edit.flipV = !edit.flipV; }));
  $('dsUndo').addEventListener('click', async () => { if (!current()?.undo.length || state.batch) return; current().edit = current().undo.pop(); await select(state.index); });
  $('dsResetCrop').addEventListener('click', () => { if (!state.active || state.batch) return; pushUndo(); current().edit.crop = C.centerCrop(state.active.width,state.active.height,Number(state.config.aspect)); render(); persist(); });
  $('dsSquare').addEventListener('click', () => {
    Object.assign(state.config,{ aspect:'1',maxSide:1024,minimum:'dimensions',minWidth:1024,minHeight:1024 });
    for (const [name,id] of Object.entries(controls)) $(id).value = state.config[name];
    if (state.active) { pushUndo(); current().edit.crop = C.centerCrop(state.active.width,state.active.height,1); } render(); persist();
  });

  function draw() {
    if ($('datasetWorkspace').hidden) return;
    const rect = $('dsPreview').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1,Math.round(rect.width*dpr)); canvas.height = Math.max(1,Math.round(rect.height*dpr));
    context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,rect.width,rect.height);
    const image = state.active; if (!image || !current()?.edit.crop) { state.view = null; return; }
    if (state.stage === 'caption') {
      const box = current().edit.crop, scale = Math.min((rect.width-24)/box.w,(rect.height-24)/box.h);
      context.drawImage(image,box.x,box.y,box.w,box.h,(rect.width-box.w*scale)/2,(rect.height-box.h*scale)/2,box.w*scale,box.h*scale);
      state.view = null; return;
    }
    const scale = Math.min((rect.width-24)/image.width,(rect.height-24)/image.height), x = (rect.width-image.width*scale)/2, y = (rect.height-image.height*scale)/2;
    state.view = { scale,x,y }; context.drawImage(image,x,y,image.width*scale,image.height*scale);
    const crop = current().edit.crop, cx=x+crop.x*scale, cy=y+crop.y*scale, cw=crop.w*scale, ch=crop.h*scale;
    context.fillStyle='rgba(0,0,0,.58)'; context.beginPath(); context.rect(x,y,image.width*scale,image.height*scale); context.rect(cx,cy,cw,ch); context.fill('evenodd');
    context.strokeStyle='#e6ac50'; context.lineWidth=2; context.strokeRect(cx,cy,cw,ch);
    context.strokeStyle='rgba(255,255,255,.4)'; context.lineWidth=1;
    for (const third of [1/3,2/3]) { context.beginPath(); context.moveTo(cx+cw*third,cy); context.lineTo(cx+cw*third,cy+ch); context.stroke(); context.beginPath(); context.moveTo(cx,cy+ch*third); context.lineTo(cx+cw,cy+ch*third); context.stroke(); }
    if (state.stage === 'prepare') { context.fillStyle='#f3c275'; for (const [px,py] of [[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]]) context.fillRect(px-5,py-5,10,10); }
  }
  new ResizeObserver(draw).observe($('dsPreview'));
  function pointer(event) { const rect=canvas.getBoundingClientRect(),view=state.view; return { x:C.clamp((event.clientX-rect.left-view.x)/view.scale,0,state.active.width),y:C.clamp((event.clientY-rect.top-view.y)/view.scale,0,state.active.height) }; }
  canvas.addEventListener('pointerdown', event => {
    if (!state.view || state.stage !== 'prepare' || state.batch || state.exporting) return;
    const p=pointer(event),crop=current().edit.crop,near=12/state.view.scale;
    const corners=[[crop.x,crop.y,crop.x+crop.w,crop.y+crop.h],[crop.x+crop.w,crop.y,crop.x,crop.y+crop.h],[crop.x,crop.y+crop.h,crop.x+crop.w,crop.y],[crop.x+crop.w,crop.y+crop.h,crop.x,crop.y]];
    const corner=corners.find(([x,y])=>Math.hypot(p.x-x,p.y-y)<=near); pushUndo();
    const inside=p.x>=crop.x&&p.x<=crop.x+crop.w&&p.y>=crop.y&&p.y<=crop.y+crop.h;
    state.drag={ start:p,box:clone(crop),move:!corner&&inside,anchor:corner?{x:corner[2],y:corner[3]}:p };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!state.drag || !state.view) return;
    const drag=state.drag,p=pointer(event),image=state.active;
    if (drag.move) current().edit.crop={...drag.box,x:Math.round(C.clamp(drag.box.x+p.x-drag.start.x,0,image.width-drag.box.w)),y:Math.round(C.clamp(drag.box.y+p.y-drag.start.y,0,image.height-drag.box.h))};
    else { const a=drag.anchor,sx=p.x>=a.x?1:-1,sy=p.y>=a.y?1:-1,ratio=Number(state.config.aspect);let w=Math.max(1,Math.abs(p.x-a.x)),h=Math.max(1,Math.abs(p.y-a.y));
      if(ratio>0){if(w/h>ratio)h=w/ratio;else w=h*ratio;}const factor=Math.min(1,(sx>0?image.width-a.x:a.x)/w,(sy>0?image.height-a.y:a.y)/h);w*=factor;h*=factor;
      current().edit.crop=C.cropBox({x:sx>0?a.x:a.x-w,y:sy>0?a.y:a.y-h,w,h},image.width,image.height);
    } draw();
  });
  function endDrag(){if(!state.drag)return;state.drag=null;render();persist();}
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
  canvas.addEventListener('keydown',event=>{if(!current()?.edit.crop||state.stage!=='prepare'||state.batch)return;const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;event.preventDefault();pushUndo();const b=current().edit.crop,step=event.shiftKey?10:1;b.x=C.clamp(b.x+delta[0]*step,0,state.active.width-b.w);b.y=C.clamp(b.y+delta[1]*step,0,state.active.height-b.h);render();persist();});

  async function prepared(item, vision = false, config = state.config) {
    const image=await imageCanvas(item),box=C.cropBox(item.edit.crop,image.width,image.height),size=C.exportSize(box,Number(config.maxSide));
    const problem=C.minimumError(box,size,config.minimum,Number(config.minWidth),Number(config.minHeight));if(problem)throw new Error(`${item.name}: ${problem}`);
    const sourceExt=/\.webp$/i.test(item.name)?'webp':/\.jpe?g$/i.test(item.name)?'jpg':'png';
    const ext=vision?'jpg':config.format==='original'?sourceExt:config.format;
    if(!vision&&config.format==='original'&&!item.edit.rotation&&!item.edit.flipH&&!item.edit.flipV&&box.x===0&&box.y===0&&box.w===item.width&&box.h===item.height&&size.width===item.width&&size.height===item.height)return{blob:item.file,ext};
    const output=document.createElement('canvas'),dimensions=vision?C.exportSize({w:size.width,h:size.height},1536):size;
    output.width=dimensions.width;output.height=dimensions.height;const ctx=output.getContext('2d');
    if(ext==='jpg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);}ctx.imageSmoothingQuality='high';ctx.drawImage(image,box.x,box.y,box.w,box.h,0,0,output.width,output.height);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/'+(ext==='jpg'?'jpeg':ext),vision ? 0.9 : Number(config.quality)/100));
    if(!blob)throw new Error('Could not encode the prepared image.');return{blob,ext};
  }
  const dataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the prepared crop.'));reader.readAsDataURL(blob);});
  function renderPresets() {
    const select=$('dsPreset');select.replaceChildren();for(const [id,[title]]of Object.entries(BUILTINS)){const option=document.createElement('option');option.value=id;option.textContent=title;select.append(option);}
    for(const item of state.shared){const option=document.createElement('option');option.value='shared:'+item.id;option.textContent=item.name+' (shared Vision)';select.append(option);}const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom / imported script';select.append(custom);
    select.value=[...select.options].some(o=>o.value===state.config.preset)?state.config.preset:'custom';
  }
  async function refreshShared(){try{const library=await api('/api/presets');state.shared=library.vision.filter(i=>i.source==='shared');renderPresets();}catch{}}
  $('dsPreset').addEventListener('change',()=>{const selected=$('dsPreset').value;state.config.preset=selected;const entry=BUILTINS[selected]||(()=>{const item=state.shared.find(i=>'shared:'+i.id===selected);return item?[item.name,item.prompt]:null;})();if(entry){state.config.title=entry[0];state.config.system=entry[1];$('dsScriptTitle').value=entry[0];$('dsSystem').value=entry[1];}render();persist();});
  $('dsImportScript').addEventListener('click',()=>$('dsScriptFile').click());
  $('dsScriptFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(state.batch||state.exporting)throw new Error('Finish the current operation before importing a script.');if(file.size>512*1024)throw new Error('Captioner script files must be at most 512 KB.');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());const doc=/\.txt$/i.test(file.name)?C.captionDocument({schema:1,product:'CyberHub',type:'system_prompt',module:'captioner',title:file.name.replace(/\.txt$/i,''),prompt:text}):C.captionDocument(JSON.parse(text));if(state.batch||state.exporting)throw new Error('Finish the current operation before importing a script.');state.config.title=doc.title;state.config.system=doc.prompt;state.config.preset='custom';$('dsScriptTitle').value=doc.title;$('dsSystem').value=doc.prompt;$('dsScriptDetails').open=true;renderPresets();render();persist();status('Captioner script imported as a local draft.');}catch(error){status(error.message||'Could not import this script.');}finally{event.target.value='';}});
  function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  $('dsExportScript').addEventListener('click',()=>{try{const doc=C.captionDocument({schema:1,product:'CyberHub',type:'system_prompt',module:'captioner',title:state.config.title,prompt:state.config.system});download(new Blob([JSON.stringify(doc,null,2)+'\n'],{type:'application/json'}),C.safeStem(doc.title+'.txt')+'.captioner.json');}catch(error){status(error.message);}});
  $('dsCaptionText').addEventListener('input',()=>{const item=current();if(!item)return;item.caption=$('dsCaptionText').value;item.captionRev++;item.captionKey=key(item);render();persist();});
  $('dsReviewed').addEventListener('click',()=>{if(!current())return;current().captionKey=key(current());current().captionRev++;render();persist();});
  $('dsCopy').addEventListener('click',async()=>{const text=current()?.caption||'';try{await navigator.clipboard.writeText(text);status('Caption copied.');}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();try{status(document.execCommand('copy')?'Caption copied.':'Select the caption text and copy it.');}catch{status('Select the caption text and copy it.');}finally{area.remove();}}});

  async function pollCaption(job) {
    let sequence=0,result='';
    for(;;){const value=await api(`/api/job?id=${encodeURIComponent(job.id)}&since=${sequence}`);let terminal;
      for(const event of value.events){sequence=event.seq+1;if(event.type==='prompt')result=event.text;if(['done','error','stopped'].includes(event.type))terminal=event;}
      if(terminal){if(terminal.type==='error')throw new Error(terminal.message);return terminal.type==='done'?result:null;}
      if(value.finished)throw new Error('The caption request ended without a result.');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
  function applyCaption(job,text){const item=state.items.find(i=>i.id===job.itemId);if(!text||!C.captionStillCurrent(item,job,state.config))return false;item.caption=text;item.captionRev++;item.captionKey=job.key;return true;}
  async function captionItems(items) {
    if(state.batch||state.exporting||!items.length)return;
    if(!state.config.system.trim()){status('Choose a caption script first.');return;}
    if(/\{WD_TAGS\}/i.test(state.config.system)){status('This script needs Auto Tagger output for {WD_TAGS}. Supply those tags in the script or use another caption script.');return;}
    const requested=items.map(item=>({item,revision:item.captionRev}));
    state.batch=true;state.stop=false;render();let completed=0,kept=0;
    try{const existing=await api('/api/state');if(existing.job&&!existing.job.finished)throw new Error('Another model run is active. Finish or stop it before captioning this dataset.');
      for(const {item,revision} of requested){if(state.stop)break;if(item.captionRev!==revision){kept++;continue;}status(`Captioning ${completed+1} of ${items.length}: ${item.name}`);const output=await prepared(item,true);if(state.stop)break;
        const snapshot={itemId:item.id,revision,key:key(item)};const connection=(await api('/api/state')).settings,imageURL=await dataURL(output.blob);if(state.stop)break;
        const result=await api('/api/generate',{workflow:'dataset_caption',count:1,rewrite_use_vision:true,rewrite_prompt:state.config.extra||'Write the training caption for this prepared image.',rewrite_system:state.config.system,caption_trigger:state.config.trigger,reference_image:{data_url:imageURL},api_url:connection.api_url,model:connection.model});
        state.job={...snapshot,id:result.id};if(state.stop)await api('/api/stop',{});await saveNow();const text=await pollCaption(state.job);if(applyCaption(state.job,text))completed++;else if(text)kept++;state.job=null;render();await saveNow();
      }status(state.stop?'Captioning stopped. Completed captions are kept.':`${completed} captions updated.${kept ? ` Kept newer manual edits for ${kept} images.` : ''} Review captions before exporting.`);
    }catch(error){status(error.message||'Captioning failed. Completed captions are kept.');}
    finally{state.batch=false;state.job=null;render();persist();}
  }
  async function resumeJob(){const job=state.job;state.batch=true;render();try{const info=await api('/api/state');if(info.job?.id!==job.id){status('The previous caption request is no longer available. Run Caption pending to continue.');return;}status('Recovering the caption request…');applyCaption(job,await pollCaption(job));}catch(error){status(error.message);}finally{state.job=null;state.batch=false;render();persist();}}
  $('dsCaptionCurrent').addEventListener('click',()=>captionItems(current()?[current()]:[]));
  $('dsCaptionPending').addEventListener('click',()=>captionItems(state.items.filter(item=>!ready(item))));
  $('dsStop').addEventListener('click',async()=>{state.stop=true;$('dsStop').disabled=true;try{if(state.job)await api('/api/stop',{});}catch(error){status(error.message);}finally{$('dsStop').disabled=false;}});
  $('dsExport').addEventListener('click',async()=>{
    if(state.batch||state.exporting||!state.items.length)return;
    if(state.items.some(item=>!ready(item))){status('Every queued image needs a caption reviewed for its current preparation. Caption pending, review existing captions or remove unwanted images.');stage('caption');return;}
    state.exporting=true;render();const items=state.items.map(item=>({...item,edit:clone(item.edit)})),config=clone(state.config);
    try{const images=[];let bytes=0;for(const [index,item]of items.entries()){status(`Preparing image ${index+1} of ${items.length} for export…`);const image=await prepared(item,false,config);bytes+=image.blob.size+new TextEncoder().encode(item.caption).length;if(bytes>512*1024*1024)throw new Error('Export is larger than 512 MB. Export a smaller batch.');images.push(image);}
      const names=C.pairNames(items.map((item,index)=>({name:item.name,ext:images[index].ext}))),entries=[];
      for(let i=0;i<items.length;i++)entries.push({name:names[i].image,data:images[i].blob},{name:names[i].caption,data:items[i].caption.trim()+'\n'});
      const zip=await C.zipStore(entries,(done,total)=>status(`Building dataset ZIP: ${done} of ${total} files…`));download(zip,'Scene-Director-LoRA-dataset.zip');status(`${items.length} image/caption pairs prepared for download. Originals are unchanged.`);
    }catch(error){status(error.message||'Dataset export failed.');}finally{state.exporting=false;render();}
  });
  render(); restore();
})();
