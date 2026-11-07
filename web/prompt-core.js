(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScenePromptCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function entries(parameters) {
    return Array.isArray(parameters)
      ? parameters.filter(p => p && typeof p.name === 'string').map(p => [p.name.trim(), String(p.value).trim()])
      : Object.entries(parameters || {});
  }
  function rotatingChoices(parameters, index) {
    const choices = {};
    for (const [name, value] of entries(parameters)) {
      const options = String(value).split('|').map(v => v.trim()).filter(Boolean);
      if (options.length >= 2) choices[name] = options[index % options.length];
    }
    return choices;
  }
  function regenerationRequest(request, index, choices, previousScenes) {
    const selected = choices || rotatingChoices(request.parameters, index);
    const parameters = Object.fromEntries(entries(request.parameters).map(([name, value]) =>
      [name, Object.hasOwn(selected, name) ? selected[name] : value]));
    return { ...request, parameters, count: 1, save_output: false, previous_scenes: previousScenes };
  }
  return { rotatingChoices, regenerationRequest };
});
