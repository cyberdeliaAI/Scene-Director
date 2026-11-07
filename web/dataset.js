(() => {
  'use strict';
  const C = window.SceneDatasetCore, $ = id => document.getElementById(id);
  const BUILTINS = {
    // Krea 2, Z-Image, Flux, SDXL, dataset and plain scripts are shared with CyberHub Captioner.
    krea2_character: ["Krea 2 Character LoRA", "You are a captioning assistant for Krea 2 character and likeness LoRA training datasets.\n\nAnalyze the image and write one concise, flowing natural-language caption suitable for Krea 2's Qwen3-VL text encoder.\n\nBegin with the trigger token: {TRIGGER}\n\nTreat the trigger token as the identity of the recurring person or character.\n\nAfter the trigger token, identify the subject with a generic class when appropriate, such as an adult woman or an adult man. Describe only the variable visible elements: pose, facial expression, clothing, accessories, hairstyle when it differs from the character's normal appearance, action, environment, background, framing, shot distance, camera angle, and clearly visible lighting conditions.\n\nDo not repeatedly describe stable identity-defining traits that remain consistent across the dataset. The trigger token should learn the person's face, facial proportions, normal hair color, normal eye appearance, body proportions, and other persistent likeness characteristics.\n\nDescribe a normally stable trait only when it is visibly altered in that particular image and the difference is relevant, such as different hair styling, glasses, makeup, facial hair, or a temporary appearance change.\n\nDo not describe the artistic style or rendering technique unless style variation itself is important to the dataset.\n\nCaption only what is clearly visible. Do not infer personality, biography, relationships, intent, or story context.\n\nUse natural descriptive sentences, never comma-separated tag lists. Keep the caption concise, normally between 25 and 60 words.\n\nDo not use the person's real name, celebrity identity, artist names, quality markers, prompt weighting, aesthetic praise, or watermark and text disclaimers.\n\nOutput only the caption."],
    krea2_style: ["Krea 2 Style LoRA", "You are a captioning assistant for Krea 2 LoRA training datasets.\n\nAnalyze the image and write one concise, flowing natural-language caption suitable for Krea 2's Qwen3-VL text encoder.\n\nBegin with the trigger token: {TRIGGER}\n\nTreat the trigger token as the holder of the shared visual style. Describe the content of the image, not the style itself.\n\nIdentify the main subject generically, such as an adult woman, an adult man, two people, a creature, or an object. Describe the variable visible elements: pose, expression, clothing, accessories, action, environment, important background elements, framing, shot distance, camera angle, and clearly visible lighting conditions.\n\nDo not describe visual traits that define the shared style. Do not mention the medium, artistic technique, rendering method, linework, brushwork, shading style, color treatment, illustration style, realism level, or other characteristics that remain consistent across the dataset. These must be learned through the trigger token.\n\nDo not describe recurring subject traits as part of the style when they can be identified separately. If an adult woman is visible, explicitly describe her as an adult woman. Likewise identify other subjects generically so that subject matter is separated from the style trigger.\n\nCaption only what is clearly visible. Do not infer hidden details, intent, story, or context.\n\nUse natural descriptive sentences, never comma-separated tag lists. Keep the caption concise, normally between 25 and 60 words.\n\nDo not use names, artist names, celebrity identities, quality markers, prompt weighting, aesthetic praise, or watermark and text disclaimers.\n\nOutput only the caption."],
    z_image: ["Z-Image LoRA training", "You are a captioning assistant for Z-Image LoRA training datasets.\nAnalyze the image and write one flowing natural-language caption.\n\nBegin with the trigger token: {TRIGGER}\n\nDescribe only the variable elements: pose, expression, clothing, action, environment, background, framing, shot distance, angle, lighting direction and quality.\n\nDo not describe traits that stay constant across the dataset. Those must be absorbed by the trigger token.\n\nCaption only what is clearly visible. Write in plain declarative sentences. Keep it between 40 and 70 words.\nNo names, no celebrity identities, no invented context, no quality markers, no weighting syntax, no watermark or text disclaimers.\nOutput only the caption text."],
    character: ['Character LoRA', 'Write a natural-language training caption for a character LoRA. Describe visible changing details: clothing, pose, expression, action, setting, framing, camera angle and light. Leave stable character identity, such as characteristic hair, face and body traits, to the supplied trigger token. If no trigger is supplied, refer to the subject naturally without inventing an identity. Use plain factual English, usually 40 to 80 words. Do not infer hidden details, names, backstory or emotions without visible evidence. Avoid quality slogans, LoRA syntax, tags and commentary. Return only one caption.'],
    style: ['Style LoRA', 'Write a concise natural-language caption for a style LoRA training image. Describe the changing scene content: visible subjects, action, objects, setting, arrangement, viewpoint and colors. Let the trigger token represent the consistent target style instead of repeatedly naming it. Keep explicit visible composition details. Do not add unseen details, artist names, quality slogans or interpretation. Write plain English and output only one caption.'],
    general: ['General image caption', 'Write one accurate English caption for an image-training dataset. Describe only visible subjects, their appearance, clothing, actions, spatial relationships, setting, framing, medium, colors and lighting. Use concise natural sentences and enough detail to distinguish this image, without guessing identities, invisible details or backstory. No quality slogans or introductory text. Return the caption only.'],
    flux: ["Flux LoRA training", "You are a captioning assistant for Flux LoRA training datasets.\nAnalyze the image and write one natural-language caption paragraph.\n\nBegin with the trigger token: {TRIGGER}\n\nDescribe only what varies across the dataset: pose, expression, clothing, action, setting, background elements, camera distance, angle, lighting and color palette.\n\nDo not describe inherent traits of the subject that remain constant. Those belong to the trigger token alone.\n\nWrite concrete declarative prose. No hidden context, no names, no celebrity identities, no invented events, no unseen text or logos, no quality hype, no weighting syntax.\nKeep it between 50 and 80 words.\nOutput one paragraph only."],
    sdxl: ["SDXL LoRA training", "You are a captioning assistant for LoRA training datasets (SDXL).\nAnalyze the image and write one comma-separated caption.\n\nBegin every caption with the trigger token: {TRIGGER}\n\nAfter the trigger, describe only the variable elements: pose, expression, clothing, background, setting, lighting, camera framing, composition and image quality.\n\nDo not describe the inherent traits of the subject that stay constant across the dataset (face shape, hair color, eye color, body type, permanent markings). These must be absorbed by the trigger token.\n\nKeep captions under 60 tokens. No invented details, no proper names, no celebrity identities, no hype filler, no weighted syntax, no duplicate tags.\nOutput only the final comma-separated caption."],
    dataset: ["Dataset training caption", "You are preparing concise dataset captions for image model training.\n\nDescribe the image with stable, reusable visual terms. Focus on subject identity as a category, clothing, pose, framing, environment, style, lighting and notable objects. Prefer clear nouns and adjectives over poetic language.\n\nDo not include guesses, story context, emotions that are not visible, quality ratings, camera EXIF, watermarks, logos or unreadable text.\n\nOutput one concise caption only."],
    plain: ["Plain visual description", "Describe the image accurately in plain language.\n\nMention only visible subjects, objects, setting, composition, lighting, colors and style. Keep uncertain details out. Do not identify real people, brands or copyrighted characters unless text in the image clearly names them.\n\nOutput one clear paragraph only."],
  };
  const DEFAULTS = { aspect: '0', aspectAll: true, resize: 'longest', maxSide: 1024, targetArea: 1024, snap: 0, minimum: 'off', minWidth: 1024, minHeight: 1024, format: 'original', quality: 95,
    preset: 'character', title: BUILTINS.character[0], system: BUILTINS.character[1], trigger: '', extra: '', savedId: '', traits: '', parallel: 1,
    grid: true, customRatios: [], filter: 'all', autoTarget: 'head', autoPadding: 15, exportMode: 'zip', exportFolder: '', overwrite: false,
    naming: 'original', namePrefix: '', kohya: false, repeats: 10, classWord: '', jsonl: false, csv: false, approvedOnly: false };
  const state = { items: [], index: -1, config: { ...DEFAULTS }, stage: 'prepare', active: null, loading: false,
    loadId: 0, batch: false, exporting: false, restoring: true, stop: false, job: null, drag: null, view: null, shared: [], db: null,
    scripts: [], tokens: new Set(), bulkUndo: null, zoom: 1, pan: { x:0, y:0 }, panning: null, space: false };
  const canvas = $('dsCanvas'), context = canvas.getContext('2d');
  const current = () => state.items[state.index];
  const clone = value => JSON.parse(JSON.stringify(value));
  const status = message => { $('dsStatus').textContent = message; };
  const key = item => C.editKey(item, state.config);
  const ready = item => !!item.caption.trim() && item.captionKey === key(item);
  const controls = { resize:'dsResize', maxSide:'dsMaxSide', targetArea:'dsTargetArea', snap:'dsSnap', minimum:'dsMinimum', minWidth:'dsMinWidth', minHeight:'dsMinHeight', format:'dsFormat', quality:'dsQuality', trigger:'dsTrigger', extra:'dsExtra', title:'dsScriptTitle', system:'dsSystem',
    traits:'dsTraits', parallel:'dsParallel', autoTarget:'dsAutoTarget', autoPadding:'dsAutoPadding', exportMode:'dsExportMode', exportFolder:'dsExportFolder', naming:'dsNaming', namePrefix:'dsNamePrefix', repeats:'dsRepeats', classWord:'dsClassWord' };
  const FLAGS = { small:'Too small', size:'Check size', error:'Unusable' };
  // With "Same ratio for all images" off, each image keeps the ratio it was cropped with.
  const ratioOf = item => Number(state.config.aspectAll === false && item?.aspect != null ? item.aspect : state.config.aspect) || 0;
  const minimum = () => C.minimumSpec(state.config);
  const sourceSize = item => item?.width && item?.height ? C.dimensions(item.width, item.height, item.edit.rotation) : null;
  const sameBox = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  function cropFor(item) { const size = sourceSize(item); return size ? item.edit.crop || C.centerCrop(size.width, size.height, ratioOf(item)) : null; }
  // Size problems use measured dimensions, so the queue flags images before they are opened.
  function problem(item) {
    if (!item) return { level:'', message:'' };
    if (item.unreadable) return { level:'error', message:'This file could not be read as an image.' };
    const size = sourceSize(item); if (!size) return { level:'', message:'' };
    if (size.width * size.height > 40000000) return { level:'error', message:'This image exceeds 40 megapixels. Resize it before adding it to this dataset.' };
    const source = C.sourceProblem(size.width, size.height, ratioOf(item), minimum());
    if (source) return { level:'small', message:source };
    const box = cropFor(item), message = C.exportProblem(box, C.exportPlan(box, state.config), minimum());
    return { level:message ? 'size' : '', message };
  }
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
        edit:clone(item.edit), undo:clone(item.undo), aspect:item.aspect, caption:item.caption, captionKey:item.captionKey, captionRev:item.captionRev,
        approved:!!item.approved, captionError:item.captionError || '', autoCrop:item.autoCrop !== false, imported:!!item.imported, pendingImport:!!item.pendingImport })) };
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
        state.job = null;
      }
      $('dsStorage').textContent = 'Dataset session saved locally in this app. Clear session removes its local copy.';
    } catch { $('dsStorage').textContent = 'Local session storage is unavailable. Keep this window open and export your work.'; }
    if (!Array.isArray(state.config.customRatios) || !state.config.customRatios.length) {
      try { state.config.customRatios = JSON.parse(localStorage.getItem('scene-director-custom-ratios') || '[]').filter(value => typeof value === 'string').slice(-12); }
      catch { state.config.customRatios = []; }
    }
    state.items.forEach(item => { item.approved = !!item.approved; item.captionError = item.captionError || ''; ensureCrop(item); });
    renderAspectOptions(); syncControls();
    state.restoring = false; renderPresets(); queue(); render(); measureAll(); loadScripts(); if (current()) await select(state.index);
    try { if (localStorage.getItem('scene-director-active-tool') === 'dataset') showTool(true); } catch {}
  }

  // Decode only the active image or the image currently being processed.
  async function imageCanvas(item) {
    const bitmap = await createImageBitmap(item.file, { imageOrientation:'from-image' });
    try {
      if (bitmap.width * bitmap.height > 40000000) throw Object.assign(new Error('This image exceeds 40 megapixels. Resize it before adding it to this dataset.'), { sizeProblem:true });
      if (item.width !== bitmap.width || item.height !== bitmap.height) { item.width = bitmap.width; item.height = bitmap.height; if (item.edit) item.edit.crop = null; }
      item.unreadable = false;
      const edit = item.edit || (item.edit = { rotation:0, flipH:false, flipV:false, crop:null });
      const size = C.dimensions(bitmap.width,bitmap.height,edit.rotation);
      if (!edit.crop) { edit.crop = C.centerCrop(size.width,size.height,ratioOf(item)); item.autoCrop = true; if (state.config.aspectAll !== false || item.aspect == null) item.aspect = state.config.aspect; }
      if (item.pendingImport) { item.captionKey = key(item); item.pendingImport = false; }
      const result = document.createElement('canvas'); result.width = size.width; result.height = size.height;
      const ctx = result.getContext('2d'); ctx.translate(size.width/2,size.height/2);
      ctx.scale(edit.flipH ? -1 : 1,edit.flipV ? -1 : 1); ctx.rotate(edit.rotation*Math.PI/180); ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);
      return result;
    } finally { bitmap.close(); }
  }
  async function select(index) {
    if (index < 0 || index >= state.items.length) return;
    if (index !== state.index) { state.zoom = 1; state.pan = { x:0, y:0 }; }
    state.index = index; state.loading = true; state.active = null; const ticket = ++state.loadId;
    render();
    try { const image = await imageCanvas(current()); if (ticket !== state.loadId) return; state.active = image; }
    catch (error) { if (ticket === state.loadId) status(error.message || 'Could not decode this image.'); }
    finally { if (ticket === state.loadId) { state.loading = false; render(); draw(); persist(); } }
  }
  const stemOf = file => (file.webkitRelativePath || file.name).replace(/\.[^./\\]*$/, '').normalize('NFC').toLowerCase();
  // Images plus optional .txt captions with the same name (also inside chosen folders). Duplicates are skipped.
  async function addFiles(files) {
    if (state.batch || state.exporting || state.restoring) return;
    const list = Array.from(files), texts = new Map();
    for (const file of list) if (/\.txt$/i.test(file.name) && file.size <= 1024 * 1024) texts.set(stemOf(file), file);
    const known = new Set(state.items.map(item => `${item.name}|${item.file.size}|${item.file.lastModified}`));
    let added = 0, skipped = 0, duplicates = 0, captions = 0;
    for (const file of list) {
      if (/\.txt$/i.test(file.name)) continue;
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > 100*1024*1024 || state.items.length >= 1000) { skipped++; continue; }
      const signature = `${file.name}|${file.size}|${file.lastModified}`;
      if (known.has(signature)) { duplicates++; continue; }
      known.add(signature);
      const item = { id:crypto.randomUUID(), name:file.name, file, url:URL.createObjectURL(file), width:0, height:0,
        edit:{ rotation:0, flipH:false, flipV:false, crop:null }, undo:[], caption:'', captionKey:'', captionRev:0, approved:false, captionError:'', autoCrop:true };
      const text = texts.get(stemOf(file));
      if (text) { try { const caption = (await text.text()).replace(/^﻿/, '').trim(); if (caption) { Object.assign(item, { caption, imported:true, pendingImport:true }); captions++; } } catch {} }
      state.items.push(item); added++;
    }
    queue(); if (state.index < 0 && state.items.length) select(0); else render();
    status([`${added} image${added === 1 ? '' : 's'} added.`, captions && `${captions} matching caption${captions === 1 ? '' : 's'} imported for review.`,
      duplicates && `${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped.`, skipped && `${skipped} unsupported, empty, oversized or extra files skipped.`].filter(Boolean).join(' '));
    persist(); measureAll();
  }
  function ensureCrop(item) {
    const size = sourceSize(item); if (!size) return;
    if (!item.edit.crop) { item.edit.crop = C.centerCrop(size.width, size.height, ratioOf(item)); item.autoCrop = true; if (state.config.aspectAll !== false || item.aspect == null) item.aspect = state.config.aspect; }
    if (item.pendingImport) { item.captionKey = key(item); item.pendingImport = false; }
  }
  $('dsAdd').addEventListener('click', () => $('dsFiles').click());
  $('dsFiles').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  $('dsAddFolder').addEventListener('click', () => $('dsFolderInput').click());
  $('dsFolderInput').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  const dropzone = $('dsDropzone');
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag-over'); });
  dropzone.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); dropzone.classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
  $('dsPrev').addEventListener('click', () => select(neighbour(-1))); $('dsNext').addEventListener('click', () => select(neighbour(1)));
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
  $('dsRemoveSmall').addEventListener('click', () => {
    if (state.batch || state.exporting) return;
    const small = state.items.filter(item => problem(item).level === 'small');
    if (!small.length || !confirm(`Remove ${small.length} image${small.length === 1 ? '' : 's'} that cannot reach the minimum size from this dataset? Original files are kept.`)) return;
    const active = current();
    small.forEach(item => URL.revokeObjectURL(item.url)); state.items = state.items.filter(item => !small.includes(item));
    const index = state.items.indexOf(active); queue();
    if (index >= 0) { state.index = index; render(); }
    else { ++state.loadId; state.active = null; state.index = -1; if (state.items.length) select(0); else { render(); draw(); } }
    persist(); status(`${small.length} too-small image${small.length === 1 ? '' : 's'} removed from this dataset.`);
  });
  // Read only image headers through the browser, one at a time, so the queue can flag sizes early.
  let measuring = false;
  async function measureAll() {
    if (measuring) return; measuring = true;
    try {
      for (let index = 0; index < state.items.length; index++) {
        const item = state.items[index];
        if ((item.width && item.height) || item.unreadable) continue;
        const size = await new Promise(resolve => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = () => resolve(null); image.src = item.url; });
        if (!state.items.includes(item) || (item.width && item.height)) continue;
        if (size && size[0] && size[1]) { item.width = size[0]; item.height = size[1]; ensureCrop(item); } else item.unreadable = true;
        if (index % 25 === 24) render();
      }
    } finally { measuring = false; render(); persist(); }
    if (state.items.some(item => !(item.width && item.height) && !item.unreadable)) setTimeout(measureAll, 0);
  }
  function queue() {
    $('dsQueue').replaceChildren();
    for (const [index,item] of state.items.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ds-thumb'; button.dataset.id = item.id;
      const image = document.createElement('img'); image.src = item.url; image.alt = ''; image.loading = 'lazy';
      const text = document.createElement('span'); text.textContent = item.name; button.title = item.name; button.setAttribute('aria-label',`Dataset image ${index+1}: ${item.name}`);
      button.append(image,text); button.addEventListener('click', () => select(index)); $('dsQueue').appendChild(button);
    }
  }
  function validation(item = current()) { return problem(item).message; }
  function updateDimensions(item = current()) {
    $('dsValidation').textContent = validation(item);
    const size = sourceSize(item), box = item?.edit.crop;
    if (!size || !box) { $('dsDimensions').textContent = state.loading ? 'Loading image…' : 'Source → Crop → Export dimensions appear here.'; return; }
    const plan = C.exportPlan(box, state.config), megapixels = (plan.width * plan.height / 1e6).toFixed(2);
    $('dsDimensions').textContent = `${size.width} × ${size.height} source → ${box.w} × ${box.h} crop → ${plan.width} × ${plan.height} export (${megapixels} MP)${sameBox(plan.crop, box) ? '' : ` · rounding trims the crop to ${plan.crop.w} × ${plan.crop.h}`}`;
  }
  function updateFields() {
    const mode = state.config.minimum, area = state.config.resize === 'area';
    $('dsMaxSideField').hidden = area; $('dsTargetAreaField').hidden = !area;
    $('dsMinFields').hidden = mode === 'off'; $('dsMinHeightField').hidden = mode !== 'dimensions';
    $('dsMinWidthLabel').textContent = { longest:'Longest side', shortest:'Shortest side', area:'Area side' }[mode] || 'Width';
    $('dsMinHelp').textContent = {
      off:'No minimum. Crops of any size are allowed.',
      dimensions:'Both sides of the crop and the export must reach these sizes.',
      longest:'The longest side of the crop and the export must reach this size.',
      shortest:'Both sides of the crop and the export must reach this size.',
      area:'1024 means at least 1024 × 1024 pixels in total, for example 840 × 1250. Checked before rounding.',
    }[mode] + (mode === 'off' ? '' : ' Crops cannot be dragged smaller. Images that cannot reach it are marked Too small and skipped.');
  }
  function syncControls() {
    for (const [name,id] of Object.entries(controls)) $(id).value = state.config[name];
    for (const [name,id] of Object.entries(checks)) $(id).checked = !!state.config[name];
    $('dsAspect').value = state.config.aspect; $('dsAspectAll').checked = state.config.aspectAll !== false; $('dsFilter').value = state.config.filter || 'all'; updateFields();
  }
  const FILTERS = {
    all: () => true,
    empty: item => !item.caption.trim(),
    review: item => !!item.caption.trim() && (!ready(item) || !item.approved),
    approved: item => ready(item) && !!item.approved,
    failed: item => !!item.captionError,
    warnings: item => warningsFor(item).length > 0,
    size: item => !!problem(item).level,
  };
  const visible = item => (FILTERS[state.config.filter] || FILTERS.all)(item);
  const identityScript = () => /character/i.test(state.config.preset) || /character|likeness/i.test(state.config.title);
  function warningsFor(item) { return item?.caption.trim() ? C.captionWarnings(item.caption, state.config.traits, identityScript()) : []; }
  function neighbour(direction) {
    for (let index = state.index + direction; index >= 0 && index < state.items.length; index += direction) if (visible(state.items[index])) return index;
    return -1;
  }
  function captionState(item) {
    if (!item) return '';
    const text = item.caption.trim(), parts = [];
    if (item.captionError) parts.push(`Last caption attempt failed: ${item.captionError}`);
    if (!text) parts.push('No caption yet.');
    else {
      parts.push(`${text.split(/\s+/).length} words.`);
      parts.push(!ready(item) ? 'The preparation changed. Review, regenerate or approve this caption for the current crop.'
        : item.approved ? 'Approved.' : item.imported ? 'Imported caption. Review and approve it.' : 'Not approved yet.');
    }
    const warnings = warningsFor(item);
    if (warnings.length) parts.push('Check: ' + warnings.join('; ') + '.');
    return parts.join(' ');
  }
  function updateExportFields() {
    const folder = state.config.exportMode === 'folder';
    $('dsFolderFields').hidden = !folder; $('dsPrefixField').hidden = state.config.naming !== 'numbered'; $('dsKohyaFields').hidden = !state.config.kohya;
    $('dsExport').textContent = folder ? 'Write images + captions' : 'Export images + captions…';
    const extras = [state.config.jsonl && 'metadata.jsonl', state.config.csv && 'captions.csv'].filter(Boolean);
    const where = state.config.kohya ? ` inside the folder “${C.kohyaFolder(state.config.repeats, state.config.trigger, state.config.classWord)}”` : '';
    $('dsExportHelp').textContent = `${folder ? 'Writes' : 'A ZIP with'} each prepared image and a matching .txt caption${where}${extras.length ? `, plus ${extras.join(' and ')}` : ''}. ` +
      (state.config.approvedOnly ? 'Every exported caption must be approved.' : 'Every exported image needs a caption for its current crop.');
  }
  function render() {
    const item = current(), busy = state.batch || state.exporting || state.restoring, caption = state.stage === 'caption';
    $('dsPrepareControls').hidden = caption; $('dsCaptionControls').hidden = !caption; $('dsEditor').hidden = !caption;
    $('dsContinue').hidden = caption; $('dsPrepareTab').setAttribute('aria-pressed',String(!caption)); $('dsCaptionTab').setAttribute('aria-pressed',String(caption));
    $('dsEmpty').hidden = !!state.active; $('dsPosition').textContent = item ? `${state.index+1} / ${state.items.length} · ${item.name}` : 'No images';
    $('dsPrev').disabled = neighbour(-1) < 0; $('dsNext').disabled = neighbour(1) < 0;
    for (const id of ['dsRemove','dsResetCrop','dsRotateLeft','dsRotateRight','dsFlipH','dsFlipV','dsAutoOne']) $(id).disabled = !item || busy || state.loading;
    $('dsUndo').disabled = !item?.undo.length || busy || state.loading;
    for (const id of ['dsAdd','dsAddFolder','dsImportCaptions','dsClear','dsSquare','dsBuckets','dsAspect','dsAspectAll','dsCustomRatio','dsAddRatio',...Object.values(controls),...Object.values(checks),
      'dsPreset','dsAutoAll','dsBulkReplace','dsBulkTrigger','dsBulkAffix','dsBulkUndo','dsSaveScript','dsUpdateScript','dsDeleteScript']) $(id).disabled = busy;
    $('dsAspect').value = state.config.aspectAll === false && item?.aspect != null ? item.aspect : state.config.aspect;
    $('dsAspectAll').checked = state.config.aspectAll !== false; updateFields();
    $('dsGrid').setAttribute('aria-pressed', String(state.config.grid !== false));
    $('dsZoom').textContent = `${Math.round(state.zoom * 100)}%`; $('dsFit').disabled = state.zoom === 1 && !state.pan.x && !state.pan.y;
    $('dsClear').disabled = busy || !state.items.length;
    $('dsImportScript').disabled = busy;
    $('dsExport').disabled = !state.items.length || busy;
    $('dsCaptionCurrent').disabled = !item || busy || !state.config.system.trim() || !!validation();
    $('dsCaptionPending').disabled = !state.items.length || busy || !state.config.system.trim(); $('dsStop').hidden = !state.batch;
    $('dsCaptionText').disabled = !item; $('dsCopy').disabled = !item?.caption.trim(); $('dsReviewed').disabled = !item?.caption.trim() || (ready(item) && !!item.approved);
    if (document.activeElement !== $('dsCaptionText')) $('dsCaptionText').value = item?.caption || '';
    $('dsCaptionState').textContent = captionState(item);
    $('dsBulkUndo').hidden = !state.bulkUndo;
    $('dsFilter').value = state.config.filter in FILTERS ? state.config.filter : 'all';
    updateScriptButtons(); updateExportFields(); updateDimensions(item);
    const counts = { approved:0, review:0, empty:0, failed:0, warnings:0, small:0, check:0 }, issues = new Map(), warned = new Set();
    for (const value of state.items) {
      const issue = problem(value); issues.set(value.id, issue);
      if (issue.level === 'small') counts.small++; else if (issue.level) counts.check++;
      if (!value.caption.trim()) counts.empty++; else if (ready(value) && value.approved) counts.approved++; else counts.review++;
      if (value.captionError) counts.failed++;
      if (warningsFor(value).length) { counts.warnings++; warned.add(value.id); }
    }
    $('dsSummary').textContent = [`${state.items.length} images`, `${counts.approved} approved`, counts.review && `${counts.review} to review`,
      counts.empty && `${counts.empty} without caption`, counts.failed && `${counts.failed} failed`, counts.warnings && `${counts.warnings} with warnings`,
      counts.small && `${counts.small} too small`, counts.check && `${counts.check} need a size check`].filter(Boolean).join(' · ');
    $('dsRemoveSmall').hidden = !counts.small; $('dsRemoveSmall').disabled = busy; $('dsRemoveSmall').textContent = `Remove too small (${counts.small})`;
    const byId = new Map(state.items.map(i => [i.id, i]));
    for (const button of $('dsQueue').children) {
      const value = byId.get(button.dataset.id); if (!value) continue;
      const issue = issues.get(value.id);
      button.setAttribute('aria-current',String(value === item)); button.hidden = !visible(value) && value !== item;
      button.dataset.state = value.captionError ? 'failed' : warned.has(value.id) ? 'warn' : !value.caption.trim() ? 'empty' : !ready(value) ? 'stale' : value.approved ? 'approved' : 'ready';
      button.dataset.problem = issue.level; button.dataset.flag = FLAGS[issue.level] || '';
      button.title = [value.name, issue.message, value.captionError && `Caption failed: ${value.captionError}`].filter(Boolean).join('\n');
    }
    requestAnimationFrame(draw);
  }
  const checks = { overwrite:'dsOverwrite', kohya:'dsKohya', jsonl:'dsJsonl', csv:'dsCsv', approvedOnly:'dsApprovedOnly' };
  function readConfig() {
    const config = { ...state.config };
    for (const [name,id] of Object.entries(controls)) config[name] = $(id).value;
    for (const [name,id] of Object.entries(checks)) config[name] = $(id).checked;
    const limits = { maxSide:[0,32768], targetArea:[64,32768], snap:[0,64], minWidth:[1,32768], minHeight:[1,32768], quality:[10,100], parallel:[1,4], repeats:[1,1000], autoPadding:[0,200] };
    for (const [name,[low,high]] of Object.entries(limits)) {
      config[name] = Number(config[name]);
      if (!Number.isInteger(config[name]) || config[name] < low || config[name] > high) throw new Error('Enter valid size, quality, repeat and padding values.');
    }
    return config;
  }
  for (const [name,id] of [...Object.entries(controls), ...Object.entries(checks)]) $(id).addEventListener('input', () => {
    if (state.batch || state.exporting) return;
    try { state.config = readConfig(); if (name === 'system' || name === 'title') { state.config.preset = 'custom'; $('dsPreset').value = 'custom'; }
      render(); persist();
    } catch (error) { status(error.message); }
  });
  const PADDING = { face:40, head:15, upper_body:8, person:5, subject:8 };
  $('dsAutoTarget').addEventListener('change', () => {
    const padding = PADDING[$('dsAutoTarget').value];
    if (padding != null) { $('dsAutoPadding').value = padding; $('dsAutoPadding').dispatchEvent(new Event('input')); }
  });
  $('dsFilter').addEventListener('change', () => { state.config.filter = $('dsFilter').value; render(); persist(); });
  function pushUndo(item = current()) { if (item) { item.undo.push({ edit:clone(item.edit), aspect:item.aspect }); item.undo = item.undo.slice(-30); } }
  const ratioLabel = value => [...$('dsAspect').options].find(option => option.value === String(value))?.textContent || String(value);
  // Apply a ratio plus the current minimum to the current image or to every image. Returns null when cancelled.
  function applyAspect(value, all) {
    const targets = all ? state.items : state.items.filter(item => item === current()), changes = [];
    for (const item of targets) {
      const size = sourceSize(item); if (!size || !item.edit.crop) continue;
      // Untouched automatic crops simply become the largest crop for the new ratio.
      const next = item.autoCrop ? C.centerCrop(size.width, size.height, Number(value) || 0) : C.constrainCrop(item.edit.crop, size.width, size.height, Number(value) || 0, minimum());
      if (!sameBox(next, item.edit.crop)) changes.push([item, next]);
    }
    const others = changes.filter(([item]) => item !== current() && !item.autoCrop).length;
    if (others && !confirm(`Adjust ${others} other crop${others === 1 ? '' : 's'} to ${ratioLabel(value)} and the minimum size? Crops change around their current center. Changed crops need their captions reviewed again.`)) return null;
    for (const [item, next] of changes) { pushUndo(item); item.edit.crop = next; }
    state.config.aspect = String(value); targets.forEach(item => { item.aspect = String(value); });
    if (all) state.config.aspectAll = true;
    render(); persist(); return changes.length;
  }
  // A committed minimum enlarges existing crops around their center when needed.
  function constrainAll() {
    let changed = 0;
    for (const item of state.items) {
      const size = sourceSize(item); if (!size || !item.edit.crop) continue;
      const next = C.constrainCrop(item.edit.crop, size.width, size.height, ratioOf(item), minimum());
      if (sameBox(next, item.edit.crop)) continue;
      pushUndo(item); item.edit.crop = next; changed++;
    }
    render(); persist();
    if (changed) status(`${changed} crop${changed === 1 ? ' was' : 's were'} adjusted to meet the minimum size.`);
  }
  for (const id of ['dsMinimum','dsMinWidth','dsMinHeight']) $(id).addEventListener('change', () => { if (!state.batch && !state.exporting) constrainAll(); });
  $('dsAspect').addEventListener('change', () => {
    if (state.batch || state.exporting) { render(); return; }
    const changed = applyAspect($('dsAspect').value, state.config.aspectAll !== false);
    if (changed === null) render(); else if (changed) status(`${changed} crop${changed === 1 ? '' : 's'} adjusted to ${ratioLabel($('dsAspect').value)}.`);
  });
  $('dsAspectAll').addEventListener('change', () => {
    if (state.batch || state.exporting) { render(); return; }
    if ($('dsAspectAll').checked) { const changed = applyAspect($('dsAspect').value, true); if (changed === null) render(); else if (changed) status(`${changed} crop${changed === 1 ? '' : 's'} adjusted to ${ratioLabel($('dsAspect').value)}.`); return; }
    state.items.forEach(item => { if (item.aspect == null) item.aspect = state.config.aspect; });
    state.config.aspectAll = false; render(); persist(); status('Each image now keeps its own aspect ratio.');
  });
  async function transform(action) { if (!current() || state.loading || state.batch || state.exporting) return; pushUndo(); action(current().edit); current().edit.crop = null; await select(state.index); }
  $('dsRotateLeft').addEventListener('click', () => transform(edit => { edit.rotation = (edit.rotation+270)%360; }));
  $('dsRotateRight').addEventListener('click', () => transform(edit => { edit.rotation = (edit.rotation+90)%360; }));
  $('dsFlipH').addEventListener('click', () => transform(edit => { edit.flipH = !edit.flipH; }));
  $('dsFlipV').addEventListener('click', () => transform(edit => { edit.flipV = !edit.flipV; }));
  $('dsUndo').addEventListener('click', async () => { if (!current()?.undo.length || state.batch) return; const entry = current().undo.pop(); if (entry && entry.edit) { current().edit = entry.edit; current().aspect = entry.aspect; } else current().edit = entry; await select(state.index); });
  $('dsResetCrop').addEventListener('click', () => { if (!state.active || state.batch) return; pushUndo(); current().edit.crop = C.centerCrop(state.active.width,state.active.height,ratioOf(current())); current().autoCrop = true; render(); persist(); });
  function preset(values, aspect, message) {
    if (state.batch || state.exporting) return;
    const previous = clone(state.config);
    Object.assign(state.config, values); syncControls();
    const changed = applyAspect(aspect, true);
    if (changed === null) { state.config = previous; syncControls(); render(); return; }
    status(`${message}${changed ? ` ${changed} crop${changed === 1 ? '' : 's'} adjusted.` : ''}`);
  }
  $('dsSquare').addEventListener('click', () => preset({ resize:'longest', maxSide:1024, minimum:'dimensions', minWidth:1024, minHeight:1024 }, '1',
    '1024 square: 1:1 crops of at least 1024 × 1024, exported at 1024 × 1024.'));
  $('dsBuckets').addEventListener('click', () => preset({ resize:'area', targetArea:1024, snap:64, minimum:'area', minWidth:1024 }, '0',
    '1024 buckets: free crops with at least 1024 × 1024 pixels of area, exported in multiples of 64 such as 832 × 1216.'));

  function view(rect) {
    const image = state.active, fit = Math.min((rect.width-24)/image.width,(rect.height-24)/image.height), scale = fit * state.zoom;
    return { scale, fit, x:(rect.width-image.width*scale)/2 + state.pan.x, y:(rect.height-image.height*scale)/2 + state.pan.y };
  }
  function handles(crop) {
    return { corners:[[crop.x,crop.y,crop.x+crop.w,crop.y+crop.h,'nwse'],[crop.x+crop.w,crop.y,crop.x,crop.y+crop.h,'nesw'],[crop.x,crop.y+crop.h,crop.x+crop.w,crop.y,'nesw'],[crop.x+crop.w,crop.y+crop.h,crop.x,crop.y,'nwse']],
      edges:[['n',crop.x+crop.w/2,crop.y,'ns'],['s',crop.x+crop.w/2,crop.y+crop.h,'ns'],['w',crop.x,crop.y+crop.h/2,'ew'],['e',crop.x+crop.w,crop.y+crop.h/2,'ew']] };
  }
  function draw() {
    if ($('datasetWorkspace').hidden) return;
    const rect = $('dsPreview').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1,Math.round(rect.width*dpr)); canvas.height = Math.max(1,Math.round(rect.height*dpr));
    context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,rect.width,rect.height);
    const image = state.active; if (!image || !current()?.edit.crop) { state.view = null; return; }
    context.imageSmoothingQuality = 'high';
    if (state.stage === 'caption') {
      const box = C.exportPlan(current().edit.crop,state.config).crop, scale = Math.min((rect.width-24)/box.w,(rect.height-24)/box.h);
      context.drawImage(image,box.x,box.y,box.w,box.h,(rect.width-box.w*scale)/2,(rect.height-box.h*scale)/2,box.w*scale,box.h*scale);
      state.view = null; return;
    }
    const { scale, x, y } = state.view = view(rect);
    context.drawImage(image,x,y,image.width*scale,image.height*scale);
    const crop = current().edit.crop, cx=x+crop.x*scale, cy=y+crop.y*scale, cw=crop.w*scale, ch=crop.h*scale;
    context.fillStyle='rgba(0,0,0,.58)'; context.beginPath(); context.rect(x,y,image.width*scale,image.height*scale); context.rect(cx,cy,cw,ch); context.fill('evenodd');
    const plan=C.exportPlan(crop,state.config); context.strokeStyle=problem(current()).level?'#f07a6a':'#e6ac50'; context.lineWidth=2; context.strokeRect(cx,cy,cw,ch);
    if (!sameBox(plan.crop,crop)) { context.save(); context.setLineDash([5,4]); context.strokeStyle='rgba(255,255,255,.8)'; context.lineWidth=1; context.strokeRect(x+plan.crop.x*scale,y+plan.crop.y*scale,plan.crop.w*scale,plan.crop.h*scale); context.restore(); }
    if (state.config.grid !== false) {
      context.strokeStyle='rgba(255,255,255,.4)'; context.lineWidth=1;
      for (const third of [1/3,2/3]) { context.beginPath(); context.moveTo(cx+cw*third,cy); context.lineTo(cx+cw*third,cy+ch); context.stroke(); context.beginPath(); context.moveTo(cx,cy+ch*third); context.lineTo(cx+cw,cy+ch*third); context.stroke(); }
    }
    context.fillStyle='#f3c275';
    for (const [px,py] of [[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]]) context.fillRect(px-5,py-5,10,10);
    for (const [px,py,horizontal] of [[cx+cw/2,cy,true],[cx+cw/2,cy+ch,true],[cx,cy+ch/2,false],[cx+cw,cy+ch/2,false]]) context.fillRect(px-(horizontal?8:3),py-(horizontal?3:8),horizontal?16:6,horizontal?6:16);
  }
  new ResizeObserver(draw).observe($('dsPreview'));
  function pointer(event) { const rect=canvas.getBoundingClientRect(),view=state.view; return { x:C.clamp((event.clientX-rect.left-view.x)/view.scale,0,state.active.width),y:C.clamp((event.clientY-rect.top-view.y)/view.scale,0,state.active.height) }; }
  function hit(p, crop) {
    const near = 12 / state.view.scale, marks = handles(crop);
    const corner = marks.corners.find(([x,y]) => Math.hypot(p.x-x,p.y-y) <= near);
    const edge = !corner && marks.edges.find(([,x,y]) => Math.hypot(p.x-x,p.y-y) <= near * 1.4);
    const inside = p.x>=crop.x && p.x<=crop.x+crop.w && p.y>=crop.y && p.y<=crop.y+crop.h;
    return { corner, edge, inside };
  }
  canvas.addEventListener('pointerdown', event => {
    if (!state.view || state.stage !== 'prepare') return;
    if (event.button === 1 || (event.button === 0 && (state.space || event.altKey))) {
      state.panning = { x:event.clientX, y:event.clientY, pan:{ ...state.pan } }; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing'; event.preventDefault(); return;
    }
    if (event.button !== 0 || state.batch || state.exporting) return;
    const p = pointer(event), crop = current().edit.crop, { corner, edge, inside } = hit(p, crop);
    pushUndo();
    state.drag = { start:p, box:clone(crop), move:!corner && !edge && inside, edge:edge ? edge[0] : null, anchor:corner ? { x:corner[2], y:corner[3] } : p, changed:false };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (state.panning) { state.pan = { x:state.panning.pan.x + event.clientX - state.panning.x, y:state.panning.pan.y + event.clientY - state.panning.y }; draw(); return; }
    if (!state.view) return;
    if (!state.drag) {
      if (state.stage !== 'prepare' || !current()?.edit.crop) return;
      const { corner, edge, inside } = hit(pointer(event), current().edit.crop);
      canvas.style.cursor = state.space ? 'grab' : corner ? `${corner[4]}-resize` : edge ? `${edge[3]}-resize` : inside ? 'move' : 'crosshair';
      return;
    }
    const drag=state.drag,p=pointer(event),image=state.active,item=current();
    if (drag.move) item.edit.crop={...drag.box,x:Math.round(C.clamp(drag.box.x+p.x-drag.start.x,0,image.width-drag.box.w)),y:Math.round(C.clamp(drag.box.y+p.y-drag.start.y,0,image.height-drag.box.h))};
    else if (drag.edge) item.edit.crop=C.edgeCrop(drag.box,drag.edge,p,image.width,image.height,ratioOf(item),minimum());
    else item.edit.crop=C.dragCrop(drag.anchor,p,image.width,image.height,ratioOf(item),minimum());
    if (!sameBox(item.edit.crop, drag.box)) { drag.changed = true; item.autoCrop = false; }
    updateDimensions(); draw();
  });
  function endDrag() {
    if (state.panning) { state.panning = null; canvas.style.cursor = state.space ? 'grab' : ''; render(); return; }
    if (!state.drag) return;
    if (!state.drag.changed) current()?.undo.pop();
    state.drag = null; render(); persist();
  }
  function cancelDrag() {
    if (state.drag) { current().edit.crop = state.drag.box; current().undo.pop(); state.drag = null; render(); return; }
    for (const menu of document.querySelectorAll('#datasetWorkspace details[open]')) menu.open = false;
  }
  canvas.addEventListener('pointerup',endDrag); canvas.addEventListener('pointercancel',endDrag);
  canvas.addEventListener('wheel', event => {
    if (!state.view || state.stage !== 'prepare') return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect(), sx = event.clientX - rect.left, sy = event.clientY - rect.top, before = state.view;
    const ix = (sx - before.x) / before.scale, iy = (sy - before.y) / before.scale;
    state.zoom = C.clamp(state.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 20);
    const scale = before.fit * state.zoom;
    state.pan = state.zoom === 1 ? { x:0, y:0 } : { x:sx - ix*scale - (rect.width - state.active.width*scale)/2, y:sy - iy*scale - (rect.height - state.active.height*scale)/2 };
    draw(); $('dsZoom').textContent = `${Math.round(state.zoom * 100)}%`; $('dsFit').disabled = state.zoom === 1;
  }, { passive:false });
  function fitView() { state.zoom = 1; state.pan = { x:0, y:0 }; render(); }
  function toggleGrid() { state.config.grid = state.config.grid === false; render(); persist(); }
  $('dsFit').addEventListener('click', fitView); $('dsGrid').addEventListener('click', toggleGrid);
  canvas.addEventListener('keydown',event=>{if(!current()?.edit.crop||state.stage!=='prepare'||state.batch)return;const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;event.preventDefault();event.stopPropagation();pushUndo();const b=current().edit.crop,step=event.shiftKey?10:1;b.x=C.clamp(b.x+delta[0]*step,0,state.active.width-b.w);b.y=C.clamp(b.y+delta[1]*step,0,state.active.height-b.h);current().autoCrop=false;render();persist();});
  // Shortcuts work while the dataset tool is visible and no text field has focus.
  document.addEventListener('keydown', event => {
    if ($('datasetWorkspace').hidden || document.querySelector('dialog[open]')) return;
    const typing = event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target === $('dsCaptionText')) { event.preventDefault(); approve(true); return; }
    if (typing || event.altKey) return;
    if (event.key === ' ' && !event.repeat) { state.space = true; if (state.stage === 'prepare') canvas.style.cursor = 'grab'; if (event.target === document.body || event.target === canvas) event.preventDefault(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); $('dsUndo').click(); return; }
    if (event.ctrlKey || event.metaKey) return;
    const actions = { a:() => $('dsPrev').click(), f:() => $('dsNext').click(), l:() => $('dsRotateLeft').click(), r:() => $('dsRotateRight').click(),
      h:() => $('dsFlipH').click(), v:() => $('dsFlipV').click(), g:toggleGrid, '0':fitView, '?':() => { $('dsShortcuts').open = !$('dsShortcuts').open; }, escape:cancelDrag };
    const action = actions[event.key.toLowerCase()];
    if (action) { event.preventDefault(); action(); }
  });
  document.addEventListener('keyup', event => { if (event.key === ' ') { state.space = false; if (!state.panning) canvas.style.cursor = ''; } });

  async function prepared(item, vision = false, config = state.config) {
    const image=await imageCanvas(item),box=C.cropBox(item.edit.crop,image.width,image.height),plan=C.exportPlan(box,config),size=plan;
    const issue=C.exportProblem(box,plan,C.minimumSpec(config));if(issue)throw Object.assign(new Error(`${item.name}: ${issue}`),{sizeProblem:true});
    const sourceExt=/\.webp$/i.test(item.name)?'webp':/\.jpe?g$/i.test(item.name)?'jpg':'png';
    const ext=vision?'jpg':config.format==='original'?sourceExt:config.format;
    if(!vision&&config.format==='original'&&!item.edit.rotation&&!item.edit.flipH&&!item.edit.flipV&&plan.crop.x===0&&plan.crop.y===0&&plan.crop.w===image.width&&plan.crop.h===image.height&&size.width===item.width&&size.height===item.height)return{blob:item.file,ext};
    const output=document.createElement('canvas'),dimensions=vision?C.exportSize({w:size.width,h:size.height},1536):size;
    output.width=dimensions.width;output.height=dimensions.height;const ctx=output.getContext('2d');
    if(ext==='jpg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);}ctx.imageSmoothingQuality='high';const source=plan.crop;ctx.drawImage(image,source.x,source.y,source.w,source.h,0,0,output.width,output.height);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/'+(ext==='jpg'?'jpeg':ext),vision ? 0.9 : Number(config.quality)/100));
    if(!blob)throw new Error('Could not encode the prepared image.');return{blob,ext};
  }
  const dataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the prepared crop.'));reader.readAsDataURL(blob);});
  function renderPresets() {
    const select = $('dsPreset'); select.replaceChildren();
    const add = (parent, value, text) => { const option = document.createElement('option'); option.value = value; option.textContent = text; parent.append(option); };
    const group = label => { const element = document.createElement('optgroup'); element.label = label; select.append(element); return element; };
    const builtIn = group('Built-in'); for (const [id,[title]] of Object.entries(BUILTINS)) add(builtIn, id, title);
    if (state.scripts.length) { const saved = group('Saved'); for (const item of state.scripts) add(saved, 'saved:' + item.id, item.title); }
    if (state.shared.length) { const shared = group('Shared Vision folder'); for (const item of state.shared) add(shared, 'shared:' + item.id, item.name); }
    add(select, 'custom', 'Custom / imported script');
    select.value = [...select.options].some(o => o.value === state.config.preset) ? state.config.preset : 'custom';
    updateScriptButtons();
  }
  function scriptEntry(id) {
    if (BUILTINS[id]) return BUILTINS[id];
    const saved = id.startsWith('saved:') && state.scripts.find(item => 'saved:' + item.id === id);
    if (saved) return [saved.title, saved.prompt];
    const shared = id.startsWith('shared:') && state.shared.find(item => 'shared:' + item.id === id);
    return shared ? [shared.name, shared.prompt] : null;
  }
  function updateScriptButtons() {
    const saved = state.scripts.some(item => item.id === state.config.savedId);
    $('dsUpdateScript').hidden = !saved; $('dsDeleteScript').hidden = !saved;
  }
  async function refreshShared(){try{const library=await api('/api/presets');state.shared=library.vision.filter(i=>i.source==='shared');renderPresets();}catch{}}
  async function loadScripts(){try{state.scripts=(await api('/api/caption-scripts')).scripts;}catch{state.scripts=[];}renderPresets();}
  $('dsPreset').addEventListener('change',()=>{const selected=$('dsPreset').value;state.config.preset=selected;state.config.savedId=selected.startsWith('saved:')?selected.slice(6):'';const entry=scriptEntry(selected);if(entry){state.config.title=entry[0];state.config.system=entry[1];$('dsScriptTitle').value=entry[0];$('dsSystem').value=entry[1];}render();persist();});
  async function saveScript(update) {
    try {
      const result = await api('/api/caption-scripts', { action:'save', title:state.config.title, prompt:state.config.system, ...(update ? { id:state.config.savedId } : {}) });
      state.scripts = result.scripts; state.config.savedId = result.id; state.config.preset = 'saved:' + result.id;
      renderPresets(); render(); persist(); status(`${update ? 'Updated' : 'Saved'} the caption script “${state.config.title}”.`);
    } catch (error) { status(error.message); }
  }
  $('dsSaveScript').addEventListener('click', () => saveScript(false));
  $('dsUpdateScript').addEventListener('click', () => saveScript(true));
  $('dsDeleteScript').addEventListener('click', async () => {
    const item = state.scripts.find(entry => entry.id === state.config.savedId);
    if (!item || !confirm(`Delete the saved caption script “${item.title}”? Captions you already wrote are kept.`)) return;
    try {
      state.scripts = (await api('/api/caption-scripts', { action:'delete', id:item.id })).scripts;
      state.config.savedId = ''; if (state.config.preset === 'saved:' + item.id) state.config.preset = 'custom';
      renderPresets(); render(); persist(); status(`Deleted “${item.title}”. The text stays in the editor as a custom script.`);
    } catch (error) { status(error.message); }
  });
  $('dsImportScript').addEventListener('click',()=>$('dsScriptFile').click());
  $('dsScriptFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(state.batch||state.exporting)throw new Error('Finish the current operation before importing a script.');if(file.size>512*1024)throw new Error('Captioner script files must be at most 512 KB.');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());const doc=/\.txt$/i.test(file.name)?C.captionDocument({schema:1,product:'CyberHub',type:'system_prompt',module:'captioner',title:file.name.replace(/\.txt$/i,''),prompt:text}):C.captionDocument(JSON.parse(text));if(state.batch||state.exporting)throw new Error('Finish the current operation before importing a script.');state.config.title=doc.title;state.config.system=doc.prompt;state.config.preset='custom';$('dsScriptTitle').value=doc.title;$('dsSystem').value=doc.prompt;$('dsScriptDetails').open=true;renderPresets();render();persist();status('Captioner script imported as a local draft.');}catch(error){status(error.message||'Could not import this script.');}finally{event.target.value='';}});
  function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  $('dsExportScript').addEventListener('click',()=>{try{const doc=C.captionDocument({schema:1,product:'CyberHub',type:'system_prompt',module:'captioner',title:state.config.title,prompt:state.config.system});download(new Blob([JSON.stringify(doc,null,2)+'\n'],{type:'application/json'}),C.safeStem(doc.title+'.txt')+'.captioner.json');}catch(error){status(error.message);}});
  // A hand edit counts as review. Approve marks a model or imported caption as checked for the current crop.
  $('dsCaptionText').addEventListener('input',()=>{const item=current();if(!item)return;item.caption=$('dsCaptionText').value;item.captionRev++;item.captionKey=key(item);item.approved=!!item.caption.trim();item.imported=false;item.captionError='';render();persist();});
  function approve(next){const item=current();if(!item?.caption.trim())return;item.captionKey=key(item);item.approved=true;item.imported=false;item.captionRev++;render();persist();if(next){const index=neighbour(1);if(index>=0)select(index);}}
  $('dsReviewed').addEventListener('click',()=>approve(false));
  $('dsCopy').addEventListener('click',async()=>{const text=current()?.caption||'';try{await navigator.clipboard.writeText(text);status('Caption copied.');}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();try{status(document.execCommand('copy')?'Caption copied.':'Select the caption text and copy it.');}catch{status('Select the caption text and copy it.');}finally{area.remove();}}});

  function applyCaption(job,text){const item=state.items.find(i=>i.id===job.itemId);if(!text||!C.captionStillCurrent(item,job,state.config))return false;item.caption=text;item.captionRev++;item.captionKey=job.key;item.approved=false;item.imported=false;item.captionError='';return true;}
  // Captions run directly on the service, up to four at a time; failures are marked and the batch continues.
  async function captionItems(items) {
    if (state.batch || state.exporting || !items.length) return;
    if (!state.config.system.trim()) { status('Choose a caption script first.'); return; }
    if (/\{WD_TAGS\}/i.test(state.config.system)) { status('This script needs Auto Tagger output for {WD_TAGS}. Supply those tags in the script or use another caption script.'); return; }
    let connection;
    try { connection = (await api('/api/state')).settings; } catch (error) { status(error.message); return; }
    const pending = items.map(item => ({ item, revision:item.captionRev })), total = pending.length;
    const workers = Math.max(1, Math.min(4, Number(state.config.parallel) || 1)), counts = { completed:0, kept:0, skipped:0, failed:0, started:0 };
    state.batch = true; state.stop = false; state.tokens = new Set(); render();
    async function worker() {
      while (!state.stop && pending.length) {
        const { item, revision } = pending.shift(); counts.started++;
        if (!state.items.includes(item)) continue;
        if (item.captionRev !== revision) { counts.kept++; continue; }
        if (problem(item).level) { counts.skipped++; continue; }
        status(`Captioning ${counts.started} of ${total}${workers > 1 ? `, ${workers} at a time` : ''}: ${item.name}`);
        const token = crypto.randomUUID(); state.tokens.add(token);
        try {
          const output = await prepared(item, true);
          if (state.stop) break;
          const job = { itemId:item.id, revision, key:key(item) };
          const result = await api('/api/caption', { token, rewrite_system:state.config.system, rewrite_prompt:state.config.extra || 'Write the training caption for this prepared image.',
            caption_trigger:state.config.trigger, caption_traits:state.config.traits, reference_image:{ data_url:await dataURL(output.blob) }, api_url:connection.api_url, model:connection.model });
          if (applyCaption(job, result.text)) counts.completed++; else counts.kept++;
        } catch (error) {
          if (state.stop) break;
          if (error.sizeProblem) { counts.skipped++; continue; }
          item.captionError = error.message || 'Captioning failed.'; counts.failed++;
        } finally { state.tokens.delete(token); render(); persist(); }
      }
    }
    try { await Promise.all(Array.from({ length:Math.min(workers, total) }, worker)); }
    finally { state.batch = false; state.tokens = new Set(); render(); persist(); }
    const notes = [counts.kept && `Kept newer manual edits for ${counts.kept} image${counts.kept === 1 ? '' : 's'}.`,
      counts.skipped && `Skipped ${counts.skipped} image${counts.skipped === 1 ? ' that does' : 's that do'} not meet the size settings.`,
      counts.failed && `${counts.failed} failed; choose Show: Failed to see them and run Caption pending to retry.`].filter(Boolean).join(' ');
    const written = `${counts.completed} caption${counts.completed === 1 ? '' : 's'} written`;
    status((state.stop ? `Captioning stopped. ${written} and kept. ${notes}` : `${written}. ${notes} Review and approve captions before exporting.`).replace(/\s+/g, ' ').trim());
  }
  $('dsCaptionCurrent').addEventListener('click',()=>captionItems(current()?[current()]:[]));
  $('dsCaptionPending').addEventListener('click',()=>captionItems(state.items.filter(item=>!ready(item)||!item.caption.trim())));
  $('dsStop').addEventListener('click',async()=>{state.stop=true;$('dsStop').disabled=true;try{await api('/api/caption/stop',{tokens:[...state.tokens]});}catch(error){status(error.message);}finally{$('dsStop').disabled=false;}});

  // Auto crop: the vision model returns a box on a padded 1000 × 1000 copy, so pixel and 0-1000 answers agree.
  async function locateImage(item) {
    const image = await imageCanvas(item), side = 1000, scale = side / Math.max(image.width, image.height);
    const w = Math.round(image.width * scale), h = Math.round(image.height * scale), ox = Math.floor((side - w) / 2), oy = Math.floor((side - h) / 2);
    const board = document.createElement('canvas'); board.width = board.height = side;
    const ctx = board.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, side, side); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, ox, oy, w, h);
    const blob = await new Promise(resolve => board.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Could not prepare the image for auto crop.');
    return { url:await dataURL(blob), scale, ox, oy, width:image.width, height:image.height };
  }
  async function autoCrop(items) {
    if (state.batch || state.exporting || !items.length) return;
    if (items.length > 1 && !confirm(`Replace the crops of ${items.length} images with auto crops? Each crop can be undone per image.`)) return;
    let config, connection;
    try { config = readConfig(); connection = (await api('/api/state')).settings; } catch (error) { status(error.message); return; }
    state.batch = true; state.stop = false; state.tokens = new Set(); render();
    let done = 0, missed = 0, failed = 0, lastError = '';
    try {
      for (const [index, item] of items.entries()) {
        if (state.stop) break;
        status(`Auto crop ${index + 1} of ${items.length}: ${item.name}`);
        const token = crypto.randomUUID(); state.tokens.add(token);
        try {
          const shot = await locateImage(item);
          const result = await api('/api/locate', { image:shot.url, target:config.autoTarget, token, api_url:connection.api_url, model:connection.model });
          if (!result.box) { missed++; continue; }
          const [x1, y1, x2, y2] = result.box, toX = v => C.clamp((v - shot.ox) / shot.scale, 0, shot.width), toY = v => C.clamp((v - shot.oy) / shot.scale, 0, shot.height);
          const region = { x:toX(x1), y:toY(y1), w:Math.max(1, toX(x2) - toX(x1)), h:Math.max(1, toY(y2) - toY(y1)) };
          pushUndo(item); item.edit.crop = C.cropAround(region, shot.width, shot.height, ratioOf(item), minimum(), config.autoPadding / 100); item.autoCrop = false; done++;
        } catch (error) { if (state.stop) break; failed++; lastError = error.message; }
        finally { state.tokens.delete(token); render(); persist(); }
      }
    } finally { state.batch = false; render(); persist(); }
    status([`Auto crop: ${done} crop${done === 1 ? '' : 's'} set.`, missed && `${missed} without a match.`, failed && `${failed} failed: ${lastError}`, state.stop && 'Stopped.'].filter(Boolean).join(' '));
  }
  $('dsAutoOne').addEventListener('click', () => autoCrop(current() ? [current()] : []));
  $('dsAutoAll').addEventListener('click', () => autoCrop(state.items.filter(item => problem(item).level !== 'error')));

  // Custom ratios are remembered in this browser and in the session.
  function renderAspectOptions() {
    const select = $('dsAspect');
    for (const option of [...select.options]) if (option.dataset.custom) option.remove();
    for (const value of state.config.customRatios || []) {
      const [w, h] = value.split(':').map(Number), ratio = String(Math.round(w / h * 1e10) / 1e10);
      if ([...select.options].some(option => Math.abs(Number(option.value) - Number(ratio)) < 1e-6)) continue;
      const option = document.createElement('option'); option.value = ratio; option.textContent = value; option.dataset.custom = '1'; select.append(option);
    }
  }
  $('dsAddRatio').addEventListener('click', () => {
    const value = $('dsCustomRatio').value.replace(/\s/g, ''), match = /^(\d{1,4}(?:\.\d{1,3})?):(\d{1,4}(?:\.\d{1,3})?)$/.exec(value);
    if (!match || !(Number(match[1]) > 0 && Number(match[2]) > 0)) { status('Enter a ratio as W:H, for example 7:9.'); return; }
    if (!state.config.customRatios.includes(value)) state.config.customRatios = [...state.config.customRatios, value].slice(-12);
    try { localStorage.setItem('scene-director-custom-ratios', JSON.stringify(state.config.customRatios)); } catch {}
    renderAspectOptions(); $('dsCustomRatio').value = '';
    const ratio = Number(match[1]) / Number(match[2]), option = [...$('dsAspect').options].find(item => Math.abs(Number(item.value) - ratio) < 1e-6);
    if (option) { $('dsAspect').value = option.value; $('dsAspect').dispatchEvent(new Event('change')); }
  });
  $('dsCustomRatio').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('dsAddRatio').click(); } });

  // Existing captions: .txt files with the same name as an image.
  $('dsImportCaptions').addEventListener('click', () => $('dsCaptionFiles').click());
  $('dsCaptionFiles').addEventListener('change', async event => {
    const files = Array.from(event.target.files).filter(file => /\.txt$/i.test(file.name) && file.size <= 1024 * 1024); event.target.value = '';
    if (!files.length || state.batch || state.exporting) return;
    const byStem = new Map(files.map(file => [file.name.replace(/\.txt$/i, '').normalize('NFC').toLowerCase(), file]));
    const matches = state.items.map(item => [item, byStem.get(item.name.replace(/\.[^.]*$/, '').normalize('NFC').toLowerCase())]).filter(([, file]) => file);
    if (!matches.length) { status('No caption file matches an image name in this dataset.'); return; }
    const replacing = matches.filter(([item]) => item.caption.trim()).length;
    if (replacing && !confirm(`Replace ${replacing} existing caption${replacing === 1 ? '' : 's'} with the imported text?`)) return;
    let imported = 0;
    for (const [item, file] of matches) {
      const text = (await file.text()).replace(/^﻿/, '').trim(); if (!text) continue;
      Object.assign(item, { caption:text, imported:true, approved:false, captionError:'' }); item.captionRev++;
      if (item.edit.crop) item.captionKey = key(item); else item.pendingImport = true;
      imported++;
    }
    render(); persist(); status(`${imported} caption${imported === 1 ? '' : 's'} imported. Review and approve them.`);
  });

  // Bulk edits apply to the captions shown by the current filter and can be undone once.
  function bulk(transform, label) {
    if (state.batch || state.exporting) return;
    const targets = state.items.filter(item => item.caption.trim() && visible(item)), before = new Map(targets.map(item => [item.id, item.caption]));
    let changed = 0;
    for (const item of targets) { const next = transform(item.caption).replace(/[ \t]+/g, ' ').trim(); if (next && next !== item.caption) { item.caption = next; item.captionRev++; changed++; } }
    if (!changed) { status('No captions changed.'); return; }
    state.bulkUndo = { label, before }; render(); persist(); status(`${label}: ${changed} caption${changed === 1 ? '' : 's'} changed. Undo is available until the next bulk edit.`);
  }
  $('dsBulkReplace').addEventListener('click', () => { const find = $('dsFind').value; if (!find) { status('Enter the text to find.'); return; } bulk(text => C.replaceText(text, find, $('dsReplace').value, $('dsMatchCase').checked), 'Replace'); });
  $('dsBulkTrigger').addEventListener('click', () => {
    const from = $('dsTriggerFrom').value.trim(), to = $('dsTriggerTo').value.trim();
    if (!from) { status('Enter the current trigger token.'); return; }
    bulk(text => C.renameTrigger(text, from, to), 'Rename trigger');
    if (to && state.config.trigger === from) { state.config.trigger = to; $('dsTrigger').value = to; render(); persist(); }
  });
  $('dsBulkAffix').addEventListener('click', () => { const start = $('dsAddStart').value, end = $('dsAddEnd').value; if (!start.trim() && !end.trim()) { status('Enter text to add.'); return; } bulk(text => C.addAffixes(text, start, end), 'Add text'); });
  $('dsBulkUndo').addEventListener('click', () => {
    const undo = state.bulkUndo; if (!undo) return;
    for (const item of state.items) if (undo.before.has(item.id)) { item.caption = undo.before.get(item.id); item.captionRev++; }
    state.bulkUndo = null; render(); persist(); status(`Undid “${undo.label}”.`);
  });

  // Export as ZIP or straight into a folder, with optional numbered names, Kohya folder and metadata files.
  const blobBase64 = async blob => { const url = await dataURL(blob); return url.slice(url.indexOf(',') + 1); };
  const exportExt = (item, config) => config.format === 'original' ? (/\.webp$/i.test(item.name) ? 'webp' : /\.jpe?g$/i.test(item.name) ? 'jpg' : 'png') : config.format;
  $('dsExport').addEventListener('click',async()=>{
    if(state.batch||state.exporting||!state.items.length)return;
    let config; try { config = readConfig(); } catch (error) { status(error.message); return; }
    const blocked=state.items.filter(item=>problem(item).level),usable=state.items.filter(item=>!blocked.includes(item));
    if(!usable.length){status('No image meets the current size settings. Change the minimum or export size, or add larger images.');return;}
    if(usable.some(item=>!ready(item))){status('Every exported image needs a caption for its current crop. Run Caption pending, approve existing captions or remove unwanted images.');stage('caption');return;}
    const unapproved = usable.filter(item => !item.approved).length;
    if (config.approvedOnly && unapproved) { status(`${unapproved} caption${unapproved === 1 ? ' is' : 's are'} not approved yet. Approve them or turn off Only approved captions.`); state.config.filter = 'review'; stage('caption'); return; }
    const folder = config.exportMode === 'folder';
    if (folder && !config.exportFolder.trim()) { status('Enter or choose the export folder first.'); $('dsExportFolder').focus(); return; }
    if(blocked.length&&!confirm(`${blocked.length} image${blocked.length===1?' does':'s do'} not meet the size settings and will be left out. Continue?`))return;
    state.exporting=true;render();
    const items=usable.map(item=>({...item,edit:clone(item.edit)})), subfolder = config.kohya ? C.kohyaFolder(config.repeats, config.trigger, config.classWord) : '';
    const names = C.datasetNames(items.map(item => ({ name:item.name, ext:exportExt(item, config) })), { naming:config.naming, prefix:config.namePrefix || config.trigger || 'image' });
    const rows = items.map((item, index) => ({ image:names[index].image, caption:item.caption.trim() })), extras = [];
    if (config.jsonl) extras.push({ name:'metadata.jsonl', text:C.metadataJsonl(rows) });
    if (config.csv) extras.push({ name:'captions.csv', text:C.captionsCsv(rows) });
    const leftOut = blocked.length ? ` ${blocked.length} left out for size.` : '';
    try {
      if (folder) {
        const check = await api('/api/dataset/check', { folder:config.exportFolder, subfolder });
        const planned = new Set([...names.flatMap(name => [name.image, name.caption]), ...extras.map(extra => extra.name)]), conflicts = check.files.filter(name => planned.has(name));
        if (conflicts.length && !config.overwrite) throw new Error(`${conflicts.length} file${conflicts.length === 1 ? '' : 's'} already exist in ${check.path}, such as ${conflicts[0]}. Turn on Replace existing files or choose another folder.`);
        for (const [index, item] of items.entries()) {
          status(`Writing ${index + 1} of ${items.length} to ${check.path}…`);
          const image = await prepared(item, false, config);
          await api('/api/dataset/write', { folder:config.exportFolder, subfolder, overwrite:config.overwrite,
            files:[{ name:names[index].image, data:await blobBase64(image.blob) }, { name:names[index].caption, text:rows[index].caption + '\n' }] });
        }
        if (extras.length) await api('/api/dataset/write', { folder:config.exportFolder, subfolder, overwrite:config.overwrite, files:extras });
        status(`${items.length} image/caption pairs written to ${check.path}.${leftOut} Originals are unchanged.`);
      } else {
        const images=[];let bytes=0;
        for(const [index,item]of items.entries()){status(`Preparing image ${index+1} of ${items.length} for export…`);const image=await prepared(item,false,config);bytes+=image.blob.size+new TextEncoder().encode(item.caption).length;if(bytes>512*1024*1024)throw new Error('Export is larger than 512 MB. Export a smaller batch or export to a folder.');images.push(image);}
        const prefix = subfolder ? subfolder + '/' : '', entries = [];
        for (let i = 0; i < items.length; i++) entries.push({ name:prefix + names[i].image, data:images[i].blob }, { name:prefix + names[i].caption, data:rows[i].caption + '\n' });
        for (const extra of extras) entries.push({ name:prefix + extra.name, data:extra.text });
        const zip=await C.zipStore(entries,(done,total)=>status(`Building dataset ZIP: ${done} of ${total} files…`));download(zip,'Scene-Director-LoRA-dataset.zip');
        status(`${items.length} image/caption pairs prepared for download.${leftOut} Originals are unchanged.`);
      }
    }catch(error){status(error.message||'Dataset export failed.');}finally{state.exporting=false;render();}
  });
  render(); restore();
})();
