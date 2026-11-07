"""Read Z-Engineer-compatible UTF-8 .txt presets without modifying the library."""

from pathlib import Path

MAX_PRESET_BYTES = 64 * 1024

TEXT_DEFAULT = """Rewrite the user's image prompt into clear, fluent English. Preserve the supplied subjects, identities, actions, relationships, setting, medium, framing, lighting, colors and explicit technical details. Improve clarity, spatial coherence and the order of visible details. Resolve obvious redundancy without redesigning the scene or adding unsupported people, props, locations or styling. Preserve intentionally specified text and names. Do not impose a new occupation or physical identity. Respect deliberate unusual compositions and all explicit constraints. Use the amount of detail the original scene needs; do not pad the prompt. Output exactly one finished image prompt as a continuous paragraph, without preamble, headings, Markdown, quotation marks, explanations or alternatives."""

COMPOSITION_DEFAULT = """Repair the composition of the user's image prompt while preserving its intended content. Make subject placement, scale, viewpoint, framing, gaze, pose, occlusion, foreground, background and the focal point consistent with one another. Preserve deliberate symmetry, negative space, off-center framing and unusual crops. Use one primary action per subject. Remove only redundant or contradictory details; do not redesign the scene, change the medium or invent new subjects, props, weather or narrative. Preserve the requested light sources and their direction, explicit appearance, colors, names, text, lens and aperture values. Write in English as one continuous paragraph, beginning with the subject and action. Output only the corrected prompt, with no heading, explanation, alternatives or JSON."""

VISION_DEFAULT = """Use the attached image as the visual basis for one faithful image-generation prompt. If the user provides text, treat it as instructions for the intended result: apply requested changes and preserve other visible details. If the text is an existing prompt, reconcile it with the image while prioritizing explicit requested changes. Describe the main subjects, visible appearance, action, arrangement, setting, viewpoint, framing, medium, palette and lighting. Do not invent unseen details or identify a real person. Avoid speculative backstory and generic quality slogans. With no text, describe the image faithfully. Write in English as one continuous paragraph. Output only the final image prompt without a preamble, heading, Markdown, explanation, alternatives or JSON."""


def _directory(directory, kind, warnings):
    if not directory:
        return []
    try:
        root = Path(directory).expanduser().resolve()
        if not root.is_dir():
            warnings.append(f"{kind.title()} preset folder is unavailable: {directory}")
            return []
        presets = []
        for path in sorted(root.glob("*.txt"), key=lambda item: item.name.casefold()):
            try:
                resolved = path.resolve()
                if resolved.parent != root or not resolved.is_file():
                    warnings.append(f"Skipped {path.name}: file links must stay in the preset folder.")
                    continue
                with resolved.open("rb") as stream:
                    raw = stream.read(MAX_PRESET_BYTES + 1)
                if len(raw) > MAX_PRESET_BYTES:
                    warnings.append(f"Skipped {path.name}: presets must be at most 64 KB.")
                    continue
                prompt = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").strip()
                if not prompt:
                    warnings.append(f"Skipped {path.name}: the preset is empty.")
                    continue
                presets.append({"id": kind + ":" + path.name, "name": path.stem,
                                "prompt": prompt, "source": "shared"})
            except (OSError, UnicodeError, ValueError, RuntimeError):
                warnings.append(f"Skipped {path.name}: could not read a UTF-8 text file.")
        return presets
    except (OSError, ValueError, RuntimeError):
        warnings.append(f"Could not read the {kind} preset folder: {directory}")
        return []


def list_presets(settings):
    warnings = []
    return {
        "ok": True,
        "text": [{"id": "builtin:faithful", "name": "Faithful rewrite", "prompt": TEXT_DEFAULT, "source": "builtin"},
                 {"id": "builtin:composition", "name": "Composition repair", "prompt": COMPOSITION_DEFAULT, "source": "builtin"}]
                + _directory(settings.get("preset_dir", ""), "text", warnings),
        "vision": [{"id": "builtin:vision", "name": "Faithful image rewrite", "prompt": VISION_DEFAULT, "source": "builtin"}]
                  + _directory(settings.get("vision_preset_dir", ""), "vision", warnings),
        "warnings": warnings,
    }
