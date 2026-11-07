# Scene Director

<img src="web/app-icon.png" alt="Scene Director icon" width="96" height="96">

Give a direction. Get distinct, surprising image prompts for **Krea 2** and **Z-Image Turbo**.

Scene Director asks a local language model to invent the scenes for you. You set a subject and a direction like `jobs` or `sport`. The model picks different moments, places, clothing, framing and light for every prompt, within the limits you set. Prompts are always English, even when your brief is Dutch.

Version 3.9.0. Python 3.9 or newer. No packages to install.

Standalone desktop downloads are available for **macOS Apple Silicon**, **macOS Intel**, **Windows x64** and **Linux x64**. [Download Scene Director 3.9.0](https://github.com/cyberdeliaAI/Scene-Director/releases/tag/v3.9.0). Python is included; no Python or Node.js installation is required. Both Mac apps are Developer ID signed and Apple-notarized. Windows and Linux downloads are portable archives. See [desktop/README.md](desktop/README.md) for installation, system requirements and build instructions. The browser launchers remain available.

On macOS, Homebrew selects the matching Intel or Apple Silicon download:

```sh
brew install --cask cyberdeliaAI/apps/scene-director
```

Quit the app before upgrading. Settings, saved prompts and dataset sessions are stored outside the app and are preserved when it is replaced.

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
| Fixed choices | Optional. Lock one aspect for every prompt, like `setting = indoors`. Separate values with `\|` to rotate them evenly over the run: `framing = close-up \| medium \| full body`. |
| Prefix every prompt | Optional. Added to the start of every saved prompt, such as your LoRA trigger. The model never writes it. |
| Saved briefs | Save every field of the current workflow under a name and load it again later. Reference images are not stored. |
| Reference image | Optional. Upload a PNG, JPEG or WebP image to guide a vision-capable language model. |

You watch the model work live. First the scene ideas for the next batch appear as headings, then each prompt types itself out underneath. If the model thinks first, its thinking shows up too, with a timer that tells you how long the batch is taking. Once a batch is checked, the drafts turn into final prompts. Copy one, copy them all, or open the output folder. Ctrl+Enter (Cmd+Enter on a Mac) starts a run.

## Working with the results

Each prompt has **Copy**, **☆ Star** and, once ComfyUI is set up, **Queue in ComfyUI**. Under **More**, **Edit text** changes it by hand, **New version** writes a different scene for that slot with the same brief, **Use in Edit a prompt** opens it for a targeted edit and **Delete** removes it. Changes are saved to the run's file. Starred prompts are collected in `favorites.txt` in the output folder.

**History** lists the prompt files in the output folder. **Open** shows a run with the same actions. **Use brief** fills the form with the brief that produced it. **Open starred prompts** shows your favorites. Every run writes a `.json` file next to its `.txt` with the brief, model and generation settings. Reference images are never stored.

History and hand edits preserve complete multiline prompts. Run records also keep each prompt's selected rotating choices, so **New version** retains those choices after deletion or reopening a run. Legacy single-result edit files are read as one complete prompt.

Long runs remember all earlier scenes as short topics, and drafts that nearly repeat an earlier scene are replaced, so runs of 100 prompts or more stay varied.

## Send prompts to ComfyUI

In **Settings → ComfyUI**, enter the ComfyUI address (`http://127.0.0.1:8188` by default) and choose a workflow saved with **Export (API)** in ComfyUI. **Detect** lists the text inputs in that workflow; choose the positive prompt. Each queued prompt replaces that input. Seed inputs get a new random value per prompt unless you choose to keep the workflow's seed. **Queue all in ComfyUI** sends the whole run. ComfyUI must be running. Scene Director only queues the prompts; the images appear in ComfyUI.

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

1. **Add images**, **Add folder** or drop PNG, JPEG or WebP files onto the preview. A `.txt` file with the same name is imported as that image's caption, for review. Duplicates (same name, size and date) are skipped.
2. In **Prepare images**, draw a crop, move it, resize its corner handles, select a ratio, rotate or flip. **Undo** restores edits. Arrow keys move a focused crop by one source pixel; Shift moves ten pixels. Crop coordinates use image pixels independently of preview scale. With **Same ratio for all images** on (the default), a ratio change adjusts every existing crop around its own center. You confirm first when other crops change. Turn it off to give each image its own ratio; the dropdown then follows the selected image. Corner and edge handles resize the crop. Scroll to zoom and hold Space or Alt while dragging to pan. **Grid**, **Fit** and the keyboard shortcuts (A/F, L/R, H/V, G, 0, Ctrl/Cmd+Z, Esc, ?) are listed under **Shortcuts**. Add your own ratio, such as `7:9`, below the ratio list.
3. Choose an export size and format. **Longest side** limits the longest exported side. **Pixel area** scales to a total pixel count like training buckets: 1024 means about 1024 × 1024 pixels, so a 2:3 crop exports at 832 × 1216 when rounding to 64. **Round to a multiple of** 8 to 64 px trims a few edge pixels instead of distorting the image. Exports never enlarge a crop.
   The **Minimum size** can be width × height, longest side, shortest side or pixel area. Crops cannot be drawn or resized below it; near an edge the crop moves inward instead. Changing the minimum grows existing crops around their center where the image allows it. Images that cannot reach the minimum are marked **Too small** in the queue, skipped by Caption pending and left out of the export after a confirmation. **Remove too small** clears them from the dataset. A pixel-area minimum is checked before rounding, so 832 × 1216 still counts as a 1024 bucket.
   **1024 square** sets 1:1 crops, a 1024 longest side and a 1024 × 1024 minimum. **1024 buckets** sets free crops, a 1024 pixel area, rounding to 64 and a 1024 pixel-area minimum. Sources must be large enough for either preset.
   **Auto crop with the vision model** (experimental) asks the vision model where the face, head and shoulders, upper body, full person or main subject is. It then sets a crop with your padding, ratio and minimum, for one image or all images. Check the results; each crop can be undone.
4. Open **Caption images**. Choose a built-in script (Krea 2 Character LoRA, Krea 2 Style LoRA, Z-Image LoRA training, Character LoRA, Style LoRA, General image caption, Flux LoRA training, SDXL LoRA training, Dataset training caption or Plain visual description), a saved or shared Vision script, or custom instructions. Optionally set a trigger token, **Constant traits** that the model must leave out, and extra instructions. **Caption this image** replaces that image's caption. **Caption pending** handles missing captions, failed attempts and preparation changes. **Requests at a time** runs up to four captions in parallel when your server supports it. A failed image is marked and the batch continues; **Stop** ends the running requests.
5. Review each caption. The word count, approval state and any warnings appear under the editor. A caption that mentions a constant trait, or describes hair, eye or skin color with a character script, is flagged. **Approve** marks a model or imported caption as checked (Ctrl/Cmd+Enter approves and opens the next image). Editing a caption by hand also approves it. Preparation changes keep the text but ask for review again. **Show**, under the preview, filters the queue: without caption, to review, approved, failed, with warnings or with size problems. **Bulk edit captions** finds and replaces text, renames the trigger or adds text at the start or end of the shown captions, with one undo. **Import captions** reads `.txt` files for images already in the queue. New manual edits made during generation are protected from older model replies.
6. **Export** as a ZIP download or straight into a folder on this computer (**Choose…** in the desktop app, or type the full path). Options: original or numbered file names (`prefix_0001`), a Kohya folder such as `10_tok woman`, `metadata.jsonl` in the Hugging Face imagefolder format, `captions.csv` and **Only approved captions**. Existing files are only replaced when **Replace existing files** is on. Every exported image needs a nonempty caption for its current crop. Images that do not meet the size settings are left out after a confirmation. Duplicate stems and unsafe filename characters are handled so each image keeps its matching caption. The export uses the caption text present when export starts.

Captioning uses the model and the precise generation settings from Settings and requires a vision-capable model. Only the prepared crop is sent, resized to at most 1536 pixels on its longest side for the model. The higher-resolution dataset export follows your crop/export settings. No scene-invention, country or character-LoRA output filters are added to dataset captions. The optional trigger is added once to newly generated captions; changing scripts or the token does not automatically rewrite existing manual captions.

Expand **System script and sharing** to edit instructions or import/export a CyberHub Captioner `.captioner.json` file. The schema-1 `CyberHub` / `system_prompt` / `captioner` envelope and literal placeholders such as `{TRIGGER}` round-trip. Plain UTF-8 `.txt` imports and the configured shared Vision preset folder are supported too. `{WD_TAGS}` scripts need externally supplied tags or editing; this version does not include Auto Tagger or CyberHub's Prompt Library database. **Save as new**, **Update saved** and **Delete saved** keep your own scripts with the app settings in `caption_scripts.json`.

Source images, crop edits, settings and captions are saved in this app's local IndexedDB for recovery at the same origin/profile. **Clear session** removes this local dataset copy after confirmation; originals and exported ZIPs stay untouched. Watch the storage status and export before closing if local storage fails. Source files are read only and never overwritten. After a reload or restart, completed captions restore and unfinished images can be retried with Caption pending.

This first version supports up to 1,000 images, 100 MB per source file, 40 megapixels per decoded image and a 512 MB dataset ZIP. It uses browser image decoding/canvas processing, with EXIF orientation applied by the decoder. An unchanged full-frame image in source format at its original resolution is exported using its original bytes. Cropped, resized, rotated, flipped or converted images are re-encoded; embedded metadata is not preserved in those processed exports. JPEG uses a white background for transparency. TIFF/BMP, direct sidecar writes beside originals, CyberHub's module system and automatic training are not included.

The main workflow was checked in the Apple Silicon app with two sample images and a mock vision server: 1024-square preparation, batch captions, a manual correction, paired ZIP export, full app restart/session recovery and switching independently to Prompt Studio. The archive and the actual images sent to the mock model were independently checked. These tests verify the application flow, not caption quality from a live model.

## Edit a prompt: change only what you request

Choose **Edit a prompt** for targeted text edits, separate from preset-based rewriting and image changes.

1. Paste the complete prompt into **Original prompt**.
2. Describe **What should change?**, such as `Remove her makeup, including lipstick and eyeliner` or `Change the woman to a man`.
3. Press **Apply prompt changes**. Copy the complete result, or choose **Use as input** for another edit. The original source is retained until you replace it.

The model is instructed to make the smallest coherent edit and preserve unrelated wording, tags, weights, trigger tokens, names, camera details, formatting and scene content. Necessary references and pronouns are updated together. A gender change does not request a different hairstyle, outfit or pose. Removing makeup removes conflicting cosmetics while keeping natural skin details. Instructions can be Dutch; output is English. No image is needed or sent, even if one is retained in another workflow. The scene generator's country, identity, word-count and image-model rules do not apply.

Each run produces one result and saves it as `prompt-edit_*.txt` in the configured output folder. The model's returned line breaks are preserved. Empty replies and replies explicitly marked truncated or filtered by the server are not saved as completed edits. The tool is model-driven; review the result for unintended changes. The source prompt supports 20,000 characters; requested changes support 4,000.

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

**Settings for** switches between two profiles. **Generate scenes (creative)** uses the defaults above. **Image changes, rewrites, edits and captions (precise)** starts at temperature 0.3, top-p 0.9 and presence penalty 0, so faithful work stays close to the source. Each profile has its own Restore defaults.

**Save** applies changes to future runs and stores them in `settings.json`. A running generation keeps the values it started with. Terminal runs also use these saved generation settings. **Cancel** discards changes in the form. **Restore defaults** fills in the original values; press Save to apply them.

The two reasoning controls use different server interfaces. The default pair requests thinking off. Selecting a reasoning level or changing template thinking keeps the controls consistent; contradictory combinations are rejected by the server-side validator too. Choose **Server default** for both to omit both controls. Supported levels and whether thinking can be switched off depend on the server and model.

Only the listed sampling and reasoning fields are configurable in this section. There is no arbitrary JSON editor or editable token limit. Scene and image-change system instructions remain fixed; custom system instructions are accepted in **Rewrite a prompt** and the separate **LoRA Dataset** caption script. The backend rejects unknown generation fields and any template option other than `enable_thinking`, including requests made outside the interface. Connection, model, output-folder and shared preset-folder settings remain available.

Optional controls (`top_k`, `presence_penalty`, `reasoning_effort` and `chat_template_kwargs`) are sent together. If the server refuses them with an unsupported-request error, the app retries once without that group and shows a notice. Temperature and top-p keep their selected values. This compatibility retry is not a guarantee that the model will stop thinking.

## Output

Each run is saved as a `.txt` file with one prompt per line, in the `prompts` folder next to the app unless you choose another folder. The file name holds the image model, subject, direction and time. A `.json` file with the same name holds the brief, model, generation settings and scene ideas, for History. Starred prompts are kept in `favorites.txt` in the same folder.

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
| `web/app.js`, `web/app.css` | Prompt Studio script and styles. |
| `web/dataset.js`, `web/dataset-core.js`, `web/dataset.css` | The LoRA Dataset tool and its tested core functions. |
| `test_features.py` | Tests for the 3.9 features. |
| `settings.json` | Created when you save connection settings. Holds your API key if you saved one, so do not share it. |
| `briefs.json`, `caption_scripts.json` | Saved briefs and saved caption scripts, next to `settings.json`. |

## What changed in 3.9.0

- Separate creative and precise generation settings. Edits, rewrites, image changes and captions now default to temperature 0.3 without presence penalty.
- Prompt actions: star, edit by hand, new version, delete, use in Edit a prompt and queue in ComfyUI. History, starred prompts, saved briefs and a `.json` record for every run.
- Rotating fixed choices with `|`, a prefix for every prompt, and better variety in long runs through earlier-scene topics and near-duplicate checks.
- ComfyUI: queue one prompt or a whole run into an API workflow, with prompt-input detection and random seeds.
- Optional settings are only retried without the optional fields when the error is about them.
- LoRA Dataset cropper: edge handles, zoom and pan, grid toggle, own ratios, keyboard shortcuts, folder import with matching captions, duplicate check and experimental auto crop with the vision model.
- LoRA Dataset captions: ten built-in scripts including Krea 2 and Z-Image, constant traits with warnings, parallel requests, failures that no longer stop the batch, approval, filters, bulk edits, caption import and saved scripts.
- Dataset export to a folder, numbered names, Kohya folders, `metadata.jsonl`, `captions.csv` and an approved-only option.
- Captions run directly in the service, so captioning and Prompt Studio no longer block each other.

## What changed in 3.8.0

- Crops can no longer be drawn or resized below the minimum size. Near an edge the crop moves inward instead of shrinking.
- A ratio change applies to every image by default and adjusts each crop around its own center. Per-image ratios remain available.
- New shortest-side and pixel-area minimums, pixel-area export sizes, rounding to multiples of 8 to 64 px and a **1024 buckets** preset.
- Too-small images are flagged in the queue, skipped while captioning and left out of the export, with one-click removal.
- Reviewed captions from 3.7 stay valid as long as the default export settings are used.

## What changed in 3.7.0

- Separate **Edit a prompt** workflow for targeted text changes, with original text and change request in separate fields.
- Instructions preserve unrelated wording and syntax and handle dependent references, makeup removal and gender changes without unrelated scene invention.
- Streaming, complete-result copy/save, optional reuse for a follow-up edit, and independent saved form state.
- Retained images and scene/profile rules do not enter text editing. Incomplete model replies are rejected before saving.

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
