# Antigravity Enhancer

All-in-one UX and workflow enhancement suite for **Google Antigravity IDE**.

Antigravity IDE is powerful, but daily development suffers from small papercuts: broken clipboard paste, annoying modal popups when opening past chats, missing right-click menus, missing recent project chats in history, and notifications focusing the wrong window. 

**Antigravity Enhancer** patches these friction points directly into the native IDE runtime with zero performance overhead.

---

## Why You Need It

### 1. Zero-Popup Cross-Workspace Navigation
Clicking a past conversation from another workspace normally triggers a modal prompt asking where to open it. Antigravity Enhancer tracks active windows in real time and handles routing automatically:
- If the workspace is already open: switches directly to that window and focuses the conversation.
- If the workspace is closed: launches it in a fresh window with the requested conversation already loaded.
- Never interrupts your active flow with repetitive confirmation dialogs.

### 2. Native Clipboard & Selection
- Restores instant keyboard pasting (`Ctrl+V` / `Cmd+V`) and system clipboard history directly into the agent input.
- Restores full right-click context menu (**Cut**, **Copy**, **Paste**, **Select All**) across the entire chat interface.
- Ensures reliable text selection and copying (`Ctrl+C` / `Cmd+C`) from code blocks and AI responses.

### 3. Conversation Forking (Branch in New Chat)
Unlocks built-in conversation branching under every response. Click the fork button to test alternative prompts or approaches from any point in the discussion without losing your original context.

### 4. Workspace Recent Chat History (Windows Fix)
On Windows, the recent conversation history dropdown often fails to list past chats belonging to the current project due to URI encoding discrepancies (`%3A` vs `:`) and drive letter casing mismatches (`C:` vs `c:`). Antigravity Enhancer normalizes workspace paths so your project's recent chats always appear in the history list for quick access.

### 5. Multi-Window Notification Focus
When background tasks finish, clicking the desktop notification normally opens a duplicate or mismatched chat in whichever window happens to be active. This patch attaches the originating workspace URI to the notification payload, ensuring clicks immediately focus the exact window and task where the work took place.

### 6. Seamless External File Opener
Clicking binary files (`.exe`, `.msi`), Office documents (`.docx`, `.xlsx`, `.pptx`), media (`.mp4`, `.mp3`), archives (`.zip`, `.rar`, `.7z`), or creative assets (`.blend`, `.psd`) in Explorer automatically launches them with the OS default application and closes the tab instead of failing with an unsupported text encoding error.
- Shortcut: `Alt + O` (or right-click -> **Open with Default Application**).
- Configurable via `antigravity-enhancer.externalOpener.enabled` and `disabledExtensions`.

---

## Quick Start

1. Download the latest `.vsix` from [GitHub Releases](https://github.com/dangphuc2470/antigravity-enhancer/releases).
2. Open Extensions (`Ctrl + Shift + X` / `Cmd + Shift + X`) in Antigravity IDE.
3. Click More Actions (**`...`**) in the top right of the panel -> **Install from VSIX...** -> select the downloaded file.
4. Reload the window (`Ctrl + Shift + P` / `Cmd + Shift + P` -> **Developer: Reload Window**).

---

## Commands

Search **`antigravity`** in the Command Palette (`Ctrl + Shift + P` / `Cmd + Shift + P`):

| Command | Description |
|---|---|
| `Antigravity Enhancer: Apply All Enhancements & Sync Checksums` | Applies all runtime patches and syncs checksums |
| `Antigravity Enhancer: Dismiss Corrupted Warning (Sync Checksums)` | Updates `product.json` checksums without modifying code |
| `Antigravity Enhancer: Remove All Enhancements (Restore Original)` | Restores pristine backup files and original checksums |

---

## License

[MIT](LICENSE.txt) (c) 2026 dangphuc2470
