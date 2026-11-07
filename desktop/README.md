# Scene Director desktop

Version **3.9.0**. The same English Prompt Studio and LoRA Dataset interface in its own desktop window, with a bundled Python service. Image changes produce revised prompts or edit instructions; the app does not generate image files or train LoRAs.

## Downloads and installation

[Download the current release](https://github.com/cyberdeliaAI/Scene-Director/releases/tag/v3.9.0). Every archive has a SHA-256 file and a `.verification.json` report identifying the source revision and checks performed on the original and extracted app. `SHA256SUMS` covers all four downloads.

| Platform | Download | Installation |
| --- | --- | --- |
| Apple Silicon, macOS 13+ | `scene-director-3.9.0-macos-arm64.zip` | Extract and move **Scene Director.app** to Applications. |
| Intel, macOS 13+ | `scene-director-3.9.0-macos-x64.zip` | Extract and move **Scene Director.app** to Applications. |
| Windows x64 | `scene-director-3.9.0-windows-x64.zip` | Extract the whole ZIP into a folder, then open **Scene Director.exe**. Keep its resources beside it. |
| Linux x64 | `scene-director-3.9.0-linux-x64.tar.gz` | Extract the archive, open the **Scene Director** folder and run `./scene-director`. |

The Mac downloads are Developer ID signed and Apple-notarized, with stapled tickets and Gatekeeper verification. Windows and Linux downloads are not code-signed. Linux is built on Ubuntu 22.04 and needs a desktop environment with GTK 3, NSS, GBM and ALSA libraries; other distributions are not separately tested. The release checks use macOS 15, Windows Server 2022 and Ubuntu 22.04 runners; older supported Mac versions are not separately tested.

No Python, Node.js or terminal window is needed for ordinary use. A compatible local model server such as LM Studio is still required. Use a vision-capable model for image workflows and captioning. Open the connection status in Scene Director to select the server and model.

### Homebrew on macOS

```sh
brew install --cask cyberdeliaAI/apps/scene-director
```

Homebrew chooses the native Intel or Apple Silicon archive and verifies its SHA-256. Quit Scene Director before updating:

```sh
brew update
brew upgrade --cask cyberdeliaAI/apps/scene-director
```

If you installed the app manually, quit it and move the existing app aside before the first Homebrew installation. Do not use `--force` to overwrite it. The separate settings and saved work are retained.

Closing the app stops its owned local service and active generation. Finished prompts remain saved. The brief and interface choices are restored on reopening; uploaded prompt-reference images must be selected again.

## Your files

- Settings and saved API key: macOS `~/Library/Application Support/Scene Director/settings.json`; Windows `%APPDATA%/Scene Director/settings.json`; Linux `~/.config/Scene Director/settings.json` (or `$XDG_CONFIG_HOME/Scene Director`).
- Interface choices: in the app's own local browser storage, under the same platform-specific app profile.
- Default prompts folder: `Documents/Scene Director/prompts` in your home folder. Change it in Settings.
- Startup diagnostic log: `desktop.log` in that app profile. It records service lifecycle messages, not uploaded images, prompts or API keys.

These folders are outside the app bundle, so replacing the app does not replace your data. The desktop app uses separate settings from the browser edition. Existing browser-edition prompt files and settings are not moved. Enter the same server/model/output folder in desktop Settings if you want to use that setup.

## Separate LoRA dataset tool

The **LoRA Dataset** tab prepares a batch of images for training: first crop/resize/rotate/flip in **Prepare images**, then generate and edit training captions in **Caption images**. Use an optional trigger token and a character/general/style/custom caption script. The prepared crop, not the uncropped original, is sent to your selected vision model when you start captioning. Nothing is automatically sent to Rewrite a prompt.

**Export images + captions** saves a ZIP or writes to a chosen folder with prepared images and matching `.txt` captions. Captions must match the current crop; the approved-only option requires approval before export. Preparation changes mark existing captions for review, while newer manual text is protected from old model responses. Captioner JSON script import/export is compatible with CyberHub schema 1; plain `.txt` scripts and shared Vision presets also work.

The dataset session, including source image copies and manual edits, is saved locally under this app profile for recovery. Clear session removes its local copy, not your originals or exported datasets. Supported sources: PNG/JPEG/WebP, up to 100 MB and 40 megapixels each; up to 1,000 images and a 512 MB ZIP. Processed image exports are re-encoded and omit embedded metadata. The tool prepares training data; it does not train LoRAs. See the main README for detailed behavior.

## Edit a prompt

Choose **Edit a prompt** for small changes to an existing prompt. Paste **Original prompt**, describe **What should change?**, and press **Apply prompt changes**. The instructions ask the model to preserve unrelated wording, prompt syntax, tags and weights, while consistently updating necessary references such as pronouns. Removing makeup also removes contradictory cosmetics; changing a woman into a man does not request changes to hair, clothing or pose. The result is a complete English prompt saved as `prompt-edit_*.txt`. **Use as input** copies it into the source field for a follow-up edit. No image is needed or sent, and scene/LoRA/profile rules do not apply. Results depend on the selected model and should be reviewed.

## Shared presets and prompt rewriting

Choose **Rewrite a prompt** for text-to-prompt conversion. Paste an existing prompt, select a preset and review the visible system instructions. **Use an image (Vision)** enables optional image-to-prompt or image-plus-text rewriting with its own separate instructions. Text-only mode ignores attached images. The scene generator's LoRA, variety and image-model rules are not added to this workflow.

In **Settings → Shared prompt presets**, click **Choose folder…** beside each field to select your existing text and Vision preset directories. You may also type the paths directly. Choosing fills the field; **Save** applies the change. Cancelling the folder dialog preserves the previous field value. For Cyberdelia Prompt Engineer these are usually `ComfyUI/user/z_engineer/presets` and `ComfyUI/user/z_engineer/vision_presets`. Scene Director reads their UTF-8 `.txt` files directly, so both apps can use the same files. No copying or editing of those files is performed. **Load .txt** is also available for one-off imports.

**Refresh presets** updates the library, while retaining the instruction text already shown. Reselect an edited file to load its latest content. Editing the visible instructions creates a custom local copy. Built-in presets work without setting up shared folders. The app retains separate text and Vision instruction snapshots when it restarts.

## Build from source

Use a native 64-bit machine for each target, Python 3.13, Node.js 24 and the pinned build requirements. Mac signing requires Apple's command-line tools. Build dependencies are separate from the dependency-free browser edition.

```sh
python3 -m venv desktop/.venv
desktop/.venv/bin/python -m pip install -r desktop/requirements-build.txt
npm ci --prefix desktop --ignore-scripts
node desktop/node_modules/electron/install.js
npm run build:native --prefix desktop
```

On Windows use `python` and `desktop/.venv/Scripts/python` instead. Unsigned local builds go into `desktop/dist/3.9.0/`. Local Mac builds have an ad-hoc signature; release Mac builds use the required Developer ID and notarization recipe in [code-signing.md](code-signing.md). `build:mac` remains a compatibility alias.

`npm start --prefix desktop` uses the isolated venv; built apps always use their bundled backend. `SCENE_DIRECTOR_DESKTOP_DATA_DIR` and `SCENE_DIRECTOR_DESKTOP_OUTPUT_DIR` select disposable test locations. The custom PNG, macOS ICNS and Windows ICO are in `assets/` and use the same artwork.

From the repository root:

```sh
python3 -m unittest -q
node --test desktop/*.test.cjs
python3 desktop/check_source_startup.py
```

The **Native builds** workflow builds on four matching runners, checks the frozen service, interface loading, renderer isolation, clean shutdown, architecture, licenses and portable HTTPS roots, then repeats the checks after extracting the final archive. Mac checks also verify all native signatures, hardened runtime, stapled tickets and Gatekeeper. Only complete matching verification reports allow all four downloads to become release candidates. Mock services are used; live model quality and real ComfyUI workflows are not evaluated by these checks.

## Desktop architecture

Electron loads the shared interface at a stable private `scene-director://app/` origin. Its main process forwards requests to an owned loopback service using a fresh session token. The renderer has sandboxing and context isolation enabled, with Node integration, webviews, external navigation and unsolicited permissions disabled. The isolated preload exposes only fixed native folder/file pickers; requesting page, frame, window and arguments are validated. Only this app's own dataset ZIP and Captioner JSON blob downloads are allowed through the native Save dialog.

An opt-in release smoke check runs with a separate disposable profile, verifies the real interface and exits through the ordinary service shutdown path. It is inactive for ordinary launches. No API keys, prompt bodies or uploaded images are written into build reports.
