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
  function minimumError(box, size, mode, minWidth, minHeight) {
    if (mode === 'dimensions' && (box.w < minWidth || box.h < minHeight || size.width < minWidth || size.height < minHeight)) return `Crop and export must be at least ${minWidth} × ${minHeight} px.`;
    if (mode === 'longest' && (Math.max(box.w, box.h) < minWidth || Math.max(size.width, size.height) < minWidth)) return `Crop and export need a longest side of at least ${minWidth} px.`;
    return '';
  }
  function editKey(item, config) {
    return JSON.stringify([item.edit, Number(config.maxSide), config.format, Number(config.quality)]);
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
  const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  function crc32(data) { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function zipStore(entries, progress = () => {}) {
    if (entries.length > 2000) throw new Error('Export up to 1,000 image/caption pairs at a time.');
    const parts = [], central = [], names = new Set(); let offset = 0, centralSize = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], name = utf8(entry.name);
      if (!entry.name || /[\\/\u0000]/.test(entry.name) || names.has(entry.name) || name.length > 65535) throw new Error('Invalid or duplicate export filename.');
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
  return { clamp, dimensions, cropBox, centerCrop, exportSize, minimumError, editKey, captionStillCurrent, safeStem, pairNames, captionDocument, crc32, zipStore };
});
