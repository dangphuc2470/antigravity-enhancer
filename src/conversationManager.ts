import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import * as crypto from 'crypto';

export interface CachedConversation {
    id: string;
    title: string;
    workspaces: string[];
    rawWorkspaces: string[];
    userWorkspaces?: string[];
    isOrphaned?: boolean;
    source?: 'ide' | 'app' | 'both';
    lastModifiedTime: number;
    createdTime: number;
    stepCount: number;
    userMsgs: number;
    modelMsgs: number;
    toolCalls: number;
    estInputTokens: number;
    estOutputTokens: number;
    estThinkingTokens: number;
    estTotalTokens: number;
    cumulativeTokens: number;
    modelName?: string;
    parentConversationId?: string;
    hasTranscript: boolean;
    firstMessageSnippet: string;
    searchableContent: string;
    mtimeMs: number;
    size: number;
}

export interface FolderNode {
    id: string;
    name: string;
    fullPath: string;
    directCount: number;
    totalCount: number;
    children: FolderNode[];
    isDriveOrRoot?: boolean;
    isOrphaned?: boolean;
}

interface DiskCachePayload {
    version: number;
    items: CachedConversation[];
}

export class ConversationManagerProvider {
    public static currentPanel: vscode.WebviewPanel | undefined;
    public static currentInstance: ConversationManagerProvider | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _conversations: CachedConversation[] = [];
    private _selectedFolder: string = 'ALL';
    private _includeSubfolders: boolean = true;
    private _selectedId: string | null = null;
    private _searchQuery: string = '';
    private _searchMode: 'all' | 'title' | 'content' | 'path' = 'all';
    private _sortBy: 'recent' | 'oldest' | 'messages' | 'tokens' | 'traffic' | 'steps' = 'recent';

