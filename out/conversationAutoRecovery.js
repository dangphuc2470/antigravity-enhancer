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
exports.runRecoveryHelper = runRecoveryHelper;
exports.startPeriodicSnapshot = startPeriodicSnapshot;
exports.checkAndAutoRecoverConversations = checkAndAutoRecoverConversations;
exports.rebuildAllConversations = rebuildAllConversations;
exports.syncMissingConversations = syncMissingConversations;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
/**
 * Execute the python recovery helper script with the given action.
 */
function runRecoveryHelper(extensionPath, action) {
    return new Promise((resolve, reject) => {
        const helperPath = path.join(extensionPath, 'resources', 'recover_conversations_helper.py');
        if (!fs.existsSync(helperPath)) {
            return reject(new Error(`Helper script not found at ${helperPath}`));
        }
        // Try 'python' first, fallback to 'python3' if needed
        const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
        (0, child_process_1.execFile)(pythonBin, [helperPath, action], { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                // Try fallback to python3 or python
                const fallbackBin = pythonBin === 'python' ? 'python3' : 'python';
                (0, child_process_1.execFile)(fallbackBin, [helperPath, action], { timeout: 30000 }, (err2, stdout2) => {
                    if (err2) {
                        return reject(new Error(`Failed to execute recovery helper: ${error.message}\n${stderr}`));
                    }
                    try {
                        const parsed = JSON.parse(stdout2.trim());
                        resolve(parsed);
                    }
                    catch (e) {
                        reject(new Error(`Invalid JSON output from recovery helper: ${stdout2}`));
                    }
                });
                return;
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            }
            catch (e) {
                reject(new Error(`Invalid JSON output from recovery helper: ${stdout}`));
            }
        });
    });
}
/**
 * Start a periodic background snapshot of trajectorySummaries.
 * Runs sparsely (e.g. every 10 minutes) to avoid resource waste.
 */
function startPeriodicSnapshot(context) {
    const run = async () => {
        try {
            const res = await runRecoveryHelper(context.extensionPath, 'snapshot');
            if (res.success && res.action === 'snapshot') {
                console.log(`[AGI Auto-Recovery] Periodic snapshot saved: ${res.count} conversations.`);
            }
        }
        catch (e) {
            console.warn('[AGI Auto-Recovery] Periodic snapshot error:', e);
        }
    };
    // First snapshot after 25 seconds of startup
    setTimeout(run, 25000);
    // Then every 10 minutes
    const interval = setInterval(run, 10 * 60 * 1000);
    context.subscriptions.push({
        dispose: () => clearInterval(interval)
    });
}
/**
 * Check on startup if any conversation is missing or dropped from the sidebar.
 * Automatically recovers recent missing conversations without annoying prompts.
 */
function checkAndAutoRecoverConversations(context) {
    setTimeout(async () => {
        try {
            const check = await runRecoveryHelper(context.extensionPath, 'check');
            if (!check.success)
                return;
            // Scenario 1: Incremental missing (e.g. 1 to 5 conversations from a recent session not yet flushed)
            if (check.missingCount > 0 && check.indexedCount > 0 && check.missingCount <= 10) {
                const sync = await runRecoveryHelper(context.extensionPath, 'sync-missing');
                if (sync.success && sync.addedCount > 0) {
                    const titles = (sync.added || []).map(a => `"${a.title}"`).join(', ');
                    vscode.window.showInformationMessage(`Antigravity Enhancer: Đã tự động khôi phục ${sync.addedCount} cuộc trò chuyện gần nhất (${titles}) vào sidebar. Tải lại cửa sổ để hiển thị ngay?`, 'Tải lại cửa sổ').then(choice => {
                        if (choice === 'Tải lại cửa sổ') {
                            vscode.commands.executeCommand('workbench.action.reloadWindow');
                        }
                    });
                }
                return;
            }
            // Scenario 2: Complete wipeout (sidebar has 0 or 1 item, while disk has many)
            if (check.indexedCount <= 1 && check.diskCount >= 3) {
                if (check.hasSnapshot && check.snapshotCount >= 2) {
                    // We have a reliable snapshot: restore it automatically
                    const restore = await runRecoveryHelper(context.extensionPath, 'restore-snapshot');
                    if (restore.success) {
                        vscode.window.showInformationMessage(`Antigravity Enhancer: Đã tự động khôi phục ${check.snapshotCount} cuộc trò chuyện từ bản sao lưu gần nhất. Bấm để cập nhật hiển thị.`, 'Tải lại cửa sổ').then(choice => {
                            if (choice === 'Tải lại cửa sổ') {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        });
                    }
                }
                else {
                    // No snapshot: prompt user to rebuild
                    vscode.window.showWarningMessage(`Antigravity Enhancer: Phát hiện mất lịch sử trò chuyện (${check.diskCount} cuộc hội thoại trên đĩa nhưng sidebar bị trống). Bạn có muốn quét và khôi phục lại không?`, 'Khôi phục ngay').then(async (choice) => {
                        if (choice === 'Khôi phục ngay') {
                            await rebuildAllConversations(context);
                        }
                    });
                }
            }
        }
        catch (e) {
            console.warn('[AGI Auto-Recovery] Startup check failed:', e);
        }
    }, 4500);
}
/**
 * Perform a full rebuild of all conversations into state.vscdb.
 */
async function rebuildAllConversations(context) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Antigravity Enhancer: Đang quét và khôi phục toàn bộ lịch sử trò chuyện...',
        cancellable: false
    }, async () => {
        try {
            const res = await runRecoveryHelper(context.extensionPath, 'rebuild');
            if (res.success) {
                const choice = await vscode.window.showInformationMessage(`Đã khôi phục thành công ${res.totalCount} cuộc trò chuyện! Tải lại cửa sổ để áp dụng ngay.`, 'Tải lại cửa sổ');
                if (choice === 'Tải lại cửa sổ') {
                    await vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            }
            else {
                vscode.window.showErrorMessage(`Khôi phục thất bại: ${res.error || 'Lỗi không xác định'}`);
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Lỗi khi khôi phục: ${err?.message || err}`);
        }
    });
}
/**
 * Sync missing conversations on demand.
 */
async function syncMissingConversations(context) {
    try {
        const sync = await runRecoveryHelper(context.extensionPath, 'sync-missing');
        if (sync.success) {
            if (sync.addedCount > 0) {
                const choice = await vscode.window.showInformationMessage(`Đã bổ sung ${sync.addedCount} cuộc trò chuyện bị rớt vào sidebar! Tải lại cửa sổ để hiển thị ngay.`, 'Tải lại cửa sổ');
                if (choice === 'Tải lại cửa sổ') {
                    await vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            }
            else {
                vscode.window.showInformationMessage('Tất cả cuộc trò chuyện trên đĩa đều đã có đủ trong sidebar.');
            }
        }
        else {
            vscode.window.showErrorMessage(`Đồng bộ thất bại: ${sync.error || 'Lỗi không xác định'}`);
        }
    }
    catch (err) {
        vscode.window.showErrorMessage(`Lỗi: ${err?.message || err}`);
    }
}
