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
exports.ExternalOpenerCustomEditorProvider = void 0;
exports.openWithSystemDefault = openWithSystemDefault;
exports.registerExternalOpener = registerExternalOpener;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const cp = __importStar(require("child_process"));
/**
 * Format bytes to readable string (e.g. 1.25 MB)
 */
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
/**
 * Opens a file with the operating system's default application.
 */
function openWithSystemDefault(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`File not found: ${filePath}`);
        return;
    }
    try {
        if (process.platform === 'win32') {
            cp.spawn('cmd.exe', ['/c', 'start', '', filePath], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        }
        else if (process.platform === 'darwin') {
            cp.spawn('open', [filePath], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        }
        else {
            cp.spawn('xdg-open', [filePath], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        }
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to open file: ${err?.message || err}`);
    }
}
/**
 * Custom Editor Provider that intercepts binary, office, media, and archive files.
 * Opens them with the OS default application while keeping the editor tab open.
 */
class ExternalOpenerCustomEditorProvider {
    openCustomDocument(uri) {
        return {
            uri,
            dispose: () => { }
        };
    }
    resolveCustomEditor(document, webviewPanel, _token) {
        const filePath = document.uri.fsPath;
        const fileName = path.basename(filePath);
        const revealText = process.platform === 'darwin' ? 'Reveal in Finder' : 'Reveal in File Explorer';
        const config = vscode.workspace.getConfiguration('antigravity-enhancer');
        const autoCloseTab = config.get('externalOpener.autoCloseTab', false);
        let fileSize = '';
        try {
            const stat = fs.statSync(filePath);
            fileSize = formatBytes(stat.size);
        }
        catch { }
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        padding: 24px;
                        box-sizing: border-box;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
                    }
                    .card {
                        text-align: center;
                        max-width: 520px;
                        width: 100%;
                        padding: 36px 28px;
                        background-color: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.03));
                        border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
                        border-radius: 8px;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    }
                    .file-name {
                        font-size: 17px;
                        font-weight: 600;
                        color: var(--vscode-foreground);
                        margin-bottom: 10px;
                        word-break: break-all;
                    }
                    .badge {
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 12px;
                        font-size: 12px;
                        font-weight: 500;
                        background-color: var(--vscode-badge-background, #3a3d41);
                        color: var(--vscode-badge-foreground, #ffffff);
                        margin-bottom: 20px;
                        transition: all 0.2s ease;
                    }
                    .file-meta {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 24px;
                        word-break: break-all;
                        line-height: 1.6;
                    }
                    .actions {
                        display: flex;
                        gap: 12px;
                        justify-content: center;
                        flex-wrap: wrap;
                    }
                    .btn {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        padding: 8px 18px;
                        font-size: 13px;
                        font-weight: 500;
                        border-radius: 4px;
                        cursor: pointer;
                        outline: none;
                        transition: all 0.15s ease;
                        min-width: 170px;
                        box-sizing: border-box;
                    }
                    .btn:active {
                        transform: translateY(1px);
                        opacity: 0.9;
                    }
                    .btn-secondary {
                        background-color: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
                        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground, #ffffff));
                        border: 1px solid var(--vscode-button-border, rgba(255, 255, 255, 0.14));
                    }
                    .btn-secondary:hover {
                        background-color: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.14));
                    }
                    .btn-primary {
                        background-color: var(--vscode-button-background, #0078d4);
                        color: var(--vscode-button-foreground, #ffffff);
                        border: 1px solid var(--vscode-button-border, transparent);
                    }
                    .btn-primary:hover {
                        background-color: var(--vscode-button-hoverBackground, #026ec1);
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="file-name">${fileName}</div>
                    <div id="statusBadge" class="badge">Ready to Open</div>
                    <div class="file-meta">
                        ${fileSize ? `Size: ${fileSize}<br>` : ''}
                        Path: ${filePath}
                    </div>
                    <div class="actions">
                        <button class="btn btn-secondary" onclick="revealFile()">${revealText}</button>
                        <button class="btn btn-primary" onclick="openFile()">Open with Default Application</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function openFile() {
                        vscode.postMessage({ command: 'open' });
                    }
                    function revealFile() {
                        vscode.postMessage({ command: 'reveal' });
                    }
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'opened') {
                            const badge = document.getElementById('statusBadge');
                            if (badge) {
                                badge.textContent = 'Opened with Default Application';
                                badge.style.backgroundColor = 'var(--vscode-testing-iconPassed, #238636)';
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `;
        webviewPanel.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'open') {
                openWithSystemDefault(filePath);
                vscode.window.setStatusBarMessage(`Opening ${fileName} with default application...`, 3000);
                webviewPanel.webview.postMessage({ type: 'opened' });
                if (autoCloseTab) {
                    setTimeout(() => {
                        webviewPanel.dispose();
                    }, 500);
                }
            }
            else if (msg.command === 'reveal') {
                vscode.commands.executeCommand('revealFileInOS', document.uri);
            }
        });
    }
}
exports.ExternalOpenerCustomEditorProvider = ExternalOpenerCustomEditorProvider;
ExternalOpenerCustomEditorProvider.viewType = 'antigravity-enhancer.externalOpener';
/**
 * Registers the Custom Editor Provider and external opener commands/shortcuts.
 */
function registerExternalOpener(context) {
    // 1. Register Custom Editor Provider for unhandled file types
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(ExternalOpenerCustomEditorProvider.viewType, new ExternalOpenerCustomEditorProvider(), {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
    }));
    // 2. Register command to open file in external default application
    context.subscriptions.push(vscode.commands.registerCommand('antigravity-enhancer.openExternal', (uri) => {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (targetUri && targetUri.fsPath) {
            openWithSystemDefault(targetUri.fsPath);
            vscode.window.setStatusBarMessage(`Opening ${path.basename(targetUri.fsPath)} with default application...`, 3000);
        }
        else {
            vscode.window.showInformationMessage('No file selected to open externally.');
        }
    }));
}
