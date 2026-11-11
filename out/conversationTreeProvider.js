"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationExplorerViewProvider = void 0;
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
    setSelectedFolder(folder) {
        this._selectedFolder = folder;
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
            }
        });
        webviewView.onDidDispose(() => {
            this._view = undefined;
        });
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
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--muted);
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
  </style>
</head>
<body>
  <div class="pane-header">
    <span>Explorer</span>
    <div class="pane-header-actions">
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
        if (node.isDriveOrRoot) {
          iconSvg = '<svg class="tree-icon drive-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 3H3V4h10v2zm1 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1zm-1 3H3v-2h10v2z"/></svg>';
        } else if (hasChildren && isExpanded) {
          iconSvg = '<svg class="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 14h10.23a1.5 1.5 0 0 0 1.41-1l2-5.5A1.5 1.5 0 0 0 13.73 5.5H7.71l-.85-.85L6.51 4h-5l-.5.5v9l.5.5zm1-8.5h3.79l.86.85.35.15H13.73a.5.5 0 0 1 .47.67l-2 5.5a.5.5 0 0 1-.47.33H2.5v-7.5z"/></svg>';
        } else {
          iconSvg = '<svg class="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 10H2V3h4.29l.86.85.35.15H14v9z"/></svg>';
        }

        let out = '<div class="tree-item ' + (isSel ? 'active' : '') + '" style="padding-left:' + (indent + 8) + 'px" data-folder="' + escapedPath + '">' +
          '<span class="tree-chevron ' + (isExpanded ? 'expanded' : '') + '" ' + (hasChildren ? 'data-toggle="' + escapedPath + '"' : '') + '>' +
          (hasChildren ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5l5 4.5-5 4.5V3.5z"/></svg>' : '') +
          '</span>' +
          iconSvg +
          '<span class="tree-label" title="' + escapedPath + '">' + escapeHtml(node.name) + '</span>' +
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

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}
exports.ConversationExplorerViewProvider = ConversationExplorerViewProvider;
ConversationExplorerViewProvider.viewType = 'antigravity.conversationExplorer';