    private static readonly CACHE_VERSION = 8;
    public static readonly CACHE_FILE = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'enhancer_conversations_cache.json');

    public static createOrShow(extensionUri: vscode.Uri, initialFolder?: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConversationManagerProvider.currentPanel) {
            ConversationManagerProvider.currentPanel.reveal(column);
            if (initialFolder && ConversationManagerProvider.currentInstance) {
                ConversationManagerProvider.currentInstance.selectFolder(initialFolder);
            } else {
                ConversationManagerProvider.currentPanel.webview.postMessage({ type: 'refreshRequest' });
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'antigravityConversationManager',
            'Conversation Manager',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        ConversationManagerProvider.currentPanel = panel;
        ConversationManagerProvider.currentInstance = new ConversationManagerProvider(panel, extensionUri, initialFolder);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialFolder?: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        if (initialFolder) {
            this._selectedFolder = initialFolder;
        } else {
            try {
                const { ConversationExplorerViewProvider } = require('./conversationTreeProvider');
                const exp = ConversationExplorerViewProvider.currentInstance;
                if (exp && exp.selectedFolder) {
                    this._selectedFolder = exp.selectedFolder;
                }
            } catch (_) {}
        }

        try {
            const { ConversationExplorerViewProvider } = require('./conversationTreeProvider');
            const exp = ConversationExplorerViewProvider.currentInstance;
            if (exp && typeof exp.includeSubfolders === 'boolean') {
                this._includeSubfolders = exp.includeSubfolders;
            }
        } catch (_) {}

        this._updateHtml();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'ready':
                    case 'refresh':
                        await this._loadConversations();
                        break;
                    case 'selectFolder':
                        this._selectedFolder = message.folder || 'ALL';
                        this._sendState();
                        break;
                    case 'toggleSubfolders':
                        this._includeSubfolders = Boolean(message.value);
                        this._sendState();
                        break;
                    case 'selectConversation':
                        this._selectedId = message.id || null;
                        if (this._selectedId) {
                            await this._sendDetail(this._selectedId);
                        }
                        break;
                    case 'search':
                        this._searchQuery = message.query || '';
                        this._searchMode = message.mode || 'all';
                        this._sendFilteredList();
                        break;
                    case 'sort':
                        this._sortBy = message.sortBy || 'recent';
                        this._sendFilteredList();
                        break;
                    case 'openInChat':
                        await this._openInChat(message.id);
                        break;
                    case 'openTranscriptLog':
                        await this._openTranscriptLog(message.id);
                        break;
                    case 'requestRename':
                        await this._requestRename(message.id, message.oldTitle);
                        break;
                    case 'rename':
                        await this._renameConversation(message.id, message.newTitle);
                        break;
                    case 'copy':
                        await vscode.env.clipboard.writeText(message.text || '');
                        vscode.window.showInformationMessage(`Copied to clipboard: ${message.text}`);
                        break;
                    case 'delete':
                        await this._deleteConversation(message.id);
                        break;
                    case 'moveConversation':
                        await this._moveConversation(message.id);
                        break;
                    case 'exportMd':
                        await this._exportConversationToMarkdown(message.id);
                        break;
                    case 'openTrafficReport':
                        await this._openTrafficReport();
                        break;
                    case 'export':
                    case 'backup': {
                        const { ConversationBackupService } = require('./conversationBackup');
                        await ConversationBackupService.backupAllConversations();
                        break;
                    }
                    case 'import': {
                        const { ConversationBackupService } = require('./conversationBackup');
                        await ConversationBackupService.importConversations();
                        break;
                    }
                    case 'forkConversation':
                        await this._forkConversation(message.id, message.stepIndex);
                        break;
                    case 'sync':
                        await ConversationManagerProvider.syncConversations();
                        break;
                    case 'syncSingleConversation':
                        if (typeof message.id === 'string') {
                            await ConversationManagerProvider.syncSingleConversation(message.id);
                        }
                        break;
                }
            },
            null,
            this._disposables
        );

        this._loadConversations();
    }

    public dispose() {
        ConversationManagerProvider.currentPanel = undefined;
        ConversationManagerProvider.currentInstance = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    public selectFolder(folder: string) {
        this._selectedFolder = folder || 'ALL';
        this._sendState();
        try {
            const { ConversationExplorerViewProvider } = require('./conversationTreeProvider');
            ConversationExplorerViewProvider.currentInstance?.setSelectedFolder(this._selectedFolder);
        } catch (_) {}
    }

    public setIncludeSubfolders(val: boolean) {
        this._includeSubfolders = val;
        this._sendState();
    }

    public selectConversation(id: string) {
        this._selectedId = id;
        this._sendState();
    }

    public async reload() {
        await this._loadConversations();
    }

    public updateData(conversations: CachedConversation[]) {
        this._conversations = conversations;
        this._sendState();
        if (this._selectedId) {
            this._sendDetail(this._selectedId);
        }
    }

    private async _openTrafficReport() {
        const { TrafficReportPanel } = require('./trafficReportPanel');
        TrafficReportPanel.createOrShow(this._extensionUri, this._conversations);
    }

    public static normalizePath(uriOrPath: string): string {
        try {
            let s = decodeURIComponent(uriOrPath || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
            if (/^file:\/\/\/[a-zA-Z]:/i.test(s)) {
                s = s.slice(8);
            } else if (s.startsWith('file://')) {
                s = s.slice(7);
            }
            s = s.replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
            if (/^[a-zA-Z]:/.test(s)) {
                s = s.charAt(0).toUpperCase() + s.slice(1);
            } else if (!s.startsWith('/') && !s.startsWith('(')) {
                s = '/' + s;
            }
            while (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1);
            return s;
        } catch {
            let s = String(uriOrPath || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
            if (/^[a-zA-Z]:/.test(s)) {
                s = s.charAt(0).toUpperCase() + s.slice(1);
            } else if (!s.startsWith('/') && !s.startsWith('(')) {
                s = '/' + s;
            }
            while (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1);
            return s;
        }
    }

    private _normalizePath(uriOrPath: string): string {
        return ConversationManagerProvider.normalizePath(uriOrPath);
    }

    public static getTranscriptPath(id: string, preferFull: boolean = false): { path: string; source: 'ide' | 'app' } | null {
        const ideBase = path.join(os.homedir(), '.gemini', 'antigravity-ide');
        const appBase = path.join(os.homedir(), '.gemini', 'antigravity');

        const ideFull = path.join(ideBase, 'brain', id, '.system_generated', 'logs', 'transcript_full.jsonl');
        const ideRegular = path.join(ideBase, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
        const appFull = path.join(appBase, 'brain', id, '.system_generated', 'logs', 'transcript_full.jsonl');
        const appRegular = path.join(appBase, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');

        let ideFile: string | null = null;
        if (preferFull && fs.existsSync(ideFull)) ideFile = ideFull;
        else if (fs.existsSync(ideRegular)) ideFile = ideRegular;
        else if (fs.existsSync(ideFull)) ideFile = ideFull;

        let appFile: string | null = null;
        if (preferFull && fs.existsSync(appFull)) appFile = appFull;
        else if (fs.existsSync(appRegular)) appFile = appRegular;
        else if (fs.existsSync(appFull)) appFile = appFull;

        if (ideFile && appFile) {
            try {
                const ideStat = fs.statSync(ideFile);
                const appStat = fs.statSync(appFile);
                if (appStat.size > ideStat.size) {
                    return { path: appFile, source: 'app' };
                }
            } catch {}
            return { path: ideFile, source: 'ide' };
        } else if (ideFile) {
            return { path: ideFile, source: 'ide' };
        } else if (appFile) {
            return { path: appFile, source: 'app' };
        }
        return null;
    }

    public static detectConversationSource(id: string): 'ide' | 'app' | 'both' {
        const ideBase = path.join(os.homedir(), '.gemini', 'antigravity-ide');
        const appBase = path.join(os.homedir(), '.gemini', 'antigravity');

        const inIde = fs.existsSync(path.join(ideBase, 'brain', id)) ||
                      fs.existsSync(path.join(ideBase, 'conversations', `${id}.db`));
        const inApp = fs.existsSync(path.join(appBase, 'brain', id)) ||
                      fs.existsSync(path.join(appBase, 'conversations', `${id}.db`));

        if (inIde && inApp) return 'both';
        if (inApp) return 'app';
        return 'ide';
    }

    public static async syncConversations(): Promise<{ syncedToIde: number; syncedToApp: number; updated: number }> {
        const ideBase = path.join(os.homedir(), '.gemini', 'antigravity-ide');
        const appBase = path.join(os.homedir(), '.gemini', 'antigravity');

        const ideBrain = path.join(ideBase, 'brain');
        const appBrain = path.join(appBase, 'brain');
        const ideConv = path.join(ideBase, 'conversations');
        const appConv = path.join(appBase, 'conversations');

        if (!fs.existsSync(ideBrain)) fs.mkdirSync(ideBrain, { recursive: true });
        if (!fs.existsSync(appBrain)) fs.mkdirSync(appBrain, { recursive: true });
        if (!fs.existsSync(ideConv)) fs.mkdirSync(ideConv, { recursive: true });
        if (!fs.existsSync(appConv)) fs.mkdirSync(appConv, { recursive: true });

        const allIds = new Set<string>();

        // Collect IDs from IDE
        if (fs.existsSync(ideBrain)) {
            for (const f of fs.readdirSync(ideBrain)) {
                if (f !== 'tempmediaStorage' && !f.startsWith('.')) allIds.add(f);
            }
        }
        if (fs.existsSync(ideConv)) {
            for (const f of fs.readdirSync(ideConv)) {
                if (f.endsWith('.db')) allIds.add(f.replace('.db', ''));
            }
        }

        // Collect IDs from App
        if (fs.existsSync(appBrain)) {
            for (const f of fs.readdirSync(appBrain)) {
                if (f !== 'tempmediaStorage' && !f.startsWith('.')) allIds.add(f);
            }
        }
        if (fs.existsSync(appConv)) {
            for (const f of fs.readdirSync(appConv)) {
                if (f.endsWith('.db')) allIds.add(f.replace('.db', ''));
            }
        }

        const stats = { syncedToIde: 0, syncedToApp: 0, updated: 0 };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Syncing conversations between IDE and Standalone App...',
            cancellable: false
        }, async progress => {
            const idList = Array.from(allIds);
            let processed = 0;

            for (const id of idList) {
                processed++;
                progress.report({
                    message: `Checking ${processed}/${idList.length}: ${id.slice(0, 8)}...`,
                    increment: (1 / (idList.length || 1)) * 100
                });

                const srcIdeBrain = path.join(ideBrain, id);
                const srcAppBrain = path.join(appBrain, id);
                const hasIdeBrain = fs.existsSync(srcIdeBrain);
                const hasAppBrain = fs.existsSync(srcAppBrain);

                const srcIdeDb = path.join(ideConv, `${id}.db`);
                const srcAppDb = path.join(appConv, `${id}.db`);
                const hasIdeDb = fs.existsSync(srcIdeDb);
                const hasAppDb = fs.existsSync(srcAppDb);

                // Case 1: In IDE only -> copy to App
                if ((hasIdeBrain || hasIdeDb) && !hasAppBrain && !hasAppDb) {
                    if (hasIdeBrain) {
                        try {
                            fs.cpSync(srcIdeBrain, srcAppBrain, { recursive: true });
                        } catch {}
                    }
                    if (hasIdeDb) {
                        for (const ext of ['.db', '.db-shm', '.db-wal']) {
                            const sf = path.join(ideConv, `${id}${ext}`);
                            const df = path.join(appConv, `${id}${ext}`);
                            if (fs.existsSync(sf)) {
                                try { fs.copyFileSync(sf, df); } catch {}
                            }
                        }
                    }
                    stats.syncedToApp++;
                    continue;
                }

                // Case 2: In App only -> copy to IDE
                if ((hasAppBrain || hasAppDb) && !hasIdeBrain && !hasIdeDb) {
                    if (hasAppBrain) {
                        try {
                            fs.cpSync(srcAppBrain, srcIdeBrain, { recursive: true });
                        } catch {}
                    }
                    if (hasAppDb) {
                        for (const ext of ['.db', '.db-shm', '.db-wal']) {
                            const sf = path.join(appConv, `${id}${ext}`);
                            const df = path.join(ideConv, `${id}${ext}`);
                            if (fs.existsSync(sf)) {
                                try { fs.copyFileSync(sf, df); } catch {}
                            }
                        }
                    }
                    stats.syncedToIde++;
                    continue;
                }

                // Case 3: Both exist -> compare and update
                let updated = false;

                const ideLog = path.join(srcIdeBrain, '.system_generated', 'logs', 'transcript.jsonl');
                const appLog = path.join(srcAppBrain, '.system_generated', 'logs', 'transcript.jsonl');
                const ideLogFull = path.join(srcIdeBrain, '.system_generated', 'logs', 'transcript_full.jsonl');
                const appLogFull = path.join(srcAppBrain, '.system_generated', 'logs', 'transcript_full.jsonl');

                if (fs.existsSync(ideLog) && fs.existsSync(appLog)) {
                    try {
                        const ideSize = fs.statSync(ideLog).size;
                        const appSize = fs.statSync(appLog).size;
                        if (ideSize > appSize + 32) {
                            fs.copyFileSync(ideLog, appLog);
                            if (fs.existsSync(ideLogFull)) fs.copyFileSync(ideLogFull, appLogFull);
                            updated = true;
                        } else if (appSize > ideSize + 32) {
                            fs.copyFileSync(appLog, ideLog);
                            if (fs.existsSync(appLogFull)) fs.copyFileSync(appLogFull, ideLogFull);
                            updated = true;
                        }
                    } catch {}
                } else if (fs.existsSync(ideLog) && !fs.existsSync(appLog)) {
                    const logDir = path.dirname(appLog);
                    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                    try {
                        fs.copyFileSync(ideLog, appLog);
                        if (fs.existsSync(ideLogFull)) fs.copyFileSync(ideLogFull, appLogFull);
                        updated = true;
                    } catch {}
                } else if (!fs.existsSync(ideLog) && fs.existsSync(appLog)) {
                    const logDir = path.dirname(ideLog);
                    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                    try {
                        fs.copyFileSync(appLog, ideLog);
                        if (fs.existsSync(appLogFull)) fs.copyFileSync(appLogFull, ideLogFull);
                        updated = true;
                    } catch {}
                }

                // Copy missing DB files
                if (hasIdeDb && !hasAppDb) {
                    for (const ext of ['.db', '.db-shm', '.db-wal']) {
                        const sf = path.join(ideConv, `${id}${ext}`);
                        const df = path.join(appConv, `${id}${ext}`);
                        if (fs.existsSync(sf)) {
                            try { fs.copyFileSync(sf, df); } catch {}
                        }
                    }
                    updated = true;
                } else if (!hasIdeDb && hasAppDb) {
                    for (const ext of ['.db', '.db-shm', '.db-wal']) {
                        const sf = path.join(appConv, `${id}${ext}`);
                        const df = path.join(ideConv, `${id}${ext}`);
                        if (fs.existsSync(sf)) {
                            try { fs.copyFileSync(sf, df); } catch {}
                        }
                    }
                    updated = true;
                }

                if (updated) stats.updated++;
            }
        });

        if (ConversationManagerProvider.currentInstance) {
            await ConversationManagerProvider.currentInstance._loadConversations();
            ConversationManagerProvider.currentInstance._sendState();
        }

        vscode.window.showInformationMessage(
            `Sync complete: ${stats.syncedToApp} copied to App, ${stats.syncedToIde} copied to IDE, ${stats.updated} updated.`
        );

        return stats;
    }

    public static async syncSingleConversation(id: string): Promise<boolean> {
        try {
            const ideBase = path.join(os.homedir(), '.gemini', 'antigravity-ide');
            const appBase = path.join(os.homedir(), '.gemini', 'antigravity');

            const ideBrain = path.join(ideBase, 'brain', id);
            const appBrain = path.join(appBase, 'brain', id);
            const ideConvDir = path.join(ideBase, 'conversations');
            const appConvDir = path.join(appBase, 'conversations');

            const hasIdeBrain = fs.existsSync(ideBrain);
            const hasAppBrain = fs.existsSync(appBrain);
            const hasIdeDb = fs.existsSync(path.join(ideConvDir, `${id}.db`));
            const hasAppDb = fs.existsSync(path.join(appConvDir, `${id}.db`));

            if (!hasIdeBrain && !hasIdeDb && !hasAppBrain && !hasAppDb) {
                vscode.window.showWarningMessage(`No conversation data found on disk for ${id}.`);
                return false;
            }

            // Sync from IDE to App if missing in App
            if ((hasIdeBrain || hasIdeDb) && !hasAppBrain && !hasAppDb) {
                if (hasIdeBrain) {
                    if (!fs.existsSync(path.dirname(appBrain))) fs.mkdirSync(path.dirname(appBrain), { recursive: true });
                    fs.cpSync(ideBrain, appBrain, { recursive: true });
                }
                if (hasIdeDb) {
                    if (!fs.existsSync(appConvDir)) fs.mkdirSync(appConvDir, { recursive: true });
                    for (const ext of ['.db', '.db-shm', '.db-wal']) {
                        const sf = path.join(ideConvDir, `${id}${ext}`);
                        const df = path.join(appConvDir, `${id}${ext}`);
                        if (fs.existsSync(sf)) {
                            try { fs.copyFileSync(sf, df); } catch {}
                        }
                    }
                }
            } else if ((hasAppBrain || hasAppDb) && !hasIdeBrain && !hasIdeDb) {
                // Sync from App to IDE if missing in IDE
                if (hasAppBrain) {
                    if (!fs.existsSync(path.dirname(ideBrain))) fs.mkdirSync(path.dirname(ideBrain), { recursive: true });
                    fs.cpSync(appBrain, ideBrain, { recursive: true });
                }
                if (hasAppDb) {
                    if (!fs.existsSync(ideConvDir)) fs.mkdirSync(ideConvDir, { recursive: true });
                    for (const ext of ['.db', '.db-shm', '.db-wal']) {
                        const sf = path.join(appConvDir, `${id}${ext}`);
                        const df = path.join(ideConvDir, `${id}${ext}`);
                        if (fs.existsSync(sf)) {
                            try { fs.copyFileSync(sf, df); } catch {}
                        }
                    }
                }
            } else {
                // Both exist: check and update transcript
                const ideLog = path.join(ideBrain, '.system_generated', 'logs', 'transcript.jsonl');
                const appLog = path.join(appBrain, '.system_generated', 'logs', 'transcript.jsonl');
                const ideLogFull = path.join(ideBrain, '.system_generated', 'logs', 'transcript_full.jsonl');
                const appLogFull = path.join(appBrain, '.system_generated', 'logs', 'transcript_full.jsonl');

                if (fs.existsSync(ideLog) && fs.existsSync(appLog)) {
                    try {
                        const ideSize = fs.statSync(ideLog).size;
                        const appSize = fs.statSync(appLog).size;
                        if (ideSize > appSize + 32) {
                            fs.copyFileSync(ideLog, appLog);
                            if (fs.existsSync(ideLogFull)) fs.copyFileSync(ideLogFull, appLogFull);
                        } else if (appSize > ideSize + 32) {
                            fs.copyFileSync(appLog, ideLog);
                            if (fs.existsSync(appLogFull)) fs.copyFileSync(appLogFull, ideLogFull);
                        }
                    } catch {}
                } else if (fs.existsSync(ideLog) && !fs.existsSync(appLog)) {
                    const logDir = path.dirname(appLog);
                    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                    fs.copyFileSync(ideLog, appLog);
                    if (fs.existsSync(ideLogFull)) fs.copyFileSync(ideLogFull, appLogFull);
                } else if (!fs.existsSync(ideLog) && fs.existsSync(appLog)) {
                    const logDir = path.dirname(ideLog);
                    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                    fs.copyFileSync(appLog, ideLog);
                    if (fs.existsSync(appLogFull)) fs.copyFileSync(appLogFull, ideLogFull);
                }

                // Copy missing DB files
                if (hasIdeDb && !hasAppDb) {
                    if (!fs.existsSync(appConvDir)) fs.mkdirSync(appConvDir, { recursive: true });
                    for (const ext of ['.db', '.db-shm', '.db-wal']) {
                        const sf = path.join(ideConvDir, `${id}${ext}`);
                        const df = path.join(appConvDir, `${id}${ext}`);
                        if (fs.existsSync(sf)) try { fs.copyFileSync(sf, df); } catch {}
                    }
                } else if (!hasIdeDb && hasAppDb) {
                    if (!fs.existsSync(ideConvDir)) fs.mkdirSync(ideConvDir, { recursive: true });
                    for (const ext of ['.db', '.db-shm', '.db-wal']) {
                        const sf = path.join(appConvDir, `${id}${ext}`);
                        const df = path.join(ideConvDir, `${id}${ext}`);
                        if (fs.existsSync(sf)) try { fs.copyFileSync(sf, df); } catch {}
                    }
                }
            }

            // Reload conversations and refresh detail
            if (ConversationManagerProvider.currentInstance) {
                const target = ConversationManagerProvider.currentInstance._conversations.find(c => c.id === id);
                if (target) {
                    target.source = 'both';
                }
                await ConversationManagerProvider.currentInstance._loadConversations();
                await ConversationManagerProvider.currentInstance._sendDetail(id);
                ConversationManagerProvider.currentInstance._sendState();
            }

            vscode.window.showInformationMessage(`Conversation ${id.slice(0, 8)}... synced between IDE and App.`);
            return true;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to sync conversation: ${e?.message || String(e)}`);
            return false;
        }
    }

    public static readDiskCache(): CachedConversation[] {
        const list: CachedConversation[] = [];
        try {
            if (fs.existsSync(ConversationManagerProvider.CACHE_FILE)) {
                const raw = JSON.parse(fs.readFileSync(ConversationManagerProvider.CACHE_FILE, 'utf8'));
                if (raw && !Array.isArray(raw) && (raw.version === 7 || raw.version === ConversationManagerProvider.CACHE_VERSION) && Array.isArray(raw.items)) {
                    for (const item of raw.items) {
                        if (item && item.id) {
                            if (Array.isArray(item.workspaces)) {
                                item.workspaces = item.workspaces.map((w: string) => ConversationManagerProvider.normalizePath(w));
                            } else {
                                item.workspaces = [];
                            }
                            item.isOrphaned = item.workspaces.length > 0 && !fs.existsSync(item.workspaces[0]);
                            if (!item.source) {
                                item.source = ConversationManagerProvider.detectConversationSource(item.id);
                            }
                            list.push(item);
                        }
                    }
                }
            }
        } catch {}
        return list;
    }

    private _readDiskCache(): Map<string, CachedConversation> {
        const map = new Map<string, CachedConversation>();
        const list = ConversationManagerProvider.readDiskCache();
        for (const it of list) {
            map.set(it.id, it);
        }
        return map;
    }

    public static writeDiskCache(conversations: CachedConversation[]) {
        try {
            const dir = path.dirname(ConversationManagerProvider.CACHE_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const payload: DiskCachePayload = {
                version: ConversationManagerProvider.CACHE_VERSION,
                items: conversations
            };
            fs.writeFileSync(ConversationManagerProvider.CACHE_FILE, JSON.stringify(payload), 'utf8');
        } catch {}
    }

    private _writeDiskCache(conversations: CachedConversation[]) {
        ConversationManagerProvider.writeDiskCache(conversations);
    }

    private _tsToMs(ts: any): number {
        if (!ts) return 0;
        if (typeof ts === 'number') return ts;
        if (ts.seconds !== undefined) {
            return Number(ts.seconds) * 1000 + Math.floor(Number(ts.nanos || 0) / 1e6);
        }
        const parsed = new Date(ts).getTime();
        return isNaN(parsed) ? 0 : parsed;
    }

    private async _loadConversations() {
        try {
            const ideBaseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
            const ideConvDir = path.join(ideBaseDir, 'conversations');
            const ideBrainDir = path.join(ideBaseDir, 'brain');

            const appBaseDir = path.join(os.homedir(), '.gemini', 'antigravity');
            const appConvDir = path.join(appBaseDir, 'conversations');
            const appBrainDir = path.join(appBaseDir, 'brain');

            const legacyConvDir = path.join(os.homedir(), '.gemini', 'conversations');

            const summariesMap = new Map<string, any>();

            // Live bridge lookup for summaries and workspaces
            try {
                const liveSummaries = await vscode.commands.executeCommand<any>('workbench.action.getCascadeSummaries');
                if (liveSummaries && typeof liveSummaries === 'object') {
                    for (const [k, v] of Object.entries(liveSummaries)) {
                        summariesMap.set(k, v);
                    }
                }
            } catch {}

            const idSet = new Set<string>();

            // Collect IDs from IDE
            if (fs.existsSync(ideConvDir)) {
                for (const f of fs.readdirSync(ideConvDir)) {
                    if (f.endsWith('.db')) idSet.add(f.replace('.db', ''));
                }
            }
            if (fs.existsSync(ideBrainDir)) {
                for (const f of fs.readdirSync(ideBrainDir)) {
                    if (f !== 'tempmediaStorage' && !f.startsWith('.')) idSet.add(f);
                }
            }

            // Collect IDs from App
            if (fs.existsSync(appConvDir)) {
                for (const f of fs.readdirSync(appConvDir)) {
                    if (f.endsWith('.db')) idSet.add(f.replace('.db', ''));
                }
            }
            if (fs.existsSync(appBrainDir)) {
                for (const f of fs.readdirSync(appBrainDir)) {
                    if (f !== 'tempmediaStorage' && !f.startsWith('.')) idSet.add(f);
                }
            }

            for (const key of summariesMap.keys()) {
                idSet.add(key);
            }

            if (fs.existsSync(legacyConvDir)) {
                for (const f of fs.readdirSync(legacyConvDir)) {
                    if (f.endsWith('.md')) {
                        idSet.add(f.replace('.md', ''));
                    }
                }
            }

            const cachedMap = this._readDiskCache();
            const result: CachedConversation[] = [];

            const systemMetaTypes = new Set([
                'CONVERSATION_HISTORY',
                'KNOWLEDGE_ARTIFACTS',
                'SYSTEM_MESSAGE',
                'GENERIC',
                'ERROR_MESSAGE'
            ]);

            for (const id of idSet) {
                const summ = summariesMap.get(id);

                let title = summ?.summary || id;
                const rawWorkspaces: string[] = (summ?.workspaces || [])
                    .map((w: any) => w?.workspaceFolderAbsoluteUri)
                    .filter((u: any) => typeof u === 'string' && u.length > 0);
                const workspaces: string[] = rawWorkspaces.map((u: string) => this._normalizePath(u));

                let lastModified = this._tsToMs(summ?.lastModifiedTime);
                let createdFromSumm = this._tsToMs(summ?.trajectoryMetadata?.createdAt);
                const stepCount = summ?.stepCount || 0;

                const hasIdeBrain = fs.existsSync(path.join(ideBrainDir, id));
                const hasIdeDb = fs.existsSync(path.join(ideConvDir, `${id}.db`));
                const hasAppBrain = fs.existsSync(path.join(appBrainDir, id));
                const hasAppDb = fs.existsSync(path.join(appConvDir, `${id}.db`));

                const inIde = hasIdeBrain || hasIdeDb;
                const inApp = hasAppBrain || hasAppDb;
                const source: 'ide' | 'app' | 'both' = (inIde && inApp) ? 'both' : (inApp ? 'app' : 'ide');

                const tInfo = ConversationManagerProvider.getTranscriptPath(id, false);
                const transcriptPath = tInfo?.path;
                const hasTranscript = Boolean(transcriptPath && fs.existsSync(transcriptPath));
                const mdPath = path.join(legacyConvDir, `${id}.md`);
                const dbPath = inIde ? path.join(ideConvDir, `${id}.db`) : path.join(appConvDir, `${id}.db`);

                let mtimeMs = 0;
                let fileSize = 0;

                if (hasTranscript && transcriptPath) {
                    try {
                        const st = fs.statSync(transcriptPath);
                        mtimeMs = st.mtimeMs;
                        fileSize = st.size;
                        if (!lastModified) lastModified = mtimeMs;
                    } catch {}
                } else if (fs.existsSync(mdPath)) {
                    try {
                        const st = fs.statSync(mdPath);
                        mtimeMs = st.mtimeMs;
                        fileSize = st.size;
                        if (!lastModified) lastModified = mtimeMs;
                    } catch {}
                } else if (fs.existsSync(dbPath)) {
                    try {
                        const st = fs.statSync(dbPath);
                        mtimeMs = st.mtimeMs;
                        fileSize = st.size;
                        if (!lastModified) lastModified = mtimeMs;
                    } catch {}
                }

                // Cache hit check
                const cached = cachedMap.get(id);
                if (cached && cached.mtimeMs === mtimeMs && cached.size === fileSize) {
                    cached.source = source;
                    if (title && title !== id) cached.title = title;
                    if (cached.userWorkspaces !== undefined) {
                        cached.workspaces = cached.userWorkspaces;
                    } else if (workspaces.length > 0) {
                        cached.workspaces = workspaces;
                        cached.rawWorkspaces = rawWorkspaces;
                    }
                    cached.isOrphaned = cached.workspaces.length > 0 && !fs.existsSync(cached.workspaces[0]);
                    if (lastModified) cached.lastModifiedTime = lastModified;
                    if (stepCount > cached.stepCount) cached.stepCount = stepCount;
                    result.push(cached);
                    continue;
                }

                let userMsgs = 0;
                let modelMsgs = 0;
                let toolCalls = 0;
                let totalSteps = stepCount;
                let userChars = 0;
                let toolOutputChars = 0;
                let responseChars = 0;
                let thinkingChars = 0;
                let currentContextChars = 0;
                let cumulativeInputChars = 0;
                let cumulativeOutputChars = 0;
                let firstMsg = '';
                let firstTime = 0;
                const searchableChunks: string[] = [];
                let totalIndexedChars = 0;
                const MAX_INDEX_CHARS = 60000;

                if (hasTranscript && transcriptPath) {
                    try {
                        const content = fs.readFileSync(transcriptPath, 'utf8');
                        const lines = content.split('\n');
                        let nonEmptyLines = 0;

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            nonEmptyLines++;
                            try {
                                const step = JSON.parse(line);
                                if (!firstTime && step.created_at) {
                                    const t = new Date(step.created_at).getTime();
                                    if (!isNaN(t)) firstTime = t;
                                }
                                if (step.type === 'USER_INPUT') {
                                    userMsgs++;
                                    const rawTxt = typeof step.content === 'string' ? step.content : '';
                                    let txt = rawTxt;
                                    const match = rawTxt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                                    if (match) txt = match[1].trim();
                                    userChars += txt.length;
                                    currentContextChars += rawTxt.length;
                                    if (!firstMsg && txt) firstMsg = txt.replace(/\s+/g, ' ').slice(0, 180);
                                    if (txt && totalIndexedChars < MAX_INDEX_CHARS) {
                                        const chunk = txt.replace(/\s+/g, ' ').slice(0, 4000);
                                        searchableChunks.push(chunk);
                                        totalIndexedChars += chunk.length;
                                    }
                                } else if (step.type === 'CHECKPOINT') {
                                    const c = typeof step.content === 'string' ? step.content : '';
                                    currentContextChars = c.length;
                                } else if (step.type === 'PLANNER_RESPONSE') {
                                    modelMsgs++;
                                    // Base overhead (~12k chars ~3.7k tokens) accounts for system instructions and tool definitions per request
                                    cumulativeInputChars += (12000 + currentContextChars);

                                    const c = typeof step.content === 'string' ? step.content : '';
                                    const th = typeof step.thinking === 'string' ? step.thinking : '';
                                    let tcLen = 0;
                                    if (step.tool_calls && Array.isArray(step.tool_calls)) {
                                        toolCalls += step.tool_calls.length;
                                        tcLen = JSON.stringify(step.tool_calls).length;
                                        responseChars += tcLen;
                                        if (workspaces.length === 0) {
                                            for (const tc of step.tool_calls) {
                                                const cwd = tc?.args?.Cwd;
                                                if (typeof cwd === 'string' && cwd.length > 2 && !cwd.toLowerCase().includes('.gemini')) {
                                                    const normCwd = this._normalizePath(cwd);
                                                    if (normCwd && (/^[a-zA-Z]:\//.test(normCwd) || normCwd.startsWith('/'))) {
                                                        workspaces.push(normCwd);
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    responseChars += c.length;
                                    thinkingChars += th.length;

                                    const outChars = c.length + th.length + tcLen;
                                    cumulativeOutputChars += outChars;
                                    currentContextChars += outChars;

                                    if (c && totalIndexedChars < MAX_INDEX_CHARS) {
                                        const chunk = c.replace(/\s+/g, ' ').slice(0, 3000);
                                        searchableChunks.push(chunk);
                                        totalIndexedChars += chunk.length;
                                    }
                                    if (th && totalIndexedChars < MAX_INDEX_CHARS) {
                                        const thChunk = th.replace(/\s+/g, ' ').slice(0, 1500);
                                        searchableChunks.push(thChunk);
                                        totalIndexedChars += thChunk.length;
                                    }
                                } else if (step.type && systemMetaTypes.has(step.type)) {
                                    const c = typeof step.content === 'string' ? step.content : '';
                                    currentContextChars += c.length;
                                } else if (step.type) {
                                    const c = typeof step.content === 'string' ? step.content : (step.output ? String(step.output) : '');
                                    toolOutputChars += c.length;
                                    currentContextChars += c.length;
                                }
                            } catch {}
                        }

                        totalSteps = Math.max(stepCount, nonEmptyLines);
                    } catch {}
                } else if (fs.existsSync(mdPath)) {
                    try {
                        const mdContent = fs.readFileSync(mdPath, 'utf8');
                        responseChars = mdContent.length;
                        firstMsg = mdContent.replace(/\s+/g, ' ').slice(0, 180);
                        searchableChunks.push(mdContent.replace(/\s+/g, ' ').slice(0, MAX_INDEX_CHARS));
                    } catch {}
                }

                const estInputTokens = Math.round((userChars + toolOutputChars) / 3.2);
                const estThinkingTokens = Math.round(thinkingChars / 3.2);
                const estOutputTokens = Math.round(responseChars / 3.2);
                const estTotalTokens = estInputTokens + estOutputTokens + estThinkingTokens;
                const cumulativeTokens = hasTranscript
                    ? Math.max(estTotalTokens, Math.round((cumulativeInputChars + cumulativeOutputChars) / 3.2))
                    : estTotalTokens;

                const finalWorkspaces = (cached?.userWorkspaces !== undefined) ? cached.userWorkspaces : workspaces;
                const finalRawWorkspaces = (cached?.userWorkspaces !== undefined) ? (cached.rawWorkspaces || []) : rawWorkspaces;
                const isOrphaned = finalWorkspaces.length > 0 && !fs.existsSync(finalWorkspaces[0]);

                const item: CachedConversation = {
                    id,
                    title: (title === id && firstMsg) ? firstMsg.slice(0, 60) : title,
                    workspaces: finalWorkspaces,
                    rawWorkspaces: finalRawWorkspaces,
                    userWorkspaces: cached?.userWorkspaces,
                    isOrphaned,
                    source,
                    lastModifiedTime: lastModified || createdFromSumm || Date.now(),
                    createdTime: createdFromSumm || firstTime || lastModified || Date.now(),
                    stepCount: totalSteps,
                    userMsgs,
                    modelMsgs,
                    toolCalls,
                    estInputTokens,
                    estOutputTokens,
                    estThinkingTokens,
                    estTotalTokens,
                    cumulativeTokens,
                    parentConversationId: summ?.trajectoryMetadata?.parentConversationId,
                    hasTranscript,
                    firstMessageSnippet: firstMsg,
                    searchableContent: searchableChunks.join(' '),
                    mtimeMs,
                    size: fileSize
                };

                result.push(item);
            }

            this._conversations = result;
            this._writeDiskCache(result);
            this._sendState();

            try {
                const { ConversationExplorerViewProvider } = require('./conversationTreeProvider');
                ConversationExplorerViewProvider.currentInstance?.updateData(result);
            } catch (_) {}
        } catch (e: any) {
            vscode.window.showErrorMessage('Error loading conversations: ' + (e?.message || String(e)));
        }
    }

    public static matchesFolder(conv: CachedConversation, folderLower: string, includeSub: boolean): boolean {
        if (folderLower === 'standalone' || folderLower === '(no workspace)') {
            return conv.workspaces.length === 0;
        }
        const target = ConversationManagerProvider.normalizePath(folderLower).toLowerCase();
        return conv.workspaces.some(w => {
            const wl = ConversationManagerProvider.normalizePath(w).toLowerCase();
            if (includeSub) {
                return wl === target || wl.startsWith(target.endsWith('/') ? target : target + '/');
            }
            return wl === target;
        });
    }

    private _matchesFolder(conv: CachedConversation, folderLower: string, includeSub: boolean): boolean {
        return ConversationManagerProvider.matchesFolder(conv, folderLower, includeSub);
    }

    public static buildFolderTree(conversations: CachedConversation[], includeSubfolders: boolean = true): { rootNodes: FolderNode[]; currentWorkspacePath: string; currentWorkspaceCount: number } {
        const rootNodesMap = new Map<string, {
            id: string;
            name: string;
            fullPath: string;
            directCount: number;
            totalCount: number;
            childrenMap: Map<string, any>;
            isDriveOrRoot: boolean;
        }>();

        const currentWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? ConversationManagerProvider.normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath)
            : '';

        let currentWorkspaceCount = 0;

        for (const conv of conversations) {
            if (currentWs && ConversationManagerProvider.matchesFolder(conv, currentWs.toLowerCase(), includeSubfolders)) {
                currentWorkspaceCount++;
            }

            const wsList = conv.workspaces.length > 0 ? conv.workspaces : ['Standalone'];

            for (const ws of wsList) {
                if (ws === 'Standalone' || ws === '(No Workspace)') {
                    if (!rootNodesMap.has('Standalone')) {
                        rootNodesMap.set('Standalone', {
                            id: 'Standalone',
                            name: 'Standalone',
                            fullPath: 'Standalone',
                            directCount: 0,
                            totalCount: 0,
                            childrenMap: new Map(),
                            isDriveOrRoot: true
                        });
                    }
                    const node = rootNodesMap.get('Standalone')!;
                    node.directCount++;
                    node.totalCount++;
                    continue;
                }

                const parts = ws.split('/').filter(Boolean);
                if (parts.length === 0) continue;

                const rootPart = parts[0].includes(':') ? parts[0] + '/' : '/' + parts[0];
                if (!rootNodesMap.has(rootPart)) {
                    rootNodesMap.set(rootPart, {
                        id: rootPart,
                        name: rootPart,
                        fullPath: rootPart,
                        directCount: 0,
                        totalCount: 0,
                        childrenMap: new Map(),
                        isDriveOrRoot: true
                    });
                }

                let currNode = rootNodesMap.get(rootPart)!;
                currNode.totalCount++;

                let currPath = rootPart;
                for (let i = 1; i < parts.length; i++) {
                    const segment = parts[i];
                    const segKey = segment.toLowerCase();
                    currPath = currPath.endsWith('/') ? currPath + segment : currPath + '/' + segment;

                    if (!currNode.childrenMap.has(segKey)) {
                        currNode.childrenMap.set(segKey, {
                            id: currPath,
                            name: segment,
                            fullPath: currPath,
                            directCount: 0,
                            totalCount: 0,
                            childrenMap: new Map(),
                            isDriveOrRoot: false
                        });
                    }

                    currNode = currNode.childrenMap.get(segKey)!;
                    currNode.totalCount++;
                }
                currNode.directCount++;
            }
        }

        const compactNode = (node: any): FolderNode => {
            let name = node.name;
            let fullPath = node.fullPath;
            let childrenMap = node.childrenMap;
            let directCount = node.directCount;
            let totalCount = node.totalCount;

            while (childrenMap.size === 1 && directCount === 0 && !node.isDriveOrRoot) {
                const child = Array.from(childrenMap.values())[0] as any;
                name += '/' + child.name;
                fullPath = child.fullPath;
                directCount = child.directCount;
                totalCount = child.totalCount;
                childrenMap = child.childrenMap;
            }

            const childrenArray: FolderNode[] = [];
            for (const child of childrenMap.values()) {
                childrenArray.push(compactNode(child));
            }

            childrenArray.sort((a, b) => a.name.localeCompare(b.name));

            const isStandalone = fullPath === 'Standalone' || fullPath === '(No Workspace)';
            const isOrphaned = !isStandalone && !fs.existsSync(fullPath);

            return {
                id: fullPath,
                name,
                fullPath,
                directCount,
                totalCount,
                isDriveOrRoot: Boolean(node.isDriveOrRoot),
                isOrphaned,
                children: childrenArray
            };
        };

        const serializedRoots: FolderNode[] = [];
        for (const root of rootNodesMap.values()) {
            serializedRoots.push(compactNode(root));
        }
        serializedRoots.sort((a, b) => {
            if (a.fullPath === 'Standalone' || a.fullPath === '(No Workspace)') return 1;
            if (b.fullPath === 'Standalone' || b.fullPath === '(No Workspace)') return -1;
            return a.name.localeCompare(b.name);
        });

        return { rootNodes: serializedRoots, currentWorkspacePath: currentWs, currentWorkspaceCount };
    }

    private _buildFolderTree(): { rootNodes: FolderNode[]; currentWorkspacePath: string; currentWorkspaceCount: number } {
        return ConversationManagerProvider.buildFolderTree(this._conversations, this._includeSubfolders);
    }

    private _filterConversations(): {
        items: any[];
        totalTokens: number;
        totalMessages: number;
        folderName: string;
        folderTotalConversations: number;
        folderTotalMessages: number;
        folderUserMsgs: number;
        folderModelMsgs: number;
        folderTotalTokens: number;
        folderCumulativeTokens: number;
        folderTotalSteps: number;
    } {
        const currentWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? this._normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath)
            : '';

        let folderList = [...this._conversations];
        if (this._selectedFolder === 'CURRENT') {
            if (currentWs) {
                const curLower = currentWs.toLowerCase();
                folderList = folderList.filter(c => this._matchesFolder(c, curLower, this._includeSubfolders));
            }
        } else if (this._selectedFolder !== 'ALL') {
            const sel = this._selectedFolder.toLowerCase();
            folderList = folderList.filter(c => this._matchesFolder(c, sel, this._includeSubfolders));
        }

        let folderName = 'All Conversations';
        if (this._selectedFolder === 'CURRENT') {
            folderName = currentWs ? (currentWs.split('/').filter(Boolean).pop() || 'Current Workspace') : 'Current Workspace';
        } else if (this._selectedFolder !== 'ALL') {
            if (this._selectedFolder === 'Standalone' || this._selectedFolder === '(No Workspace)') {
                folderName = 'Standalone';
            } else {
                const parts = this._selectedFolder.split('/').filter(Boolean);
                folderName = parts.length > 0 ? parts[parts.length - 1] : this._selectedFolder;
                if (!fs.existsSync(this._selectedFolder)) {
                    folderName += ' (orphaned)';
                }
            }
        }

        let folderTotalConversations = folderList.length;
        let folderTotalMessages = 0;
        let folderUserMsgs = 0;
        let folderModelMsgs = 0;
        let folderTotalTokens = 0;
        let folderCumulativeTokens = 0;
        let folderTotalSteps = 0;

        for (const c of folderList) {
            folderTotalMessages += (c.userMsgs || 0) + (c.modelMsgs || 0);
            folderUserMsgs += c.userMsgs || 0;
            folderModelMsgs += c.modelMsgs || 0;
            folderTotalTokens += c.estTotalTokens || 0;
            folderCumulativeTokens += c.cumulativeTokens || c.estTotalTokens || 0;
            folderTotalSteps += c.stepCount || 0;
        }

        let list = [...folderList];
        const q = this._searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(c => {
                const titleMatch = c.title.toLowerCase().includes(q);
                if (this._searchMode === 'title') return titleMatch;

                const wsMatch = (c.workspaces || []).some(w => w.toLowerCase().includes(q))
                    || (c.userWorkspaces || []).some(w => w.toLowerCase().includes(q))
                    || (c.rawWorkspaces || []).some(w => w.toLowerCase().includes(q))
                    || (c.workspaces.length === 0 && 'standalone'.includes(q));

                if (this._searchMode === 'path') return wsMatch;

                const snippetMatch = (c.firstMessageSnippet || '').toLowerCase().includes(q);
                const contentMatch = (c.searchableContent || '').toLowerCase().includes(q);
                const idMatch = c.id.toLowerCase().includes(q);

                if (this._searchMode === 'content') {
                    return contentMatch || snippetMatch;
                }
                return titleMatch || contentMatch || snippetMatch || idMatch || wsMatch;
            });
        }

        list.sort((a, b) => {
            if (this._sortBy === 'recent') return b.lastModifiedTime - a.lastModifiedTime;
            if (this._sortBy === 'oldest') return a.lastModifiedTime - b.lastModifiedTime;
            if (this._sortBy === 'messages') return (b.userMsgs + b.modelMsgs) - (a.userMsgs + a.modelMsgs);
            if (this._sortBy === 'tokens') return b.estTotalTokens - a.estTotalTokens;
            if (this._sortBy === 'traffic') return (b.cumulativeTokens || b.estTotalTokens) - (a.cumulativeTokens || a.estTotalTokens);
            if (this._sortBy === 'steps') return b.stepCount - a.stepCount;
            return 0;
        });

        let totalTokens = 0;
        let totalMessages = 0;

        const items = list.map(c => {
            totalTokens += c.estTotalTokens;
            totalMessages += c.userMsgs + c.modelMsgs;

            let matchSnippet = c.firstMessageSnippet;
            if (q && c.searchableContent) {
                const idx = c.searchableContent.toLowerCase().indexOf(q);
                if (idx !== -1) {
                    const start = Math.max(0, idx - 48);
                    const end = Math.min(c.searchableContent.length, idx + q.length + 80);
                    matchSnippet = (start > 0 ? '...' : '') + c.searchableContent.slice(start, end) + (end < c.searchableContent.length ? '...' : '');
                }
            }
            if (this._searchMode === 'path' || (!c.searchableContent && (c.workspaces || []).some(w => w.toLowerCase().includes(q)))) {
                const matchedWs = (c.workspaces || []).find(w => w.toLowerCase().includes(q))
                    || (c.userWorkspaces || []).find(w => w.toLowerCase().includes(q))
                    || (c.rawWorkspaces || []).find(w => w.toLowerCase().includes(q))
                    || 'Standalone';
                matchSnippet = 'Path: ' + matchedWs;
            }
            const { searchableContent, ...rest } = c;
            return { ...rest, matchSnippet };
        });

        return {
            items,
            totalTokens,
            totalMessages,
            folderName,
            folderTotalConversations,
            folderTotalMessages,
            folderUserMsgs,
            folderModelMsgs,
            folderTotalTokens,
            folderCumulativeTokens,
            folderTotalSteps
        };
    }

    private _sendState() {
        const treeData = this._buildFolderTree();
        const filtered = this._filterConversations();

        this._panel.webview.postMessage({
            type: 'state',
            tree: treeData.rootNodes,
            currentWorkspace: treeData.currentWorkspacePath,
            currentWorkspaceCount: treeData.currentWorkspaceCount,
            selectedFolder: this._selectedFolder,
            includeSubfolders: this._includeSubfolders,
            conversations: filtered.items,
            filteredTokens: filtered.totalTokens,
            filteredMessages: filtered.totalMessages,
            folderName: filtered.folderName,
            folderTotalConversations: filtered.folderTotalConversations,
            folderTotalMessages: filtered.folderTotalMessages,
            folderUserMsgs: filtered.folderUserMsgs,
            folderModelMsgs: filtered.folderModelMsgs,
            folderTotalTokens: filtered.folderTotalTokens,
            folderCumulativeTokens: filtered.folderCumulativeTokens,
            folderTotalSteps: filtered.folderTotalSteps,
            totalConversations: this._conversations.length,
            selectedId: this._selectedId,
            searchQuery: this._searchQuery,
            searchMode: this._searchMode,
            sortBy: this._sortBy
        });

        if (this._selectedId) {
            this._sendDetail(this._selectedId);
        }
    }

    private _sendFilteredList() {
        const filtered = this._filterConversations();
        this._panel.webview.postMessage({
            type: 'conversationList',
            conversations: filtered.items,
            filteredTokens: filtered.totalTokens,
            filteredMessages: filtered.totalMessages,
            folderName: filtered.folderName,
            folderTotalConversations: filtered.folderTotalConversations,
            folderTotalMessages: filtered.folderTotalMessages,
            folderUserMsgs: filtered.folderUserMsgs,
            folderModelMsgs: filtered.folderModelMsgs,
            folderTotalTokens: filtered.folderTotalTokens,
            folderCumulativeTokens: filtered.folderCumulativeTokens,
            folderTotalSteps: filtered.folderTotalSteps,
            selectedId: this._selectedId
        });
    }

    private async _sendDetail(id: string) {
        const conv = this._conversations.find(c => c.id === id);
        if (!conv) return;

        const tInfo = ConversationManagerProvider.getTranscriptPath(id, false);
        const transcriptPath = tInfo?.path;
        const mdPath = path.join(os.homedir(), '.gemini', 'conversations', `${id}.md`);

        const messages: Array<{ role: string; content: string; thinking?: string; time?: string; stepIndex?: number; toolCount?: number }> = [];

        if (transcriptPath && fs.existsSync(transcriptPath)) {
            try {
                const fileStream = fs.createReadStream(transcriptPath);
                const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

                for await (const line of rl) {
                    if (!line.trim()) continue;
                    try {
                        const step = JSON.parse(line);
                        if (step.type === 'USER_INPUT') {
                            let txt = typeof step.content === 'string' ? step.content : '';
                            const match = txt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                            if (match) txt = match[1].trim();
                            messages.push({
                                role: 'user',
                                content: txt,
                                time: step.created_at,
                                stepIndex: step.step_index
                            });
                        } else if (step.type === 'PLANNER_RESPONSE') {
                            const c = typeof step.content === 'string' ? step.content : '';
                            const th = typeof step.thinking === 'string' ? step.thinking : '';
                            const toolCount = Array.isArray(step.tool_calls) ? step.tool_calls.length : 0;
                            if (c || th) {
                                messages.push({
                                    role: 'assistant',
                                    content: c,
                                    thinking: th ? th.slice(0, 4000) : undefined,
                                    time: step.created_at,
                                    stepIndex: step.step_index,
                                    toolCount
                                });
                            }
                        }
                    } catch {}
                }
            } catch {}
        } else if (fs.existsSync(mdPath)) {
            try {
                const mdContent = fs.readFileSync(mdPath, 'utf8');
                messages.push({
                    role: 'system',
                    content: mdContent.slice(0, 15000)
                });
            } catch {}
        }

        const { searchableContent, ...convSummary } = conv;
        this._panel.webview.postMessage({
            type: 'detail',
            conversation: convSummary,
            messages
        });
    }

    public static async openInChat(id: string, cachedConv?: CachedConversation) {
        let conv = cachedConv;
        if (!conv && ConversationManagerProvider.currentInstance) {
            conv = ConversationManagerProvider.currentInstance._conversations.find(c => c.id === id);
        }
        if (!conv) {
            const list = ConversationManagerProvider.readDiskCache();
            conv = list.find(c => c.id === id);
        }
        const curWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? ConversationManagerProvider.normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase()
            : '';
        const convWorkspaces = conv?.workspaces || [];
        const sameWorkspace = convWorkspaces.length === 0 || (curWs && convWorkspaces.some(w => w.toLowerCase() === curWs));

        if (sameWorkspace) {
            try {
                await vscode.commands.executeCommand('workbench.action.openCascadeFromManager', id, conv?.rawWorkspaces || convWorkspaces);
            } catch {
                try {
                    await vscode.commands.executeCommand('workbench.action.smartFocusConversation', id);
                } catch {
                    vscode.window.showInformationMessage(`Opened conversation ${id}`);
                }
            }
        } else {
            const rawUris = (conv?.rawWorkspaces && conv.rawWorkspaces.length > 0)
                ? conv.rawWorkspaces
                : convWorkspaces.map(w => vscode.Uri.file(w).toString());
            try {
                const res = await vscode.commands.executeCommand<{ openInCurrentWindow?: boolean }>('antigravity.openConversationWorkspaceQuickPick', {
                    cascadeId: id,
                    workspaceUris: rawUris
                });
                if (res?.openInCurrentWindow) {
                    await vscode.commands.executeCommand('workbench.action.smartFocusConversation', id);
                }
            } catch {
                try {
                    await vscode.commands.executeCommand('workbench.action.openCascadeFromManager', id, rawUris);
                } catch {}
            }
        }
    }

    public static async openTranscriptLog(id: string) {
        const tInfo = ConversationManagerProvider.getTranscriptPath(id, false);
        if (tInfo && fs.existsSync(tInfo.path)) {
            const doc = await vscode.workspace.openTextDocument(tInfo.path);
            await vscode.window.showTextDocument(doc);
        } else {
            const mdPath = path.join(os.homedir(), '.gemini', 'conversations', `${id}.md`);
            if (fs.existsSync(mdPath)) {
                const doc = await vscode.workspace.openTextDocument(mdPath);
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showErrorMessage('No transcript log found for this conversation.');
            }
        }
    }

    private async _openInChat(id: string) {
        await ConversationManagerProvider.openInChat(id);
    }

    private async _openTranscriptLog(id: string) {
        await ConversationManagerProvider.openTranscriptLog(id);
    }

    private async _exportConversationToMarkdown(id: string) {
        await ConversationManagerProvider.exportConversationToMarkdown(id);
    }

    public static async exportConversationToMarkdown(id: string): Promise<void> {
        let conv = ConversationManagerProvider.currentInstance?._conversations.find(c => c.id === id);
        if (!conv) {
            const list = ConversationManagerProvider.readDiskCache();
            conv = list.find(c => c.id === id);
        }

        const tInfo = ConversationManagerProvider.getTranscriptPath(id, true);
        const legacyMdPath = path.join(os.homedir(), '.gemini', 'conversations', `${id}.md`);

        let mdContent = '';

        if (tInfo && fs.existsSync(tInfo.path)) {
            mdContent = await ConversationManagerProvider.convertTranscriptToMarkdown(id, tInfo.path, conv);
        } else if (fs.existsSync(legacyMdPath)) {
            try {
                mdContent = fs.readFileSync(legacyMdPath, 'utf8');
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to read markdown file: ${err?.message || String(err)}`);
                return;
            }
        } else {
            vscode.window.showErrorMessage('No transcript or conversation history found to export.');
            return;
        }

        const rawTitle = conv?.title || id;
        const safeTitle = rawTitle.replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 80) || 'conversation';
        const defaultFilename = `${safeTitle}.md`;

        let defaultFolder = os.homedir();
        if (conv?.workspaces && conv.workspaces.length > 0 && fs.existsSync(conv.workspaces[0])) {
            defaultFolder = conv.workspaces[0];
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            defaultFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultFolder, defaultFilename)),
            filters: { 'Markdown': ['md'] },
            saveLabel: 'Export',
            title: 'Export Conversation to Markdown'
        });

        if (!saveUri) return;

        try {
            fs.writeFileSync(saveUri.fsPath, mdContent, 'utf8');
            const action = await vscode.window.showInformationMessage(
                `Exported conversation to ${path.basename(saveUri.fsPath)}`,
                'Open File',
                'Reveal in File Explorer'
            );
            if (action === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(saveUri);
                await vscode.window.showTextDocument(doc);
            } else if (action === 'Reveal in File Explorer') {
                await vscode.commands.executeCommand('revealFileInOS', saveUri);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to export markdown: ${err?.message || String(err)}`);
        }
    }

    public static async convertTranscriptToMarkdown(id: string, transcriptFile: string, conv?: CachedConversation): Promise<string> {
        const fileStream = fs.createReadStream(transcriptFile);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        const title = conv?.title || id;
        const createdStr = conv?.createdTime ? new Date(conv.createdTime).toLocaleString() : '';
        const modifiedStr = conv?.lastModifiedTime ? new Date(conv.lastModifiedTime).toLocaleString() : '';
        const wsStr = conv?.workspaces && conv.workspaces.length > 0 ? conv.workspaces.join(', ') : 'Standalone';

        const lines: string[] = [];
        lines.push(`# ${title}`);
        lines.push('');
        lines.push(`- **Conversation ID:** \`${id}\``);
        if (createdStr) lines.push(`- **Created:** ${createdStr}`);
        if (modifiedStr) lines.push(`- **Last Modified:** ${modifiedStr}`);
        lines.push(`- **Workspace:** ${wsStr}`);
        lines.push('');
        lines.push('---');
        lines.push('');

        let pendingTools: Array<{ stepIndex?: number; name: string }> = [];

        const flushTools = () => {
            if (pendingTools.length > 0) {
                lines.push(`<details><summary>Tool Executions (${pendingTools.length})</summary>`);
                lines.push('');
                for (const t of pendingTools) {
                    const stepPrefix = t.stepIndex !== undefined ? `Step #${t.stepIndex}: ` : '';
                    lines.push(`- ${stepPrefix}\`${t.name}\``);
                }
                lines.push('');
                lines.push('</details>');
                lines.push('');
                pendingTools = [];
            }
        };

        for await (const rawLine of rl) {
            if (!rawLine.trim()) continue;
            try {
                const step = JSON.parse(rawLine);
                const sType = step.type;

                if (sType === 'USER_INPUT') {
                    flushTools();
                    const stepIdx = step.step_index !== undefined ? ` (Step #${step.step_index})` : '';
                    const timeStr = step.created_at ? ` · ${new Date(step.created_at).toLocaleTimeString()}` : '';

                    lines.push(`## User${stepIdx}${timeStr}`);
                    lines.push('');

                    let txt = typeof step.content === 'string' ? step.content : '';
                    const reqMatch = txt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                    if (reqMatch) {
                        txt = reqMatch[1].trim();
                    }
                    lines.push(txt || '*(Empty prompt)*');
                    lines.push('');
                } else if (sType === 'PLANNER_RESPONSE') {
                    const stepIdx = step.step_index !== undefined ? ` (Step #${step.step_index})` : '';
                    const timeStr = step.created_at ? ` · ${new Date(step.created_at).toLocaleTimeString()}` : '';

                    if (step.tool_calls && Array.isArray(step.tool_calls)) {
                        for (const tc of step.tool_calls) {
                            const callName = tc?.name || tc?.toolName || 'tool';
                            pendingTools.push({ stepIndex: step.step_index, name: callName });
                        }
                    }

                    const c = typeof step.content === 'string' ? step.content.trim() : '';
                    const th = typeof step.thinking === 'string' ? step.thinking.trim() : '';

                    if (th) {
                        lines.push('<details><summary>Thinking Process</summary>');
                        lines.push('');
                        lines.push(th);
                        lines.push('');
                        lines.push('</details>');
                        lines.push('');
                    }

                    if (c) {
                        lines.push(`## Assistant${stepIdx}${timeStr}`);
                        lines.push('');
                        lines.push(c);
                        lines.push('');
                        flushTools();
                        lines.push('---');
                        lines.push('');
                    }
                } else if (step.tool_calls && Array.isArray(step.tool_calls)) {
                    for (const tc of step.tool_calls) {
                        const callName = tc?.name || tc?.toolName || 'tool';
                        pendingTools.push({ stepIndex: step.step_index, name: callName });
                    }
                }
            } catch (_) {}
        }

        flushTools();
        return lines.join('\n');
    }

    private async _forkConversation(id: string, stepIndex: number) {
        await ConversationManagerProvider.forkConversation(id, stepIndex);
    }

    public static async forkConversation(id: string, stepIndex: number) {
        const instance = ConversationManagerProvider.currentInstance;
        let conv = instance?._conversations.find(c => c.id === id);
        if (!conv) {
            const list = ConversationManagerProvider.readDiskCache();
            conv = list.find(c => c.id === id);
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Forking conversation from step #${stepIndex}...`,
            cancellable: false
        }, async () => {
            let forkedId: string | null = null;
            let usedNativeFork = false;
            try {
                const res = await vscode.commands.executeCommand<any>('workbench.action.forkCascadeFromManager', id, stepIndex);
                if (typeof res === 'string' && res) {
                    forkedId = res;
                    usedNativeFork = true;
                } else if (res && typeof res.newCascadeId === 'string') {
                    forkedId = res.newCascadeId;
                    usedNativeFork = true;
                }
            } catch (e) {
                console.warn('[ConversationManager] Native fork command failed, falling back to transcript copy:', e);
            }

            if (!forkedId) {
                forkedId = await ConversationManagerProvider.createTranscriptFork(id, stepIndex, conv);
            }

            if (forkedId) {
                if (usedNativeFork) {
                    await new Promise(r => setTimeout(r, 350));
                }
                vscode.window.showInformationMessage(`Conversation forked at step #${stepIndex}.`);
                if (instance) {
                    await instance._loadConversations();
                    instance.selectConversation(forkedId);
                }
                if (!usedNativeFork) {
                    await ConversationManagerProvider.openInChat(forkedId, conv);
                }
            } else {
                vscode.window.showErrorMessage(`Failed to fork conversation at step #${stepIndex}.`);
            }
        });
    }

    public static async createTranscriptFork(sourceId: string, stepIndex: number, sourceConv?: CachedConversation): Promise<string | null> {
        try {
            const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
            const tInfo = ConversationManagerProvider.getTranscriptPath(sourceId, false);
            const srcTranscript = tInfo?.path;

            if (!srcTranscript || !fs.existsSync(srcTranscript)) {
                vscode.window.showErrorMessage('No transcript file found to fork.');
                return null;
            }
            const srcLogsDir = path.dirname(srcTranscript);
            const srcBrainDir = path.resolve(srcLogsDir, '..', '..');

            const newId = crypto.randomUUID();
            const dstBrainDir = path.join(baseDir, 'brain', newId);
            const dstLogsDir = path.join(dstBrainDir, '.system_generated', 'logs');
            fs.mkdirSync(dstLogsDir, { recursive: true });

            let totalSteps = 0;
            const rl = readline.createInterface({
                input: fs.createReadStream(srcTranscript),
                crlfDelay: Infinity
            });

            const slicedLines: string[] = [];
            for await (const line of rl) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const step = JSON.parse(trimmed);
                    const sIdx = typeof step.step_index === 'number' ? step.step_index : totalSteps;
                    if (sIdx <= stepIndex) {
                        slicedLines.push(trimmed);
                        totalSteps++;
                    } else {
                        break;
                    }
                } catch {
                    slicedLines.push(trimmed);
                    totalSteps++;
                }
            }

            if (slicedLines.length === 0) {
                vscode.window.showErrorMessage(`No steps found up to step #${stepIndex}.`);
                return null;
            }

            fs.writeFileSync(path.join(dstLogsDir, 'transcript.jsonl'), slicedLines.join('\n') + '\n', 'utf8');

            const srcTranscriptFull = path.join(srcLogsDir, 'transcript_full.jsonl');
            if (fs.existsSync(srcTranscriptFull)) {
                const rlFull = readline.createInterface({
                    input: fs.createReadStream(srcTranscriptFull),
                    crlfDelay: Infinity
                });
                const fullLines: string[] = [];
                for await (const line of rlFull) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const step = JSON.parse(trimmed);
                        const sIdx = typeof step.step_index === 'number' ? step.step_index : fullLines.length;
                        if (sIdx <= stepIndex) {
                            fullLines.push(trimmed);
                        } else {
                            break;
                        }
                    } catch {
                        fullLines.push(trimmed);
                    }
                }
                if (fullLines.length > 0) {
                    fs.writeFileSync(path.join(dstLogsDir, 'transcript_full.jsonl'), fullLines.join('\n') + '\n', 'utf8');
                }
            }

            const mediaDirs = ['.tempmediaStorage', '.user_uploaded'];
            for (const md of mediaDirs) {
                const srcM = path.join(srcBrainDir, md);
                const dstM = path.join(dstBrainDir, md);
                if (fs.existsSync(srcM)) {
                    try {
                        fs.cpSync(srcM, dstM, { recursive: true });
                    } catch (_) {}
                }
            }

            try {
                const files = fs.readdirSync(srcBrainDir);
                for (const f of files) {
                    if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f)) {
                        try {
                            fs.copyFileSync(path.join(srcBrainDir, f), path.join(dstBrainDir, f));
                        } catch (_) {}
                    }
                }
            } catch (_) {}

            const cacheList = ConversationManagerProvider.readDiskCache();
            const baseTitle = sourceConv?.title || 'Conversation';
            const newTitle = `Fork of ${baseTitle} (Step #${stepIndex})`;
            const ratio = totalSteps / Math.max(1, sourceConv?.stepCount || totalSteps);
            const newCached: CachedConversation = {
                id: newId,
                title: newTitle,
                workspaces: sourceConv?.workspaces || [],
                rawWorkspaces: sourceConv?.rawWorkspaces || [],
                userWorkspaces: sourceConv?.userWorkspaces,
                isOrphaned: Boolean(sourceConv?.isOrphaned),
                createdTime: Date.now(),
                lastModifiedTime: Date.now(),
                stepCount: totalSteps,
                userMsgs: Math.max(1, Math.round((sourceConv?.userMsgs || 2) * ratio)),
                modelMsgs: Math.max(0, Math.round((sourceConv?.modelMsgs || 2) * ratio)),
                toolCalls: 0,
                estInputTokens: Math.round((sourceConv?.estInputTokens || 1000) * ratio),
                estOutputTokens: Math.round((sourceConv?.estOutputTokens || 1000) * ratio),
                estThinkingTokens: 0,
                estTotalTokens: Math.round((sourceConv?.estTotalTokens || 2000) * ratio),
                cumulativeTokens: Math.round((sourceConv?.cumulativeTokens || 2000) * ratio),
                parentConversationId: sourceId,
                hasTranscript: true,
                firstMessageSnippet: sourceConv?.firstMessageSnippet || '',
                searchableContent: '',
                mtimeMs: Date.now(),
                size: fs.statSync(path.join(dstLogsDir, 'transcript.jsonl')).size
            };

            cacheList.unshift(newCached);
            ConversationManagerProvider.writeDiskCache(cacheList);

            return newId;
        } catch (e: any) {
            vscode.window.showErrorMessage('Error during transcript fork: ' + (e?.message || String(e)));
            return null;
        }
    }

    private async _requestRename(id: string, oldTitle: string) {
        const newTitle = await vscode.window.showInputBox({
            prompt: 'Enter new conversation title',
            value: oldTitle || '',
            validateInput: val => (!val || !val.trim()) ? 'Title cannot be empty' : null
        });
        if (newTitle && newTitle.trim()) {
            await this._renameConversation(id, newTitle.trim());
        }
    }

    private async _renameConversation(id: string, newTitle: string) {
        if (!newTitle || !newTitle.trim()) return;
        const trimmed = newTitle.trim();
        const conv = this._conversations.find(c => c.id === id);
        if (conv) {
            conv.title = trimmed;
            this._writeDiskCache(this._conversations);
            this._sendState();
        }
        try {
            await vscode.commands.executeCommand('workbench.action.renameCascadeFromManager', id, trimmed);
        } catch {}
        vscode.window.showInformationMessage(`Conversation title updated to: ${trimmed}`);
    }

    private async _deleteConversation(id: string) {
        const conv = this._conversations.find(c => c.id === id);
        const label = conv?.title ? `"${conv.title}"` : id;
        const confirm = await vscode.window.showWarningMessage(
            `Delete conversation ${label}?`,
            { modal: true },
            'Delete'
        );
        if (confirm !== 'Delete') return;

        try {
            try {
                await vscode.commands.executeCommand('workbench.action.deleteCascadeFromManager', id);
            } catch {}

            const ideBaseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
            const appBaseDir = path.join(os.homedir(), '.gemini', 'antigravity');
            for (const bDir of [ideBaseDir, appBaseDir]) {
                for (const ext of ['.db', '.db-shm', '.db-wal']) {
                    const f = path.join(bDir, 'conversations', `${id}${ext}`);
                    if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
                }
                const br = path.join(bDir, 'brain', id);
                if (fs.existsSync(br)) try { fs.rmSync(br, { recursive: true, force: true }); } catch {}
            }

            this._conversations = this._conversations.filter(c => c.id !== id);
            this._writeDiskCache(this._conversations);
            if (this._selectedId === id) this._selectedId = null;
            this._sendState();
            vscode.window.showInformationMessage('Conversation deleted.');
        } catch (e: any) {
            vscode.window.showErrorMessage('Failed to delete conversation: ' + (e?.message || String(e)));
        }
    }

    private async _moveConversation(id: string) {
        const conv = this._conversations.find(c => c.id === id);
        if (!conv) return;

        const currentWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? ConversationManagerProvider.normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath)
            : '';

        const knownSet = new Set<string>();
        for (const c of this._conversations) {
            for (const w of c.workspaces) {
                if (w && w !== 'Standalone' && w !== '(No Workspace)') {
                    knownSet.add(w);
                }
            }
        }
        if (currentWs) knownSet.add(currentWs);

        const items: vscode.QuickPickItem[] = [];

        items.push({
            label: '$(symbol-misc) Standalone',
            description: 'No workspace attached',
            detail: 'Convert to standalone conversation'
        });

        if (currentWs) {
            items.push({
                label: `$(folder-active) ${path.basename(currentWs)}`,
                description: currentWs,
                detail: 'Current open workspace in editor'
            });
        }

        const otherWorkspaces = Array.from(knownSet)
            .filter(w => w !== currentWs)
            .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

        for (const ws of otherWorkspaces) {
            const exists = fs.existsSync(ws);
            items.push({
                label: `$(folder) ${path.basename(ws)}${exists ? '' : ' (orphaned)'}`,
                description: ws,
                detail: exists ? undefined : 'Folder not found on disk'
            });
        }

        items.push({
            label: '$(folder-opened) Browse folder...',
            description: 'Choose a different folder from disk...'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Move "${conv.title}" to folder...`,
            title: 'Move Conversation to Folder'
        });

        if (!selected) return;

        let targetPath: string | null = null;
        if (selected.label.includes('Standalone')) {
            targetPath = 'STANDALONE';
        } else if (selected.label.includes('Browse folder...')) {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Folder',
                title: 'Choose Workspace Folder for Conversation'
            });
            if (uris && uris.length > 0) {
                targetPath = uris[0].fsPath;
            } else {
                return;
            }
        } else {
            targetPath = selected.description || selected.label;
        }

        if (!targetPath) return;

        if (targetPath === 'STANDALONE') {
            conv.workspaces = [];
            conv.rawWorkspaces = [];
            conv.userWorkspaces = [];
            conv.isOrphaned = false;
        } else {
            const norm = ConversationManagerProvider.normalizePath(targetPath);
            conv.workspaces = [norm];
            conv.rawWorkspaces = [vscode.Uri.file(targetPath).toString()];
            conv.userWorkspaces = [norm];
            conv.isOrphaned = !fs.existsSync(norm);
        }

        this._writeDiskCache(this._conversations);
        if (this._selectedId === id) {
            await this._sendDetail(id);
        }
        this._sendState();

        try {
            const { ConversationExplorerViewProvider } = require('./conversationTreeProvider');
            ConversationExplorerViewProvider.currentInstance?.updateData(this._conversations);
        } catch (_) {}

        vscode.window.showInformationMessage(`Moved "${conv.title}" to ${conv.workspaces[0] || 'Standalone'}`);
    }

    private _updateHtml() {
        this._panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conversation Manager</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --sidebar-bg: var(--vscode-sideBar-background);
    --header-bg: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
    --border: var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
    --active-bg: var(--vscode-list-activeSelectionBackground, #04395e);
    --active-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
    --hover-bg: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
    --badge-bg: var(--vscode-badge-background, #4d4d4d);
    --badge-fg: var(--vscode-badge-foreground, #ffffff);
    --input-bg: var(--vscode-input-background, #1e1e1e);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --input-border: var(--vscode-input-border, rgba(128, 128, 128, 0.35));
    --focus-border: var(--vscode-focusBorder, #007fd4);
    --option-active-bg: var(--vscode-inputOption-activeBackground, rgba(0, 127, 212, 0.3));
    --option-active-fg: var(--vscode-inputOption-activeForeground, #ffffff);
    --option-active-border: var(--vscode-inputOption-activeBorder, #007fd4);
    --button-bg: var(--vscode-button-background, #0e639c);
    --button-fg: var(--vscode-button-foreground, #ffffff);
    --button-hover: var(--vscode-button-hoverBackground, #1177bb);
    --btn-sec-bg: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.16));
    --btn-sec-fg: var(--vscode-button-secondaryForeground, var(--fg));
    --btn-sec-hover: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.28));
    --muted: var(--vscode-descriptionForeground, #888888);
    --link: var(--vscode-textLink-foreground, #3794ff);
    --match-bg: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.35));
    --error-fg: var(--vscode-errorForeground, #f48771);
    --user-bg: var(--vscode-input-background, rgba(255, 255, 255, 0.03));
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    --mono: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
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

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.35)); }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.6)); }

  /* Splitter / Resizer handles */
  .resizer {
    width: 6px;
    background: var(--border);
    cursor: col-resize;
    position: relative;
    z-index: 10;
    margin: 0 -1px;
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .resizer:hover, .resizer.dragging {
    background: var(--vscode-focusBorder, #007fd4);
  }
  .btn-mini {
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    padding: 2px 5px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
  }
  .btn-mini:hover {
    background: var(--hover-bg);
    color: var(--fg);
  }

  /* 2-Pane Layout */
  .main-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .folder-icon {
    color: #e5a93c;
  }
  .drive-icon {
    color: #4daafc;
  }

  /* Pane 1: Conversation List */
  .pane-list {
    width: 420px;
    min-width: 320px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    flex-shrink: 0;
  }

  /* Folder Overview Panel (Material You inspired, Dark Mode VS Code) */
  .folder-overview {
    padding: 10px 12px 10px 12px;
    background: var(--vscode-sideBar-background, rgba(255, 255, 255, 0.025));
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }
  .overview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .overview-title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }
  .overview-title-icon {
    width: 14px;
    height: 14px;
    min-width: 14px;
    min-height: 14px;
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
    opacity: 0.9;
  }
  .overview-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.1px;
  }
  .overview-scope-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 1.5px 7px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.07);
    color: var(--muted);
    border: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    letter-spacing: 0.2px;
  }
  .overview-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }
  .m3-stat-card {
    background: var(--vscode-editor-background, rgba(255, 255, 255, 0.035));
    border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    border-radius: 10px;
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
  }
  .m3-stat-card.clickable {
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .m3-stat-card.clickable:hover {
    background: rgba(255, 255, 255, 0.065);
    border-color: rgba(255, 255, 255, 0.16);
  }
  .m3-label {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--muted);
    opacity: 0.85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m3-value {
    font-size: 16.5px;
    font-weight: 700;
    color: var(--fg);
    line-height: 1.25;
    letter-spacing: -0.2px;
  }
  .m3-sub {
    font-size: 10px;
    color: var(--muted);
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .search-box {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 7px;
    background: var(--sidebar-bg);
    flex-shrink: 0;
  }
  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-input {
    width: 100%;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 8px;
    padding: 5px 26px 5px 10px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s ease;
  }
  .search-input:focus {
    border-color: var(--focus-border);
  }
  .search-clear {
    position: absolute;
    right: 6px;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 4px;
    display: none;
  }
  .search-clear:hover { color: var(--fg); }
  .search-clear.visible { display: block; }
  .filter-chips {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
  }
  .chip {
    padding: 2.5px 9px;
    border-radius: 99px;
    background: transparent;
    cursor: pointer;
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    user-select: none;
    transition: all 0.15s ease;
  }
  .chip:hover {
    background: var(--hover-bg);
    color: var(--fg);
  }
  .chip.active {
    background: var(--option-active-bg);
    color: var(--option-active-fg);
    border-color: var(--option-active-border);
  }
  .sort-select {
    margin-left: auto;
    background: var(--vscode-dropdown-background, var(--input-bg));
    color: var(--vscode-dropdown-foreground, var(--input-fg));
    border: 1px solid var(--vscode-dropdown-border, var(--input-border));
    border-radius: 6px;
    font-size: 11px;
    font-family: inherit;
    padding: 2.5px 6px;
    outline: none;
  }
  .list-summary-strip {
    padding: 4px 12px;
    font-size: 11px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    background: var(--bg);
    flex-shrink: 0;
  }
  .conv-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .conv-item {
    margin: 2px 6px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid transparent;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .conv-item:hover {
    background: var(--hover-bg);
    border-color: rgba(255, 255, 255, 0.05);
  }
  .conv-item.active {
    background: var(--active-bg);
    color: var(--active-fg);
    border-color: transparent;
  }
  .conv-title {
    font-weight: 500;
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conv-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
  }
  .conv-item.active .conv-meta,
  .conv-item.active .conv-snippet {
    color: var(--active-fg);
    opacity: 0.85;
  }
  .conv-snippet {
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  mark {
    background: var(--match-bg);
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }

  /* Pane 3: Detail Preview */
  .pane-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
    min-width: 0;
  }
  .detail-header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--vscode-sideBar-background, rgba(255, 255, 255, 0.025));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-shrink: 0;
  }
  .detail-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    letter-spacing: -0.2px;
  }
  .detail-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .btn-primary {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    padding: 5px 16px;
    border-radius: 9999px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    font-family: inherit;
    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  }
  .btn-primary:hover {
    background: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4);
  }
  .btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--fg);
    padding: 5px 14px;
    border-radius: 9999px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  }
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.11);
    border-color: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
  }
  .btn-danger:hover { color: var(--error-fg); }

  /* Stats Grid */
  .detail-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-shrink: 0;
  }

  /* Metadata row */
  .metadata-bar {
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    background: rgba(255, 255, 255, 0.015);
    flex-shrink: 0;
  }
  .m3-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2.5px 10px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 11px;
    color: var(--muted);
    user-select: none;
  }
  .m3-chip b {
    color: var(--fg);
    font-weight: 600;
  }
  .meta-link {
    color: #60a5fa;
    cursor: pointer;
    text-decoration: none;
    font-weight: 500;
  }
  .meta-link:hover {
    text-decoration: underline;
    color: #93c5fd;
  }

  /* Search match bar inside detail */
  .detail-search-bar {
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    background: rgba(234, 179, 8, 0.06);
    border-left: 3px solid #eab308;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    color: var(--muted);
    flex-shrink: 0;
  }
  .detail-search-bar label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }

  /* Messages Transcript */
  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg-bubble {
    border-radius: 12px;
    padding: 12px 16px;
    font-size: 13px;
    line-height: 1.6;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
  }
  .msg-bubble.user {
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.07) 0%, rgba(59, 130, 246, 0.03) 100%);
    border: 1px solid rgba(59, 130, 246, 0.22);
  }
  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11.5px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--muted);
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .msg-header-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .msg-role-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  .msg-role-pill.user {
    background: rgba(59, 130, 246, 0.18);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.28);
  }
  .msg-role-pill.assistant {
    background: rgba(168, 85, 247, 0.16);
    color: #d8b4fe;
    border: 1px solid rgba(168, 85, 247, 0.25);
  }
  .msg-role-pill.archive {
    background: rgba(255, 255, 255, 0.08);
    color: var(--muted);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .msg-fork-btn {
    opacity: 0.75;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 9999px;
    padding: 2px 10px;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    transition: all 0.18s cubic-bezier(0.2, 0, 0, 1);
    color: var(--fg);
  }
  .msg-bubble:hover .msg-fork-btn {
    opacity: 1;
    border-color: rgba(255, 255, 255, 0.25);
  }
  .msg-fork-btn:hover {
    background: #3b82f6 !important;
    color: #ffffff !important;
    border-color: transparent !important;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.35);
  }
  .msg-body {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
  }
  .thinking-block {
    margin-bottom: 10px;
    border: 1px solid rgba(192, 132, 252, 0.2);
    border-radius: 10px;
    background: rgba(20, 16, 28, 0.45);
    font-size: 12px;
    overflow: hidden;
  }
  .thinking-block summary {
    padding: 6px 12px;
    cursor: pointer;
    color: #d8b4fe;
    user-select: none;
    font-weight: 600;
    transition: background 0.15s ease;
  }
  .thinking-block summary:hover {
    background: rgba(192, 132, 252, 0.08);
  }
  .thinking-content {
    padding: 8px 12px;
    border-top: 1px solid rgba(192, 132, 252, 0.12);
    white-space: pre-wrap;
    word-break: break-word;
    color: rgba(255, 255, 255, 0.72);
    line-height: 1.55;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    gap: 8px;
    font-size: 12.5px;
    padding: 20px;
    text-align: center;
  }

  .orphaned-tag {
    font-size: 10px;
    color: var(--vscode-editorWarning-foreground, #cca700);
    opacity: 0.85;
    font-style: italic;
    font-weight: normal;
    margin-left: 3px;
    vertical-align: middle;
  }

  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: transparent;
  }
  .context-menu {
    position: fixed;
    z-index: 9999;
    background: var(--vscode-menu-background, #252526);
    color: var(--vscode-menu-foreground, #cccccc);
    border: 1px solid var(--vscode-menu-border, #454545);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 4px 0;
    min-width: 175px;
    font-size: 12px;
    user-select: none;
  }
  .context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease;
  }
  .context-menu-item:hover {
    background: var(--vscode-menu-selectionBackground, #04395e);
    color: var(--vscode-menu-selectionForeground, #ffffff);
  }
  .context-menu-item.danger {
    color: var(--danger, #f87171);
  }
  .context-menu-item.danger:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }
  .context-menu-separator {
    height: 1px;
    background: var(--vscode-menu-separatorBackground, var(--border, rgba(255, 255, 255, 0.08)));
    margin: 4px 0;
  }

  /* In-Conversation Find Widget (Ctrl+F) */
  .find-widget {
    position: fixed;
    top: 16px;
    right: 28px;
    z-index: 9999;
    display: flex;
    align-items: center;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
    padding: 4px 6px;
    gap: 4px;
    font-size: 12px;
    user-select: none;
    animation: findSlideIn 0.15s ease-out;
  }
  @keyframes findSlideIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .find-input-wrap {
    display: flex;
    align-items: center;
    background: var(--vscode-input-background, #3c3c3c);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 3px 8px;
    gap: 6px;
    width: 240px;
  }
  .find-input-wrap:focus-within {
    border-color: var(--accent, #007acc);
  }
  .find-input-wrap input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--vscode-input-foreground, #ffffff);
    font-family: inherit;
    font-size: 12px;
    width: 100%;
  }
  .find-count {
    font-size: 11px;
    color: var(--muted, #888888);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .find-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--fg, #cccccc);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: background 0.1s;
  }
  .find-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
  }
  .find-btn.active {
    background: var(--accent, #007acc);
    color: #ffffff;
  }
  .find-btn.close-btn {
    font-size: 16px;
    line-height: 1;
  }
  mark.find-match {
    background-color: rgba(234, 92, 0, 0.45);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  mark.find-match.active-match {
    background-color: #f38518;
    color: #ffffff;
    box-shadow: 0 0 0 2px #ff9800;
  }
  .source-tag {
    display: inline-block;
    padding: 0px 4px;
    font-size: 9px;
    font-weight: 700;
    line-height: 14px;
    border-radius: 3px;
    margin-right: 4px;
    letter-spacing: 0.3px;
    vertical-align: middle;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .source-tag.ide {
    background: rgba(59, 130, 246, 0.18);
    color: #60a5fa;
    border: 1px solid rgba(96, 165, 250, 0.35);
  }
  .source-tag.app {
    background: rgba(245, 158, 11, 0.18);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.35);
  }
  .source-tag.both {
    background: rgba(16, 185, 129, 0.18);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.35);
  }
  .conv-folder-badge {
    display: inline-flex;
    align-items: center;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
</style>
</head>
<body>

  <!-- Main 2-Pane Layout with Draggable Splitter -->
  <div class="main-layout">

    <!-- Pane 1: Conversation List -->
    <div class="pane-list" id="paneList">
      <div class="folder-overview" id="folderOverview"></div>
      <div class="search-box">
        <div class="search-input-wrapper">
          <input type="text" id="searchInput" class="search-input" placeholder="Search title, content, or workspace path...">
          <button class="search-clear" id="btnClearSearch" title="Clear search">&times;</button>
        </div>
        <div class="filter-chips">
          <div class="chip active" id="chipAll" data-mode="all">All</div>
          <div class="chip" id="chipTitle" data-mode="title">Title</div>
          <div class="chip" id="chipContent" data-mode="content">Content</div>
          <div class="chip" id="chipPath" data-mode="path">Path</div>
          <select id="sortSelect" class="sort-select" title="Sort conversations">
            <option value="recent">Recent</option>
            <option value="oldest">Oldest</option>
            <option value="messages">Messages</option>
            <option value="tokens">Context Size</option>
            <option value="traffic">API Traffic</option>
          </select>
        </div>
      </div>
      <div class="list-summary-strip" id="listSummaryStrip" style="display:none;">
        <span id="summaryCount">0 conversations</span>
        <span id="summaryMetrics">0 messages / ~0 tokens</span>
      </div>
      <div class="conv-list" id="convList"></div>
    </div>

    <!-- Splitter between Pane 2 and Pane 3 -->
    <div class="resizer" id="resizer2" title="Drag to resize"></div>

    <!-- Pane 3: Detail Preview -->
    <div class="pane-detail" id="paneDetail">
      <div class="empty-state">Select a conversation to view message statistics, token breakdown, and transcript</div>
    </div>

  </div>

  <div id="findWidget" class="find-widget" style="display:none;">
    <div class="find-input-wrap">
      <input type="text" id="findInput" placeholder="Find in messages (Enter = next)..." spellcheck="false">
      <span class="find-count" id="findCount">0 of 0</span>
    </div>
    <button class="find-btn" id="findPrevBtn" title="Previous match (Shift+Enter)">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/><path d="M4.5 13.5l4-4 4 4"/></svg>
    </button>
    <button class="find-btn" id="findNextBtn" title="Next match (Enter)">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5l4 4 4-4"/></svg>
    </button>
    <button class="find-btn toggle-btn" id="findCaseBtn" title="Match Case (Alt+C)">Aa</button>
    <button class="find-btn close-btn" id="findCloseBtn" title="Close (Escape)">&times;</button>
  </div>

  <div id="contextBackdrop" class="context-backdrop" style="display:none;"></div>
  <div id="contextMenu" class="context-menu" style="display:none;"></div>

<script>
  const vscode = acquireVsCodeApi();

  let state = {
    tree: [],
    conversations: [],
    filteredTokens: 0,
    filteredMessages: 0,
    folderName: 'All Conversations',
    folderTotalConversations: 0,
    folderTotalMessages: 0,
    folderUserMsgs: 0,
    folderModelMsgs: 0,
    folderTotalTokens: 0,
    folderCumulativeTokens: 0,
    folderTotalSteps: 0,
    totalConversations: 0,
    currentWorkspace: '',
    currentWorkspaceCount: 0,
    selectedFolder: 'ALL',
    includeSubfolders: true,
    selectedId: null,
    searchQuery: '',
    searchMode: 'all',
    sortBy: 'recent',
    detail: null,
    matchesOnly: false,
    expandedFolders: new Set()
  };

  let searchDebounce = null;

  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');

  function updateSearch(val) {
    state.searchQuery = val;
    btnClearSearch.classList.toggle('visible', val.trim().length > 0);
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      vscode.postMessage({ type: 'search', query: val, mode: state.searchMode });
      if (state.detail) renderDetailPane();
    }, 120);
  }

  searchInput.addEventListener('input', ev => updateSearch(ev.target.value));
  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    updateSearch('');
    searchInput.focus();
  });

  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const mode = chip.getAttribute('data-mode') || 'all';
      state.searchMode = mode;
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      vscode.postMessage({ type: 'search', query: state.searchQuery, mode });
    });
  });

  document.getElementById('sortSelect').addEventListener('change', ev => {
    state.sortBy = ev.target.value;
    vscode.postMessage({ type: 'sort', sortBy: state.sortBy });
  });

  // Context Menu functions
  function showContextMenu(x, y, id) {
    const c = state.conversations.find(item => item.id === id);
    if (!c) return;

    const menu = document.getElementById('contextMenu');
    const backdrop = document.getElementById('contextBackdrop');

    menu.innerHTML = 
      '<div class="context-menu-item" data-action="move" data-id="' + escapeHtml(c.id) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 10H2V3h4.29l.86.85.35.15H14v9z"/></svg>' +
        '<span>Move to Folder...</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="openInChat" data-id="' + escapeHtml(c.id) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v7A1.5 1.5 0 0 0 2.5 13h1.86l2.14 2.14a.5.5 0 0 0 .85-.35V13h6.15a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 3h-10z"/></svg>' +
        '<span>Open in Chat</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="openTranscriptLog" data-id="' + escapeHtml(c.id) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/></svg>' +
        '<span>View Log</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="exportMd" data-id="' + escapeHtml(c.id) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2zm-2.5 3.5a.5.5 0 0 0-1 0v3.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 11.793V8z"/></svg>' +
        '<span>Export to MD...</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="rename" data-id="' + escapeHtml(c.id) + '" data-title="' + escapeHtml(c.title) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>' +
        '<span>Rename...</span>' +
      '</div>' +
      '<div class="context-menu-item" data-action="syncSingle" data-id="' + escapeHtml(c.id) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-7.068 2H.534a.25.25 0 0 1-.192-.41l1.966-2.36a.25.25 0 0 1 .384 0l1.966 2.36a.25.25 0 0 1-.192.41z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 4.9 4c1.552 0 2.94-.707 3.857-1.818a.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>' +
        '<span>Sync (IDE &lt;-&gt; App)</span>' +
      '</div>' +
      '<div class="context-menu-separator"></div>' +
      '<div class="context-menu-item danger" data-action="delete" data-id="' + escapeHtml(c.id) + '">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>' +
        '<span>Delete</span>' +
      '</div>';

    const menuWidth = 185;
    const menuHeight = 195;
    const posX = (x + menuWidth > window.innerWidth) ? Math.max(10, window.innerWidth - menuWidth - 10) : x;
    const posY = (y + menuHeight > window.innerHeight) ? Math.max(10, window.innerHeight - menuHeight - 10) : y;

    menu.style.left = posX + 'px';
    menu.style.top = posY + 'px';
    menu.style.display = 'block';
    backdrop.style.display = 'block';
  }

  function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    const backdrop = document.getElementById('contextBackdrop');
    if (menu) menu.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
  }

  document.getElementById('contextMenu').addEventListener('click', ev => {
    const item = ev.target.closest('[data-action]');
    if (!item) return;
    const action = item.getAttribute('data-action');
    const id = item.getAttribute('data-id');
    hideContextMenu();
    if (action === 'move' && id) {
      vscode.postMessage({ type: 'moveConversation', id });
    } else if (action === 'openInChat' && id) {
      vscode.postMessage({ type: 'openInChat', id });
    } else if (action === 'openTranscriptLog' && id) {
      vscode.postMessage({ type: 'openTranscriptLog', id });
    } else if (action === 'exportMd' && id) {
      vscode.postMessage({ type: 'exportMd', id });
    } else if (action === 'syncSingle' && id) {
      vscode.postMessage({ type: 'syncSingleConversation', id });
    } else if (action === 'rename' && id) {
      const title = item.getAttribute('data-title') || '';
      vscode.postMessage({ type: 'requestRename', id, oldTitle: title });
    } else if (action === 'delete' && id) {
      vscode.postMessage({ type: 'delete', id });
    }
  });

  document.getElementById('contextBackdrop').addEventListener('click', hideContextMenu);
  document.getElementById('contextBackdrop').addEventListener('contextmenu', ev => {
    ev.preventDefault();
    hideContextMenu();
  });

  // Event delegation for Conversation List
  document.getElementById('convList').addEventListener('click', ev => {
    const item = ev.target.closest('.conv-item[data-id]');
    if (item) {
      const id = item.getAttribute('data-id');
      if (id) selectConversation(id);
    }
  });

  document.addEventListener('contextmenu', ev => {
    const item = ev.target.closest('.conv-item[data-id]');
    if (item) {
      ev.preventDefault();
      const id = item.getAttribute('data-id');
      if (id) {
        selectConversation(id);
        showContextMenu(ev.clientX, ev.clientY, id);
      }
    } else {
      if (!ev.target.closest('input, textarea')) {
        ev.preventDefault();
      }
    }
  });

  // Event delegation for Detail Pane
  document.getElementById('paneDetail').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if (action === 'openInChat' && id) {
      vscode.postMessage({ type: 'openInChat', id });
    } else if (action === 'openTranscriptLog' && id) {
      vscode.postMessage({ type: 'openTranscriptLog', id });
    } else if (action === 'syncSingleConversation' && id) {
      vscode.postMessage({ type: 'syncSingleConversation', id });
    } else if (action === 'rename' && id) {
      const title = btn.getAttribute('data-title') || '';
      vscode.postMessage({ type: 'requestRename', id, oldTitle: title });
    } else if (action === 'move' && id) {
      vscode.postMessage({ type: 'moveConversation', id });
    } else if (action === 'delete' && id) {
      vscode.postMessage({ type: 'delete', id });
    } else if (action === 'openTrafficReport') {
      vscode.postMessage({ type: 'openTrafficReport' });
    } else if (action === 'openFind') {
      openFindWidget();
    } else if (action === 'copy') {
      const text = btn.getAttribute('data-copy') || '';
      vscode.postMessage({ type: 'copy', text });
    } else if (action === 'jumpConv' && id) {
      selectConversation(id);
    } else if (action === 'forkFromStep' && id) {
      const step = parseInt(btn.getAttribute('data-step') || '-1', 10);
      if (step >= 0) {
        vscode.postMessage({ type: 'forkConversation', id, stepIndex: step });
      }
    }
  });

  document.getElementById('folderOverview').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-action="openTrafficReport"]');
    if (btn) {
      vscode.postMessage({ type: 'openTrafficReport' });
      return;
    }
  });

  document.getElementById('paneDetail').addEventListener('change', ev => {
    if (ev.target && ev.target.id === 'chkMatchesOnly') {
      state.matchesOnly = ev.target.checked;
      renderDetailPane();
    }
  });

  function selectConversation(id) {
    state.selectedId = id;
    renderConversationList();
    vscode.postMessage({ type: 'selectConversation', id });
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'refreshRequest':
        vscode.postMessage({ type: 'refresh' });
        break;
      case 'state':
        state = { ...state, ...msg };
        renderFolderOverview();
        renderConversationList();
        const hb = document.getElementById('headerTotalBadge'); if (hb) hb.innerText = String(msg.totalConversations || 0);
        if (!state.selectedId && state.detail) {
          state.detail = null;
          renderDetailPane();
        }
        break;
      case 'conversationList':
        state = { ...state, ...msg };
        renderFolderOverview();
        renderConversationList();
        if (state.detail) renderDetailPane();
        break;
      case 'detail':
        state.detail = msg;
        renderDetailPane();
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) {
      const hrs = Math.floor(diff / 3600000);
      if (hrs <= 0) {
        const mins = Math.floor(diff / 60000);
        return mins <= 1 ? 'now' : mins + 'm';
      }
      return hrs + 'h';
    }
    const D = d.getDate();
    const M = d.getMonth() + 1;
    const Y = d.getFullYear();
    return Y === now.getFullYear() ? (D + '/' + M) : (D + '/' + M + '/' + Y);
  }

  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(2).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1') + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(num);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function highlightMatches(text, query) {
    if (!text) return '';
    const q = (query || '').trim();
    if (!q) return escapeHtml(text);
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    let result = '';
    let lastIdx = 0;
    let idx = lowerText.indexOf(lowerQ);
    while (idx !== -1) {
      result += escapeHtml(text.slice(lastIdx, idx));
      result += '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>';
      lastIdx = idx + q.length;
      idx = lowerText.indexOf(lowerQ, lastIdx);
    }
    result += escapeHtml(text.slice(lastIdx));
    return result;
  }

  function renderFolderOverview() {
    const container = document.getElementById('folderOverview');
    if (!container) return;

    const fName = state.folderName || 'All Conversations';
    const isSearching = Boolean((state.searchQuery || '').trim());
    const count = (typeof state.folderTotalConversations === 'number') ? state.folderTotalConversations : state.conversations.length;
    const msgs = (typeof state.folderTotalMessages === 'number') ? state.folderTotalMessages : (state.filteredMessages || 0);
    const userMsgs = state.folderUserMsgs || 0;
    const aiMsgs = state.folderModelMsgs || 0;
    const tokens = (typeof state.folderTotalTokens === 'number') ? state.folderTotalTokens : (state.filteredTokens || 0);
    const steps = state.folderTotalSteps || 0;

    let iconSvg = '';
    if (state.selectedFolder === 'ALL') {
      iconSvg = '<svg class="overview-title-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3V4h10v8zM5 6h6v1H5V6zm0 3h6v1H5V9z"/></svg>';
    } else if (state.selectedFolder === 'CURRENT') {
      iconSvg = '<svg class="overview-title-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.251.068a.5.5 0 0 1 .42.58L10.477 6.5H14a.5.5 0 0 1 .372.832l-9.5 10.5a.5.5 0 0 1-.84-.528l1.2-5.804H1.5a.5.5 0 0 1-.372-.832l9.5-10.5a.5.5 0 0 1 .623-.1z"/></svg>';
    } else if (state.selectedFolder === 'Standalone' || state.selectedFolder === '(No Workspace)') {
      iconSvg = '<svg class="overview-title-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--muted);"><path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3V4h10v8z"/></svg>';
    } else if (/^[a-zA-Z]:/.test(state.selectedFolder)) {
      iconSvg = '<svg class="overview-title-icon drive-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 3H3V4h10v2zm1 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1zm-1 3H3v-2h10v2z"/></svg>';
    } else {
      iconSvg = '<svg class="overview-title-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 10H2V3h4.29l.86.85.35.15H14v9z"/></svg>';
    }

    const scopeLabel = state.selectedFolder === 'ALL'
      ? 'Global'
      : (state.includeSubfolders ? 'Recursive' : 'Direct folder');

    const convSub = isSearching
      ? (state.conversations.length + ' matching filter')
      : (count === 1 ? '1 conversation' : count + ' conversations');

    const msgSub = (userMsgs || aiMsgs)
      ? (formatNumber(userMsgs) + ' user · ' + formatNumber(aiMsgs) + ' AI')
      : 'User & Assistant';

    const apiTraffic = (typeof state.folderCumulativeTokens === 'number') ? state.folderCumulativeTokens : tokens;

    container.innerHTML =
      '<div class="overview-header">' +
        '<div class="overview-title" title="' + escapeHtml(state.selectedFolder) + '">' +
          iconSvg +
          '<span class="overview-name">' + escapeHtml(fName) + '</span>' +
        '</div>' +
        '<span class="overview-scope-badge">' + scopeLabel + '</span>' +
      '</div>' +
      '<div class="overview-cards">' +
        '<div class="m3-stat-card">' +
          '<div class="m3-label">Conversations</div>' +
          '<div class="m3-value">' + count + '</div>' +
          '<div class="m3-sub" title="' + escapeHtml(convSub) + '">' + escapeHtml(convSub) + '</div>' +
        '</div>' +
        '<div class="m3-stat-card">' +
          '<div class="m3-label">Messages</div>' +
          '<div class="m3-value">' + formatNumber(msgs) + '</div>' +
          '<div class="m3-sub" title="' + escapeHtml(msgSub) + '">' + escapeHtml(msgSub) + '</div>' +
        '</div>' +
        '<div class="m3-stat-card">' +
          '<div class="m3-label">Context Memory</div>' +
          '<div class="m3-value">~' + formatNumber(tokens) + '</div>' +
          '<div class="m3-sub">active context</div>' +
        '</div>' +
        '<div class="m3-stat-card clickable" id="cardApiTraffic" data-action="openTrafficReport" title="Click to open detailed API Traffic & Token Report" style="cursor:pointer;">' +
          '<div class="m3-label">API Traffic (Full)</div>' +
          '<div class="m3-value">~' + formatNumber(apiTraffic) + '</div>' +
          '<div class="m3-sub">Cumulative &middot; View Report &rarr;</div>' +
        '</div>' +
      '</div>';
  }

  function renderConversationList() {
    const isSearching = Boolean((state.searchQuery || '').trim());
    const strip = document.getElementById('listSummaryStrip');
    if (isSearching) {
      strip.style.display = 'flex';
      document.getElementById('summaryCount').innerText = state.conversations.length + ' matching filter';
      document.getElementById('summaryMetrics').innerText = formatNumber(state.filteredMessages) + ' messages · ~' + formatNumber(state.filteredTokens) + ' tokens';
    } else {
      strip.style.display = 'none';
    }

    const container = document.getElementById('convList');
    if (state.conversations.length === 0) {
      container.innerHTML = '<div class="empty-state">No conversations match the current filter</div>';
      return;
    }

    let html = '';
    for (const c of state.conversations) {
      const isSel = c.id === state.selectedId;
      const isStandalone = !c.workspaces || c.workspaces.length === 0 || c.workspaces[0] === 'Standalone' || c.workspaces[0] === '(No Workspace)';
      const wsName = isStandalone ? 'Standalone' : (c.workspaces[0].split('/').pop() || c.workspaces[0]);
      const wsOrphaned = !isStandalone && Boolean(c.isOrphaned);
      const wsDisplay = escapeHtml(wsName) + (wsOrphaned ? ' <span class="orphaned-tag">(orphaned)</span>' : '');
      const timeStr = formatTime(c.lastModifiedTime);
      const titleHighlighted = highlightMatches(c.title, state.searchQuery);
      const snippetRaw = c.matchSnippet || c.firstMessageSnippet;
      const snippetHighlighted = snippetRaw ? highlightMatches(snippetRaw, state.searchQuery) : '';
      const totalMsgs = (c.userMsgs || 0) + (c.modelMsgs || 0);
      let sourceBadge = '';
      if (c.source === 'app') {
        sourceBadge = '<span class="source-tag app" title="Standalone App (~/.gemini/antigravity)">App</span>';
      } else if (c.source === 'both') {
        sourceBadge = '<span class="source-tag both" title="Synced in both IDE and Standalone App">Both</span>';
      } else {
        sourceBadge = '<span class="source-tag ide" title="Antigravity IDE (~/.gemini/antigravity-ide)">IDE</span>';
      }

      html += '<div class="conv-item ' + (isSel ? 'active' : '') + '" data-id="' + escapeHtml(c.id) + '">' +
        '<div class="conv-title" title="' + escapeHtml(c.title) + '">' + titleHighlighted + '</div>' +
        '<div class="conv-meta">' +
        '<span class="conv-folder-badge">' + sourceBadge + wsDisplay + '</span>' +
        '<span>&middot;</span>' +
        '<span>' + totalMsgs + ' messages (' + (c.userMsgs || 0) + '/' + (c.modelMsgs || 0) + ')</span>' +
        '<span>&middot;</span>' +
        '<span>' + (state.sortBy === 'traffic' ? ('~' + formatNumber(c.cumulativeTokens || c.estTotalTokens) + ' traffic') : ('~' + formatNumber(c.estTotalTokens) + ' tokens')) + '</span>' +
        '<span style="margin-left:auto;flex-shrink:0;">' + escapeHtml(timeStr) + '</span>' +
        '</div>' +
        (snippetHighlighted ? '<div class="conv-snippet">' + snippetHighlighted + '</div>' : '') +
        '</div>';
    }
    container.innerHTML = html;
  }

  function renderDetailPane() {
    const container = document.getElementById('paneDetail');
    if (!state.detail || !state.detail.conversation) {
      container.innerHTML = '<div class="empty-state">Select a conversation to view message statistics, token breakdown, and transcript</div>';
      return;
    }

    const c = state.detail.conversation;
    const msgs = state.detail.messages || [];
    const q = (state.searchQuery || '').trim().toLowerCase();

    const isStandalone = !c.workspaces || c.workspaces.length === 0 || c.workspaces[0] === 'Standalone' || c.workspaces[0] === '(No Workspace)';
    const wsStr = isStandalone ? 'Standalone' : c.workspaces.join(', ');
    const wsShort = isStandalone ? 'Standalone' : (c.workspaces[0].split('/').pop() || c.workspaces[0]);
    const wsOrphaned = !isStandalone && Boolean(c.isOrphaned);
    const wsDisplay = escapeHtml(wsShort) + (wsOrphaned ? ' <span class="orphaned-tag">(orphaned)</span>' : '');
    const wsFullTitle = escapeHtml(wsStr) + (wsOrphaned ? ' (orphaned)' : '');
    const createdStr = new Date(c.createdTime).toLocaleString();
    const modifiedStr = new Date(c.lastModifiedTime).toLocaleString();
    const durationMs = Math.max(0, c.lastModifiedTime - c.createdTime);
    const durationMins = Math.round(durationMs / 60000);
    const durationStr = durationMins >= 60 ? (Math.floor(durationMins / 60) + 'h ' + (durationMins % 60) + 'm') : (durationMins + 'm');

    let matchCount = 0;
    const msgEntries = [];
    for (const m of msgs) {
      const contentMatch = q && m.content && m.content.toLowerCase().includes(q);
      const thinkMatch = q && m.thinking && m.thinking.toLowerCase().includes(q);
      const hasMatch = Boolean(contentMatch || thinkMatch);
      if (hasMatch) matchCount++;
      if (q && state.matchesOnly && !hasMatch) continue;
      msgEntries.push({ m, thinkMatch });
    }

    let messagesHtml = '';
    for (const entry of msgEntries) {
      const m = entry.m;
      const isUser = m.role === 'user';
      const roleLabel = isUser ? 'User' : (m.role === 'system' ? 'Archive' : 'Assistant');
      const bodyHighlighted = highlightMatches(m.content, state.searchQuery);
      const thinkingHtml = m.thinking
        ? '<details class="thinking-block" ' + (entry.thinkMatch ? 'open' : '') + '><summary>Thinking (' + formatNumber(m.thinking.length) + ' chars)</summary><div class="thinking-content">' + highlightMatches(m.thinking, state.searchQuery) + '</div></details>'
        : '';
      const stepLabel = m.stepIndex !== undefined ? ('Step #' + m.stepIndex) : '';
      const timeLabel = m.time ? new Date(m.time).toLocaleTimeString() : '';
      const rightMeta = [stepLabel, timeLabel].filter(Boolean).join(' · ');
      const forkBtn = (m.stepIndex !== undefined)
        ? '<button class="btn-mini msg-fork-btn" data-action="forkFromStep" data-id="' + escapeHtml(c.id) + '" data-step="' + m.stepIndex + '" title="Fork conversation from this step (' + stepLabel + ')">Fork</button>'
        : '';

      const roleClass = isUser ? 'user' : (m.role === 'system' ? 'archive' : 'assistant');
      messagesHtml += '<div class="msg-bubble ' + (isUser ? 'user' : 'assistant') + '">' +
        '<div class="msg-header"><span class="msg-role-pill ' + roleClass + '">' + roleLabel + '</span><span class="msg-header-right"><span>' + escapeHtml(rightMeta) + '</span>' + forkBtn + '</span></div>' +
        thinkingHtml +
        '<div class="msg-body">' + bodyHighlighted + '</div>' +
        '</div>';
    }

    const totalMsgs = (c.userMsgs || 0) + (c.modelMsgs || 0);
    const thinkingNote = c.estThinkingTokens ? (' (' + formatNumber(c.estThinkingTokens) + ' think)') : '';

    container.innerHTML =
      '<div class="detail-header">' +
        '<div class="detail-title" title="' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn-primary" data-action="openInChat" data-id="' + escapeHtml(c.id) + '">Open in Chat</button>' +
          '<button class="btn-secondary" data-action="syncSingleConversation" data-id="' + escapeHtml(c.id) + '" title="Sync this conversation between IDE and App (~/.gemini/antigravity)">Sync</button>' +
          '<button class="btn-secondary" data-action="openFind" title="Find in conversation (Ctrl+F)">Find</button>' +
          '<button class="btn-secondary" data-action="openTranscriptLog" data-id="' + escapeHtml(c.id) + '">View Log</button>' +
        '</div>' +
      '</div>' +

      '<div class="detail-stats">' +
        '<div class="m3-stat-card">' +
          '<span class="m3-label">Messages</span>' +
          '<span class="m3-value">' + totalMsgs + ' total</span>' +
          '<span class="m3-sub">' + (c.userMsgs || 0) + ' user / ' + (c.modelMsgs || 0) + ' AI · ' + (c.toolCalls || 0) + ' tools</span>' +
        '</div>' +
        '<div class="m3-stat-card">' +
          '<span class="m3-label">Context Memory</span>' +
          '<span class="m3-value">~' + formatNumber(c.estTotalTokens) + '</span>' +
          '<span class="m3-sub">' + formatNumber(c.estInputTokens) + ' in / ' + formatNumber(c.estOutputTokens) + ' out' + thinkingNote + '</span>' +
        '</div>' +
        '<div class="m3-stat-card clickable" data-action="openTrafficReport" title="Click to open detailed API Traffic & Token Report" style="cursor:pointer;">' +
          '<span class="m3-label">API Traffic (Full)</span>' +
          '<span class="m3-value">~' + formatNumber(c.cumulativeTokens || c.estTotalTokens) + '</span>' +
          '<span class="m3-sub">' + (c.modelMsgs || 0) + ' reqs &middot; Cumulative &rarr;</span>' +
        '</div>' +
        '<div class="m3-stat-card">' +
          '<span class="m3-label">Duration</span>' +
          '<span class="m3-value">' + durationStr + '</span>' +
          '<span class="m3-sub">Updated ' + formatTime(c.lastModifiedTime) + '</span>' +
        '</div>' +
      '</div>' +

      '<div class="metadata-bar">' +
        '<div class="m3-chip"><b>Source:</b> ' + (c.source === 'app' ? '<span class="source-tag app">App</span> <span>Standalone (~/.gemini/antigravity)</span>' : (c.source === 'both' ? '<span class="source-tag both">Both</span> <span>Synced (IDE &amp; App)</span>' : '<span class="source-tag ide">IDE</span> <span>Antigravity IDE (~/.gemini/antigravity-ide)</span>')) + '</div>' +
        '<div class="m3-chip"><b>ID:</b> <span class="meta-link" style="font-family:var(--mono);" data-action="copy" data-copy="' + escapeHtml(c.id) + '" title="Click to copy full ID">' + escapeHtml(c.id) + '</span></div>' +
        '<div class="m3-chip"><b>Workspace:</b> <span class="meta-link" data-action="copy" data-copy="' + escapeHtml(wsStr) + '" title="' + wsFullTitle + ' (click to copy)">' + wsDisplay + '</span></div>' +
        '<div class="m3-chip"><b>Steps:</b> <span>' + c.stepCount + ' (' + (c.hasTranscript ? 'Transcript' : 'DB') + ')</span></div>' +
        '<div class="m3-chip"><b>Created:</b> <span>' + escapeHtml(createdStr) + '</span></div>' +
        '<div class="m3-chip"><b>Modified:</b> <span>' + escapeHtml(modifiedStr) + '</span></div>' +
        (c.parentConversationId ? ('<div class="m3-chip"><b>Forked:</b> <span class="meta-link" style="font-family:var(--mono);" data-action="jumpConv" data-id="' + escapeHtml(c.parentConversationId) + '" title="Open parent conversation">' + escapeHtml(c.parentConversationId.slice(0, 8)) + '...</span></div>') : '') +
      '</div>' +

      (q ? (
        '<div class="detail-search-bar">' +
          '<span>Found matches in <b>' + matchCount + '</b> of ' + msgs.length + ' messages for "' + escapeHtml(state.searchQuery.trim()) + '"</span>' +
          '<label><input type="checkbox" id="chkMatchesOnly" ' + (state.matchesOnly ? 'checked' : '') + '> Show matching messages only</label>' +
        '</div>'
      ) : '') +

      '<div class="messages-container">' +
        (messagesHtml || '<div class="empty-state">No transcript messages found for this conversation.</div>') +
      '</div>';

    if (findState.isOpen && findState.query) {
      setTimeout(performFind, 60);
    }
  }

  // Draggable Splitter for Resizing Columns
  (function initResizers() {
    const r2 = document.getElementById('resizer2');
    const pL = document.getElementById('paneList');
    if (!r2 || !pL) return;

    try {
      const w2 = localStorage.getItem('cm_pane2_width');
      if (w2 && !isNaN(Number(w2))) pL.style.width = Math.max(280, Math.min(window.innerWidth - 300, Number(w2))) + 'px';
    } catch (_) {}

    let startX = 0;
    let startWidth = 0;

    function onMouseMove(e) {
      const dx = e.clientX - startX;
      let newW = startWidth + dx;
      newW = Math.max(280, Math.min(window.innerWidth - 280, newW));
      pL.style.width = newW + 'px';
      try { localStorage.setItem('cm_pane2_width', String(newW)); } catch (_) {}
    }

    function onMouseUp() {
      r2.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    r2.addEventListener('mousedown', e => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = pL.offsetWidth;
      r2.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  })();

  document.getElementById('folderOverview').addEventListener('click', ev => {
    if (ev.target && ev.target.closest('#btnRefreshOverview')) {
      vscode.postMessage({ type: 'refresh' });
    }
  });

  // ==========================================
  // In-Conversation Find Widget Engine (Ctrl+F)
  // ==========================================
  let findState = {
    isOpen: false,
    query: '',
    matchCase: false,
    matches: [],
    activeIndex: -1
  };

  function clearFindHighlights() {
    const marks = Array.from(document.querySelectorAll('#paneDetail mark.find-match'));
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    }
    findState.matches = [];
    findState.activeIndex = -1;
    updateFindCount();
  }

  function updateFindCount() {
    const el = document.getElementById('findCount');
    if (!el) return;
    if (!findState.query) {
      el.textContent = '0 of 0';
    } else if (findState.matches.length === 0) {
      el.textContent = 'No results';
    } else {
      el.textContent = (findState.activeIndex + 1) + ' of ' + findState.matches.length;
    }
  }

  function jumpToMatch(index) {
    if (findState.matches.length === 0) return;
    if (findState.activeIndex >= 0 && findState.activeIndex < findState.matches.length) {
      findState.matches[findState.activeIndex].classList.remove('active-match');
    }
    findState.activeIndex = (index + findState.matches.length) % findState.matches.length;
    const target = findState.matches[findState.activeIndex];
    if (target) {
      target.classList.add('active-match');
      const details = target.closest('details');
      if (details) details.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    updateFindCount();
  }

  function performFind() {
    clearFindHighlights();
    const q = findState.query;
    if (!q) return;

    const container = document.querySelector('#paneDetail .messages-container') || document.getElementById('paneDetail');
    if (!container) return;

    const textNodes = [];
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node => {
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('#findWidget, .m3-stat-card, .stat-card, .detail-actions, script, style')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let n;
    while (n = walker.nextNode()) {
      textNodes.push(n);
    }

    const matches = [];
    const searchTarget = findState.matchCase ? q : q.toLowerCase();

    for (const node of textNodes) {
      const text = node.textContent || '';
      const compareText = findState.matchCase ? text : text.toLowerCase();
      let index = compareText.indexOf(searchTarget);
      if (index === -1) continue;

      const parent = node.parentNode;
      if (!parent) continue;

      let remainingNode = node;
      while (index !== -1) {
        const matchNode = remainingNode.splitText(index);
        remainingNode = matchNode.splitText(q.length);

        const mark = document.createElement('mark');
        mark.className = 'find-match';
        mark.textContent = matchNode.textContent;

        parent.replaceChild(mark, matchNode);
        matches.push(mark);

        const comp = findState.matchCase ? (remainingNode.textContent || '') : (remainingNode.textContent || '').toLowerCase();
        index = comp.indexOf(searchTarget);
      }
    }

    findState.matches = matches;
    if (matches.length > 0) {
      jumpToMatch(0);
    } else {
      updateFindCount();
    }
  }

  function openFindWidget() {
    const widget = document.getElementById('findWidget');
    const input = document.getElementById('findInput');
    if (!widget || !input) return;

    widget.style.display = 'flex';
    findState.isOpen = true;

    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length < 80) {
      input.value = sel;
      findState.query = sel;
    }
    input.focus();
    input.select();
    if (input.value) {
      performFind();
    }
  }

  function closeFindWidget() {
    const widget = document.getElementById('findWidget');
    if (widget) widget.style.display = 'none';
    findState.isOpen = false;
    clearFindHighlights();
  }

  window.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'f' || ev.key === 'F')) {
      ev.preventDefault();
      openFindWidget();
      return;
    }

    if (ev.key === 'F3') {
      ev.preventDefault();
      if (!findState.isOpen) {
        openFindWidget();
      } else if (ev.shiftKey) {
        jumpToMatch(findState.activeIndex - 1);
      } else {
        jumpToMatch(findState.activeIndex + 1);
      }
      return;
    }

    if (ev.key === 'Escape' && findState.isOpen) {
      ev.preventDefault();
      closeFindWidget();
      return;
    }
  });

  document.getElementById('findInput').addEventListener('input', ev => {
    findState.query = ev.target.value;
    performFind();
  });

  document.getElementById('findInput').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.shiftKey) {
        jumpToMatch(findState.activeIndex - 1);
      } else {
        jumpToMatch(findState.activeIndex + 1);
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      closeFindWidget();
    }
  });

  document.getElementById('findNextBtn').addEventListener('click', () => {
    jumpToMatch(findState.activeIndex + 1);
  });

  document.getElementById('findPrevBtn').addEventListener('click', () => {
    jumpToMatch(findState.activeIndex - 1);
  });

  document.getElementById('findCaseBtn').addEventListener('click', () => {
    findState.matchCase = !findState.matchCase;
    document.getElementById('findCaseBtn').classList.toggle('active', findState.matchCase);
    performFind();
  });

  document.getElementById('findCloseBtn').addEventListener('click', () => {
    closeFindWidget();
  });

</script>
</body>
</html>`;
    }
}
