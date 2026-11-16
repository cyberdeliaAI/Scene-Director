'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/dataset-core.js');

// A minimal TIFF block with one IFD0 entry: Orientation (0x0112), SHORT, count 1.
function tiff(orientation, littleEndian = true) {
  const b = Buffer.alloc(26), u16 = (v, o) => littleEndian ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o);
  const u32 = (v, o) => littleEndian ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o);
  b.write(littleEndian ? 'II' : 'MM', 0, 'ascii'); u16(42, 2); u32(8, 4); u16(1, 8);
  u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(orientation, 18); u32(0, 22);
  return b;
}
const exif = block => Buffer.concat([Buffer.from('Exif\0\0', 'binary'), block]);
function segment(marker, body) { const head = Buffer.from([0xff, marker, 0, 0]); head.writeUInt16BE(body.length + 2, 2); return Buffer.concat([head, body]); }
function jpeg(...segments) {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, segment(0xda, Buffer.alloc(10)), Buffer.alloc(32, 0x11), Buffer.from([0xff, 0xd9])]);
}
function pngChunk(type, body) { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'ascii'); return Buffer.concat([head, body, Buffer.alloc(4)]); }
function png(...chunks) {
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), pngChunk('IHDR', Buffer.alloc(13)), ...chunks, pngChunk('IEND', Buffer.alloc(0))]);
}
function riffChunk(type, body) { const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32LE(body.length, 4); return Buffer.concat([head, body, Buffer.alloc(body.length & 1)]); }
function webp(...chunks) {
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks]), head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
const vp8x = flags => riffChunk('VP8X', Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
const orientation = bytes => C.exifOrientation(C.blobReader(new Blob([bytes])));

test('JPEG orientation is read from the Exif segment in either byte order', async () => {
  assert.equal(await orientation(jpeg(segment(0xe0, Buffer.from('JFIF\0')), segment(0xe1, exif(tiff(6))))), 6);
  assert.equal(await orientation(jpeg(segment(0xe1, exif(tiff(3, false))))), 3);
  assert.equal(await orientation(jpeg(segment(0xe1, exif(tiff(1))))), 1);
  // Other APP1 data (XMP), large ICC segments before Exif and files without Exif.
  assert.equal(await orientation(jpeg(segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x/>')), segment(0xe2, Buffer.alloc(60000)), segment(0xe1, exif(tiff(8))))), 8);
  assert.equal(await orientation(jpeg(segment(0xe0, Buffer.from('JFIF\0')))), 1);
});
test('PNG eXIf before the image data and WebP EXIF chunks are read', async () => {
  assert.equal(await orientation(png(pngChunk('eXIf', tiff(6)))), 6);
  assert.equal(await orientation(png(pngChunk('eXIf', exif(tiff(5, false))))), 5);
  assert.equal(await orientation(png(pngChunk('IDAT', Buffer.alloc(20)), pngChunk('eXIf', tiff(6)))), 1);
  assert.equal(await orientation(webp(vp8x(0x08), riffChunk('VP8L', Buffer.alloc(21)), riffChunk('EXIF', tiff(6)))), 6);
  assert.equal(await orientation(webp(vp8x(0x08), riffChunk('VP8 ', Buffer.alloc(30)), riffChunk('EXIF', exif(tiff(7))))), 7);
  assert.equal(await orientation(webp(vp8x(0x00), riffChunk('VP8L', Buffer.alloc(21)), riffChunk('EXIF', tiff(6)))), 1);
  assert.equal(await orientation(webp(riffChunk('VP8L', Buffer.alloc(21)))), 1);
});
test('damaged or unknown data never throws and counts as normal', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('GIF89a'), jpeg(segment(0xe1, exif(Buffer.from('II*\0\xff\xff\xff\x7f', 'binary')))),
    jpeg(segment(0xe1, exif(tiff(9)))), png(pngChunk('eXIf', Buffer.from('nonsense')))]) {
    assert.equal(await orientation(bytes), 1);
  }
});
