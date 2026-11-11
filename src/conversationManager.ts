import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

export interface CachedConversation {
    id: string;
    title: string;
    workspaces: string[];
    rawWorkspaces: string[];
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
}

interface DiskCachePayload {
    version: number;
    items: CachedConversation[];
}

export class ConversationManagerProvider {
    public static currentPanel: vscode.WebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private _conversations: CachedConversation[] = [];
    private _selectedFolder: string = 'ALL';
    private _includeSubfolders: boolean = true;
    private _selectedId: string | null = null;
    private _searchQuery: string = '';
    private _searchMode: 'all' | 'title' | 'content' = 'all';
    private _sortBy: 'recent' | 'oldest' | 'messages' | 'tokens' | 'steps' = 'recent';

    private static readonly CACHE_VERSION = 4;
    private static readonly CACHE_FILE = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'enhancer_conversations_cache.json');

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConversationManagerProvider.currentPanel) {
            ConversationManagerProvider.currentPanel.reveal(column);
            ConversationManagerProvider.currentPanel.webview.postMessage({ type: 'refreshRequest' });
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
        new ConversationManagerProvider(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

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
                }
            },
            null,
            this._disposables
        );

        this._loadConversations();
    }

    public dispose() {
        ConversationManagerProvider.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _normalizePath(uriOrPath: string): string {
        try {
            let s = decodeURIComponent(uriOrPath || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
            if (s.startsWith('file:///')) s = s.slice(8);
            else if (s.startsWith('file://')) s = s.slice(7);
            s = s.replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
            if (/^[a-zA-Z]:/.test(s)) {
                s = s.charAt(0).toUpperCase() + s.slice(1);
            }
            while (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1);
            return s;
        } catch {
            let s = String(uriOrPath || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
            if (/^[a-zA-Z]:/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
            while (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1);
            return s;
        }
    }

    private _readDiskCache(): Map<string, CachedConversation> {
        const map = new Map<string, CachedConversation>();
        try {
            if (fs.existsSync(ConversationManagerProvider.CACHE_FILE)) {
                const raw = JSON.parse(fs.readFileSync(ConversationManagerProvider.CACHE_FILE, 'utf8'));
                if (raw && !Array.isArray(raw) && raw.version === ConversationManagerProvider.CACHE_VERSION && Array.isArray(raw.items)) {
                    for (const item of raw.items) {
                        if (item && item.id) {
                            if (Array.isArray(item.workspaces)) {
                                item.workspaces = item.workspaces.map((w: string) => this._normalizePath(w));
                            }
                            map.set(item.id, item);
                        }
                    }
                }
            }
        } catch {}
        return map;
    }

    private _writeDiskCache(conversations: CachedConversation[]) {
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
            const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
            const convDir = path.join(baseDir, 'conversations');
            const brainDir = path.join(baseDir, 'brain');
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

            const dbFiles = fs.existsSync(convDir)
                ? fs.readdirSync(convDir).filter(f => f.endsWith('.db'))
                : [];

            const idSet = new Set<string>(dbFiles.map(f => f.replace('.db', '')));
            for (const key of summariesMap.keys()) {
                idSet.add(key);
            }
            if (fs.existsSync(brainDir)) {
                for (const f of fs.readdirSync(brainDir)) {
                    if (f !== 'tempmediaStorage' && !f.startsWith('.')) {
                        idSet.add(f);
                    }
                }
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

            const toolOutputTypes = new Set([
                'RUN_COMMAND',
                'VIEW_FILE',
                'CODE_ACTION',
                'LIST_DIRECTORY',
                'GREP_SEARCH',
                'ASK_QUESTION'
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

                const transcriptPath = path.join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
                const hasTranscript = fs.existsSync(transcriptPath);
                const mdPath = path.join(legacyConvDir, `${id}.md`);
                const dbPath = path.join(convDir, `${id}.db`);

                let mtimeMs = 0;
                let fileSize = 0;

                if (hasTranscript) {
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
                    if (title && title !== id) cached.title = title;
                    if (workspaces.length > 0) cached.workspaces = workspaces;
                    if (rawWorkspaces.length > 0) cached.rawWorkspaces = rawWorkspaces;
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
                let firstMsg = '';
                let firstTime = 0;
                const searchableChunks: string[] = [];
                let totalIndexedChars = 0;
                const MAX_INDEX_CHARS = 60000;

                if (hasTranscript) {
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
                                    let txt = typeof step.content === 'string' ? step.content : '';
                                    const match = txt.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                                    if (match) txt = match[1].trim();
                                    userChars += txt.length;
                                    if (!firstMsg && txt) firstMsg = txt.replace(/\s+/g, ' ').slice(0, 180);
                                    if (txt && totalIndexedChars < MAX_INDEX_CHARS) {
                                        const chunk = txt.replace(/\s+/g, ' ').slice(0, 4000);
                                        searchableChunks.push(chunk);
                                        totalIndexedChars += chunk.length;
                                    }
                                } else if (step.type === 'PLANNER_RESPONSE') {
                                    modelMsgs++;
                                    const c = typeof step.content === 'string' ? step.content : '';
                                    const th = typeof step.thinking === 'string' ? step.thinking : '';
                                    responseChars += c.length;
                                    thinkingChars += th.length;
                                    if (step.tool_calls && Array.isArray(step.tool_calls)) {
                                        toolCalls += step.tool_calls.length;
                                        responseChars += JSON.stringify(step.tool_calls).length;
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
                                } else if (step.type && toolOutputTypes.has(step.type)) {
                                    const c = typeof step.content === 'string' ? step.content : (step.output ? String(step.output) : '');
                                    toolOutputChars += c.length;
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

                const item: CachedConversation = {
                    id,
                    title: (title === id && firstMsg) ? firstMsg.slice(0, 60) : title,
                    workspaces,
                    rawWorkspaces,
                    lastModifiedTime: lastModified || createdFromSumm || Date.now(),
                    createdTime: createdFromSumm || firstTime || lastModified || Date.now(),
                    stepCount: totalSteps,
                    userMsgs,
                    modelMsgs,
                    toolCalls,
                    estInputTokens,
                    estOutputTokens,
                    estThinkingTokens,
                    estTotalTokens: estInputTokens + estOutputTokens + estThinkingTokens,
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
        } catch (e: any) {
            vscode.window.showErrorMessage('Error loading conversations: ' + (e?.message || String(e)));
        }
    }

    private _matchesFolder(conv: CachedConversation, folderLower: string, includeSub: boolean): boolean {
        if (folderLower === '(no workspace)') {
            return conv.workspaces.length === 0;
        }
        const target = this._normalizePath(folderLower).toLowerCase();
        return conv.workspaces.some(w => {
            const wl = this._normalizePath(w).toLowerCase();
            if (includeSub) {
                return wl === target || wl.startsWith(target.endsWith('/') ? target : target + '/');
            }
            return wl === target;
        });
    }

    private _buildFolderTree(): { rootNodes: FolderNode[]; currentWorkspacePath: string; currentWorkspaceCount: number } {
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
            ? this._normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath)
            : '';

        let currentWorkspaceCount = 0;

        for (const conv of this._conversations) {
            if (currentWs && this._matchesFolder(conv, currentWs.toLowerCase(), this._includeSubfolders)) {
                currentWorkspaceCount++;
            }

            const wsList = conv.workspaces.length > 0 ? conv.workspaces : ['(No Workspace)'];

            for (const ws of wsList) {
                if (ws === '(No Workspace)') {
                    if (!rootNodesMap.has(ws)) {
                        rootNodesMap.set(ws, {
                            id: ws,
                            name: ws,
                            fullPath: ws,
                            directCount: 0,
                            totalCount: 0,
                            childrenMap: new Map(),
                            isDriveOrRoot: true
                        });
                    }
                    const node = rootNodesMap.get(ws)!;
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

            return {
                id: fullPath,
                name,
                fullPath,
                directCount,
                totalCount,
                isDriveOrRoot: Boolean(node.isDriveOrRoot),
                children: childrenArray
            };
        };

        const serializedRoots: FolderNode[] = [];
        for (const root of rootNodesMap.values()) {
            serializedRoots.push(compactNode(root));
        }
        serializedRoots.sort((a, b) => {
            if (a.fullPath === '(No Workspace)') return 1;
            if (b.fullPath === '(No Workspace)') return -1;
            return a.name.localeCompare(b.name);
        });

        return { rootNodes: serializedRoots, currentWorkspacePath: currentWs, currentWorkspaceCount };
    }

    private _filterConversations(): { items: any[]; totalTokens: number; totalMessages: number } {
        let list = [...this._conversations];

        const currentWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? this._normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath)
            : '';

        if (this._selectedFolder === 'CURRENT') {
            if (currentWs) {
                const curLower = currentWs.toLowerCase();
                list = list.filter(c => this._matchesFolder(c, curLower, this._includeSubfolders));
            }
        } else if (this._selectedFolder !== 'ALL') {
            const sel = this._selectedFolder.toLowerCase();
            list = list.filter(c => this._matchesFolder(c, sel, this._includeSubfolders));
        }

        const q = this._searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(c => {
                const titleMatch = c.title.toLowerCase().includes(q);
                if (this._searchMode === 'title') return titleMatch;

                const snippetMatch = (c.firstMessageSnippet || '').toLowerCase().includes(q);
                const contentMatch = (c.searchableContent || '').toLowerCase().includes(q);
                const idMatch = c.id.toLowerCase().includes(q);
                const wsMatch = c.workspaces.some(w => w.toLowerCase().includes(q));

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
            const { searchableContent, ...rest } = c;
            return { ...rest, matchSnippet };
        });

        return { items, totalTokens, totalMessages };
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
            selectedId: this._selectedId
        });
    }

    private async _sendDetail(id: string) {
        const conv = this._conversations.find(c => c.id === id);
        if (!conv) return;

        const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
        const transcriptPath = path.join(baseDir, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
        const mdPath = path.join(os.homedir(), '.gemini', 'conversations', `${id}.md`);

        const messages: Array<{ role: string; content: string; thinking?: string; time?: string; stepIndex?: number; toolCount?: number }> = [];

        if (fs.existsSync(transcriptPath)) {
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

    private async _openInChat(id: string) {
        const conv = this._conversations.find(c => c.id === id);
        const curWs = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0])
            ? this._normalizePath(vscode.workspace.workspaceFolders[0].uri.fsPath).toLowerCase()
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

    private async _openTranscriptLog(id: string) {
        const transcriptPath = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
            const doc = await vscode.workspace.openTextDocument(transcriptPath);
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

            const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
            for (const ext of ['.db', '.db-shm', '.db-wal']) {
                const f = path.join(baseDir, 'conversations', `${id}${ext}`);
                if (fs.existsSync(f)) fs.unlinkSync(f);
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

  /* Top Toolbar */
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--sidebar-bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .top-bar .title-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  .badge-count {
    background: var(--badge-bg);
    color: var(--badge-fg);
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 500;
  }
  .btn-icon-text {
    background: var(--btn-sec-bg);
    border: 1px solid transparent;
    color: var(--btn-sec-fg);
    padding: 3px 9px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: inherit;
  }
  .btn-icon-text:hover {
    background: var(--btn-sec-hover);
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

  /* 3-Pane Layout */
  .main-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Pane 1: Folder Explorer */
  .pane-folders {
    width: 260px;
    min-width: 210px;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .pane-header {
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--muted);
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .pane-header-actions {
    display: flex;
    gap: 2px;
    text-transform: none;
    letter-spacing: normal;
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
    aspect-ratio: 1 / 1;
    display: block;
    flex-shrink: 0;
  }
  .tree-icon {
    width: 14px;
    height: 14px;
    min-width: 14px;
    min-height: 14px;
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
    opacity: 0.85;
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
  }
  .tree-item.active .tree-badge {
    background: rgba(255, 255, 255, 0.2);
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
  }
  .subfolders-toggle input, .subfolders-toggle label { cursor: pointer; }

  /* Pane 2: Conversation List */
  .pane-list {
    width: 370px;
    min-width: 280px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    flex-shrink: 0;
  }
  .search-box {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    border-radius: 2px;
    padding: 4px 24px 4px 8px;
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
  }
  .search-input:focus {
    border-color: var(--focus-border);
  }
  .search-clear {
    position: absolute;
    right: 5px;
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
    gap: 4px;
    font-size: 11px;
  }
  .chip {
    padding: 2px 7px;
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    user-select: none;
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
    border-radius: 2px;
    font-size: 11px;
    font-family: inherit;
    padding: 2px 4px;
    outline: none;
  }
  .list-summary-strip {
    padding: 4px 10px;
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
  }
  .conv-item {
    padding: 8px 11px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .conv-item:hover {
    background: var(--hover-bg);
  }
  .conv-item.active {
    background: var(--active-bg);
    color: var(--active-fg);
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
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--sidebar-bg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
  }
  .detail-title {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .detail-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .btn-primary {
    background: var(--button-bg);
    color: var(--button-fg);
    border: 1px solid transparent;
    padding: 4px 11px;
    border-radius: 2px;
    cursor: pointer;
    font-weight: 500;
    font-size: 12px;
    font-family: inherit;
  }
  .btn-primary:hover { background: var(--button-hover); }
  .btn-secondary {
    background: var(--btn-sec-bg);
    border: 1px solid transparent;
    color: var(--btn-sec-fg);
    padding: 4px 10px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }
  .btn-secondary:hover { background: var(--btn-sec-hover); }
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
  .stat-card {
    background: var(--sidebar-bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat-card .stat-label {
    font-size: 10.5px;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
    letter-spacing: 0.4px;
  }
  .stat-card .stat-value {
    font-size: 14px;
    font-weight: 600;
  }
  .stat-card .stat-sub {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Metadata row */
  .metadata-bar {
    padding: 7px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    background: var(--sidebar-bg);
    flex-shrink: 0;
  }
  .metadata-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .metadata-item b {
    color: var(--fg);
    font-weight: 500;
  }
  .meta-link {
    color: var(--link);
    cursor: pointer;
    text-decoration: none;
  }
  .meta-link:hover {
    text-decoration: underline;
  }

  /* Search match bar inside detail */
  .detail-search-bar {
    padding: 5px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
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
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg-bubble {
    border-radius: 3px;
    padding: 9px 12px;
    font-size: 12.5px;
    line-height: 1.5;
    border: 1px solid var(--border);
    background: var(--sidebar-bg);
  }
  .msg-bubble.user {
    background: var(--user-bg);
  }
  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--muted);
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .msg-role {
    color: var(--fg);
  }
  .msg-body {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
  }
  .thinking-block {
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--bg);
    font-size: 11.5px;
  }
  .thinking-block summary {
    padding: 4px 8px;
    cursor: pointer;
    color: var(--muted);
    user-select: none;
    font-weight: 500;
  }
  .thinking-block summary:hover {
    color: var(--fg);
  }
  .thinking-content {
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--muted);
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
</style>
</head>
<body>

  <!-- Top Bar -->
  <div class="top-bar">
    <div class="title-group">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="opacity:0.85;">
        <path d="M14 1H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2.5l3 3 3-3H14a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm0 10h-4.17L7.5 13.33 5.17 11H2V2h12v9z"/>
      </svg>
      <span>Conversation Manager</span>
      <span id="headerTotalBadge" class="badge-count">0</span>
    </div>
    <button class="btn-icon-text" id="btnRefresh">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
        <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
      </svg>
      <span>Refresh</span>
    </button>
  </div>

  <!-- Main 3-Pane Layout -->
  <div class="main-layout">

    <!-- Pane 1: Folders Tree -->
    <div class="pane-folders">
      <div class="pane-header">
        <span>Explorer</span>
        <div class="pane-header-actions">
          <button class="btn-mini" id="btnExpandAll" title="Expand All">Expand</button>
          <button class="btn-mini" id="btnCollapseAll" title="Collapse All">Collapse</button>
        </div>
      </div>
      <div class="folder-tree" id="folderTree"></div>
      <div class="subfolders-toggle">
        <input type="checkbox" id="chkSubfolders" checked>
        <label for="chkSubfolders">Include subfolders recursively</label>
      </div>
    </div>

    <!-- Pane 2: Conversation List -->
    <div class="pane-list">
      <div class="search-box">
        <div class="search-input-wrapper">
          <input type="text" id="searchInput" class="search-input" placeholder="Search title or chat content...">
          <button class="search-clear" id="btnClearSearch" title="Clear search">&times;</button>
        </div>
        <div class="filter-chips">
          <div class="chip active" id="chipAll" data-mode="all">All</div>
          <div class="chip" id="chipTitle" data-mode="title">Title</div>
          <div class="chip" id="chipContent" data-mode="content">Content</div>
          <select id="sortSelect" class="sort-select" title="Sort conversations">
            <option value="recent">Recent</option>
            <option value="oldest">Oldest</option>
            <option value="messages">Messages</option>
            <option value="tokens">Tokens</option>
            <option value="steps">Steps</option>
          </select>
        </div>
      </div>
      <div class="list-summary-strip" id="listSummaryStrip">
        <span id="summaryCount">0 conversations</span>
        <span id="summaryMetrics">0 msgs / ~0 tok</span>
      </div>
      <div class="conv-list" id="convList"></div>
    </div>

    <!-- Pane 3: Detail Preview -->
    <div class="pane-detail" id="paneDetail">
      <div class="empty-state">Select a conversation to view message statistics, token breakdown, and transcript</div>
    </div>

  </div>

<script>
  const vscode = acquireVsCodeApi();

  let state = {
    tree: [],
    conversations: [],
    filteredTokens: 0,
    filteredMessages: 0,
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

  document.getElementById('btnRefresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });

  document.getElementById('btnExpandAll').addEventListener('click', () => {
    function collect(nodes) {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) {
          state.expandedFolders.add(n.fullPath);
          collect(n.children);
        }
      }
    }
    collect(state.tree);
    renderFolderTree();
  });

  document.getElementById('btnCollapseAll').addEventListener('click', () => {
    state.expandedFolders.clear();
    renderFolderTree();
  });

  document.getElementById('chkSubfolders').addEventListener('change', ev => {
    state.includeSubfolders = ev.target.checked;
    vscode.postMessage({ type: 'toggleSubfolders', value: state.includeSubfolders });
  });

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

  // Event delegation for Folder Tree
  document.getElementById('folderTree').addEventListener('click', ev => {
    const chev = ev.target.closest('.tree-chevron[data-toggle]');
    if (chev) {
      ev.stopPropagation();
      const folderPath = chev.getAttribute('data-toggle');
      if (folderPath) {
        if (state.expandedFolders.has(folderPath)) state.expandedFolders.delete(folderPath);
        else state.expandedFolders.add(folderPath);
        renderFolderTree();
      }
      return;
    }
    const item = ev.target.closest('.tree-item[data-folder]');
    if (item) {
      const folder = item.getAttribute('data-folder');
      if (folder) {
        state.selectedFolder = folder;
        renderFolderTree();
        vscode.postMessage({ type: 'selectFolder', folder });
      }
    }
  });

  // Event delegation for Conversation List
  document.getElementById('convList').addEventListener('click', ev => {
    const item = ev.target.closest('.conv-item[data-id]');
    if (item) {
      const id = item.getAttribute('data-id');
      if (id) selectConversation(id);
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
    } else if (action === 'rename' && id) {
      const title = btn.getAttribute('data-title') || '';
      vscode.postMessage({ type: 'requestRename', id, oldTitle: title });
    } else if (action === 'delete' && id) {
      vscode.postMessage({ type: 'delete', id });
    } else if (action === 'copy') {
      const text = btn.getAttribute('data-copy') || '';
      vscode.postMessage({ type: 'copy', text });
    } else if (action === 'jumpConv' && id) {
      selectConversation(id);
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
        if (state.expandedFolders.size === 0 && Array.isArray(state.tree)) {
          for (const r of state.tree) {
            state.expandedFolders.add(r.fullPath);
          }
        }
        renderFolderTree();
        renderConversationList();
        document.getElementById('headerTotalBadge').innerText = String(msg.totalConversations || 0);
        if (!state.selectedId && state.detail) {
          state.detail = null;
          renderDetailPane();
        }
        break;
      case 'conversationList':
        state.conversations = msg.conversations || [];
        state.filteredTokens = msg.filteredTokens || 0;
        state.filteredMessages = msg.filteredMessages || 0;
        state.selectedId = msg.selectedId;
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
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
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

  function renderFolderTree() {
    const container = document.getElementById('folderTree');
    let html = '';

    const isAll = state.selectedFolder === 'ALL';
    html += '<div class="tree-item ' + (isAll ? 'active' : '') + '" data-folder="ALL">' +
      '<span class="tree-chevron"></span>' +
      '<svg class="tree-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zm-1 10H3V4h10v8zM5 6h6v1H5V6zm0 3h6v1H5V9z"/></svg>' +
      '<span class="tree-label">All Conversations</span>' +
      '<span class="tree-badge">' + state.totalConversations + '</span>' +
      '</div>';

    if (state.currentWorkspace) {
      const isCur = state.selectedFolder === 'CURRENT';
      html += '<div class="tree-item ' + (isCur ? 'active' : '') + '" data-folder="CURRENT" title="' + escapeHtml(state.currentWorkspace) + '">' +
        '<span class="tree-chevron"></span>' +
        '<svg class="tree-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.251.068a.5.5 0 0 1 .42.58L10.477 6.5H14a.5.5 0 0 1 .372.832l-9.5 10.5a.5.5 0 0 1-.84-.528l1.2-5.804H1.5a.5.5 0 0 1-.372-.832l9.5-10.5a.5.5 0 0 1 .623-.1z"/></svg>' +
        '<span class="tree-label">Current Workspace</span>' +
        '<span class="tree-badge">' + (state.currentWorkspaceCount || 0) + '</span>' +
        '</div>';
    }

    function renderNode(node, depth) {
      const isSel = state.selectedFolder.toLowerCase() === node.fullPath.toLowerCase();
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = state.expandedFolders.has(node.fullPath);
      const indent = depth * 12;
      const escapedPath = escapeHtml(node.fullPath);
      const count = state.includeSubfolders ? node.totalCount : node.directCount;

      let iconSvg = '';
      if (node.isDriveOrRoot) {
        iconSvg = '<svg class="tree-icon drive-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 3H3V4h10v2zm1 3H2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1zm-1 3H3v-2h10v2z"/></svg>';
      } else if (hasChildren && isExpanded) {
        iconSvg = '<svg class="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 14h13l.5-.5v-8l-.5-.5H8.29l-.85-.85L7 4H2l-.5.5v9l.5.5zm1-8.5h4.29l.85.85.36.15H14v1.5H2.5v-2.5zm0 3.5H14v4.5H2.5V9z"/></svg>';
      } else {
        iconSvg = '<svg class="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zm-.5 11h-12V3h4.29l.85.85.35.15H14v10z"/></svg>';
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

  function renderConversationList() {
    document.getElementById('summaryCount').innerText = state.conversations.length + ' conversation' + (state.conversations.length === 1 ? '' : 's');
    document.getElementById('summaryMetrics').innerText = formatNumber(state.filteredMessages) + ' msgs · ~' + formatNumber(state.filteredTokens) + ' tok';

    const container = document.getElementById('convList');
    if (state.conversations.length === 0) {
      container.innerHTML = '<div class="empty-state">No conversations match the current filter</div>';
      return;
    }

    let html = '';
    for (const c of state.conversations) {
      const isSel = c.id === state.selectedId;
      const wsName = c.workspaces.length > 0 ? (c.workspaces[0].split('/').pop() || c.workspaces[0]) : 'No Workspace';
      const timeStr = formatTime(c.lastModifiedTime);
      const titleHighlighted = highlightMatches(c.title, state.searchQuery);
      const snippetRaw = c.matchSnippet || c.firstMessageSnippet;
      const snippetHighlighted = snippetRaw ? highlightMatches(snippetRaw, state.searchQuery) : '';
      const totalMsgs = (c.userMsgs || 0) + (c.modelMsgs || 0);

      html += '<div class="conv-item ' + (isSel ? 'active' : '') + '" data-id="' + escapeHtml(c.id) + '">' +
        '<div class="conv-title" title="' + escapeHtml(c.title) + '">' + titleHighlighted + '</div>' +
        '<div class="conv-meta">' +
        '<span>' + escapeHtml(wsName) + '</span>' +
        '<span>&middot;</span>' +
        '<span>' + totalMsgs + ' msgs (' + (c.userMsgs || 0) + '/' + (c.modelMsgs || 0) + ')</span>' +
        '<span>&middot;</span>' +
        '<span>~' + formatNumber(c.estTotalTokens) + ' tok</span>' +
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

    const wsStr = c.workspaces.join(', ') || '(No Workspace)';
    const wsShort = c.workspaces.length > 0 ? (c.workspaces[0].split('/').pop() || c.workspaces[0]) : '(No Workspace)';
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

      messagesHtml += '<div class="msg-bubble ' + (isUser ? 'user' : 'assistant') + '">' +
        '<div class="msg-header"><span class="msg-role">' + roleLabel + '</span><span>' + escapeHtml(rightMeta) + '</span></div>' +
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
          '<button class="btn-secondary" data-action="openTranscriptLog" data-id="' + escapeHtml(c.id) + '">View Log</button>' +
          '<button class="btn-secondary" data-action="rename" data-id="' + escapeHtml(c.id) + '" data-title="' + escapeHtml(c.title) + '">Rename</button>' +
          '<button class="btn-secondary btn-danger" data-action="delete" data-id="' + escapeHtml(c.id) + '">Delete</button>' +
        '</div>' +
      '</div>' +

      '<div class="detail-stats">' +
        '<div class="stat-card">' +
          '<span class="stat-label">Messages</span>' +
          '<span class="stat-value">' + totalMsgs + ' total</span>' +
          '<span class="stat-sub">' + (c.userMsgs || 0) + ' user / ' + (c.modelMsgs || 0) + ' AI · ' + (c.toolCalls || 0) + ' tools</span>' +
        '</div>' +
        '<div class="stat-card">' +
          '<span class="stat-label">Est. Tokens</span>' +
          '<span class="stat-value">~' + formatNumber(c.estTotalTokens) + '</span>' +
          '<span class="stat-sub">' + formatNumber(c.estInputTokens) + ' in / ' + formatNumber(c.estOutputTokens) + ' out' + thinkingNote + '</span>' +
        '</div>' +
        '<div class="stat-card">' +
          '<span class="stat-label">Steps</span>' +
          '<span class="stat-value">' + c.stepCount + '</span>' +
          '<span class="stat-sub">' + (c.hasTranscript ? 'Transcript indexed' : 'DB / archive only') + '</span>' +
        '</div>' +
        '<div class="stat-card">' +
          '<span class="stat-label">Duration</span>' +
          '<span class="stat-value">' + durationStr + '</span>' +
          '<span class="stat-sub">Updated ' + formatTime(c.lastModifiedTime) + '</span>' +
        '</div>' +
      '</div>' +

      '<div class="metadata-bar">' +
        '<div class="metadata-item"><b>ID:</b> <span class="meta-link" style="font-family:var(--mono);" data-action="copy" data-copy="' + escapeHtml(c.id) + '" title="Click to copy full ID">' + escapeHtml(c.id) + '</span></div>' +
        '<div class="metadata-item"><b>Workspace:</b> <span class="meta-link" data-action="copy" data-copy="' + escapeHtml(wsStr) + '" title="' + escapeHtml(wsStr) + ' (click to copy)">' + escapeHtml(wsShort) + '</span></div>' +
        '<div class="metadata-item"><b>Created:</b> <span>' + escapeHtml(createdStr) + '</span></div>' +
        '<div class="metadata-item"><b>Modified:</b> <span>' + escapeHtml(modifiedStr) + '</span></div>' +
        (c.parentConversationId ? ('<div class="metadata-item"><b>Forked from:</b> <span class="meta-link" style="font-family:var(--mono);" data-action="jumpConv" data-id="' + escapeHtml(c.parentConversationId) + '" title="Open parent conversation">' + escapeHtml(c.parentConversationId.slice(0, 8)) + '...</span></div>') : '') +
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
  }
</script>
</body>
</html>`;
    }
}
