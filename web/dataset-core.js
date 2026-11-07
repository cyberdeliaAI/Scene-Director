(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SceneDatasetCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  function dimensions(width, height, rotation = 0) {
    return Math.abs(rotation % 180) === 90 ? { width: height, height: width } : { width, height };
  }
  function cropBox(box, width, height) {
    if (![width, height, box.x, box.y, box.w, box.h].every(Number.isFinite) || width < 1 || height < 1) throw new Error('Invalid crop dimensions.');
    const x = clamp(Math.round(box.x), 0, width - 1), y = clamp(Math.round(box.y), 0, height - 1);
    return { x, y, w: clamp(Math.round(box.w), 1, width - x), h: clamp(Math.round(box.h), 1, height - y) };
  }
  function centerCrop(width, height, ratio = 0) {
    let w = width, h = height;
    if (ratio > 0) { if (w / h > ratio) w = h * ratio; else h = w / ratio; }
    return cropBox({ x: (width - w) / 2, y: (height - h) / 2, w, h }, width, height);
  }
  function exportSize(box, maximum = 0) {
    const scale = maximum > 0 ? Math.min(1, maximum / Math.max(box.w, box.h)) : 1;
    return { width: Math.max(1, Math.round(box.w * scale)), height: Math.max(1, Math.round(box.h * scale)) };
  }
  // Minimum sizes. "longest", "shortest" and "area" use the first value; area 1024 means 1024 × 1024 pixels in total.
  const MINIMUM_MODES = ['off', 'dimensions', 'longest', 'shortest', 'area'];
  function minimumSpec(config = {}) {
    const mode = MINIMUM_MODES.includes(config.minimum) ? config.minimum : 'off';
    return { mode, width: Number(config.minWidth) || 0, height: Number(config.minHeight) || 0 };
  }
  function meetsMinimum(w, h, spec) {
    if (spec.mode === 'dimensions') return w >= spec.width && h >= spec.height;
    if (spec.mode === 'longest') return Math.max(w, h) >= spec.width;
    if (spec.mode === 'shortest') return Math.min(w, h) >= spec.width;
    if (spec.mode === 'area') return w * h >= spec.width * spec.width * (1 - 1e-9);
    return true;
  }
  function describeMinimum(spec) {
    if (spec.mode === 'dimensions') return `${spec.width} × ${spec.height} px`;
    if (spec.mode === 'longest') return `a longest side of ${spec.width} px`;
    if (spec.mode === 'shortest') return `a shortest side of ${spec.width} px`;
    if (spec.mode === 'area') return `${spec.width} × ${spec.width} px of area`;
    return 'none';
  }
  const keepsShape = (ratio, spec) => ratio > 0 || spec.mode === 'longest' || spec.mode === 'area';
  const roundUp = value => Math.ceil(value - 1e-6);
  const matchesRatio = (box, ratio) => !(ratio > 0) || Math.abs(box.w - box.h * ratio) <= Math.max(1, ratio);
  // The smallest size of at least w × h that meets the minimum. A fixed ratio, longest side and area grow proportionally.
  function growToMinimum(w, h, ratio, spec) {
    if (meetsMinimum(w, h, spec)) return { w, h };
    if (!keepsShape(ratio, spec)) return { w: Math.max(w, spec.width), h: Math.max(h, spec.mode === 'dimensions' ? spec.height : spec.width) };
    const factor = spec.mode === 'dimensions' ? Math.max(spec.width / w, spec.height / h)
      : spec.mode === 'longest' ? spec.width / Math.max(w, h)
      : spec.mode === 'shortest' ? spec.width / Math.min(w, h)
      : spec.width / Math.sqrt(w * h);
    return { w: roundUp(w * Math.max(1, factor)), h: roundUp(h * Math.max(1, factor)) };
  }
  // Fit a size inside width × height. Shapes scale down together; a fixed ratio is rounded from its shorter side.
  function fitSize(size, width, height, keepShape, ratio = 0) {
    let { w, h } = size;
    if (keepShape) { const factor = Math.min(1, width / w, height / h); w *= factor; h *= factor; }
    if (ratio >= 1) { w = Math.round(w); h = Math.round(w / ratio); }
    else if (ratio > 0) { h = Math.round(h); w = Math.round(h * ratio); }
    return { w: clamp(Math.round(w), 1, Math.max(1, width)), h: clamp(Math.round(h), 1, Math.max(1, height)) };
  }
  function placeAround(cx, cy, size, width, height) {
    const w = clamp(size.w, 1, width), h = clamp(size.h, 1, height);
    return { x: clamp(Math.round(cx - w / 2), 0, width - w), y: clamp(Math.round(cy - h / 2), 0, height - h), w, h };
  }
  // Keep a crop that already fits. Otherwise change its ratio (same area) and grow it to the minimum around its own center.
  function constrainCrop(box, width, height, ratio = 0, spec = { mode: 'off' }) {
    if (!box) return centerCrop(width, height, ratio);
    let result = cropBox(box, width, height);
    const cx = result.x + result.w / 2, cy = result.y + result.h / 2;
    if (!matchesRatio(result, ratio)) {
      const w = Math.sqrt(result.w * result.h * ratio);
      result = placeAround(cx, cy, fitSize({ w, h: w / ratio }, width, height, true, ratio), width, height);
    }
    if (!meetsMinimum(result.w, result.h, spec)) {
      result = placeAround(cx, cy, fitSize(growToMinimum(result.w, result.h, ratio, spec), width, height, keepsShape(ratio, spec), ratio), width, height);
    }
    return result;
  }
  // Draw or resize a crop from a fixed anchor corner. The minimum is enforced while dragging; when the
  // anchor is too close to an edge for the minimum, the crop moves inward instead of shrinking.
  function dragCrop(anchor, point, width, height, ratio = 0, spec = { mode: 'off' }) {
    const sx = point.x >= anchor.x ? 1 : -1, sy = point.y >= anchor.y ? 1 : -1, keep = keepsShape(ratio, spec);
    let w = Math.max(1, Math.abs(point.x - anchor.x)), h = Math.max(1, Math.abs(point.y - anchor.y));
    if (ratio > 0) { if (w / h > ratio) h = w / ratio; else w = h * ratio; }
    const wanted = growToMinimum(w, h, ratio, spec);
    let size = fitSize(wanted, sx > 0 ? width - anchor.x : anchor.x, sy > 0 ? height - anchor.y : anchor.y, keep, ratio);
    if (!meetsMinimum(size.w, size.h, spec)) size = fitSize(wanted, width, height, keep, ratio);
    const x = sx > 0 ? anchor.x : anchor.x - size.w, y = sy > 0 ? anchor.y : anchor.y - size.h;
    return { x: clamp(Math.round(x), 0, width - size.w), y: clamp(Math.round(y), 0, height - size.h), w: size.w, h: size.h };
  }
  // Pixel-area rounding works like training buckets: multiples of step, at most the target area, closest to the crop's shape.
  function bucketSize(box, area, step) {
    const maxW = Math.floor(box.w / step) * step, maxH = Math.floor(box.h / step) * step, aspect = box.w / box.h;
    let best = null;
    for (let w = step; w <= maxW; w += step) {
      const h = Math.min(maxH, Math.floor(area / w / step) * step);
      if (h < step) continue;
      const score = Math.abs(Math.log(w / h / aspect));
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && w * h > best.width * best.height)) best = { width: w, height: h, score };
    }
    return best && { width: best.width, height: best.height };
  }
  // Longest-side rounding rounds each side to the nearest multiple, never above the crop or the maximum side.
  function snapSides(box, scaled, step, maximum) {
    const side = (value, limit) => {
      let top = Math.floor(limit / step) * step;
      if (maximum > 0) top = Math.min(top, Math.floor(maximum / step) * step);
      return top >= step ? clamp(Math.round(value / step) * step, step, top) : Math.max(1, Math.round(value));
    };
    return { width: side(scaled.width, box.w), height: side(scaled.height, box.h) };
  }
  // The pixels that are actually exported. Never enlarges. Rounding trims a few edge pixels instead of distorting.
  function exportPlan(box, config = {}) {
    const area = config.resize === 'area', side = Number(area ? config.targetArea : config.maxSide) || 0;
    const scale = side > 0 ? Math.min(1, area ? side / Math.sqrt(box.w * box.h) : side / Math.max(box.w, box.h)) : 1;
    const scaled = { width: box.w * scale, height: box.h * scale }, step = Number(config.snap) || 0;
    const snapped = step > 1 ? (area ? bucketSize(box, scaled.width * scaled.height, step) : snapSides(box, scaled, step, side)) : null;
    const size = snapped || { width: Math.max(1, Math.round(scaled.width)), height: Math.max(1, Math.round(scaled.height)) };
    let w = box.w, h = box.h;
    if (snapped && w * size.height > h * size.width) w = Math.round(h * size.width / size.height);
    else if (snapped && w * size.height < h * size.width) h = Math.round(w * size.height / size.width);
    const crop = { x: box.x + Math.floor((box.w - w) / 2), y: box.y + Math.floor((box.h - h) / 2), w, h };
    return { crop, width: size.width, height: size.height, scaled };
  }
  // Pixel-area minimums compare the size before rounding, so 832 × 1216 still counts as a 1024 bucket.
  function exportProblem(box, plan, spec) {
    if (!MINIMUM_MODES.includes(spec.mode) || spec.mode === 'off') return '';
    if (!meetsMinimum(box.w, box.h, spec)) return `The crop is ${box.w} × ${box.h} px, below the minimum of ${describeMinimum(spec)}. Enlarge the crop.`;
    const size = spec.mode === 'area' ? plan.scaled : plan;
    if (!meetsMinimum(size.width, size.height, spec)) return `The export would be ${plan.width} × ${plan.height} px, below the minimum of ${describeMinimum(spec)}. Raise the export size or lower the minimum.`;
    return '';
  }
  function sourceProblem(width, height, ratio, spec) {
    const largest = centerCrop(width, height, ratio);
    return meetsMinimum(largest.w, largest.h, spec) ? '' : `This image is ${width} × ${height} px, too small for the minimum of ${describeMinimum(spec)}${ratio > 0 ? ' at this aspect ratio' : ''}.`;
  }
  function minimumError(box, size, mode, minWidth, minHeight) {
    return exportProblem(box, { ...size, scaled: size }, { mode, width: Number(minWidth), height: Number(minHeight) });
  }
  // Default settings keep the 3.7 key, so existing reviewed captions stay valid after updating.
  function editKey(item, config) {
    const area = config.resize === 'area', step = Number(config.snap) || 0;
    const key = [item.edit, area ? 0 : Number(config.maxSide), config.format, Number(config.quality)];
    if (area || step > 1) key.push(area ? 'area' : 'longest', area ? Number(config.targetArea) : 0, step > 1 ? step : 0);
    return JSON.stringify(key);
  }
  const utf8 = value => new TextEncoder().encode(value);
  function safeStem(value) {
    let name = String(value).split(/[\\/]/).pop().replace(/\.[^.]*$/, '').normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').trim() || 'image';
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) name = '_' + name;
    let result = '';
    for (const character of name) { if (utf8(result + character).length > 180) break; result += character; }
    return result || 'image';
  }
  function pairNames(items) {
    const used = new Set();
    return items.map(item => {
      const base = safeStem(item.name); let stem = base, index = 2;
      while (used.has(stem.normalize('NFKC').toLowerCase())) stem = `${base}_${index++}`;
      used.add(stem.normalize('NFKC').toLowerCase());
      const ext = ['png', 'jpg', 'jpeg', 'webp'].includes(item.ext) ? item.ext : 'png';
      return { image: stem + '.' + ext, caption: stem + '.txt' };
    });
  }
  function captionDocument(value) {
    if (!value || Array.isArray(value) || value.schema !== 1 || value.product !== 'CyberHub' || value.type !== 'system_prompt' || value.module !== 'captioner') throw new Error('Choose a CyberHub Captioner system-prompt JSON file (schema 1).');
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200 || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 100000) throw new Error('The Captioner title or system prompt is missing or too long.');
    return { schema: 1, product: 'CyberHub', type: 'system_prompt', module: 'captioner', title: value.title.trim(), prompt: value.prompt };
  }
  // Free-ratio edge drags: the minimum along one axis while the other side stays as it is.
  function minAlong(other, spec, horizontal) {
    if (spec.mode === 'dimensions') return horizontal ? spec.width : spec.height;
    if (spec.mode === 'shortest') return spec.width;
    if (spec.mode === 'longest') return other >= spec.width ? 1 : spec.width;
    if (spec.mode === 'area') return roundUp(spec.width * spec.width / Math.max(1, other));
    return 1;
  }
  // Resize from an edge handle. A fixed ratio keeps the opposite edge and the perpendicular center.
  function edgeCrop(box, handle, point, width, height, ratio = 0, spec = { mode: 'off' }) {
    const horizontal = handle === 'e' || handle === 'w', start = handle === 'e' || handle === 's';
    const anchor = horizontal ? (start ? box.x : box.x + box.w) : (start ? box.y : box.y + box.h);
    const room = horizontal ? (start ? width - box.x : box.x + box.w) : (start ? height - box.y : box.y + box.h);
    let along = Math.max(1, Math.abs((horizontal ? point.x : point.y) - anchor)), w, h;
    if (ratio > 0) {
      const grown = growToMinimum(horizontal ? along : along * ratio, horizontal ? along / ratio : along, ratio, spec);
      let size = fitSize(grown, horizontal ? room : width, horizontal ? height : room, true, ratio);
      if (!meetsMinimum(size.w, size.h, spec)) size = fitSize(grown, width, height, true, ratio);
      ({ w, h } = size);
    } else {
      along = Math.max(along, minAlong(horizontal ? box.h : box.w, spec, horizontal));
      if (horizontal) { w = clamp(Math.round(along), 1, width); h = box.h; } else { h = clamp(Math.round(along), 1, height); w = box.w; }
    }
    const x = horizontal ? (start ? anchor : anchor - w) : (ratio > 0 ? box.x + box.w / 2 - w / 2 : box.x);
    const y = horizontal ? (ratio > 0 ? box.y + box.h / 2 - h / 2 : box.y) : (start ? anchor : anchor - h);
    return { x: clamp(Math.round(x), 0, width - w), y: clamp(Math.round(y), 0, height - h), w, h };
  }
  // A crop around a located region: padding, then the ratio, then the minimum, kept inside the image.
  function cropAround(region, width, height, ratio = 0, spec = { mode: 'off' }, padding = 0) {
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
    let w = Math.max(1, region.w * (1 + 2 * padding)), h = Math.max(1, region.h * (1 + 2 * padding));
    if (ratio > 0) { if (w / h > ratio) h = w / ratio; else w = h * ratio; }
    return placeAround(cx, cy, fitSize(growToMinimum(w, h, ratio, spec), width, height, keepsShape(ratio, spec), ratio), width, height);
  }
  function safeSegment(value, fallback) {
    let name = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').replace(/^[. ]+/g, '').trim();
    if (!name) name = fallback;
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) name = '_' + name;
    let result = '';
    for (const character of name) { if (utf8(result + character).length > 120) break; result += character; }
    return result || fallback;
  }
  // Kohya-style folder name: repeats_trigger class, for example 10_my_token woman.
  function kohyaFolder(repeats, trigger, classWord) {
    const words = [trigger, classWord].map(value => String(value || '').trim()).filter(Boolean).join(' ') || 'dataset';
    return safeSegment(`${Math.max(1, Math.round(Number(repeats) || 1))}_${words}`, '1_dataset');
  }
  function datasetNames(items, options = {}) {
    if (options.naming !== 'numbered') return pairNames(items);
    const prefix = safeSegment(options.prefix, 'image').replace(/\s+/g, '_'), digits = Math.max(4, String(items.length).length);
    return items.map((item, index) => {
      const stem = `${prefix}_${String(index + 1).padStart(digits, '0')}`, ext = ['png', 'jpg', 'jpeg', 'webp'].includes(item.ext) ? item.ext : 'png';
      return { image: `${stem}.${ext}`, caption: `${stem}.txt` };
    });
  }
  // metadata.jsonl in the Hugging Face imagefolder format, and a plain CSV.
  function metadataJsonl(rows) { return rows.map(row => JSON.stringify({ file_name: row.image, text: row.caption })).join('\n') + '\n'; }
  function captionsCsv(rows) {
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    return 'file_name,caption\n' + rows.map(row => `${quote(row.image)},${quote(row.caption)}`).join('\n') + '\n';
  }
  const IDENTITY_RE = /\b(?:blonde|brunette|red-haired|redheaded|grey-haired|gray-haired|silver-haired)\b|\b(?:blue|green|brown|hazel|grey|gray|amber)(?:-eyed|\s+eyes)\b|\b(?:pale|fair|olive|tanned|freckled|porcelain)\s+skin\b|\b(?:red|blonde|black|brown|auburn|ginger|grey|gray|silver|white|pink|purple|blue|green)\s+hair\b/i;
  // Flags captions that mention a constant trait, or (for character scripts) describe stable identity.
  function captionWarnings(caption, traits, identityCheck) {
    const text = String(caption || ''), lower = text.toLowerCase(), found = [];
    for (const trait of String(traits || '').split(/[,;\n]/).map(value => value.trim()).filter(value => value.length >= 3)) {
      if (lower.includes(trait.toLowerCase())) found.push(`mentions “${trait}”`);
    }
    const match = identityCheck ? IDENTITY_RE.exec(text) : null;
    if (match && !found.some(item => item.toLowerCase().includes(match[0].toLowerCase()))) found.push(`describes identity: “${match[0]}”`);
    return found;
  }
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function replaceText(text, find, replacement, matchCase) {
    return find ? String(text).replace(new RegExp(escapeRegExp(find), matchCase ? 'g' : 'gi'), () => replacement) : String(text);
  }
  function renameTrigger(text, from, to) {
    if (!from) return String(text);
    const pattern = new RegExp('^' + escapeRegExp(from) + '(?=$|[\\s,.:;!?])', 'i');
    if (!pattern.test(text)) return String(text);
    return to ? String(text).replace(pattern, () => to) : String(text).replace(pattern, '').replace(/^[\s,.:;!?]+/, '');
  }
  function addAffixes(text, start, end) {
    let result = String(text).trim();
    start = String(start || '').trim(); end = String(end || '').trim();
    if (start && !result.toLowerCase().startsWith(start.toLowerCase())) result = start + (/[,;:.]$/.test(start) ? ' ' : ', ') + result;
    if (end && !result.toLowerCase().endsWith(end.toLowerCase())) result = result.replace(/[\s,;]+$/, '') + (/^[,;:.]/.test(end) ? '' : ', ') + end;
    return result;
  }
  // ZIP entry names: a file, or one safe folder level such as 10_token woman/image.png.
  function validZipName(name) {
    const parts = String(name).split('/');
    return parts.length <= 2 && parts.every(part => part && part !== '.' && part !== '..' && !/[\\\u0000]/.test(part));
  }
  const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  function crc32(data) { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function zipStore(entries, progress = () => {}) {
    if (entries.length > 2010) throw new Error('Export up to 1,000 image/caption pairs at a time.');
    const parts = [], central = [], names = new Set(); let offset = 0, centralSize = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], name = utf8(entry.name);
      if (!entry.name || !validZipName(entry.name) || names.has(entry.name) || name.length > 65535) throw new Error('Invalid or duplicate export filename.');
      names.add(entry.name);
      const raw = typeof entry.data === 'string' ? utf8(entry.data) : entry.data instanceof Uint8Array ? entry.data : new Uint8Array(await entry.data.arrayBuffer());
      if (offset + raw.length + centralSize + 512 > 512 * 1024 * 1024) throw new Error('Export is larger than 512 MB. Export a smaller batch.');
      const crc = crc32(raw), header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
      view.setUint16(12, 33, true);
      view.setUint32(14, crc, true); view.setUint32(18, raw.length, true); view.setUint32(22, raw.length, true); view.setUint16(26, name.length, true); header.set(name, 30);
      const record = new Uint8Array(46 + name.length), cv = new DataView(record.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, raw.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); record.set(name, 46);
      parts.push(header, raw); central.push(record); offset += header.length + raw.length; centralSize += record.length;
      progress(i + 1, entries.length);
    }
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
    view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  function captionStillCurrent(item, job, config) { return !!item && item.id === job.itemId && item.captionRev === job.revision && editKey(item, config) === job.key; }
  return { clamp, dimensions, cropBox, centerCrop, exportSize, minimumSpec, meetsMinimum, describeMinimum, matchesRatio, growToMinimum,
    constrainCrop, dragCrop, edgeCrop, cropAround, minAlong, exportPlan, exportProblem, sourceProblem, minimumError, editKey, captionStillCurrent,
    safeStem, safeSegment, pairNames, datasetNames, kohyaFolder, metadataJsonl, captionsCsv, captionWarnings, replaceText, renameTrigger, addAffixes,
    validZipName, captionDocument, crc32, zipStore };
});
