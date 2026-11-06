# Scene Director for Apple Silicon — test build

Version **3.7.0-beta.1**, based on Scene Director 3.7.0. A self-contained Electron app with the existing English interface and a bundled Python service. It writes prompts; image changes produce a revised prompt or edit instruction, not an edited image file.

## Install and use

Download the standalone test bundle from the [private macOS test release](https://github.com/cyberdeliaAI/Scene-Director/releases/tag/v3.7.0-beta.1). This repository also includes the desktop source and build instructions.

1. Extract `Scene_Director_3.7.0-beta.1_macOS_arm64.zip`.
2. Drag **Scene Director.app** to Applications, or open it from the extracted folder.
3. Open LM Studio, load a language model and start its local server. Use a vision-capable model for image uploads.
4. Open Scene Director and click its connection status to set the server and model. All scene, two-subject, image-reference, image-change, prompt-rewrite and sampling controls are included.

Apple Silicon (M1 or newer) and macOS 13 or newer are required. The build has been run on the development Mac; older supported macOS versions have not been tested. No separate Python, Node.js or terminal window is needed to use the app. LM Studio or another compatible model server is still required.

This is a locally ad-hoc-signed test build, not a Developer ID-signed or Apple-notarized release. macOS may require approval in **System Settings → Privacy & Security → Open Anyway** on first launch. No security settings need to be disabled.

Closing the window or choosing **Scene Director → Quit** stops the local app service and any generation still in progress. Previously finished batches stay saved. Opening the app again restores the text brief and interface choices. Uploaded images are held in memory and must be selected again.

## Your files

- Settings and saved API key: `~/Library/Application Support/Scene Director/settings.json` (readable only by your Mac account).
- Interface choices: in the app's own local browser storage, under the same Application Support folder.
- Default prompts folder: `~/Documents/Scene Director/prompts`. Change it in Settings.
- Startup diagnostic log: `~/Library/Application Support/Scene Director/desktop.log`. It records service lifecycle messages, not uploaded images, prompts or API keys.

These folders are outside the app bundle, so replacing the app does not replace your data. The desktop app uses separate settings from the browser edition. Existing browser-edition prompt files and settings are not moved. Enter the same server/model/output folder in desktop Settings if you want to use that setup.

## Separate LoRA dataset tool

The **LoRA Dataset** tab prepares a batch of images for training: first crop/resize/rotate/flip in **Prepare images**, then generate and edit training captions in **Caption images**. Use an optional trigger token and a character/general/style/custom caption script. The prepared crop, not the uncropped original, is sent to your selected vision model when you start captioning. Nothing is automatically sent to Rewrite a prompt.

**Export images + captions** opens a Save dialog for a ZIP containing prepared images and matching `.txt` captions. Every image needs a reviewed caption. Preparation changes mark existing captions for review, while newer manual text is protected from old model responses. Captioner JSON script import/export is compatible with CyberHub schema 1; plain `.txt` scripts and shared Vision presets also work.

The dataset session, including source image copies and manual edits, is saved locally under this app profile for recovery. Clear session removes its local copy, not your originals or exported datasets. Supported sources: PNG/JPEG/WebP, up to 100 MB and 40 megapixels each; up to 1,000 images and a 512 MB ZIP. Processed image exports are re-encoded and omit embedded metadata. The tool prepares training data; it does not train LoRAs. See the main README for detailed behavior.

## Edit a prompt

Choose **Edit a prompt** for small changes to an existing prompt. Paste **Original prompt**, describe **What should change?**, and press **Apply prompt changes**. The instructions ask the model to preserve unrelated wording, prompt syntax, tags and weights, while consistently updating necessary references such as pronouns. Removing makeup also removes contradictory cosmetics; changing a woman into a man does not request changes to hair, clothing or pose. The result is a complete English prompt saved as `prompt-edit_*.txt`. **Use as input** copies it into the source field for a follow-up edit. No image is needed or sent, and scene/LoRA/profile rules do not apply. Results depend on the selected model and should be reviewed.

## Shared presets and prompt rewriting

Choose **Rewrite a prompt** for text-to-prompt conversion. Paste an existing prompt, select a preset and review the visible system instructions. **Use an image (Vision)** enables optional image-to-prompt or image-plus-text rewriting with its own separate instructions. Text-only mode ignores attached images. The scene generator's LoRA, variety and image-model rules are not added to this workflow.

In **Settings → Shared prompt presets**, click **Choose folder…** beside each field to select your existing text and Vision preset directories. You may also type the paths directly. Choosing fills the field; **Save** applies the change. Cancelling the folder dialog preserves the previous field value. For Cyberdelia Prompt Engineer these are usually `ComfyUI/user/z_engineer/presets` and `ComfyUI/user/z_engineer/vision_presets`. Scene Director reads their UTF-8 `.txt` files directly, so both apps can use the same files. No copying or editing of those files is performed. **Load .txt** is also available for one-off imports.

**Refresh presets** updates the library, while retaining the instruction text already shown. Reselect an edited file to load its latest content. Editing the visible instructions creates a custom local copy. Built-in presets work without setting up shared folders. The app retains separate text and Vision instruction snapshots when it restarts.

## Build on an Apple Silicon Mac

Build tools only: Python 3.9+ with an arm64 runtime, Node.js 22.12+ and the macOS command-line tools. The checked-in lockfile pins JavaScript dependencies. The Python build uses PyInstaller 6.22.3.

From this `desktop` folder:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install pyinstaller==6.22.3
npm ci
npm run build:mac
```

Output: `dist/3.7.0-beta.1/Scene Director-darwin-arm64/Scene Director.app`.

The custom app icon is in `assets/SceneDirector.icns`, with the original PNG and generation prompt alongside it. It was generated with built-in imagegen; macOS icon sizes were exported from that artwork. The web interface uses `../web/app-icon.png`.

For source development, `npm start` uses the isolated `.venv` Python. The built `.app` always uses its bundled executable. `SCENE_DIRECTOR_DESKTOP_DATA_DIR` and `SCENE_DIRECTOR_DESKTOP_OUTPUT_DIR` can select disposable folders during testing; neither is needed for ordinary use.

Run the checks from the parent `Scene Director` folder:

```sh
python3 -m unittest -q
node --test desktop/folder-picker.test.cjs desktop/dataset.test.cjs
SCENE_DIRECTOR_TEST_BACKEND="$PWD/desktop/dist/3.7.0-beta.1/Scene Director-darwin-arm64/Scene Director.app/Contents/Resources/backend/scene-director-backend" python3 -m unittest test_desktop -q
```

Desktop integration tests cover private-session access, bundled assets, both image-model profiles, vision input, saved settings, relaunch and shutdown during generation. They use temporary profiles and fake local model servers. Actual prompt quality and model compatibility depend on your selected model and were not evaluated using a live model for this build.

## Desktop architecture

Electron loads the interface at a stable private `scene-director://app/` origin so saved interface choices survive app restarts even though the service chooses a new free port. The main process forwards interface requests to the bundled service on loopback with a fresh session token. Ordinary browsers cannot access that private service without the token. Renderer Node.js access is disabled, context isolation and sandboxing are enabled, and external navigation/new windows are blocked. Only this app's own dataset ZIP and Captioner JSON blob downloads are allowed, through the native Save dialog; the requesting window and initiator origin are checked. The page has no Node.js or general filesystem access. Its isolated preload bridge exposes only a preset-folder picker, which returns the folder explicitly selected in a native dialog. The main process validates the requesting window, main frame, page and arguments.

Implementation follows the official [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocol documentation](https://www.electronjs.org/docs/latest/api/protocol) and [PyInstaller usage documentation](https://www.pyinstaller.org/en/stable/usage.html).
