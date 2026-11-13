# Scenes

A **scene** is one arrangement of layers: for example *Default*, *Focus*, *Party* or *Sleep*. The wall shows one scene at a time, and switching fades between them.

## In the editor

The **Scenes** list is at the top left. The green dot marks the scene on the wall, which is also the scene you're editing.

| Button | Does |
|---|---|
| Click a scene | Shows it on the wall |
| **New** | Empty scene |
| **Duplicate** | New scene with the same layers, **shared** (see below) |
| **Rename** / double-click | Renames the current scene |
| **Delete** | Deletes the current scene (layers shared with other scenes stay there) |

## Shared layers

The same layer can be in several scenes. That's handy for mapping: line up the shape on your AC vent once, and it stays lined up in every scene.

- **Duplicate** shares every layer with the new scene. To share a single layer, select it and use **Also show in scene…**.
- Moving, warping or changing the settings of a shared layer changes it in every scene it's in. **Visibility, lock and stacking order stay per scene**, so you can hide it in one scene, or put it on top in another.
- **Unlink** (shown under a shared layer) gives the current scene its own independent copy.
- Deleting a shared layer asks whether to remove it from this scene only, or from every scene.
- When the wall switches between two scenes that share a layer, that layer stays put; only the others fade.

## Voice and commands

| Say | Command |
|---|---|
| focus mode · switch to party scene · scene sleep | `scene.set { "name" }` (case doesn't matter; the start of a name is enough) |
| next scene · previous scene | `scene.next` · `scene.previous` (wraps around) |
| what scenes do I have | `scene.list` |

## Backups (import / export)

- **Export all** downloads `wall-YYYY-MM-DD.json` with every scene, the canvas size and the keystone.
- **Export scene** downloads just the current scene.
- **Import…** takes either file and offers:
  - **Add scenes:** adds the file's scenes next to yours. Imported layers get new ids, so they don't link with yours by accident, but layers shared *within* the file stay shared.
  - **Replace everything** (full backups only): restores the backup exactly. Undo (Ctrl+Z) works if you change your mind.

Uploaded images are stored by the wall API, so a backup refers to them by URL; it doesn't contain the image files.
