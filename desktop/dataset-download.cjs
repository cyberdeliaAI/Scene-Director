'use strict';

function allowDatasetDownload(item, contents, window, isAppPage) {
  if (!window || window.isDestroyed() || contents !== window.webContents || !isAppPage(contents.getURL())) return false;
  if (item.getInitiatorOrigin() !== 'scene-director://app' || !item.getURL().startsWith('blob:scene-director://app/')) return false;
  const filename = item.getFilename();
  return filename === 'Scene-Director-LoRA-dataset.zip' || /^[^/\\\u0000-\u001f]+\.captioner\.json$/u.test(filename);
}

module.exports = { allowDatasetDownload };
