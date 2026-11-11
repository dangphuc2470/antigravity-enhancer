"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationExplorerViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const conversationManager_1 = require("./conversationManager");
class ConversationExplorerViewProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this._conversations = [];
        this._selectedFolder = 'ALL';
        this._includeSubfolders = true;
        ConversationExplorerViewProvider.currentInstance = this;
        this.loadInitialData();
    }
    loadInitialData() {
        const cached = conversationManager_1.ConversationManagerProvider.readDiskCache();
        if (cached && cached.length > 0) {
            this._conversations = cached;
        }
    }
    updateData(conversations) {
        this._conversations = conversations;
        this._sendState();
    }
    get selectedFolder() {
        return this._selectedFolder;
    }
    get includeSubfolders() {
        return this._includeSubfolders;
    }
    setSelectedFolder(folder) {
        this._selectedFolder = folder;
        this._sendState();
    }
    setIncludeSubfolders(val) {
        this._includeSubfolders = val;
        this._sendState();
    }
    async refresh() {
        if (conversationManager_1.ConversationManagerProvider.currentInstance) {
            await conversationManager_1.ConversationManagerProvider.currentInstance.reload();
        }
        else {
            const cached = conversationManager_1.ConversationManagerProvider.readDiskCache();
            if (cached && cached.length > 0) {
                this.updateData(cached);
            }
        }
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    this._sendState();
                    break;
                case 'selectFolder':
                    this._selectedFolder = message.folder || 'ALL';
                    this._sendState();
                    conversationManager_1.ConversationManagerProvider.createOrShow(this.extensionUri, this._selectedFolder);
                    break;
                case 'toggleSubfolders':
                    this._includeSubfolders = Boolean(message.value);
                    this._sendState();
                    if (conversationManager_1.ConversationManagerProvider.currentInstance) {
                        conversationManager_1.ConversationManagerProvider.currentInstance.setIncludeSubfolders(this._includeSubfolders);
                    }
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'export': {
                    const { ConversationBackupService } = require('./conversationBackup');
                    await ConversationBackupService.backupAllConversations();
                    break;
                }
                case 'import': {
                    const { ConversationBackupService } = require('./conversationBackup');
                    await ConversationBackupService.importConversations();
                    break;
                }
                case 'moveFolder':
                    await this._moveFolderConversations(message.folder);
                    break;
                case 'revealFolder':
                    if (message.folder && fs.existsSync(message.folder)) {
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(message.folder));
                    }
                    else {
                        vscode.window.showWarningMessage('Folder does not exist on disk.');
                    }
                    break;
                case 'copyPath':
                    if (message.path) {
                        await vscode.env.clipboard.writeText(message.path);
                        vscode.window.showInformationMessage(`Copied: ${message.path}`);
                    }
                    break;
            }
        });
        webviewView.onDidDispose(() => {
            this._view = undefined;
        });
    }
    async _moveFolderConversations(folderPath) {
        if (!folderPath)
            return;
        const matching = this._conversations.filter(c => conversationManager_1.ConversationManagerProvider.matchesFolder(c, folderPath.toLowerCase(), this._includeSubfolders));
        if (matching.length === 0) {
            vscode.window.showInformationMessage('No conversations found in this folder.');
            return;
        }
        const isStandalone = folderPath === 'Standalone' || folderPath === '(No Workspace)';
        const folderLabel = isStandalone ? 'Standalone' : (folderPath.split('/').filter(Boolean).pop() || folderPath);
        const currentWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? conversationManager_1.ConversationManagerProvider.normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath)
            : '';
        const knownSet = new Set();
        for (const c of this._conversations) {
            for (const w of c.workspaces) {
                if (w && w !== 'Standalone' && w !== '(No Workspace)') {
                    knownSet.add(w);
                }
            }
        }
        if (currentWs)
            knownSet.add(currentWs);
        const items = [];
        items.push({
            label: '$(symbol-misc) Standalone',
            description: 'No workspace attached',
            detail: `Convert ${matching.length} conversation(s) to standalone`
        });
        if (currentWs && currentWs.toLowerCase() !== folderPath.toLowerCase()) {
            items.push({
                label: `$(folder-active) ${path.basename(currentWs)}`,
                description: currentWs,
                detail: 'Current open workspace in editor'
            });
        }
        const otherWorkspaces = Array.from(knownSet)
            .filter(w => w.toLowerCase() !== folderPath.toLowerCase() && w !== currentWs)
            .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
        for (const ws of otherWorkspaces) {
            const exists = fs.existsSync(ws);
            items.push({
                label: `$(folder) ${path.basename(ws)}${exists ? '' : ' (orphaned)'}`,
                description: ws,
                detail: exists ? undefined : 'Folder no longer exists on disk'
            });
        }
        items.push({
            label: '$(folder-opened) Browse other folder...',
            description: 'Choose a different folder from disk...'
        });
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Move ${matching.length} conversation(s) from "${folderLabel}" to...`,
            title: `Move All Conversations in "${folderLabel}"`
        });
        if (!selected)
            return;
        let targetPath = null;
        if (selected.label.includes('Standalone')) {
            targetPath = 'STANDALONE';
        }
        else if (selected.label.includes('Browse other folder...')) {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Target Folder',
                title: `Choose Workspace Folder for ${matching.length} Conversation(s)`
            });
            if (uris && uris.length > 0) {
                targetPath = uris[0].fsPath;
            }
            else {
                return;
            }
        }
        else {
            targetPath = selected.description || selected.label;
        }
        if (!targetPath)
            return;
        for (const conv of matching) {
            if (targetPath === 'STANDALONE') {
                conv.workspaces = [];
                conv.rawWorkspaces = [];
                conv.userWorkspaces = [];
                conv.isOrphaned = false;
            }
            else {
                const norm = conversationManager_1.ConversationManagerProvider.normalizePath(targetPath);
                conv.workspaces = [norm];
                conv.rawWorkspaces = [vscode.Uri.file(targetPath).toString()];
                conv.userWorkspaces = [norm];
                conv.isOrphaned = !fs.existsSync(norm);
            }
        }
        conversationManager_1.ConversationManagerProvider.writeDiskCache(this._conversations);
        this._sendState();
        if (conversationManager_1.ConversationManagerProvider.currentInstance) {
            conversationManager_1.ConversationManagerProvider.currentInstance.updateData(this._conversations);
        }
        vscode.window.showInformationMessage(`Moved ${matching.length} conversation(s) from "${folderLabel}" to ${targetPath === 'STANDALONE' ? 'Standalone' : targetPath}`);
    }
    _sendState() {
        if (!this._view)
            return;
        const treeData = conversationManager_1.ConversationManagerProvider.buildFolderTree(this._conversations, this._includeSubfolders);
        this._view.webview.postMessage({
            type: 'state',
            tree: treeData.rootNodes,
            currentWorkspace: treeData.currentWorkspacePath,
            currentWorkspaceCount: treeData.currentWorkspaceCount,
            totalConversations: this._conversations.length,
            selectedFolder: this._selectedFolder,
            includeSubfolders: this._includeSubfolders
        });
    }
    _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conversation Explorer</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #181818);
      --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground, #cccccc));
      --muted: var(--vscode-descriptionForeground, #888888);
      --border: var(--vscode-sideBar-border, var(--vscode-widget-border, rgba(255, 255, 255, 0.08)));
      --hover-bg: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.06));
      --active-bg: var(--vscode-list-activeSelectionBackground, #04395e);
      --active-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
      --badge-bg: var(--vscode-badge-background, rgba(255, 255, 255, 0.1));
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 13px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    ::-webkit-scrollbar { width: 7px; height: 7px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.35)); }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.6)); }

    .pane-header {
      padding: 5px 8px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      user-select: none;
    }
    .pane-header-actions {
      display: flex;
      gap: 3px;
      text-transform: none;
      letter-spacing: normal;
    }
    .btn-mini {
      background: transparent;
      border: 1px solid transparent;
      color: var(--muted);
      padding: 2px 5px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .btn-mini:hover {
      background: var(--hover-bg);
      color: var(--fg);
    }
    .folder-tree {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .tree-item {
      display: flex;
      align-items: center;
      padding: 3px 8px;
      cursor: pointer;
      user-select: none;
      font-size: 12.5px;
      gap: 5px;
      line-height: 20px;
      transition: background 0.1s ease;
    }
    .tree-item:hover {
      background: var(--hover-bg);
    }
    .tree-item.active {
      background: var(--active-bg);
      color: var(--active-fg);
    }
    .tree-chevron {
      width: 14px;
      height: 14px;
      min-width: 14px;
      min-height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      opacity: 0.75;
    }
    .tree-chevron:hover { opacity: 1; }
    .tree-chevron.expanded svg {
      transform: rotate(90deg);
    }
    .tree-chevron svg {
      width: 10px;
      height: 10px;
      min-width: 10px;
      min-height: 10px;
      display: block;
      flex-shrink: 0;
    }
    .tree-icon {
      width: 14px;
      height: 14px;
      min-width: 14px;
      min-height: 14px;
      flex-shrink: 0;
      opacity: 0.9;
      display: inline-block;
    }
    .folder-icon {
      color: #e5a93c;
    }
    .drive-icon {
      color: #4daafc;
    }
    .tree-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .orphaned-tag {
      font-size: 10px;
      color: var(--vscode-editorWarning-foreground, #cca700);
      opacity: 0.85;
      font-style: italic;
      font-weight: normal;
      margin-left: 3px;
    }
    .tree-badge {
      margin-left: auto;
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 0 6px;
      border-radius: 99px;
      font-size: 10.5px;
      line-height: 16px;
      flex-shrink: 0;
      font-weight: 500;
    }
    .tree-item.active .tree-badge {
      background: rgba(255, 255, 255, 0.25);
      color: var(--active-fg);
    }
    .subfolders-toggle {
      padding: 7px 10px;
      border-top: 1px solid var(--border);
      font-size: 11.5px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      flex-shrink: 0;
      user-select: none;
    }
    .subfolders-toggle input, .subfolders-toggle label { cursor: pointer; }
    .context-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 9998;
      display: none;
    }
    .context-menu {
      position: fixed;
      z-index: 9999;
      background: var(--vscode-menu-background, #252526);
      color: var(--vscode-menu-foreground, #cccccc);
      border: 1px solid var(--vscode-menu-border, #454545);
      border-radius: 5px;
      padding: 4px 0;
      min-width: 175px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.45);
      display: none;
      font-size: 11.5px;
      user-select: none;
    }
    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 5px 12px;
      cursor: pointer;
    }
    .context-menu-item:hover {
      background: var(--vscode-menu-selectionBackground, #04395e);
      color: var(--vscode-menu-selectionForeground, #ffffff);
    }
    .context-menu-item svg {
      width: 14px;
      height: 14px;
      opacity: 0.85;
      flex-shrink: 0;
    }
    .context-menu-item:hover svg {
      opacity: 1;
    }
    .context-menu-separator {
      height: 1px;
      background: var(--vscode-menu-separatorBackground, #454545);
      margin: 4px 0;
    }
  </style>
</head>
<body>
  <div class="pane-header">
    <div class="pane-header-actions left">
      <button class="btn-mini" id="btnImport" title="Import conversations from .zip archive">Import</button>
      <button class="btn-mini" id="btnExport" title="Export all conversations to .zip archive">Export</button>
    </div>
    <div class="pane-header-actions right">
      <button class="btn-mini" id="btnExpandAll" title="Expand All">Expand</button>
      <button class="btn-mini" id="btnCollapseAll" title="Collapse All">Collapse</button>
      <button class="btn-mini" id="btnRefresh" title="Refresh conversations">Refresh</button>
    </div>
  </div>
  <div class="folder-tree" id="folderTree"></div>
  <div class="subfolders-toggle">
    <input type="checkbox" id="chkSubfolders" checked>
    <label for="chkSubfolders">Include subfolders recursively</label>
  </div>
  <div class="context-backdrop" id="contextBackdrop"></div>
  <div class="context-menu" id="treeContextMenu"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let state = {
      tree: [],
      currentWorkspace: '',
      currentWorkspaceCount: 0,
      totalConversations: 0,
      selectedFolder: 'ALL',
      includeSubfolders: true,
      expandedFolders: new Set()
    };

    function escapeHtml(s) {
      if (!s) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderFolderTree() {
      const container = document.getElementById('folderTree');
      if (!container) return;

      const isAll = state.selectedFolder === 'ALL';
      let html = '<div class="tree-item ' + (isAll ? 'active' : '') + '" style="padding-left:8px" data-folder="ALL">' +
        '<span class="tree-chevron"></span>' +
        '<svg class="tree-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:#e5a93c"><path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3V4h10v8zM5 6h6v1H5V6zm0 3h6v1H5V9z"/></svg>' +
        '<span class="tree-label">All Conversations</span>' +
        '<span class="tree-badge">' + (state.totalConversations || 0) + '</span>' +
        '</div>';

      if (state.currentWorkspace) {
        const isCur = state.selectedFolder === 'CURRENT';
        html += '<div class="tree-item ' + (isCur ? 'active' : '') + '" style="padding-left:8px" data-folder="CURRENT">' +
          '<span class="tree-chevron"></span>' +
          '<svg class="tree-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.251.068a.5.5 0 0 1 .42.58L10.477 6.5H14a.5.5 0 0 1 .372.832l-9.5 10.5a.5.5 0 0 1-.84-.528l1.2-5.804H1.5a.5.5 0 0 1-.372-.832l9.5-10.5a.5.5 0 0 1 .623-.1z"/></svg>' +
          '<span class="tree-label">Current Workspace</span>' +
          '<span class="tree-badge">' + (state.currentWorkspaceCount || 0) + '</span>' +
          '</div>';
      }

      function renderNode(node, depth) {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = state.expandedFolders.has(node.fullPath);
        const isSel = state.selectedFolder.toLowerCase() === node.fullPath.toLowerCase();
        const indent = depth * 12;
        const escapedPath = escapeHtml(node.fullPath);
        const count = state.includeSubfolders ? node.totalCount : node.directCount;

        let iconSvg = '';
        if (node.fullPath === 'Standalone' || node.fullPath === '(No Workspace)') {
          iconSvg = '<svg class="tree-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--muted);"><path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3V4h10v8z"/></svg>';
        } else if (node.isDriveOrRoot) {
          iconSvg = '<svg class="tree-icon drive-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 3H3V4h10v2zm1 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1zm-1 3H3v-2h10v2z"/></svg>';
        } else if (hasChildren && isExpanded) {
          iconSvg = '<svg class="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 14h10.23a1.5 1.5 0 0 0 1.41-1l2-5.5A1.5 1.5 0 0 0 13.73 5.5H7.71l-.85-.85L6.51 4h-5l-.5.5v9l.5.5zm1-8.5h3.79l.86.85.35.15H13.73a.5.5 0 0 1 .47.67l-2 5.5a.5.5 0 0 1-.47.33H2.5v-7.5z"/></svg>';
        } else {
          iconSvg = '<svg class="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 10H2V3h4.29l.86.85.35.15H14v9z"/></svg>';
        }

        const orphanedBadge = node.isOrphaned ? ' <span class="orphaned-tag">(orphaned)</span>' : '';

        let out = '<div class="tree-item ' + (isSel ? 'active' : '') + '" style="padding-left:' + (indent + 8) + 'px" data-folder="' + escapedPath + '">' +
          '<span class="tree-chevron ' + (isExpanded ? 'expanded' : '') + '" ' + (hasChildren ? 'data-toggle="' + escapedPath + '"' : '') + '>' +
          (hasChildren ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5l5 4.5-5 4.5V3.5z"/></svg>' : '') +
          '</span>' +
          iconSvg +
          '<span class="tree-label" title="' + escapedPath + '">' + escapeHtml(node.name) + orphanedBadge + '</span>' +
          '<span class="tree-badge">' + count + '</span>' +
          '</div>';

        if (hasChildren && isExpanded) {
          for (const child of node.children) {
            out += renderNode(child, depth + 1);
          }
        }
        return out;
      }

      for (const root of state.tree) {
        html += renderNode(root, 0);
      }

      container.innerHTML = html;
    }

    document.getElementById('folderTree').addEventListener('click', e => {
      const toggleEl = e.target.closest('[data-toggle]');
      if (toggleEl) {
        e.stopPropagation();
        const p = toggleEl.getAttribute('data-toggle');
        if (state.expandedFolders.has(p)) {
          state.expandedFolders.delete(p);
        } else {
          state.expandedFolders.add(p);
        }
        renderFolderTree();
        return;
      }

      const itemEl = e.target.closest('.tree-item');
      if (itemEl) {
        const folder = itemEl.getAttribute('data-folder');
        if (folder) {
          state.selectedFolder = folder;
          renderFolderTree();
          vscode.postMessage({ type: 'selectFolder', folder });
        }
      }
    });

    document.getElementById('chkSubfolders').addEventListener('change', e => {
      state.includeSubfolders = e.target.checked;
      renderFolderTree();
      vscode.postMessage({ type: 'toggleSubfolders', value: state.includeSubfolders });
    });

    document.getElementById('btnExpandAll').addEventListener('click', () => {
      function expand(node) {
        state.expandedFolders.add(node.fullPath);
        if (node.children) node.children.forEach(expand);
      }
      state.tree.forEach(expand);
      renderFolderTree();
    });

    document.getElementById('btnCollapseAll').addEventListener('click', () => {
      state.expandedFolders.clear();
      renderFolderTree();
    });

    document.getElementById('btnRefresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('btnImport').addEventListener('click', () => {
      vscode.postMessage({ type: 'import' });
    });

    document.getElementById('btnExport').addEventListener('click', () => {
      vscode.postMessage({ type: 'export' });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'state') {
        state = { ...state, ...msg };
        if (state.expandedFolders.size === 0 && Array.isArray(state.tree)) {
          for (const r of state.tree) {
            state.expandedFolders.add(r.fullPath);
          }
        }
        document.getElementById('chkSubfolders').checked = Boolean(state.includeSubfolders);
        renderFolderTree();
      }
    });

    let currentContextMenuFolder = null;
    const treeContextMenu = document.getElementById('treeContextMenu');
    const contextBackdrop = document.getElementById('contextBackdrop');

    function hideContextMenu() {
      if (treeContextMenu) treeContextMenu.style.display = 'none';
      if (contextBackdrop) contextBackdrop.style.display = 'none';
      currentContextMenuFolder = null;
    }

    if (contextBackdrop) {
      contextBackdrop.addEventListener('click', hideContextMenu);
      contextBackdrop.addEventListener('contextmenu', e => {
        e.preventDefault();
        hideContextMenu();
      });
    }

    document.addEventListener('click', () => hideContextMenu());
    window.addEventListener('blur', () => hideContextMenu());

    document.addEventListener('contextmenu', e => {
      e.preventDefault();
      const itemEl = e.target.closest('.tree-item');
      if (!itemEl) {
        hideContextMenu();
        return;
      }

      const folder = itemEl.getAttribute('data-folder');
      if (!folder) {
        hideContextMenu();
        return;
      }

      currentContextMenuFolder = folder;
      const isAll = folder === 'ALL';
      const isCurrent = folder === 'CURRENT';
      const isStandalone = folder === 'Standalone' || folder === '(No Workspace)';

      let menuHtml = '';
      if (!isAll && !isCurrent) {
        menuHtml += '<div class="context-menu-item" data-action="move">' +
          '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 10H2V3h4.29l.86.85.35.15H14v9z"/></svg>' +
          '<span>Move All to Folder...</span>' +
          '</div>';

        if (!isStandalone) {
          menuHtml += '<div class="context-menu-item" data-action="reveal">' +
            '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 14h10.23a1.5 1.5 0 0 0 1.41-1l2-5.5A1.5 1.5 0 0 0 13.73 5.5H7.71l-.85-.85L6.51 4h-5l-.5.5v9l.5.5zm1-8.5h3.79l.86.85.35.15H13.73a.5.5 0 0 1 .47.67l-2 5.5a.5.5 0 0 1-.47.33H2.5v-7.5z"/></svg>' +
            '<span>Reveal in File Explorer</span>' +
            '</div>';
          menuHtml += '<div class="context-menu-item" data-action="copyPath">' +
            '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h7v1H4V4zm0 3h7v1H4V7zm0 3h5v1H4v-1zm9-8H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm0 13H3V3h10v12z"/></svg>' +
            '<span>Copy Path</span>' +
            '</div>';
        }
        menuHtml += '<div class="context-menu-separator"></div>';
      }

      menuHtml += '<div class="context-menu-item" data-action="expandAll">' +
        '<span>Expand All</span>' +
        '</div>';
      menuHtml += '<div class="context-menu-item" data-action="collapseAll">' +
        '<span>Collapse All</span>' +
        '</div>';
      menuHtml += '<div class="context-menu-item" data-action="refresh">' +
        '<span>Refresh</span>' +
        '</div>';

      treeContextMenu.innerHTML = menuHtml;
      treeContextMenu.style.display = 'block';
      if (contextBackdrop) contextBackdrop.style.display = 'block';

      const menuWidth = 180;
      const menuHeight = 150;
      let posX = e.clientX;
      let posY = e.clientY;

      if (posX + menuWidth > window.innerWidth) {
        posX = Math.max(4, window.innerWidth - menuWidth - 6);
      }
      if (posY + menuHeight > window.innerHeight) {
        posY = Math.max(4, window.innerHeight - menuHeight - 6);
      }

      treeContextMenu.style.left = posX + 'px';
      treeContextMenu.style.top = posY + 'px';
    });

    treeContextMenu.addEventListener('click', e => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.getAttribute('data-action');
      const folder = currentContextMenuFolder;
      hideContextMenu();

      if (action === 'move' && folder) {
        vscode.postMessage({ type: 'moveFolder', folder });
      } else if (action === 'reveal' && folder) {
        vscode.postMessage({ type: 'revealFolder', folder });
      } else if (action === 'copyPath' && folder) {
        vscode.postMessage({ type: 'copyPath', path: folder });
      } else if (action === 'expandAll') {
        document.getElementById('btnExpandAll').click();
      } else if (action === 'collapseAll') {
        document.getElementById('btnCollapseAll').click();
      } else if (action === 'refresh') {
        vscode.postMessage({ type: 'refresh' });
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}
exports.ConversationExplorerViewProvider = ConversationExplorerViewProvider;
ConversationExplorerViewProvider.viewType = 'antigravity.conversationExplorer';
