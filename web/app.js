(() => {
  "use strict";
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const STORE = "scene-director-brief-v1";

  const HINTS = {
    target: {
      "krea2": "Cohesive scenes with one clear visual treatment. Medium, light and material carry the look.",
      "z-image-turbo": "Concrete scenes with clear layout and interaction. Your appearance and consistency choices stay in control."
    },
    creativity: {
      grounded: "Familiar situations, observed with fresh detail.",
      balanced: "A mix of familiar and less obvious ideas.",
      adventurous: "Unexpected but believable ideas. Never fantasy unless you ask for it."
    }
  };
  const CHIPS = {
    direction: ["jobs", "sport", "hobbies", "household chores", "quiet daily moments", "night out", "travel", "crafts"],
    style: ["documentary photography", "35mm film photo", "cinematic still", "studio portrait", "gouache illustration", "ink drawing", "3D render"],
    interaction: ["colleagues sharing a task", "friends", "teacher and student", "rivals", "strangers"],
    count: ["5", "10", "20", "50"]
  };

  const brief = {
    workflow: "scenes", changes: "", editOutput: "full_prompt", preserve: "",
    promptEditSource: "", promptEditChanges: "",
    rewritePrompt: "", rewriteVision: false,
    rewriteTextSystem: "", rewriteVisionSystem: "",
    rewriteTextPreset: "builtin:faithful", rewriteVisionPreset: "builtin:vision",
    target: "krea2", mode: "single", subject: "woman", lora: true,
    first: "woman", firstLora: true, second: "man", secondLora: false, interaction: "",
    direction: "jobs", count: 10, creativity: "balanced",
    style: "", wishes: "", avoid: [], fixed: [], outputPrefix: "", referenceMode: "inspiration", referenceNotes: ""
  };
  const reference = { data_url: null, name: "", loading: false, revision: 0 };
  const REFERENCE_HINTS = {
    inspiration: "Borrow a few distinctive visible qualities while letting the LLM invent substantially different scenes.",
    composition: "Use the framing, viewpoint and relative positions. Adapt the scene to your subjects and direction.",
    style: "Borrow medium, palette, textures and light; invent the scene content from your brief.",
    scene: "Stay close to the visible activity, setting and arrangement, while varying the details you leave open."
  };
  let samplingDefaults = { temperature: 0.8, top_p: 0.95, top_k: 20, presence_penalty: 0.6, reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } };
  let preciseDefaults = { temperature: 0.3, top_p: 0.9, top_k: 20, presence_penalty: 0, reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } };
  const conn = { server: "lmstudio", api_url: "http://localhost:1234/v1", model: "", output_dir: "", preset_dir: "", vision_preset_dir: "", api_key: "", has_api_key: false,
    sampling: JSON.parse(JSON.stringify(samplingDefaults)), sampling_precise: JSON.parse(JSON.stringify(preciseDefaults)),
    comfy_url: "http://127.0.0.1:8188", comfy_workflow: "", comfy_node: "", comfy_input: "text", comfy_seed: "random" };
  let samplingDrafts = null, samplingProfile = "creative";
  let promptLibrary = { text: [], vision: [] }, promptLibraryLoaded = false, presetRevision = 0;
  let presets = { lmstudio: { url: "http://localhost:1234/v1" }, ollama: { url: "http://localhost:11434/v1" } };
  let defaultOutputDir = "";
  const run = { id: null, seq: 0, timer: null, prompts: [], ideas: [], choices: [], file: null, total: 0, notices: [], request: null, view: "live" };
  const single = { busy: false };
  const favorites = new Set();

  // Storage ---------------------------------------------------------------
  function loadBrief() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      if (saved && typeof saved === "object") {
        for (const key of Object.keys(brief)) if (key in saved && typeof saved[key] === typeof brief[key]) brief[key] = saved[key];
        if (!Array.isArray(brief.avoid)) brief.avoid = [];
        if (!Array.isArray(brief.fixed)) brief.fixed = [];
        if (!(brief.referenceMode in REFERENCE_HINTS)) brief.referenceMode = "inspiration";
        if (!["scenes", "change_image", "rewrite", "edit_prompt"].includes(brief.workflow)) brief.workflow = "scenes";
        if (!["full_prompt", "edit_instruction"].includes(brief.editOutput)) brief.editOutput = "full_prompt";
      }
    } catch (e) { /* storage unavailable: start with defaults */ }
  }
  function saveBrief() {
    try { localStorage.setItem(STORE, JSON.stringify(brief)); } catch (e) { /* ignore */ }
  }

  // Brief form --------------------------------------------------------------
  function renderBrief() {
    for (const el of $$("[data-bind]")) {
      const key = el.dataset.bind;
      if (el.type === "checkbox") el.checked = !!brief[key];
      else el.value = brief[key];
    }
    for (const name of ["workflow", "target", "mode", "creativity"]) {
      const input = $(`input[name="${name}"][value="${brief[name]}"]`);
      if (input) input.checked = true;
    }
    renderWorkflow(); renderMode(); renderHints(); renderChips(); renderAvoid(); renderFixed(); renderStart(); renderBadge(); renderReference();
  }
  function renderWorkflow() {
    const editing = brief.workflow === "change_image";
    const rewriting = brief.workflow === "rewrite";
    const promptEditing = brief.workflow === "edit_prompt";
    const imageFirst = editing || (rewriting && brief.rewriteVision);
    const section = $("#referenceSection"), slot = $("#sourceImageSlot");
    slot.hidden = !imageFirst;
    if (imageFirst) {
      if (section.parentElement !== slot) slot.appendChild(section);
    } else if (section.previousElementSibling !== $("#referenceHome")) {
      $("#referenceHome").after(section);
    }
    $("#sceneControls").hidden = editing || rewriting || promptEditing;
    $("#changeControls").hidden = !editing;
    $("#rewriteControls").hidden = !rewriting;
    $("#rewriteModeControls").hidden = !rewriting;
    $("#promptEditControls").hidden = !promptEditing;
    $("#targetGroup").hidden = rewriting || promptEditing;
    $("#more").hidden = editing || rewriting || promptEditing;
    section.hidden = promptEditing || (rewriting && !brief.rewriteVision);
    $("#referenceGuide").hidden = editing || rewriting;
    $("#referenceTitle").textContent = editing ? "Source image" : "Reference image";
    $("#referenceOptional").hidden = editing;
    if (imageFirst) section.open = true;
    $("#referenceOptional").hidden = imageFirst;
    $("#workflowHint").textContent = promptEditing ? "Change only what you ask in an existing prompt. Keep everything else." : rewriting ? "Transform one prompt using your chosen system instructions, with optional Vision input." : editing ? "Upload an image and request specific changes. Keep the rest of the scene." : "Invent scenes from a creative brief, with an optional reference.";
    $("#referenceHelp").textContent = (imageFirst ? "Required. " : "") + "PNG, JPEG or WebP, up to 5 MB. Requires a vision-capable language model. Sent to your selected model server only when you press Write; not saved in settings or prompt files.";
    renderRewrite(); renderStart(); renderReference();
  }
  function rewriteKeys() {
    return brief.rewriteVision ? ["rewriteVisionSystem", "rewriteVisionPreset", "vision"] : ["rewriteTextSystem", "rewriteTextPreset", "text"];
  }
  function renderRewrite() {
    const [systemKey, presetKey, kind] = rewriteKeys();
    const select = $("#rewritePreset");
    select.textContent = "";
    const custom = document.createElement("option"); custom.value = ""; custom.textContent = "Custom instructions"; select.appendChild(custom);
    for (const item of promptLibrary[kind]) {
      const option = document.createElement("option");
      option.value = item.id; option.textContent = item.name + (item.source === "shared" ? " (shared)" : " (built-in)");
      select.appendChild(option);
    }
    const chosen = promptLibrary[kind].find(item => item.id === brief[presetKey]);
    if (chosen && !brief[systemKey]) brief[systemKey] = chosen.prompt;
    if (promptLibraryLoaded && (!chosen || chosen.prompt !== brief[systemKey])) brief[presetKey] = "";
    select.value = brief[presetKey];
    $("#rewriteSystem").value = brief[systemKey];
    $("#rewriteSourceOptional").hidden = !brief.rewriteVision;
    $("#rewritePresetLabel").textContent = brief.rewriteVision ? "Vision system-prompt preset" : "System-prompt preset";
  }
  async function refreshPresets() {
    const revision = ++presetRevision;
    $("#presetStatus").textContent = "Reading preset files…";
    try {
      const library = await api("/api/presets");
      if (revision !== presetRevision) return;
      if (!library.ok) throw new Error(library.error || "Could not read the presets.");
      promptLibrary = library;
      promptLibraryLoaded = true;
      // Keep the visible snapshot. Reselect a changed file to load its new text.
      for (const kind of ["Text", "Vision"]) {
        const items = promptLibrary[kind.toLowerCase()];
        const key = "rewrite" + kind + "Preset", system = "rewrite" + kind + "System";
        const chosen = items.find(item => item.id === brief[key]);
        if (chosen && !brief[system]) brief[system] = chosen.prompt;
      }
      renderRewrite(); renderReference(); saveBrief();
      $("#presetStatus").textContent = `${library.text.length} text and ${library.vision.length} Vision presets available. ` + (library.warnings || []).join(" ");
    } catch (error) {
      if (revision === presetRevision) $("#presetStatus").textContent = error.message || "Could not read the presets.";
    }
  }
  $("#refreshPresets").addEventListener("click", refreshPresets);
  $("#presetSettings").addEventListener("click", () => {
    openDialog(); $("#presetFoldersSection").open = true; $("#presetDir").focus();
  });
  $("#rewritePreset").addEventListener("change", event => {
    const [system, preset, kind] = rewriteKeys();
    const item = promptLibrary[kind].find(item => item.id === event.target.value);
    brief[preset] = item ? item.id : "";
    if (item) brief[system] = item.prompt;
    $("#rewriteSystem").value = brief[system]; changed();
  });
  $("#rewriteSystem").addEventListener("input", event => {
    const [system, preset] = rewriteKeys();
    brief[system] = event.target.value; brief[preset] = "";
    $("#rewritePreset").value = ""; changed();
  });
  $("#loadPresetFile").addEventListener("click", () => $("#presetFile").click());
  $("#presetFile").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    const [system, preset] = rewriteKeys();
    try {
      if (!/\.txt$/i.test(file.name) || file.size > 65536) throw new Error("Choose one UTF-8 .txt preset of up to 64 KB.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).trim();
      if (!content) throw new Error("This preset is empty.");
      brief[system] = content; brief[preset] = "";
      renderRewrite(); changed(); $("#presetStatus").textContent = `Loaded ${file.name} as custom instructions. The original file is unchanged.`;
    } catch (error) { $("#presetStatus").textContent = error.message || "Could not read this UTF-8 preset."; }
    finally { event.target.value = ""; }
  });
  function renderMode() {
    $("#singleFields").hidden = brief.mode !== "single";
    $("#pairFields").hidden = brief.mode !== "two";
  }
  function renderHints() {
    $("#targetHint").textContent = HINTS.target[brief.target];
    $("#surpriseHint").textContent = HINTS.creativity[brief.creativity];
  }
  function renderChips() {
    for (const box of $$("[data-chips]")) {
      const key = box.dataset.chips;
      box.textContent = "";
      for (const value of CHIPS[key]) {
        const chip = document.createElement("button");
        chip.type = "button"; chip.className = "chip"; chip.textContent = value;
        chip.setAttribute("aria-pressed", String(String(brief[key]).trim().toLowerCase() === value));
        chip.addEventListener("click", () => {
          brief[key] = key === "count" ? Number(value) : value;
          const input = $(`[data-bind="${key}"]`);
          if (input) input.value = brief[key];
          changed();
        });
        box.appendChild(chip);
      }
    }
  }
  function renderStart() {
    if (brief.workflow === "edit_prompt") { $("#startBtn").textContent = "Apply prompt changes"; return; }
    if (brief.workflow === "rewrite") { $("#startBtn").textContent = "Rewrite prompt"; return; }
    if (brief.workflow === "change_image") {
      $("#startBtn").textContent = brief.editOutput === "edit_instruction" ? "Write edit instruction" : "Write revised prompt";
      return;
    }
    const n = clampCount(brief.count);
    $("#startBtn").textContent = `Write ${n} prompt${n === 1 ? "" : "s"}`;
  }
  function renderBadge() {
    const set = [brief.style.trim(), brief.wishes.trim(), brief.avoid.length, brief.fixed.some(f => f.name.trim() && f.value.trim()), brief.outputPrefix.trim()].filter(Boolean).length;
    $("#moreBadge").textContent = set ? `${set} set` : "";
  }
  function clampCount(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 10;
  }
  function changed() { renderChips(); renderStart(); renderBadge(); renderReference(); saveBrief(); }

  function renderReference() {
    $("#referenceOptions").hidden = !reference.data_url;
    $("#referenceBadge").textContent = reference.data_url ? "Attached" : "";
    $("#referenceName").textContent = reference.name;
    $("#dropTitle").textContent = reference.data_url ? "Drop another image to replace" : "Drop an image here";
    $("#referenceModeHint").textContent = REFERENCE_HINTS[brief.referenceMode];
    if (reference.data_url) {
      if ($("#referencePreview").getAttribute("src") !== reference.data_url) $("#referencePreview").src = reference.data_url;
    }
    else $("#referencePreview").removeAttribute("src");
    const rewriting = brief.workflow === "rewrite";
    $("#startBtn").disabled = !!run.id || single.busy || (brief.workflow !== "edit_prompt" && reference.loading) ||
      (brief.workflow === "edit_prompt" && (!brief.promptEditSource.trim() || !brief.promptEditChanges.trim())) ||
      (brief.workflow === "change_image" && (!reference.data_url || !brief.changes.trim())) ||
      (rewriting && (!brief[rewriteKeys()[0]].trim() || (brief.rewriteVision ? !reference.data_url : !brief.rewritePrompt.trim())));
  }
  async function loadReferenceFiles(files) {
    const items = Array.from(files || []);
    if (items.length !== 1) {
      reference.revision++; reference.loading = false;
      $("#referenceStatus").textContent = "Choose or drop one image file at a time.";
      $("#referenceFile").value = "";
      renderReference(); return;
    }
    const file = items[0];
    const revision = ++reference.revision;
    const extension = (file.name || "").split(".").pop().toLowerCase();
    const mime = file.type === "image/jpg" ? "image/jpeg" : (file.type || ({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp"})[extension]);
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || !file.size || file.size > 5 * 1024 * 1024) {
      $("#referenceStatus").textContent = "Choose a PNG, JPEG or WebP image of 5 MB or less.";
      $("#referenceFile").value = "";
      reference.loading = false; renderReference();
      return;
    }
    reference.loading = true; renderReference();
    $("#referenceStatus").textContent = "Loading image…";
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the image. Select it again."));
        reader.readAsDataURL(file.type === mime ? file : new Blob([file], {type:mime}));
      });
      const image = new Image(); image.src = data; await image.decode();
      if (revision !== reference.revision) return;
      reference.data_url = data; reference.name = file.name;
      $("#referenceStatus").textContent = brief.workflow === "change_image" ? "Source image ready. Describe your changes, then press Write." : "Image ready. It will guide the next run.";
      checkConnection();
    } catch (error) {
      if (revision !== reference.revision) return;
      $("#referenceStatus").textContent = "Could not decode this image. Choose another PNG, JPEG or WebP file.";
      $("#referenceFile").value = "";
    } finally {
      if (revision === reference.revision) { reference.loading = false; renderReference(); }
    }
  }
  $("#referenceFile").addEventListener("change", (event) => {
    if (event.target.files.length) loadReferenceFiles(event.target.files);
  });
  const dropzone = $("#imageDropzone");
  let dragDepth = 0;
  for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault(); event.stopPropagation();
      if (eventName === "dragenter") { dragDepth++; dropzone.classList.add("drag-over"); }
      if (eventName === "dragover" && event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (eventName === "dragleave") {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) dropzone.classList.remove("drag-over");
      }
      if (eventName === "drop") {
        dragDepth = 0; dropzone.classList.remove("drag-over");
        $("#referenceFile").value = "";
        loadReferenceFiles(event.dataTransfer ? event.dataTransfer.files : []);
      }
    });
  }
  $("#removeReference").addEventListener("click", () => {
    reference.revision++; reference.data_url = null; reference.name = ""; reference.loading = false;
    $("#referenceFile").value = "";
    $("#referenceStatus").textContent = brief.workflow === "change_image" ? "Source image removed. Upload an image to continue." : "Image removed. The next run will use the text brief only.";
    renderReference(); checkConnection();
  });

  for (const el of $$("[data-bind]")) {
    el.addEventListener("input", () => {
      const key = el.dataset.bind;
      brief[key] = el.type === "checkbox" ? el.checked : (key === "count" ? el.value : el.value);
      if (key === "rewriteVision") { renderWorkflow(); checkConnection(); }
      changed();
    });
  }
  $("#count").addEventListener("change", () => { brief.count = clampCount(brief.count); $("#count").value = brief.count; changed(); });
  for (const name of ["workflow", "target", "mode", "creativity"]) {
    for (const input of $$(`input[name="${name}"]`)) {
      input.addEventListener("change", () => {
        brief[name] = input.value; renderWorkflow(); renderMode(); renderHints(); saveBrief();
        if (name === "workflow") checkConnection();
        if (!run.id && !run.prompts.length) renderEmpty();
      });
    }
  }
  for (const button of $$("[data-step]")) {
    button.addEventListener("click", () => {
      brief.count = clampCount(clampCount(brief.count) + Number(button.dataset.step));
      $("#count").value = brief.count; changed();
    });
  }

  // Avoid tags
  function renderAvoid() {
    const box = $("#avoidTags"), input = $("#avoidInput");
    for (const tag of $$(".tag", box)) tag.remove();
    brief.avoid.forEach((item, index) => {
      const tag = document.createElement("span");
      tag.className = "tag"; tag.textContent = item;
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${item}`);
      remove.addEventListener("click", () => { brief.avoid.splice(index, 1); renderAvoid(); changed(); input.focus(); });
      tag.appendChild(remove);
      box.insertBefore(tag, input);
    });
  }
  function addAvoid(text) {
    for (const part of text.split(/[,;\n]/)) {
      const item = part.trim();
      if (item && !brief.avoid.some(a => a.toLowerCase() === item.toLowerCase())) brief.avoid.push(item);
    }
    renderAvoid(); changed();
  }
  $("#avoidInput").addEventListener("keydown", (e) => {
    const input = e.currentTarget;
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) { e.preventDefault(); addAvoid(input.value); input.value = ""; }
    else if (e.key === "Enter") e.preventDefault();
    else if (e.key === "Backspace" && !input.value && brief.avoid.length) { brief.avoid.pop(); renderAvoid(); changed(); }
  });
  $("#avoidInput").addEventListener("blur", (e) => { if (e.target.value.trim()) { addAvoid(e.target.value); e.target.value = ""; } });
  $("#avoidTags").addEventListener("click", (e) => { if (e.target.id === "avoidTags") $("#avoidInput").focus(); });

  // Fixed choices
  function renderFixed() {
    const list = $("#fixedList");
    list.textContent = "";
    brief.fixed.forEach((row, index) => {
      const wrap = document.createElement("div");
      wrap.className = "fixed-row";
      const name = document.createElement("input");
      name.type = "text"; name.placeholder = "setting"; name.value = row.name; name.setAttribute("aria-label", "Choice name");
      const eq = document.createElement("span"); eq.className = "eq"; eq.textContent = "=";
      const value = document.createElement("input");
      value.type = "text"; value.placeholder = "indoors"; value.value = row.value; value.setAttribute("aria-label", "Choice value");
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "icon-btn"; remove.textContent = "×"; remove.setAttribute("aria-label", "Remove this choice");
      name.addEventListener("input", () => { row.name = name.value; changed(); });
      value.addEventListener("input", () => { row.value = value.value; changed(); });
      remove.addEventListener("click", () => { brief.fixed.splice(index, 1); renderFixed(); changed(); });
      wrap.append(name, eq, value, remove);
      list.appendChild(wrap);
    });
  }
  $("#addFixed").addEventListener("click", () => {
    brief.fixed.push({ name: "", value: "" });
    renderFixed(); changed();
    const inputs = $$("#fixedList input");
    inputs[inputs.length - 2].focus();
  });

  // Connection ------------------------------------------------------------------
  async function api(path, body) {
    const options = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const response = await fetch(path, options);
    return response.json();
  }
  function setPill(kind, text) {
    $("#connDot").className = "dot" + (kind ? " " + kind : "");
    $("#connText").textContent = text;
  }
  function serverName(server) {
    return server === "lmstudio" ? "LM Studio" : server === "ollama" ? "Ollama" : "your server";
  }
  function referenceForRun() {
    return brief.workflow !== "edit_prompt" && !!reference.data_url && (brief.workflow !== "rewrite" || brief.rewriteVision);
  }
  async function checkConnection() {
    setPill("", "Checking connection");
    try {
      const result = await api("/api/models", { api_url: conn.api_url, api_key: conn.api_key, require_vision: referenceForRun() });
      if (!result.ok) {
        setPill("err", /API key/.test(result.error || "") ? "API key needed. Click to add it" : "Not connected. Set up the connection");
        return result;
      }
      const model = conn.model || result.auto;
      const selected = result.models.find(m => m.id === model || m.key === model);
      if (referenceForRun() && selected && selected.vision === false) {
        setPill("err", "Reference image needs a vision model. Click to choose one");
        return result;
      }
      if (model) setPill("ok", `${model} on ${serverName(result.server === "lmstudio" ? "lmstudio" : conn.server)}`);
      else setPill("err", referenceForRun() ? "No vision model ready. Click to choose one" : (result.note ? "No model loaded" : "Connected, no model found"));
      return result;
    } catch (e) {
      setPill("err", "Scene Director is not running");
      return { ok: false, error: "The Scene Director window was closed. Start it again." };
    }
  }

  const dialog = $("#connDialog");
  function fillModels(result, selected) {
    const select = $("#modelSelect");
    select.textContent = "";
    const auto = document.createElement("option");
    auto.value = ""; auto.textContent = result && result.auto ? `Automatic (${result.auto})` : "Automatic (loaded model)";
    select.appendChild(auto);
    const models = (result && result.models) || [];
    for (const m of models) {
      const option = document.createElement("option");
      option.value = m.id;
      const capability = m.vision === true ? " · vision" : m.vision === false ? " · text only" : "";
      option.textContent = m.id + capability + (m.loaded === false ? " (not loaded)" : "");
      select.appendChild(option);
    }
    if (selected && !models.some(m => m.id === selected)) {
      const option = document.createElement("option");
      option.value = selected; option.textContent = selected; select.appendChild(option);
    }
    select.value = selected || "";
  }
  function showTest(result) {
    const box = $("#testResult");
    if (!result.ok) { box.className = "test-result err"; box.textContent = result.error; return; }
    const loaded = result.models.filter(m => m.loaded).length;
    box.className = "test-result " + (result.auto ? "ok" : "err");
    if (result.auto) {
      box.textContent = result.server === "lmstudio"
        ? `Connected to LM Studio. ${loaded} model${loaded === 1 ? "" : "s"} loaded. Automatic uses ${result.auto}.`
        : `Connected. ${result.models.length} model${result.models.length === 1 ? "" : "s"} available.`;
    } else box.textContent = result.note || "Connected, but the server lists no chat model.";
  }
  async function refreshDialogModels() {
    $("#testResult").className = "test-result"; $("#testResult").textContent = "Checking…";
    const draft = { api_url: $("#apiUrl").value.trim(), api_key: $("#apiKey").value.trim(), require_vision: referenceForRun() };
    try {
      const result = await api("/api/models", draft);
      fillModels(result.ok ? result : null, $("#modelSelect").value);
      showTest(result);
    } catch (e) { showTest({ ok: false, error: "Scene Director is not running. Start it again." }); }
  }
  function renderKeyField() {
    $("#apiKey").value = "";
    $("#apiKey").placeholder = conn.has_api_key ? "A key is saved. Paste a new one to replace it." : "Paste your API key";
    $("#forgetKey").hidden = !conn.has_api_key;
  }
  function fillSampling(values) {
    for (const [id, key] of [["temperature", "temperature"], ["topP", "top_p"], ["topK", "top_k"], ["presencePenalty", "presence_penalty"]]) $("#" + id).value = values[key];
    $("#reasoningEffort").value = values.reasoning_effort == null ? "default" : values.reasoning_effort;
    const thinking = values.chat_template_kwargs.enable_thinking;
    $("#templateThinking").value = thinking == null ? "default" : String(thinking);
  }
  function samplingValues() {
    const values = {};
    for (const [id, key] of [["temperature", "temperature"], ["topP", "top_p"], ["topK", "top_k"], ["presencePenalty", "presence_penalty"]]) {
      const field = $("#" + id);
      if (!field.value.trim() || !field.checkValidity()) {
        $("#samplingSection").open = true;
        field.reportValidity();
        throw new Error("Check the value for " + field.previousElementSibling.textContent + ".");
      }
      values[key] = Number(field.value);
    }
    const effort = $("#reasoningEffort").value;
    values.reasoning_effort = effort === "default" ? null : effort;
    const thinking = $("#templateThinking").value;
    values.chat_template_kwargs = { enable_thinking: thinking === "default" ? null : thinking === "true" };
    return values;
  }
  $("#reasoningEffort").addEventListener("change", () => {
    const effort = $("#reasoningEffort").value;
    if (effort !== "default" && $("#templateThinking").value !== "default") $("#templateThinking").value = effort === "none" ? "false" : "true";
  });
  $("#templateThinking").addEventListener("change", () => {
    const thinking = $("#templateThinking").value, effort = $("#reasoningEffort").value;
    if (thinking === "true" && effort === "none") $("#reasoningEffort").value = "default";
    if (thinking === "false" && effort !== "default" && effort !== "none") $("#reasoningEffort").value = "none";
  });
  $("#samplingProfile").addEventListener("change", () => {
    try { samplingDrafts[samplingProfile] = samplingValues(); }
    catch (error) { $("#samplingProfile").value = samplingProfile; showTest({ ok: false, error: error.message }); return; }
    samplingProfile = $("#samplingProfile").value;
    fillSampling(samplingDrafts[samplingProfile]);
  });
  $("#resetSampling").addEventListener("click", () => {
    fillSampling(samplingProfile === "precise" ? preciseDefaults : samplingDefaults);
    $("#testResult").className = "test-result";
    $("#testResult").textContent = "Default generation values restored in this form. Press Save to apply them.";
  });
  function openDialog() {
    $(`input[name="server"][value="${conn.server}"]`).checked = true;
    $("#apiUrl").value = conn.api_url; $("#outputDir").value = conn.output_dir;
    $("#presetDir").value = conn.preset_dir || "";
    $("#visionPresetDir").value = conn.vision_preset_dir || "";
    renderKeyField();
    samplingDrafts = { creative: JSON.parse(JSON.stringify(conn.sampling)), precise: JSON.parse(JSON.stringify(conn.sampling_precise || preciseDefaults)) };
    samplingProfile = "creative"; $("#samplingProfile").value = "creative";
    fillSampling(samplingDrafts.creative);
    $("#comfyUrl").value = conn.comfy_url || ""; $("#comfyWorkflow").value = conn.comfy_workflow || "";
    $("#comfySeed").value = conn.comfy_seed === "fixed" ? "fixed" : "random"; $("#comfyStatus").textContent = "";
    fillComfyNodes(null);
    fillModels(null, conn.model);
    $("#testResult").textContent = "";
    dialog.showModal();
    refreshDialogModels();
  }
  $("#connPill").addEventListener("click", openDialog);
  for (const input of $$('input[name="server"]')) {
    input.addEventListener("change", () => {
      if (presets[input.value]) $("#apiUrl").value = presets[input.value].url;
      if (input.value !== "custom") refreshDialogModels();
      else $("#apiUrl").focus();
    });
  }
  $("#apiUrl").addEventListener("input", () => {
    const url = $("#apiUrl").value.trim();
    const match = Object.entries(presets).find(([, p]) => p.url === url);
    $(`input[name="server"][value="${match ? match[0] : "custom"}"]`).checked = true;
  });
  $("#refreshModels").addEventListener("click", refreshDialogModels);
  $("#testConn").addEventListener("click", refreshDialogModels);
  $("#connClose").addEventListener("click", () => dialog.close());
  $("#connCancel").addEventListener("click", () => dialog.close());
  $("#dlgOpenFolder").addEventListener("click", () => openFolder($("#outputDir").value.trim() || defaultOutputDir, $("#testResult")));
  function dialogValues() {
    return {
      server: $('input[name="server"]:checked').value,
      api_url: $("#apiUrl").value.trim(),
      api_key: $("#apiKey").value.trim(),
      model: $("#modelSelect").value,
      output_dir: $("#outputDir").value.trim() || defaultOutputDir,
      preset_dir: $("#presetDir").value.trim(), vision_preset_dir: $("#visionPresetDir").value.trim(),
      ...(() => { samplingDrafts[samplingProfile] = samplingValues(); return { sampling: samplingDrafts.creative, sampling_precise: samplingDrafts.precise }; })(),
      ...(() => {
        const value = $("#comfyNode").value, split = value.lastIndexOf("|");
        return { comfy_url: $("#comfyUrl").value.trim(), comfy_workflow: $("#comfyWorkflow").value.trim(), comfy_seed: $("#comfySeed").value,
          comfy_node: split > 0 ? value.slice(0, split) : "", comfy_input: split > 0 ? value.slice(split + 1) : "text" };
      })()
    };
  }
  async function saveConnection(extra) {
    let next;
    try { next = Object.assign(dialogValues(), extra || {}); }
    catch (error) { showTest({ ok: false, error: error.message }); return null; }
    if (!next.api_url) { showTest({ ok: false, error: "Enter a server address." }); return null; }
    try {
      const result = await api("/api/settings", next);
      if (!result.ok) { showTest(result); return null; }
      Object.assign(conn, result.settings, { api_key: "" });  // the server keeps the key from now on
      refreshPresets(); loadFavorites();
      if (!run.id && run.prompts.length) renderRun(); else renderBarActions();
      return result.settings;
    } catch (e) {
      showTest({ ok: false, error: "Could not save. Is Scene Director still running?" });
      return null;
    }
  }
  $("#connSave").addEventListener("click", async () => {
    if (await saveConnection()) { dialog.close(); checkConnection(); }
  });
  // Enter in any field saves, like pressing Save.
  $("#connForm").addEventListener("submit", (e) => { e.preventDefault(); $("#connSave").click(); });
  $("#connForm").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); $("#connSave").click(); }
  });
  $("#forgetKey").addEventListener("click", async () => {
    if (await saveConnection({ api_key: "", forget_api_key: true })) {
      renderKeyField();
      const box = $("#testResult");
      box.className = "test-result"; box.textContent = "The saved key is removed.";
    }
  });

  async function openFolder(path, target) {
    try {
      const result = await api("/api/open-folder", { path });
      if (!result.ok) {
        if (target) { target.className = "test-result err"; target.textContent = result.error; } else setStatus(result.error);
      }
    } catch (e) { setStatus("Scene Director is not running. Start it again."); }
  }
  $("#openFolder").addEventListener("click", () => openFolder(run.file || conn.output_dir || defaultOutputDir));

  // Script page ---------------------------------------------------------------
  const page = $("#page");
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function renderEmpty() {
    page.textContent = "";
    page.appendChild(el("p", "transition", "FADE IN:"));
    const empty = el("div", "empty");
    const editing = brief.workflow === "change_image";
    const rewriting = brief.workflow === "rewrite";
    const promptEditing = brief.workflow === "edit_prompt";
    empty.appendChild(el("p", "", promptEditing ? "Your edited prompt appears here." : rewriting ? "Your rewritten prompt appears here." : editing ? "Your revised prompt or edit instruction appears here." : "Your prompts appear here as they are written, one scene at a time."));
    empty.appendChild(el("p", "muted", promptEditing ? "Paste the original prompt, describe only the changes and press Apply prompt changes." : rewriting ? "Paste a prompt, choose system instructions and press Rewrite prompt. Enable Vision to use an image." : editing ? "Upload a source image and describe the changes. Unrequested details stay the same." : "Pick a subject and a direction, then press Write. Anything you leave blank, the model invents."));
    empty.appendChild(el("p", "muted", "Make sure a model is loaded in LM Studio and its server is running. The connection status sits at the top of this page."));
    page.appendChild(empty);
  }
  function setStatus(text) { $("#status").textContent = text; }
  function setProgress(done, total) {
    $("#progress").style.width = total ? `${Math.min(100, (done / total) * 100)}%` : "0";
  }
  async function copyText(text, button, label) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const area = el("textarea"); area.value = text; document.body.appendChild(area); area.select();
      try { document.execCommand("copy"); } catch (err) { /* nothing else to try */ }
      area.remove();
    }
    if (button) { button.textContent = "Copied"; setTimeout(() => { button.textContent = label; }, 1400); }
  }
  // Live view: the model's reply while it is being written --------------------
  function decodePartial(raw) {
    raw = raw.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
    try { return JSON.parse('"' + raw + '"'); }
    catch (e) { return raw.replace(/\\n/g, " ").replace(/\\"/g, '"'); }
  }
  function partialList(text, key) {
    // Read the strings of "key": [ ... ] from JSON that is still being written.
    const match = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(text);
    const items = [];
    if (!match) return null;
    let i = match.index + match[0].length;
    while (i < text.length) {
      while (i < text.length && /[\s,]/.test(text[i])) i++;
      if (i >= text.length || text[i] !== '"') break;
      i++;
      let raw = "", closed = false;
      while (i < text.length) {
        const c = text[i];
        if (c === "\\") { raw += text.slice(i, i + 2); i += 2; continue; }
        if (c === '"') { closed = true; i++; break; }
        raw += c; i++;
      }
      items.push({ text: decodePartial(raw), done: closed });
      if (!closed) break;
    }
    return items;
  }
  function liveParts() {
    let content = run.live.content, thinking = run.live.reasoning;
    const think = /<think>([\s\S]*?)(<\/think>|$)/i.exec(content);
    if (think) { thinking += think[1]; content = content.replace(think[0], ""); }
    if (["rewrite", "edit_prompt"].includes(run.workflow)) return { content: content.trim(), thinking: thinking.trim(), ideas: null, prompts: null };
    const ideas = partialList(content, "ideas");
    const prompts = partialList(content, "prompts");
    return { content: content.trim(), thinking: thinking.trim(), ideas, prompts };
  }
  function clearLive() {
    run.live = null;
    const block = $("#live");
    if (block) block.remove();
  }
  function renderLive() {
    if (!run.live) return;
    const nearBottom = page.scrollHeight - page.scrollTop - page.clientHeight < 120;
    let block = $("#live");
    if (!block) {
      if (run.prompts.length === 0) {
        page.textContent = "";
        page.appendChild(el("p", "transition", "FADE IN:"));
      }
      block = el("section", "live"); block.id = "live";
      block.setAttribute("aria-label", "Model output, live");
      page.appendChild(block);
    }
    const live = run.live, parts = liveParts();
    block.textContent = "";
    const head = el("div", "live-head");
    head.appendChild(el("span", "pulse"));
    const range = live.first === live.last ? `prompt ${live.first}` : `prompts ${live.first} to ${live.last}`;
    const phase = run.workflow === "edit_prompt" && parts.content ? "Editing" : run.workflow === "rewrite" && parts.content ? "Rewriting" : parts.prompts && parts.prompts.length ? "Writing" : parts.ideas && parts.ideas.length ? "Choosing scenes for" : parts.thinking ? "Thinking about" : "Waiting for the model on";
    head.appendChild(el("span", "", `${phase} ${range}${live.attempt > 1 ? " (retry)" : ""}`));
    const seconds = Math.round((Date.now() - live.started) / 1000);
    head.appendChild(el("span", "elapsed", seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `${seconds} s`));
    block.appendChild(head);

    if (parts.thinking && !(parts.prompts && parts.prompts.length)) {
      const tail = parts.thinking.length > 420 ? "…" + parts.thinking.slice(-420) : parts.thinking;
      const p = el("p", "thinking");
      p.appendChild(el("b", "", "Thinking"));
      p.appendChild(document.createTextNode(tail));
      block.appendChild(p);
    }
    const ideas = parts.ideas || [], prompts = parts.prompts || [];
    const rows = Math.max(ideas.length, prompts.length);
    if (rows) {
      for (let k = 0; k < rows; k++) {
        const scene = el("article", "scene draft");
        scene.appendChild(el("span", "scene-no", String(live.first + k)));
        if (ideas[k]) scene.appendChild(el("h3", "slug", ideas[k].text.replace(/\.$/, "")));
        const body = el("p", "action", prompts[k] ? prompts[k].text : "");
        if (prompts[k] && !prompts[k].done && k === prompts.length - 1) body.appendChild(el("span", "caret"));
        scene.appendChild(body);
        block.appendChild(scene);
      }
    } else if (parts.content && (["rewrite", "edit_prompt"].includes(run.workflow) || (!parts.content.startsWith("{") && !parts.content.startsWith("```")))) {
      // A model that ignores the JSON format: show its raw text.
      const scene = el("article", "scene draft");
      const body = el("p", "action", ["rewrite", "edit_prompt"].includes(run.workflow) ? parts.content : parts.content.slice(-1600));
      if (run.workflow === "edit_prompt") body.classList.add("prompt-edit-text");
      body.appendChild(el("span", "caret"));
      scene.appendChild(body);
      block.appendChild(scene);
    }
    if (nearBottom) page.scrollTop = page.scrollHeight;
  }

  function addScene(event) {
    if (run.live) clearLive();
    if (run.prompts.length === 0) page.textContent = "";
    if (!page.querySelector(".transition")) page.appendChild(el("p", "transition", "FADE IN:"));
    run.prompts.push(event.text); run.ideas.push(event.idea || "");
    run.choices.push(event.choices || window.ScenePromptCore.rotatingChoices(run.request?.parameters, run.prompts.length - 1));
    page.appendChild(sceneCard(run.prompts.length - 1, true));
    if (page.scrollHeight > page.clientHeight) page.scrollTo({ top: page.scrollHeight, behavior: "smooth" });
    $("#copyAll").disabled = false; renderBarActions();
  }
  function addError(message, saved, file) {
    const box = el("div", "error-box");
    box.appendChild(el("strong", "", "The run stopped"));
    box.appendChild(el("p", "", message));
    if (saved) box.appendChild(el("p", "", `${saved} prompt${saved === 1 ? " was" : "s were"} saved to ${file}.`));
    if (run.prompts.length === 0) page.textContent = "";
    page.prepend(box);
    page.scrollTo({ top: 0, behavior: "smooth" });
  }
  function addNotice(event) {
    run.notices.push(event);
    const log = $("#log");
    const line = el("p", event.level === "warn" ? "warn" : "", event.message);
    log.appendChild(line);
    const toggle = $("#logToggle");
    toggle.hidden = false;
    toggle.textContent = log.hidden ? `Show details (${run.notices.length})` : "Hide details";
  }
  $("#logToggle").addEventListener("click", () => {
    const log = $("#log");
    log.hidden = !log.hidden;
    $("#logToggle").textContent = log.hidden ? `Show details (${run.notices.length})` : "Hide details";
  });
  $("#copyAll").addEventListener("click", () => copyText(run.prompts.join("\n"), $("#copyAll"), "Copy all"));

  function setRunning(active) {
    $("#startBtn").disabled = active;
    if (active) $("#startBtn").textContent = "Writing…"; else { renderStart(); renderReference(); }
    for (const input of $$('input[name="workflow"]')) input.disabled = active;
    $("#stopBtn").hidden = !active;
    $("#stopBtn").disabled = false;
    $("#kbdHint").hidden = active;
  }
  function finish() {
    clearLive();
    clearInterval(run.timer); run.timer = null; run.id = null;
    setRunning(false); renderBarActions();
  }
  function handle(event) {
    switch (event.type) {
      case "start":
        run.total = event.count;
        run.workflow = event.workflow;
        $("#meta").textContent = event.workflow === "edit_prompt" ? `Edited prompt, written by ${event.model}` : event.workflow === "rewrite" ? `Rewritten prompt, written by ${event.model}` : event.workflow === "change_image" ? `${event.output_kind === "edit_instruction" ? "Edit instruction" : "Revised prompt"} for ${event.target_label}, written by ${event.model}` : `${event.count} for ${event.target_label}, written by ${event.model}`;
        setStatus(`Writing… the first batch can take a minute on a local model.`);
        break;
      case "batch":
        clearLive();
        run.live = { first: event.first, last: event.last, attempt: event.attempt, content: "", reasoning: "", started: Date.now() };
        renderLive();
        break;
      case "delta":
        if (run.live) {
          run.live[event.channel === "reasoning" ? "reasoning" : "content"] += event.text;
        }
        break;
      case "prompt":
        addScene(event);
        setProgress(run.prompts.length, run.total);
        setStatus(`${run.prompts.length} of ${run.total} written`);
        break;
      case "notice": addNotice(event); break;
      case "log": addNotice({ level: "info", message: event.message }); break;
      case "saved": run.file = event.file; break;
      case "done":
        run.file = event.file;
        page.appendChild(el("p", "transition out", "FADE OUT."));
        page.appendChild(el("p", "saved-line", `Saved to ${event.file}`));
        setStatus(`Done. ${event.count} prompt${event.count === 1 ? "" : "s"} saved.`);
        setProgress(1, 1);
        finish();
        break;
      case "stopped":
        if (event.file) run.file = event.file;
        setStatus(event.saved ? `Stopped. ${event.saved} prompts saved.` : "Stopped before the first batch was finished.");
        finish();
        break;
      case "error":
        addError(event.message, event.saved, event.file);
        setStatus(event.saved ? `Stopped with an error. ${event.saved} prompts saved.` : "Stopped with an error.");
        finish();
        break;
    }
  }
  async function poll() {
    if (!run.id || run.polling) return;
    run.polling = true;
    try {
      const result = await api(`/api/job?id=${encodeURIComponent(run.id)}&since=${run.seq}`);
      if (!result.ok) { handle({ type: "error", message: result.error || "Lost track of this run.", saved: 0 }); return; }
      for (const event of result.events) { run.seq = event.seq + 1; handle(event); }
      if (run.live) renderLive();  // also keeps the elapsed time ticking
    } catch (e) {
      handle({ type: "error", message: "Scene Director is not running anymore. Start it again. Finished batches are in the output folder.", saved: 0 });
    } finally {
      run.polling = false;
    }
  }
  function follow(id) {
    Object.assign(run, { id, seq: 0, prompts: [], ideas: [], choices: [], file: null, total: 0, notices: [], live: null, workflow: brief.workflow, request: null, view: "live" });
    $("#log").textContent = ""; $("#log").hidden = true; $("#logToggle").hidden = true;
    $("#copyAll").disabled = true;
    page.textContent = "";
    setProgress(0, 1);
    setRunning(true);
    clearInterval(run.timer);
    run.timer = setInterval(poll, 250);
    poll();
  }

  async function start(e) {
    if (e) e.preventDefault();
    if (run.id || single.busy) return;
    if (reference.loading && brief.workflow !== "edit_prompt") { setStatus("Wait for the reference image to finish loading."); return; }
    const editing = brief.workflow === "change_image";
    const rewriting = brief.workflow === "rewrite";
    const promptEditing = brief.workflow === "edit_prompt";
    if (promptEditing && (!brief.promptEditSource.trim() || !brief.promptEditChanges.trim())) {
      setStatus("Paste the original prompt and describe what should change first."); return;
    }
    if (rewriting && (!brief[rewriteKeys()[0]].trim() || (brief.rewriteVision ? !reference.data_url : !brief.rewritePrompt.trim()))) {
      setStatus("Choose system instructions and paste a prompt, or enable Vision and upload an image."); return;
    }
    if (editing && (!reference.data_url || !brief.changes.trim())) {
      setStatus("Upload a source image and describe the changes first."); return;
    }
    brief.count = clampCount(brief.count);
    $("#count").value = brief.count;
    const two = brief.mode === "two";
    let request = {
      target: brief.target,
      subject: (two ? brief.first : brief.subject).trim() || "person",
      identity: (two ? brief.firstLora : brief.lora) ? "lora" : "free",
      subject2: two ? (brief.second.trim() || "another person") : "",
      identity2: brief.secondLora ? "lora" : "free",
      interaction: two ? brief.interaction.trim() : "",
      direction: brief.direction.trim(),
      count: brief.count,
      creativity: brief.creativity,
      style: brief.style.trim(),
      wishes: brief.wishes.trim(),
      avoid: brief.avoid,
      parameters: brief.fixed.filter(f => f.name.trim() || f.value.trim()),
      output_prefix: brief.outputPrefix.trim(),
      api_url: conn.api_url, api_key: conn.api_key, model: conn.model,
      output_dir: conn.output_dir || defaultOutputDir
    };
    if (reference.data_url) request.reference_image = { data_url: reference.data_url, mode: brief.referenceMode, notes: brief.referenceNotes.trim() };
    if (editing) request = {
      workflow: "change_image", target: brief.target, count: 1, changes: brief.changes.trim(),
      edit_output: brief.editOutput, preserve: brief.preserve.trim(),
      reference_image: { data_url: reference.data_url, mode: "scene", notes: "" },
      api_url: conn.api_url, api_key: conn.api_key, model: conn.model, output_dir: conn.output_dir || defaultOutputDir
    };
    if (rewriting) {
      request = { workflow: "rewrite", count: 1, rewrite_prompt: brief.rewritePrompt.trim(),
        rewrite_system: brief[rewriteKeys()[0]].trim(), rewrite_use_vision: brief.rewriteVision,
        api_url: conn.api_url, api_key: conn.api_key, model: conn.model, output_dir: conn.output_dir || defaultOutputDir };
      if (brief.rewriteVision) request.reference_image = { data_url: reference.data_url };
    }
    if (promptEditing) request = {
      workflow: "edit_prompt", count: 1, source_prompt: brief.promptEditSource.trim(), changes: brief.promptEditChanges.trim(),
      api_url: conn.api_url, api_key: conn.api_key, model: conn.model, output_dir: conn.output_dir || defaultOutputDir
    };
    setStatus("Starting…");
    try {
      const result = await api("/api/generate", request);
      if (!result.ok) { setStatus(result.error); return; }
      follow(result.id);
      run.request = request;
    } catch (err) {
      setStatus("Scene Director is not running. Start it again from its launcher.");
    }
  }
  $("#brief").addEventListener("submit", start);
  $("#stopBtn").addEventListener("click", async () => {
    $("#stopBtn").disabled = true;
    setStatus("Stopping… finished batches stay saved.");
    try { await api("/api/stop", {}); } catch (e) { /* the poll reports the outcome */ }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !dialog.open && !$("#promptWorkspace").hidden) start(e);
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) $("#kbdHint").textContent = "Cmd + Enter also starts a run.";

  // Prompt actions, history, favorites, saved briefs and ComfyUI -----------------
  const busyMessage = "Wait until the current run has finished.";
  const normalize = text => String(text || "").split(/\s+/).filter(Boolean).join(" ");
  const comfyReady = () => !!(conn.comfy_workflow && conn.comfy_node);
  const isBusy = () => !!run.id || single.busy;
  const canRegenerate = () => run.view !== "favorites" && !!run.request && (run.request.workflow || "scenes") === "scenes";
  function button(label, title, handler, cls = "copy") {
    const node = el("button", cls, label);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("click", () => handler(node));
    return node;
  }
  function sceneCard(index, fresh) {
    const text = run.prompts[index], idea = run.ideas[index] || "";
    const scene = el("article", "scene" + (fresh ? " new" : ""));
    scene.dataset.index = String(index);
    scene.appendChild(el("span", "scene-no", String(index + 1)));
    if (idea) scene.appendChild(el("h3", "slug", idea.replace(/\.$/, "")));
    scene.appendChild(el("p", "action" + (run.workflow === "edit_prompt" ? " prompt-edit-text" : ""), text));
    const foot = el("div", "scene-foot");
    foot.appendChild(el("span", "", `${text.split(/\s+/).filter(Boolean).length} words`));
    foot.appendChild(button("Copy", "", node => copyText(run.prompts[index], node, "Copy")));
    const starred = favorites.has(normalize(text));
    foot.appendChild(button(starred ? "★ Starred" : "☆ Star", starred ? "Remove the star" : "Add to favorites.txt in the output folder",
      () => toggleStar(index), "copy" + (starred ? " starred" : "")));
    if (comfyReady()) foot.appendChild(button("Queue in ComfyUI", "Send this prompt to your ComfyUI workflow", node => queueComfy([run.prompts[index]], node)));
    if (run.workflow === "edit_prompt") foot.appendChild(button("Use as input", "Edit this result further", () => useForEdit(index)));
    const more = el("details", "more-menu");
    more.appendChild(el("summary", "copy", "More"));
    const menu = el("div", "more-items");
    if (run.view !== "favorites") menu.appendChild(button("Edit text", "Change this prompt by hand", () => editInline(index)));
    if (canRegenerate()) menu.appendChild(button("New version", "Write a different scene for this slot with the same brief", () => regenerate(index)));
    if (run.workflow !== "edit_prompt") menu.appendChild(button("Use in Edit a prompt", "Make targeted changes with the language model", () => useForEdit(index)));
    menu.appendChild(button(run.view === "favorites" ? "Remove star" : "Delete", run.view === "favorites" ? "Remove from favorites.txt" : "Remove this prompt from the run and its file", () => removePrompt(index)));
    more.appendChild(menu);
    more.addEventListener("toggle", () => { if (more.open) for (const other of $$(".more-menu[open]")) if (other !== more) other.open = false; });
    foot.appendChild(more);
    scene.appendChild(foot);
    return scene;
  }
  function renderRun() {
    page.textContent = "";
    page.appendChild(el("p", "transition", "FADE IN:"));
    if (!run.prompts.length) page.appendChild(el("p", "empty-line", run.view === "favorites" ? "No starred prompts yet. Use ☆ Star on any prompt." : "No prompts left in this run."));
    run.prompts.forEach((_, index) => page.appendChild(sceneCard(index, false)));
    if (run.prompts.length) page.appendChild(el("p", "transition out", "FADE OUT."));
    if (run.file) page.appendChild(el("p", "saved-line", `${run.view === "favorites" ? "Starred prompts in" : "Saved to"} ${run.file}`));
    $("#copyAll").disabled = !run.prompts.length;
    renderBarActions();
  }
  function renderBarActions() {
    $("#queueAll").hidden = !comfyReady() || !run.prompts.length;
    $("#queueAll").disabled = !!run.id;
  }
  async function persistRun() {
    if (run.view === "favorites" || !run.file) return true;
    try {
      const result = await api("/api/run-file", { file: run.file, prompts: run.prompts, ideas: run.ideas, choices: run.choices });
      if (!result.ok) { setStatus(result.error); return false; }
      return true;
    } catch (e) { setStatus("Scene Director is not running. Start it again."); return false; }
  }
  function editInline(index) {
    if (isBusy()) { setStatus(busyMessage); return; }
    const card = page.querySelector(`.scene[data-index="${index}"]`);
    if (!card) return;
    const area = el("textarea", "scene-edit");
    area.value = run.prompts[index]; area.rows = 7; area.setAttribute("aria-label", `Edit prompt ${index + 1}`);
    const bar = el("div", "scene-foot");
    bar.append(button("Save", "", async () => {
      const value = area.value.trim();
      if (!value) { setStatus("A prompt cannot be empty. Use Delete instead."); return; }
      run.prompts[index] = value;
      if (await persistRun()) setStatus(`Prompt ${index + 1} updated.`);
      renderRun();
    }), button("Cancel", "", () => renderRun()));
    card.querySelector(".action").replaceWith(area);
    card.querySelector(".scene-foot").replaceWith(bar);
    area.focus();
  }
  async function removePrompt(index) {
    if (isBusy()) { setStatus(busyMessage); return; }
    if (run.view === "favorites") { await toggleStar(index); return; }
    if (!confirm(`Delete prompt ${index + 1}${run.file ? " from this run and its file" : ""}?`)) return;
    run.prompts.splice(index, 1); run.ideas.splice(index, 1); run.choices.splice(index, 1);
    if (await persistRun()) setStatus(`Prompt ${index + 1} deleted.`);
    renderRun();
  }
  async function loadFavorites() {
    try {
      const result = await api("/api/favorites");
      if (result.ok) { favorites.clear(); for (const prompt of result.prompts) favorites.add(normalize(prompt)); return result; }
    } catch (e) { /* the status pill reports a stopped service */ }
    return { prompts: [], file: null };
  }
  async function toggleStar(index) {
    const text = normalize(run.prompts[index]), remove = favorites.has(text);
    try {
      const result = await api("/api/favorite", { prompt: text, remove });
      if (!result.ok) { setStatus(result.error); return; }
      if (result.starred) favorites.add(text); else favorites.delete(text);
      setStatus(result.starred ? `Starred. Saved in ${result.file}.` : "Star removed.");
      if (run.view === "favorites") { run.prompts.splice(index, 1); run.ideas.splice(index, 1); renderRun(); return; }
      const card = page.querySelector(`.scene[data-index="${index}"]`);
      if (card) card.replaceWith(sceneCard(index, false));
    } catch (e) { setStatus("Scene Director is not running. Start it again."); }
  }
  async function queueComfy(prompts, node) {
    if (!comfyReady()) { openDialog(); $("#comfySection").open = true; return; }
    if (node) node.disabled = true;
    setStatus(`Sending ${prompts.length} prompt${prompts.length === 1 ? "" : "s"} to ComfyUI…`);
    try {
      const result = await api("/api/comfy/queue", { prompts });
      setStatus(result.ok ? `Queued ${result.queued} prompt${result.queued === 1 ? "" : "s"} in ComfyUI.` : result.error);
    } catch (e) { setStatus("Scene Director is not running. Start it again."); }
    finally { if (node) node.disabled = false; renderBarActions(); }
  }
  function useForEdit(index) {
    if (run.id) { setStatus(busyMessage); return; }
    brief.workflow = "edit_prompt";
    $('input[name="workflow"][value="edit_prompt"]').checked = true;
    brief.promptEditSource = run.prompts[index]; $("#promptEditSource").value = brief.promptEditSource;
    brief.promptEditChanges = ""; $("#promptEditChanges").value = "";
    renderWorkflow(); changed(); checkConnection(); $("#promptEditChanges").focus();
  }
  async function runSingle(request) {
    const started = await api("/api/generate", request);
    if (!started.ok) throw new Error(started.error);
    let seq = 0, prompt = null;
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const result = await api(`/api/job?id=${encodeURIComponent(started.id)}&since=${seq}`);
      if (!result.ok) throw new Error(result.error || "Lost track of this request.");
      for (const event of result.events) {
        seq = event.seq + 1;
        if (event.type === "prompt") prompt = event;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "stopped") throw new Error("Stopped before a new version was written.");
        if (event.type === "done") { if (!prompt) throw new Error("The model returned no new prompt."); return prompt; }
      }
      if (result.finished) throw new Error("The request ended without a new prompt.");
    }
  }
  async function regenerate(index) {
    if (isBusy()) { setStatus(busyMessage); return; }
    const others = run.prompts.map((text, i) => i === index ? "" : (run.ideas[i] || text.split(/\s+/).slice(0, 30).join(" ")))
      .filter(Boolean).map(note => note.slice(0, 300)).slice(-300);
    const request = window.ScenePromptCore.regenerationRequest(run.request, index, run.choices[index], others);
    single.busy = true; renderReference();
    const card = page.querySelector(`.scene[data-index="${index}"]`);
    if (card) card.classList.add("regenerating");
    setStatus(`Writing a new version of prompt ${index + 1}…`);
    try {
      const result = await runSingle(request);
      run.prompts[index] = result.text; run.ideas[index] = result.idea || "";
      if (await persistRun()) setStatus(`Prompt ${index + 1} replaced${run.file ? " and saved" : ""}.`);
    } catch (error) { setStatus(error.message || "Could not write a new version."); }
    finally { single.busy = false; renderRun(); renderReference(); }
  }

  const historyDialog = $("#historyDialog");
  async function openHistory() {
    $("#historyList").textContent = ""; $("#historyFolder").textContent = "Reading the output folder…";
    historyDialog.showModal();
    try {
      const result = await api("/api/history");
      if (!result.ok) { $("#historyFolder").textContent = result.error; return; }
      $("#historyFolder").textContent = result.runs.length ? `${result.runs.length} prompt file${result.runs.length === 1 ? "" : "s"} in ${result.folder}` : `No prompt files yet in ${result.folder}.`;
      for (const item of result.runs) {
        const row = el("div", "history-row"), info = el("div", "history-info"), actions = el("div", "history-buttons");
        info.appendChild(el("strong", "", item.label || item.name));
        info.appendChild(el("span", "", `${item.count} prompt${item.count === 1 ? "" : "s"} · ${new Date(item.modified).toLocaleString()}${item.model ? " · " + item.model : ""}`));
        actions.appendChild(button("Open", "Show these prompts", () => openRun(item.file), "btn"));
        if (item.has_brief) actions.appendChild(button("Use brief", "Fill the form with the brief of this run", () => openRun(item.file, true), "btn"));
        row.append(info, actions); $("#historyList").appendChild(row);
      }
    } catch (e) { $("#historyFolder").textContent = "Scene Director is not running. Start it again."; }
  }
  function requestForRegenerate(record) {
    const request = { ...record };
    delete request.reference;
    return Object.assign(request, { api_url: conn.api_url, model: conn.model, output_dir: conn.output_dir || defaultOutputDir });
  }
  async function openRun(file, briefOnly) {
    if (isBusy()) { $("#historyFolder").textContent = busyMessage; return; }
    try {
      const item = await api("/api/history/item?file=" + encodeURIComponent(file));
      if (!item.ok) { $("#historyFolder").textContent = item.error; return; }
      historyDialog.close();
      if (briefOnly) { applyRequest(item.request); return; }
      Object.assign(run, { prompts: item.prompts, ideas: item.ideas, choices: item.choices, file: item.file, view: "history", notices: [],
        workflow: (item.request && item.request.workflow) || "scenes", request: item.request ? requestForRegenerate(item.request) : null });
      $("#meta").textContent = `Opened ${file.split(/[\\/]/).pop()}${item.model ? `, written by ${item.model}` : ""}`;
      setProgress(0, 1); setStatus(""); renderRun();
    } catch (e) { $("#historyFolder").textContent = "Scene Director is not running. Start it again."; }
  }
  async function openFavorites() {
    if (isBusy()) { $("#historyFolder").textContent = busyMessage; return; }
    const result = await loadFavorites();
    historyDialog.close();
    Object.assign(run, { prompts: result.prompts.slice(), ideas: result.prompts.map(() => ""), choices: [], file: result.file, workflow: "scenes", view: "favorites", request: null });
    $("#meta").textContent = "Starred prompts"; setStatus(""); renderRun();
  }
  // Fill the form from a stored request (History) or a saved brief.
  function applyRequest(record) {
    if (!record || typeof record !== "object") return;
    const workflow = ["scenes", "change_image", "rewrite", "edit_prompt"].includes(record.workflow) ? record.workflow : "scenes";
    brief.workflow = workflow;
    if (record.target in HINTS.target) brief.target = record.target;
    if (workflow === "scenes") {
      const two = !!record.subject2;
      Object.assign(brief, { mode: two ? "two" : "single", interaction: record.interaction || "", direction: record.direction || "",
        count: clampCount(record.count || brief.count), creativity: record.creativity in HINTS.creativity ? record.creativity : "balanced",
        style: record.style && record.style !== "auto" ? record.style : "", wishes: record.wishes || "",
        avoid: Array.isArray(record.avoid) ? record.avoid.map(String) : [], outputPrefix: record.output_prefix || "",
        fixed: Object.entries(record.parameters || {}).map(([name, value]) => ({ name, value: String(value) })) });
      if (two) Object.assign(brief, { first: record.subject || "", firstLora: record.identity === "lora", second: record.subject2, secondLora: record.identity2 === "lora" });
      else Object.assign(brief, { subject: record.subject || "", lora: record.identity === "lora" });
    } else if (workflow === "change_image") {
      Object.assign(brief, { changes: record.changes || "", editOutput: record.edit_output === "edit_instruction" ? "edit_instruction" : "full_prompt", preserve: record.preserve || "" });
    } else if (workflow === "edit_prompt") {
      Object.assign(brief, { promptEditSource: record.source_prompt || "", promptEditChanges: record.changes || "" });
    } else {
      const vision = !!record.rewrite_use_vision;
      Object.assign(brief, { rewritePrompt: record.rewrite_prompt || "", rewriteVision: vision });
      brief[vision ? "rewriteVisionSystem" : "rewriteTextSystem"] = record.rewrite_system || "";
      brief[vision ? "rewriteVisionPreset" : "rewriteTextPreset"] = "";
    }
    if (record.reference) { brief.referenceMode = record.reference.mode in REFERENCE_HINTS ? record.reference.mode : "inspiration"; brief.referenceNotes = record.reference.notes || ""; }
    renderBrief(); saveBrief(); checkConnection();
    setStatus(record.reference ? "Brief restored. Select the reference image again; images are not stored." : "Brief restored. Press the button to write again.");
  }
  $("#historyBtn").addEventListener("click", openHistory);
  $("#historyClose").addEventListener("click", () => historyDialog.close());
  $("#historyFavorites").addEventListener("click", openFavorites);
  $("#queueAll").addEventListener("click", () => queueComfy(run.prompts.slice(), $("#queueAll")));

  // Saved briefs
  let savedBriefs = [];
  function updateBriefButtons() { $("#briefLoad").disabled = $("#briefDelete").disabled = !$("#briefSelect").value; }
  function renderBriefPresets(selected = "") {
    const select = $("#briefSelect");
    select.textContent = "";
    const empty = el("option", "", savedBriefs.length ? "Choose a saved brief" : "No saved briefs yet");
    empty.value = ""; select.appendChild(empty);
    for (const item of savedBriefs) { const option = el("option", "", item.name); option.value = item.name; select.appendChild(option); }
    select.value = savedBriefs.some(item => item.name === selected) ? selected : "";
    updateBriefButtons();
  }
  async function loadBriefs() {
    try { const result = await api("/api/briefs"); if (result.ok) savedBriefs = result.briefs; } catch (e) { /* stopped service */ }
    renderBriefPresets();
  }
  function assignBrief(saved) {
    for (const key of Object.keys(brief)) if (key in saved && typeof saved[key] === typeof brief[key]) brief[key] = saved[key];
    if (!Array.isArray(brief.avoid)) brief.avoid = [];
    if (!Array.isArray(brief.fixed)) brief.fixed = [];
    if (!(brief.referenceMode in REFERENCE_HINTS)) brief.referenceMode = "inspiration";
    if (!["scenes", "change_image", "rewrite", "edit_prompt"].includes(brief.workflow)) brief.workflow = "scenes";
  }
  $("#briefSelect").addEventListener("change", updateBriefButtons);
  $("#briefSave").addEventListener("click", async () => {
    const name = $("#briefName").value.trim();
    if (!name) { $("#briefStatus").textContent = "Enter a name first."; $("#briefName").focus(); return; }
    try {
      const result = await api("/api/briefs", { action: "save", name, brief: JSON.parse(JSON.stringify(brief)) });
      if (!result.ok) { $("#briefStatus").textContent = result.error; return; }
      savedBriefs = result.briefs;
      const stored = savedBriefs.find(item => item.name.toLowerCase() === name.replace(/\s+/g, " ").toLowerCase());
      renderBriefPresets(stored ? stored.name : "");
      $("#briefName").value = "";
      $("#briefStatus").textContent = `Saved “${stored ? stored.name : name}”. Reference images are not stored.`;
    } catch (e) { $("#briefStatus").textContent = "Scene Director is not running. Start it again."; }
  });
  $("#briefName").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); $("#briefSave").click(); } });
  $("#briefLoad").addEventListener("click", () => {
    const item = savedBriefs.find(entry => entry.name === $("#briefSelect").value);
    if (!item) return;
    assignBrief(item.brief); renderBrief(); saveBrief(); checkConnection();
    $("#briefStatus").textContent = `Loaded “${item.name}”.`;
    if (!run.id && !run.prompts.length) renderEmpty();
  });
  $("#briefDelete").addEventListener("click", async () => {
    const name = $("#briefSelect").value;
    if (!name || !confirm(`Delete the saved brief “${name}”?`)) return;
    try {
      const result = await api("/api/briefs", { action: "delete", name });
      if (!result.ok) { $("#briefStatus").textContent = result.error; return; }
      savedBriefs = result.briefs; renderBriefPresets(); $("#briefStatus").textContent = `Deleted “${name}”.`;
    } catch (e) { $("#briefStatus").textContent = "Scene Director is not running. Start it again."; }
  });

  // ComfyUI settings
  function fillComfyNodes(candidates) {
    const select = $("#comfyNode"), saved = conn.comfy_node ? `${conn.comfy_node}|${conn.comfy_input || "text"}` : "";
    select.textContent = "";
    const none = el("option", "", candidates ? (candidates.length ? "Choose the positive prompt input" : "No text inputs found") : "Not set. Press Detect.");
    none.value = ""; select.appendChild(none);
    let found = false;
    for (const item of candidates || []) {
      const option = el("option", "", `${item.title} · node ${item.node} · ${item.input}`);
      option.value = `${item.node}|${item.input}`; option.title = item.preview; select.appendChild(option);
      if (option.value === saved) found = true;
    }
    if (saved && !found) { const option = el("option", "", `Node ${conn.comfy_node} · ${conn.comfy_input || "text"} (saved)`); option.value = saved; select.appendChild(option); }
    select.value = saved || (candidates && candidates.length ? `${candidates[0].node}|${candidates[0].input}` : "");
  }
  $("#comfyDetect").addEventListener("click", async () => {
    const status = $("#comfyStatus");
    status.textContent = "Reading the workflow…";
    try {
      const result = await api("/api/comfy/inspect", { workflow: $("#comfyWorkflow").value.trim() });
      if (!result.ok) { status.textContent = result.error; fillComfyNodes(null); return; }
      fillComfyNodes(result.candidates);
      status.textContent = `${result.candidates.length} text input${result.candidates.length === 1 ? "" : "s"} found. Choose the positive prompt.` +
        (result.seeds ? ` ${result.seeds} seed input${result.seeds === 1 ? "" : "s"} can get a new value per prompt.` : "");
    } catch (e) { status.textContent = "Scene Director is not running. Start it again."; }
  });

  // Boot -----------------------------------------------------------------------
  if (window.sceneDirectorDesktop?.choosePresetFolder) {
    const buttons = $$("[data-choose-folder]");
    $("#folderPickerHelp").hidden = false;
    for (const button of buttons) {
      button.hidden = false;
      button.addEventListener("click", async () => {
        const field = $({ text: "#presetDir", vision: "#visionPresetDir", workflow: "#comfyWorkflow", dataset: "#dsExportFolder" }[button.dataset.chooseFolder]);
        buttons.forEach(item => { item.disabled = true; });
        try {
          const selected = await window.sceneDirectorDesktop.choosePresetFolder(button.dataset.chooseFolder, field.value);
          if (typeof selected === "string" && selected) { field.value = selected; field.dispatchEvent(new Event("input", { bubbles: true })); }
        } catch (error) {
          $("#testResult").className = "test-result err";
          $("#testResult").textContent = "Could not open the folder picker. Try again or enter the folder path.";
        } finally { buttons.forEach(item => { item.disabled = false; }); }
      });
    }
  }
  if (location.protocol === "scene-director:") {
    $("#keyHelp").textContent = "Needed when your server requires authentication, such as an LM Studio API token. Save stores it in this app's private settings folder on this Mac. It is never shown in this page again.";
  }
  async function boot() {
    loadBrief();
    renderBrief();
    renderEmpty();
    try {
      const state = await api("/api/state");
      presets = state.presets || presets;
      samplingDefaults = state.sampling_defaults || samplingDefaults;
      preciseDefaults = state.precise_defaults || preciseDefaults;
      defaultOutputDir = state.default_output_dir || "";
      Object.assign(conn, state.settings || {});
      if (!conn.output_dir) conn.output_dir = defaultOutputDir;
      await refreshPresets();
      checkConnection(); loadFavorites(); loadBriefs(); renderBarActions();
      if (state.job && !state.job.finished && state.job.workflow !== "dataset_caption") follow(state.job.id);
    } catch (e) {
      setPill("err", "Scene Director is not running");
    }
  }
  boot();
})();
