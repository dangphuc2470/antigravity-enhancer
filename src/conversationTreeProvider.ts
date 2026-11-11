import * as vscode from 'vscode';
import { ConversationManagerProvider, CachedConversation, FolderNode } from './conversationManager';

export class ConversationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly folderPath: string,
        public readonly count: number,
        public readonly folderNode?: FolderNode,
        public readonly specialType?: 'ALL' | 'CURRENT'
    ) {
        super(label, collapsibleState);

        this.description = String(count);
        this.tooltip = specialType === 'ALL'
            ? `All Conversations (${count})`
            : specialType === 'CURRENT'
                ? `Current Workspace (${count})`
                : `${folderPath} (${count})`;

        if (specialType === 'ALL') {
            this.iconPath = new vscode.ThemeIcon('archive');
            this.contextValue = 'rootAll';
        } else if (specialType === 'CURRENT') {
            this.iconPath = new vscode.ThemeIcon('zap');
            this.contextValue = 'rootCurrent';
        } else if (folderNode?.isDriveOrRoot) {
            this.iconPath = new vscode.ThemeIcon('device-hdd');
            this.contextValue = 'driveNode';
        } else {
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

export class ConversationTreeProvider implements vscode.TreeDataProvider<ConversationTreeItem> {
    private static _instance?: ConversationTreeProvider;
    public static get instance(): ConversationTreeProvider | undefined {
        return ConversationTreeProvider._instance;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<ConversationTreeItem | undefined | void> = new vscode.EventEmitter<ConversationTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ConversationTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private _conversations: CachedConversation[] = [];
    private _tree: FolderNode[] = [];
    private _currentWsCount: number = 0;

    constructor(private readonly extensionUri: vscode.Uri) {
        ConversationTreeProvider._instance = this;
        this.loadInitialData();
    }

    private loadInitialData() {
        const cached = ConversationManagerProvider.readDiskCache();
        if (cached && cached.length > 0) {
            this.refresh(cached);
        }
    }

    public refresh(conversations?: CachedConversation[]): void {
        if (conversations) {
            this._conversations = conversations;
            const res = ConversationManagerProvider.buildFolderTree(conversations, true);
            this._tree = res.rootNodes;
            this._currentWsCount = res.currentWorkspaceCount;
            this._onDidChangeTreeData.fire();
        } else {
            const cached = ConversationManagerProvider.readDiskCache();
            if (cached && cached.length > 0) {
                this.refresh(cached);
            } else {
                this._onDidChangeTreeData.fire();
            }
        }
    }

    public getTreeItem(element: ConversationTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: ConversationTreeItem): Thenable<ConversationTreeItem[]> {
        if (!element) {
            const items: ConversationTreeItem[] = [];

            // 1. All Conversations
            items.push(new ConversationTreeItem(
                'All Conversations',
                vscode.TreeItemCollapsibleState.None,
                'ALL',
                this._conversations.length,
                undefined,
                'ALL'
            ));

            // 2. Current Workspace (if open)
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                items.push(new ConversationTreeItem(
                    'Current Workspace',
                    vscode.TreeItemCollapsibleState.None,
                    'CURRENT',
                    this._currentWsCount,
                    undefined,
                    'CURRENT'
                ));
            }

            // 3. Roots from tree
            for (const root of this._tree) {
                const hasChildren = root.children && root.children.length > 0;
                items.push(new ConversationTreeItem(
                    root.name,
                    hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    root.fullPath,
                    root.totalCount,
                    root
                ));
            }

            return Promise.resolve(items);
        }

        if (element.folderNode && element.folderNode.children) {
            const children = element.folderNode.children.map(child => {
                const hasChildren = child.children && child.children.length > 0;
                return new ConversationTreeItem(
                    child.name,
                    hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    child.fullPath,
                    child.totalCount,
                    child
                );
            });
            return Promise.resolve(children);
        }

        return Promise.resolve([]);
    }
}
