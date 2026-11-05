# Scene Director

<img src="web/app-icon.png" alt="Scene Director icon" width="96" height="96">

Give a direction. Get distinct, surprising image prompts for **Krea 2** and **Z-Image Turbo**.

Scene Director asks a local language model to invent the scenes for you. You set a subject and a direction like `jobs` or `sport`. The model picks different moments, places, clothing, framing and light for every prompt, within the limits you set. Prompts are always English, even when your brief is Dutch.

Version 3.6.0. Python 3.9 or newer. No packages to install.

An experimental **Electron app for Apple Silicon** is available, version 3.6.0-beta.1. [Download the macOS test app](https://github.com/cyberdeliaAI/Scene-Director/releases/tag/v3.6.0-beta.1) from this private repository's Releases page. It includes Python and opens in its own Mac window. Apple Silicon and macOS 13 or newer are required. See [desktop/README.md](desktop/README.md) for installation, storage locations and build instructions. Source is included here; compiled apps are attached to releases. The browser launchers continue to work as before.

## Quick start with LM Studio

1. Open LM Studio and load a chat model. Qwen3.5 9B is the tested default. A non-thinking (instruct) model is fastest.
2. Open the **Developer** tab and start the server. It runs at `http://localhost:1234`.
3. Start Scene Director:
   - **macOS:** double-click `Start Scene Director.command`. The first time, macOS may block it: right-click it, choose Open, then Open again.
   - **Windows:** double-click `Start Scene Director.bat`.
   - **Linux or terminal:** run `python3 scene_director.py`.
4. Your browser opens the interface. The status at the top shows which model is connected. Click it to change the server, the model or the output folder.

Keep the small terminal window open while you work. Close it, or press Ctrl+C in it, to quit.

### Thinking models

Some models think before they answer. Scene Director asks the server to switch thinking off. LM Studio does not always honor that. If a model thinks anyway, it can spend its whole token budget before writing a single prompt. Scene Director then stops with a clear message. Switch thinking off for that model in LM Studio, or load an instruct model, and try again.

## The interface

| Field | What it does |
| --- | --- |
| Workflow | Generate scenes invents new scenes. Change an image writes a targeted revision from an uploaded source image. |
| Image model | Picks the writing profile: Krea 2 or Z-Image Turbo. |
| Who is in the scene | One subject, or two subjects in one shared moment. A word is enough: `woman`, `an old fisherman`, `a border collie`. |
| Character LoRA | On when you use a character LoRA. Prompts leave stable physical identity to the LoRA while allowing expression, gaze, clothing and posture. Incidental background people may be obscured; both explicitly requested subjects stay visible. |
| How they relate | Two subjects only. Optional. Blank lets the model invent a fitting connection. |
| Direction | Broad or specific. `jobs` gives a different occupation in every prompt. `night-shift nurse` keeps every prompt on that. |
| How many prompts | Written in batches of five. Every batch is saved right away. |
| Surprise level | Grounded, balanced or adventurous. Adventurous stays believable. It never turns into fantasy unless you ask. |
| Visual style | Optional. Blank lets the model choose, leaning to believable photography for everyday subjects. |
| Extra wishes | Optional. Plain language that applies to every prompt. |
| Never show | Optional. Things that must not appear. |
| Fixed choices | Optional. Lock one aspect for every prompt, like `setting = indoors` or `framing = full body`. |
| Reference image | Optional. Upload a PNG, JPEG or WebP image to guide a vision-capable language model. |

You watch the model work live. First the scene ideas for the next batch appear as headings, then each prompt types itself out underneath. If the model thinks first, its thinking shows up too, with a timer that tells you how long the batch is taking. Once a batch is checked, the drafts turn into final prompts. Copy one, copy them all, or open the output folder. Ctrl+Enter (Cmd+Enter on a Mac) starts a run.

## How the prompts are written

Both profiles write one paragraph of natural sentences per prompt, usually 100 to 180 words (140 to 220 with two subjects). No tags, weights, quality slogans or negatives. Every prompt follows the same hard rules:

- Describe visible image content. Express atmosphere through color, light, space and gesture rather than sounds, smells or remarks about the viewer.
- One coherent activity per subject. Supporting movements are allowed; unrelated simultaneous tasks and incompatible poses are avoided.
- Use plausible lighting where it helps a realistic scene; illustrations and graphic artwork can use color, shading and visual structure without camera terminology.
- No place names, brands, logos or readable text.

**Krea 2** gets one clear visual treatment per scene, with medium, light and material carrying the look.
**Z-Image Turbo** gets objective, concrete descriptions with clear layout. It honors supplied appearance and consistency choices without forcing a new identity for each scene. Appearance details fit the kind of subject; human identity instructions are not imposed on animals or objects.

Broad work directions (`jobs`, `occupations`, `beroepen`) explore different real occupations. A narrow direction such as `working as a night-shift nurse` keeps that role in every prompt and varies unspecified moments and compositions. A reference to work in extra wishes, an exclusion or a phrase such as `exercise after work` does not turn an unrelated direction into a jobs brief. Specific choices take priority over generic variety guidance.

Scene Director also checks every draft. Drafts that describe a LoRA character's hair or looks, mention LoRAs, or contain detected non-visual narration are replaced. Individual sentences are never deleted automatically: they may contain an essential subject or interaction. Replacement feedback asks the model to preserve both subjects and their activities. Exact duplicates are skipped. Checks catch specific patterns; they are not a complete semantic or visual validator. Mixed LoRA/free scenes rely on the per-subject identity instructions to distinguish whose appearance may be described.

## LoRA Dataset: separate image preparation and captioning tool

Use the **LoRA Dataset** tool tab for training-dataset preparation. It has its own image queue, crop edits, scripts and captions; nothing is automatically sent to Prompt Studio or Rewrite a prompt. It does not train a LoRA.

1. **Add images** or drop multiple PNG, JPEG or WebP files onto the preview.
2. In **Prepare images**, draw a crop, move it, resize its corner handles, select a ratio, rotate or flip. **Undo** restores edits. Arrow keys move a focused crop by one source pixel; Shift moves ten pixels. Crop coordinates use image pixels independently of preview scale.
3. Choose an export size and format. Maximum side never enlarges the crop. Optional minimum width/height or longest-side constraints block captioning/export when not met. **1024 square** sets a 1:1 crop, 1024-pixel maximum and 1024 × 1024 minimum; sources must be large enough.
4. Open **Caption images**. Choose Character LoRA, General image caption, Style LoRA, a shared Vision script, or custom instructions. Optionally set a trigger token and extra caption instructions. **Caption this image** replaces that image's caption; **Caption pending** handles missing captions and preparation changes, one image at a time. **Stop batch** stops the current model worker and prevents further images from starting.
5. Review and edit each caption. Preparation changes keep its existing text but mark it for review. Edit it, regenerate it or explicitly choose **Mark reviewed for this crop**. New manual edits made during generation are protected from older model replies.
6. **Export images + captions** creates one ZIP with prepared images and matching UTF-8 `.txt` files. Every queued image must have a reviewed, nonempty caption. Remove images you do not want. Duplicate stems and unsafe filename characters are handled so each image keeps its matching caption. The export uses the caption text present when export starts.

Captioning uses the model and sampling controls from Settings and requires a vision-capable model. Only the prepared crop is sent, resized to at most 1536 pixels on its longest side for the model. The higher-resolution dataset export follows your crop/export settings. No scene-invention, country or character-LoRA output filters are added to dataset captions. The optional trigger is added once to newly generated captions; changing scripts or the token does not automatically rewrite existing manual captions.

Expand **System script and sharing** to edit instructions or import/export a CyberHub Captioner `.captioner.json` file. The schema-1 `CyberHub` / `system_prompt` / `captioner` envelope and literal placeholders such as `{TRIGGER}` round-trip. Plain UTF-8 `.txt` imports and the configured shared Vision preset folder are supported too. `{WD_TAGS}` scripts need externally supplied tags or editing; this version does not include Auto Tagger or CyberHub's Prompt Library database.

Source images, crop edits, settings and captions are saved in this app's local IndexedDB for recovery at the same origin/profile. **Clear session** removes this local dataset copy after confirmation; originals and exported ZIPs stay untouched. Watch the storage status and export before closing if local storage fails. Source files are read only and never overwritten. A running caption request can be recovered while the service remains alive; after an app restart, completed captions restore and unfinished images can be retried with Caption pending.

This first version supports up to 1,000 images, 100 MB per source file, 40 megapixels per decoded image and a 512 MB dataset ZIP. It uses browser image decoding/canvas processing, with EXIF orientation applied by the decoder. An unchanged full-frame image in source format at its original resolution is exported using its original bytes. Cropped, resized, rotated, flipped or converted images are re-encoded; embedded metadata is not preserved in those processed exports. JPEG uses a white background for transparency. TIFF/BMP, direct sidecar writes beside originals, CyberHub's module system and automatic training are not included.

The main workflow was checked in the Apple Silicon app with two sample images and a mock vision server: 1024-square preparation, batch captions, a manual correction, paired ZIP export, full app restart/session recovery and switching independently to Prompt Studio. The archive and the actual images sent to the mock model were independently checked. These tests verify the application flow, not caption quality from a live model.

## Rewrite a prompt

Choose **Rewrite a prompt** for a separate prompt-to-prompt workflow. Paste one existing prompt, select a system-prompt preset, review its complete instructions and press **Rewrite prompt**. One result is streamed, copied and saved like other prompts. This workflow sends the displayed instructions directly as the system message and your text as the user message. It does not add the scene workflow's subject, LoRA, country, job, variety, word-count or image-model profiles. A preset can therefore preserve names, physical appearance, weighted tags or a short output when appropriate. The instructions determine the target model/style; the Krea 2 / Z-Image Turbo profile controls apply to the other workflows.

Enable **Use an image (Vision)** to use a source image with separate Vision instructions. Text can describe changes, provide an existing prompt, or stay empty for image-to-prompt. A vision-capable model is required. Turning Vision off ignores an attached image and uses the text-only instructions, including for automatic model selection. Text and Vision remember their own selected preset and instruction snapshot.

### Use the same preset files as Z-Engineer

The shared-library format matches [Cyberdelia Prompt Engineer's system and Vision presets](https://github.com/cyberdeliaAI/comfyui-cyberdelia-z-engineer#system-and-vision-presets): one UTF-8 `.txt` file per preset, filename as label, up to 64 KB. In **Settings → Shared prompt presets**, use **Choose folder…** beside each field in the desktop app, or enter the full paths to the existing folders, typically:

```text
/path/to/ComfyUI/user/z_engineer/presets
/path/to/ComfyUI/user/z_engineer/vision_presets
```

Save, then use **Refresh presets**. You can also point to the package's `presets` / `vision_presets` folders, or to another library folder; Z-Engineer must be able to access those same files through its preset folders if you want it to see them too. Scene Director reads the selected directories directly without copying, renaming, modifying or deleting their files. Only direct `.txt` children are listed; external file symlinks, invalid UTF-8, empty files and files over 64 KB are skipped with a notice. The ComfyUI server does not need to be running to read these files.

Selecting a preset copies its full instructions into the visible **System instructions** field. You may edit this local copy or paste your own instructions; it becomes **Custom instructions**. **Load .txt** imports a one-off file without setting up a shared folder. This copy is remembered in the brief, so an external file change cannot silently change the next run. Refresh discovers new/edited files but preserves the displayed instructions; reselect the changed file to load its latest text. The previous output remains visible until you start another run.

Built-in **Faithful rewrite**, **Composition repair** and **Faithful image rewrite** presets work without a shared folder. Source text is limited to 20 KB and system instructions to 64 KB. Rewrites save as `prompt-rewrite_text_…txt` or `prompt-rewrite_vision_…txt`, one result per line. The final response is preserved as one result rather than being split into multiple scene prompts; outer code fences and reasoning blocks are removed and whitespace is flattened for this file format. Empty responses produce an error, not an exported empty prompt. Presets influence an LLM; they are not a guarantee of perfect content preservation.

## Change an image

Choose **Change an image** under Workflow for targeted changes instead of scene invention. **Source image** appears directly below the workflow selector, before the model and change controls. Drop one image into the upload box or click the box to browse, then enter what should change, for example:

`Change her hair to auburn and make her shoes navy blue. Keep everything else unchanged.`

The dedicated instruction preserves unrequested subjects, appearance, pose, clothing, setting, framing, lighting and medium. Changing hair color should preserve hairstyle and face; changing shoe color should preserve the shoes' shape and the outfit. If a replacement value is left open, the LLM chooses a coherent alternative for that attribute only. Add optional **Keep unchanged** notes to emphasize priorities. Unclear targets, invisible details or contradictory requests can produce a clarification error rather than an invented edit.

| Output | Use |
| --- | --- |
| Full revised prompt | A standalone description of the intended final image, incorporating your changes. Use it to recreate the scene in a text-to-image model. |
| Edit instruction | A shorter instruction naming the exact changes and preserving the rest. Use it with the original image in an image-editing model. |

One result is written per run. The scene workflow's subject counts, occupations, surprise settings, fixed choices and LoRA identity filters do not apply here; deliberate appearance edits such as hair color are allowed. Both workflows share the uploaded image while the tab is open, but keep their text controls separate. Switching workflows does not change a run already in progress; the workflow selector is disabled until it finishes.

This app produces text, not an edited image file. A full text prompt can describe the intended scene but does not guarantee pixel-exact preservation when regenerating it. For an actual targeted image edit, use the **Edit instruction** and source image in an editor that supports image editing. A vision-capable LLM is required to inspect the source image in either output mode.

## Reference images for scene generation

Expand **Reference image**, drop one PNG, JPEG or WebP image of up to 5 MB into the box (or click to browse), and choose how it should guide the prompts:

| Mode | What the LLM takes from the image |
| --- | --- |
| Inspiration | A few distinctive visible qualities, with freedom to invent substantially different scenes. |
| Composition | Framing, viewpoint, relative positions and the use of space. |
| Style and lighting | Medium, palette, textures and the treatment of light. |
| Scene basis | The visible activity, setting and arrangement, for close scene variations. |

Add optional notes such as `Keep the side view and warm window light; invent different occupations.` Your typed subjects, direction, fixed choices, exclusions and LoRA settings take priority. If Direction is blank, the reference becomes the scene direction. An image does not change the requested number of principal subjects or override a protected character's identity. Each resulting prompt describes the selected qualities explicitly, so it can be used without attaching the reference to the image generator.

The selected language model must support image input. Settings labels known vision and text-only models. Automatic selects a loaded vision model when the server reports one. Known text-only models are refused for image runs; when capability information is unavailable, the app tries the request and reports server errors. With LM Studio, load a vision-language model and any vision adapter it requires. Other servers must support image content in the compatible chat-completions API.

The preview appears before you start. **Write** sends the image to your selected model server with the brief for each batch. The app holds it in this tab and the running process; it does not save the upload in settings, browser storage or prompt files. Mode and notes can be remembered, but the image must be selected again after a reload. **Remove image** returns future runs to text-only input. A run already started keeps the image it started with.

This remains a prompt-writing tool: it does not directly run Krea 2 or Z-Image Turbo, edit the uploaded image or apply an image-to-image strength setting.

## Generation settings

Click the connection status at the top to open **Settings**, then expand **Generation settings**. These controls apply to the language model that writes your prompts, not to image generation in Krea 2 or Z-Image Turbo.

| Editable control | Default | App validation |
| --- | --- | --- |
| Temperature | 0.8 | Finite number from 0 to 2 |
| Top-p | 0.95 | Greater than 0, up to 1 |
| Top-k | 20 | Whole number from 1 to 1000 |
| Presence penalty | 0.6 | Finite number from -2 to 2 |
| Reasoning effort | None | Server default, none, minimal, low, medium, high, xhigh or max |
| Template thinking | Off | Server default, off or on |

**Save** applies changes to future runs and stores them in `settings.json`. A running generation keeps the values it started with. Terminal runs also use these saved generation settings. **Cancel** discards changes in the form. **Restore defaults** fills in the original values; press Save to apply them.

The two reasoning controls use different server interfaces. The default pair requests thinking off. Selecting a reasoning level or changing template thinking keeps the controls consistent; contradictory combinations are rejected by the server-side validator too. Choose **Server default** for both to omit both controls. Supported levels and whether thinking can be switched off depend on the server and model.

Only the listed sampling and reasoning fields are configurable in this section. There is no arbitrary JSON editor or editable token limit. Scene and image-change system instructions remain fixed; custom system instructions are accepted in **Rewrite a prompt** and the separate **LoRA Dataset** caption script. The backend rejects unknown generation fields and any template option other than `enable_thinking`, including requests made outside the interface. Connection, model, output-folder and shared preset-folder settings remain available.

Optional controls (`top_k`, `presence_penalty`, `reasoning_effort` and `chat_template_kwargs`) are sent together. If the server refuses them with an unsupported-request error, the app retries once without that group and shows a notice. Temperature and top-p keep their selected values. This compatibility retry is not a guarantee that the model will stop thinking.

## Output

Each run is saved as a `.txt` file with one prompt per line, in the `prompts` folder next to the app unless you choose another folder. The file name holds the image model, subject, direction and time.

## Other servers

Any OpenAI-compatible server works. Click the connection status, choose **Ollama** (`http://localhost:11434/v1`) or **Other**, and enter the address including `/v1`. An API key is only needed when your server asks for one, for example when authentication is on in LM Studio. Save stores it in `settings.json` next to the app, readable only by your user account on macOS and Linux. The page never shows it again: leave the field blank to keep it, paste a new one to replace it, or click Forget the saved key. Terminal runs use the saved key too.

## Terminal use

```
python3 scene_director.py woman jobs 10
python3 scene_director.py woman jobs 10 --target z-image-turbo
python3 scene_director.py woman jobs 10 --subject2 man --interaction "colleagues sharing a task"
python3 scene_director.py woman sport 10 --subject2 man --identity free --identity2 free
python3 scene_director.py person "quiet daily moments" 8 -p "setting=indoors" --avoid rain --avoid cafes
python3 scene_director.py woman jobs 5 --live
python3 scene_director.py woman jobs 5 --reference-image reference.jpg --reference-mode composition --reference-notes "Keep the side view"
python3 scene_director.py --workflow change_image --reference-image photo.jpg --changes "Change her hair to auburn and her shoes to navy blue" --edit-output edit_instruction
python3 scene_director.py --interactive
python3 scene_director.py --list-models
python3 scene_director.py woman jobs 3 --dry-run
python3 scene_director.py --help
```

`--live` shows the model's raw output in the terminal while it writes. `--dry-run` prints the full instructions and brief without contacting a server. The environment variables `SCENE_DIRECTOR_API_URL`, `SCENE_DIRECTOR_API_KEY` and `SCENE_DIRECTOR_MODEL` set defaults. The older `KREA_*` names still work.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Cannot reach http://localhost:1234" | Start the server in LM Studio's Developer tab. |
| "The server refused access (error 401)" | Your server needs an API key. Click the connection status, paste the key and press Save. |
| "LM Studio has no model loaded" | Load a chat model in LM Studio, or pick one under the connection settings so LM Studio loads it. |
| "The model spent its whole token budget thinking" | Switch thinking off for that model in LM Studio, or use an instruct model. |
| Repeated empty or malformed replies | Try another model, a broader direction or fewer fixed choices. |
| "No free port found" | Start with another port: `python3 scene_director.py --port 8790`. |
| The browser does not open | Open the address printed in the terminal window yourself. |

## Files

| File | Purpose |
| --- | --- |
| `scene_director.py` | The engine and the terminal commands. |
| `scene_director_web.py` | The local web server behind the interface. Listens on 127.0.0.1 only. |
| `web/index.html` | The interface. |
| `web/fonts/` | Archivo and Courier Prime, both under the SIL Open Font License. |
| `Start Scene Director.command` / `.bat` / `start_scene_director.sh` | Launchers for macOS, Windows and Linux. |
| `test_scene_director.py` | Tests. Run `python3 -m unittest` in this folder. |
| `settings.json` | Created when you save connection settings. Holds your API key if you saved one, so do not share it. |

## What changed in 3.6.0

- Added an independent **LoRA Dataset** workspace with crop/resize preparation and batch training captions.
- Added editable captions, trigger tokens, caption-script sharing, local session recovery and paired ZIP export.
- Kept Prompt Studio and the existing folder selectors separate and available.

## What changed in 3.5.1

- Added native **Choose folder…** selectors beside both shared preset-folder fields in the Electron app. Selection fills the field; Save applies it. Cancelling preserves the existing path.
- Browser users can continue entering folder paths directly.

## What changed in 3.5.0

- Added the separate **Rewrite a prompt** workflow, with one prompt in and one result out.
- Added compatible shared text and Vision `.txt` preset folders, full visible instructions, local custom edits, one-off imports and explicit refresh/reselect behavior.
- Added optional Vision input with its own instructions. Text-only rewriting ignores attached images and all scene-invention rules.
- Updated the Apple Silicon Electron test build. Existing settings and older release archives are preserved.

## What changed in 3.4.1

- Source image is first after the workflow selector in Change an image. Switching workflows moves the same upload control, retaining the current image.
- Drag-and-drop upload box with click-to-browse, keyboard access, drag highlighting and the same file validation for both input methods.

## What changed in 3.4.0

- Separate Change an image workflow with requested changes, optional preservation notes and a required source image.
- Dedicated revision instructions preserve the unrequested scene and allow deliberate appearance edits independently of scene LoRA controls.
- Choose a full revised prompt or a concise edit instruction. Each run saves one text result; image files are not edited by this app.

## What changed in 3.3.0

- Optional reference-image upload with a preview, removal control, four guidance modes and free-form notes.
- Image content is sent alongside the brief to a vision-capable LLM, including subsequent batches and compatibility retries.
- Vision capability detection for current and legacy LM Studio model lists, with compatible-server fallback and clear text-only model errors.
- Validated image formats and a 5 MB limit. Uploads are not written into settings, progress events or prompt files.

## What changed in 3.2.0

- Validated sampling and reasoning controls in Settings, with defaults, persistence and a reset button. Only the listed generation fields are accepted.
- LoRA background rules no longer hide a requested second subject. Stable identity and temporary expression are distinguished.
- Specific occupations remain fixed; incidental work references no longer trigger the work theme.
- Z-Image Turbo no longer forces appearance changes. Both profiles support natural writing order and medium-appropriate visual descriptions.
- Non-visual drafts are replaced instead of deleting sentences that might contain an essential subject or interaction.

To upgrade, use the new app files in your existing Scene Director folder while keeping your `settings.json` and `prompts` folder. Settings created by 3.1.1 continue to work; the new controls start at their defaults.

## What changed in 3.1.1

- The API key is saved with the connection settings and used for every run, also from the terminal. A refused key gets a clear message.
- Enter in the connection window saves.

## What changed in 3.1

- Live view: the model's reply is streamed, so you see the scene ideas, the prompts being written and any thinking as it happens. Servers that do not stream still work.
- `--live` for the same view in the terminal.

## What changed in 3.0

- New name and a browser interface with help and examples for every field. It works the same on macOS, Windows and Linux.
- LM Studio is the default server. Loaded models are detected, thinking is switched off where the server allows it, and a thinking model that writes nothing gets a clear message.
- Tighter instructions: one action per subject, a named light source, only visible detail, no unrequested drama.
- Work rules only apply to work directions.
- Character LoRA mode keeps extra people out of focus. Z-Image Turbo without a LoRA varies faces.
- Non-visual sentences are removed automatically. The model's short scene summaries, not full prompts, are used to avoid repeats, so long runs fit small context windows.

## Sources for the writing profiles

- Krea 2 prompting guide: https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md
- Krea 2 expansion prompt: https://github.com/krea-ai/krea-2/blob/main/docs/expansion.txt
- Z-Image Turbo prompt enhancer: https://huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo/blob/main/pe.py
