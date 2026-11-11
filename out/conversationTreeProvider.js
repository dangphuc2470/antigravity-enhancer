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
exports.ConversationTreeProvider = exports.ConversationTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const conversationManager_1 = require("./conversationManager");
class ConversationTreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, folderPath, count, folderNode, specialType) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.folderPath = folderPath;
        this.count = count;
        this.folderNode = folderNode;
        this.specialType = specialType;
        this.description = String(count);
        this.tooltip = specialType === 'ALL'
            ? `All Conversations (${count})`
            : specialType === 'CURRENT'
                ? `Current Workspace (${count})`
                : `${folderPath} (${count})`;
        if (specialType === 'ALL') {
            this.iconPath = new vscode.ThemeIcon('archive');
            this.contextValue = 'rootAll';
        }
        else if (specialType === 'CURRENT') {
            this.iconPath = new vscode.ThemeIcon('zap');
            this.contextValue = 'rootCurrent';
        }
        else if (folderNode?.isDriveOrRoot) {
            this.iconPath = new vscode.ThemeIcon('device-hdd');
            this.contextValue = 'driveNode';
        }
        else {
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'folderNode';
        }
        this.command = {
            command: 'antigravity.selectConversationFolder',
            title: 'Open in Conversation Manager',
            arguments: [folderPath]
        };
    }
}
exports.ConversationTreeItem = ConversationTreeItem;
class ConversationTreeProvider {
    static get instance() {
        return ConversationTreeProvider._instance;
    }
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._conversations = [];
        this._tree = [];
        this._currentWsCount = 0;
        ConversationTreeProvider._instance = this;
        this.loadInitialData();
    }
    loadInitialData() {
        const cached = conversationManager_1.ConversationManagerProvider.readDiskCache();
        if (cached && cached.length > 0) {
            this.refresh(cached);
        }
    }
    refresh(conversations) {
        if (conversations) {
            this._conversations = conversations;
            const res = conversationManager_1.ConversationManagerProvider.buildFolderTree(conversations, true);
            this._tree = res.rootNodes;
            this._currentWsCount = res.currentWorkspaceCount;
            this._onDidChangeTreeData.fire();
        }
        else {
            const cached = conversationManager_1.ConversationManagerProvider.readDiskCache();
            if (cached && cached.length > 0) {
                this.refresh(cached);
            }
            else {
                this._onDidChangeTreeData.fire();
            }
        }
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            const items = [];
            // 1. All Conversations
            items.push(new ConversationTreeItem('All Conversations', vscode.TreeItemCollapsibleState.None, 'ALL', this._conversations.length, undefined, 'ALL'));
            // 2. Current Workspace (if open)
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                items.push(new ConversationTreeItem('Current Workspace', vscode.TreeItemCollapsibleState.None, 'CURRENT', this._currentWsCount, undefined, 'CURRENT'));
            }
            // 3. Roots from tree
            for (const root of this._tree) {
                const hasChildren = root.children && root.children.length > 0;
                items.push(new ConversationTreeItem(root.name, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, root.fullPath, root.totalCount, root));
            }
            return Promise.resolve(items);
        }
        if (element.folderNode && element.folderNode.children) {
            const children = element.folderNode.children.map(child => {
                const hasChildren = child.children && child.children.length > 0;
                return new ConversationTreeItem(child.name, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, child.fullPath, child.totalCount, child);
            });
            return Promise.resolve(children);
        }
        return Promise.resolve([]);
    }
}
exports.ConversationTreeProvider = ConversationTreeProvider;
