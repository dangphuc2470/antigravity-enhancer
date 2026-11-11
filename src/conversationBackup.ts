import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { CachedConversation, ConversationManagerProvider } from './conversationManager';

export interface ZipEntry {
    name: string;
    data: Buffer;
}
let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[i] = c;
    }
    return crcTable;
}

function calculateCrc32(buf: Buffer): number {
    const z = zlib as any;
    if (typeof z.crc32 === 'function') {
        return (z.crc32(buf) >>> 0);
    }
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return ((crc ^ 0xffffffff) >>> 0);
}

/**
 * Creates a standard PKZIP archive buffer using native Node.js zlib (zero dependencies).
 */
export function createZipArchive(entries: ZipEntry[]): Buffer {
    const parts: Buffer[] = [];
    const cdEntries: Buffer[] = [];
    let offset = 0;

    const now = new Date();
    const time = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
    const date = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

    for (const entry of entries) {
        const normalizedName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
        const filenameBuf = Buffer.from(normalizedName, 'utf8');
        const rawData = entry.data;
        const crc = calculateCrc32(rawData);
        const compressed = zlib.deflateRawSync(rawData);

        // Local file header: 30 bytes
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
        lh.writeUInt16LE(20, 4);         // version needed: 2.0
        lh.writeUInt16LE(0x0800, 6);     // general purpose bit flag: bit 11 = UTF-8 filename
        lh.writeUInt16LE(8, 8);          // compression method: Deflate
        lh.writeUInt16LE(time, 10);      // last mod time
        lh.writeUInt16LE(date, 12);      // last mod date
        lh.writeUInt32LE(crc, 14);       // crc-32
        lh.writeUInt32LE(compressed.length, 18); // compressed size
        lh.writeUInt32LE(rawData.length, 22);    // uncompressed size
        lh.writeUInt16LE(filenameBuf.length, 26); // filename length
        lh.writeUInt16LE(0, 28);         // extra field length

        parts.push(lh, filenameBuf, compressed);

        // Central directory file header: 46 bytes
        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
        cdh.writeUInt16LE(20, 4);         // version made by
        cdh.writeUInt16LE(20, 6);         // version needed
        cdh.writeUInt16LE(0x0800, 8);     // general purpose bit flag: UTF-8
        cdh.writeUInt16LE(8, 10);         // compression method: Deflate
        cdh.writeUInt16LE(time, 12);      // last mod time
        cdh.writeUInt16LE(date, 14);      // last mod date
        cdh.writeUInt32LE(crc, 16);       // crc-32
        cdh.writeUInt32LE(compressed.length, 20); // compressed size
        cdh.writeUInt32LE(rawData.length, 24);    // uncompressed size
        cdh.writeUInt16LE(filenameBuf.length, 28); // filename length
        cdh.writeUInt16LE(0, 30);         // extra field length
        cdh.writeUInt16LE(0, 32);         // comment length
        cdh.writeUInt16LE(0, 34);         // disk number start
        cdh.writeUInt16LE(0, 36);         // internal file attributes
        cdh.writeUInt32LE(0, 38);         // external file attributes
        cdh.writeUInt32LE(offset, 42);    // relative offset of local header

        cdEntries.push(cdh, filenameBuf);
        offset += 30 + filenameBuf.length + compressed.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const b of cdEntries) {
        cdSize += b.length;
    }

    // End of central directory record: 22 bytes
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
    eocd.writeUInt16LE(0, 4);          // disk number
    eocd.writeUInt16LE(0, 6);          // disk where cd starts
    eocd.writeUInt16LE(entries.length, 8);  // number of cd records on this disk
    eocd.writeUInt16LE(entries.length, 10); // total number of cd records
    eocd.writeUInt32LE(cdSize, 12);    // size of central directory
    eocd.writeUInt32LE(cdOffset, 16);  // offset of cd with respect to starting disk
    eocd.writeUInt16LE(0, 20);         // comment length

    return Buffer.concat([...parts, ...cdEntries, eocd]);
}

/**
 * Extracts a standard PKZIP archive buffer into a list of file entries.
 */
export function readZipArchive(buf: Buffer): ZipEntry[] {
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset === -1) {
        throw new Error('Selected file is not a valid ZIP archive.');
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    const results: ZipEntry[] = [];
    let curr = cdOffset;

    for (let i = 0; i < totalEntries; i++) {
        if (curr + 46 > buf.length || buf.readUInt32LE(curr) !== 0x02014b50) {
            break;
        }

        const method = buf.readUInt16LE(curr + 10);
        const compSize = buf.readUInt32LE(curr + 20);
        const uncompSize = buf.readUInt32LE(curr + 24);
        const fnLen = buf.readUInt16LE(curr + 28);
        const extraLen = buf.readUInt16LE(curr + 30);
        const commentLen = buf.readUInt16LE(curr + 32);
        const localHeaderOffset = buf.readUInt32LE(curr + 42);

        const filename = buf.toString('utf8', curr + 46, curr + 46 + fnLen);
        curr += 46 + fnLen + extraLen + commentLen;

        // Skip directory entries
        if (filename.endsWith('/') || filename.endsWith('\\')) {
            continue;
        }

        if (localHeaderOffset + 30 > buf.length) {
            continue;
        }

        const localFnLen = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localFnLen + localExtraLen;

        if (dataStart + compSize > buf.length) {
            continue;
        }

        const compData = buf.subarray(dataStart, dataStart + compSize);
        let decompressedData: Buffer;

        if (method === 0) {
            decompressedData = compData;
        } else if (method === 8) {
            try {
                decompressedData = zlib.inflateRawSync(compData);
            } catch (err: any) {
                console.error(`Failed to inflate entry ${filename}:`, err);
                continue;
            }
        } else {
            console.warn(`Unsupported compression method ${method} for entry ${filename}`);
            continue;
        }

        results.push({
            name: filename,
            data: decompressedData
        });
    }

    return results;
}

export class ConversationBackupService {
    /**
     * Backs up all cached conversations and their transcripts into a single .zip archive.
     */
    public static async backupAllConversations(): Promise<void> {
        const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
        const brainDir = path.join(baseDir, 'brain');

        // Read all cached conversations
        let conversations = ConversationManagerProvider.readDiskCache();
        if (!conversations || conversations.length === 0) {
            vscode.window.showWarningMessage('No conversations found to backup.');
            return;
        }

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
        const defaultFilename = `antigravity-conversations-backup-${dateStr}.zip`;
        const defaultUri = vscode.Uri.file(path.join(os.homedir(), defaultFilename));

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'ZIP Archive': ['zip'] },
            saveLabel: 'Save Backup',
            title: 'Backup Antigravity Conversations'
        });

        if (!saveUri) {
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Backing up Antigravity conversations...',
                cancellable: false
            },
            async progress => {
                const entries: ZipEntry[] = [];
                let packedCount = 0;

                // 1. Pack manifest metadata
                const manifest = {
                    version: 1,
                    generator: 'Antigravity Enhancer',
                    createdAt: now.toISOString(),
                    totalConversations: conversations.length,
                    conversations: conversations
                };
                entries.push({
                    name: 'manifest.json',
                    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
                });

                // 2. Pack transcripts for each conversation
                for (let i = 0; i < conversations.length; i++) {
                    const c = conversations[i];
                    progress.report({
                        message: `Packing ${i + 1}/${conversations.length}: ${c.title.slice(0, 30)}...`,
                        increment: (1 / (conversations.length + 1)) * 90
                    });

                    const logDir = path.join(brainDir, c.id, '.system_generated', 'logs');
                    const transcriptPath = path.join(logDir, 'transcript.jsonl');
                    const transcriptFullPath = path.join(logDir, 'transcript_full.jsonl');

                    let hasData = false;
                    if (fs.existsSync(transcriptPath)) {
                        try {
                            const data = fs.readFileSync(transcriptPath);
                            entries.push({
                                name: `conversations/${c.id}/transcript.jsonl`,
                                data
                            });
                            hasData = true;
                        } catch {}
                    }

                    if (fs.existsSync(transcriptFullPath)) {
                        try {
                            const data = fs.readFileSync(transcriptFullPath);
                            entries.push({
                                name: `conversations/${c.id}/transcript_full.jsonl`,
                                data
                            });
                            hasData = true;
                        } catch {}
                    }

                    if (hasData) {
                        packedCount++;
                    }
                }

                progress.report({ message: 'Creating ZIP archive...', increment: 5 });

                const zipBuffer = createZipArchive(entries);
                fs.writeFileSync(saveUri.fsPath, zipBuffer);

                progress.report({ message: 'Done!', increment: 5 });

                const action = await vscode.window.showInformationMessage(
                    `Successfully backed up ${packedCount} conversation(s) to ${path.basename(saveUri.fsPath)}`,
                    'Show in Folder'
                );

                if (action === 'Show in Folder') {
                    vscode.commands.executeCommand('revealFileInOS', saveUri);
                }
            }
        );
    }

    /**
     * Imports conversations from a .zip backup archive with strict deduplication.
     */
    public static async importConversations(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'ZIP Archive': ['zip'] },
            openLabel: 'Import Backup',
            title: 'Select Antigravity Conversation Backup (.zip)'
        });

        if (!uris || uris.length === 0) {
            return;
        }

        const zipPath = uris[0].fsPath;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Importing conversations from backup...',
                cancellable: false
            },
            async progress => {
                let zipBuffer: Buffer;
                try {
                    zipBuffer = fs.readFileSync(zipPath);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to read ZIP file: ${err.message}`);
                    return;
                }

                progress.report({ message: 'Reading archive entries...', increment: 10 });
                let entries: ZipEntry[];
                try {
                    entries = readZipArchive(zipBuffer);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to extract ZIP archive: ${err.message}`);
                    return;
                }

                const baseDir = path.join(os.homedir(), '.gemini', 'antigravity-ide');
                const brainDir = path.join(baseDir, 'brain');
                if (!fs.existsSync(brainDir)) {
                    fs.mkdirSync(brainDir, { recursive: true });
                }

                // Look for manifest.json
                const manifestEntry = entries.find(e => e.name === 'manifest.json');
                let manifestConversations: CachedConversation[] = [];
                if (manifestEntry) {
                    try {
                        const parsed = JSON.parse(manifestEntry.data.toString('utf8'));
                        if (Array.isArray(parsed.conversations)) {
                            manifestConversations = parsed.conversations;
                        }
                    } catch {}
                }

                // Collect entry map by conversation ID
                const convFileMap = new Map<string, { transcript?: Buffer; transcriptFull?: Buffer }>();
                for (const e of entries) {
                    const match = e.name.match(/^conversations\/([^/]+)\/(transcript(?:_full)?\.jsonl)$/);
                    if (match) {
                        const cid = match[1];
                        const fileType = match[2];
                        const item = convFileMap.get(cid) || {};
                        if (fileType === 'transcript.jsonl') item.transcript = e.data;
                        if (fileType === 'transcript_full.jsonl') item.transcriptFull = e.data;
                        convFileMap.set(cid, item);
                    }
                }

                // Merge metadata map
                const metadataMap = new Map<string, CachedConversation>();
                for (const c of manifestConversations) {
                    if (c && c.id) {
                        metadataMap.set(c.id, c);
                    }
                }

                // Also include conversations discovered from file paths if manifest didn't contain them
                for (const cid of convFileMap.keys()) {
                    if (!metadataMap.has(cid)) {
                        metadataMap.set(cid, {
                            id: cid,
                            title: cid,
                            workspaces: [],
                            rawWorkspaces: [],
                            lastModifiedTime: Date.now(),
                            createdTime: Date.now(),
                            stepCount: 0,
                            userMsgs: 0,
                            modelMsgs: 0,
                            toolCalls: 0,
                            estInputTokens: 0,
                            estOutputTokens: 0,
                            estThinkingTokens: 0,
                            estTotalTokens: 0,
                            cumulativeTokens: 0,
                            hasTranscript: true,
                            firstMessageSnippet: '',
                            searchableContent: '',
                            mtimeMs: Date.now(),
                            size: 0
                        });
                    }
                }

                const totalCandidates = metadataMap.size;
                if (totalCandidates === 0) {
                    vscode.window.showWarningMessage('No conversation transcripts found in the selected backup archive.');
                    return;
                }

                // Read current local cache
                const currentCache = ConversationManagerProvider.readDiskCache();
                const currentCacheMap = new Map<string, CachedConversation>();
                for (const c of currentCache) {
                    currentCacheMap.set(c.id, c);
                }

                let importedCount = 0;
                let skippedDuplicates = 0;
                let processed = 0;

                // Strict deduplication & restoration
                for (const [cid, meta] of metadataMap.entries()) {
                    processed++;
                    progress.report({
                        message: `Processing ${processed}/${totalCandidates}...`,
                        increment: (1 / (totalCandidates + 1)) * 75
                    });

                    const localTargetDir = path.join(brainDir, cid, '.system_generated', 'logs');
                    const localTranscript = path.join(localTargetDir, 'transcript.jsonl');
                    const localTranscriptFull = path.join(localTargetDir, 'transcript_full.jsonl');

                    const existsOnDisk = fs.existsSync(localTranscript);
                    let localHasData = false;
                    if (existsOnDisk) {
                        try {
                            const st = fs.statSync(localTranscript);
                            if (st.size > 0) {
                                localHasData = true;
                            }
                        } catch {}
                    }

                    // Deduplication check:
                    // If local transcript exists with non-empty content, SKIP to protect active local conversations!
                    if (localHasData) {
                        skippedDuplicates++;
                        // If local cache is missing metadata for this conversation, backfill it without overwriting
                        if (!currentCacheMap.has(cid)) {
                            currentCacheMap.set(cid, meta);
                        }
                        continue;
                    }

                    // New or missing conversation -> Extract and restore
                    const files = convFileMap.get(cid);
                    if (!files || (!files.transcript && !files.transcriptFull)) {
                        continue;
                    }

                    try {
                        if (!fs.existsSync(localTargetDir)) {
                            fs.mkdirSync(localTargetDir, { recursive: true });
                        }

                        if (files.transcript) {
                            fs.writeFileSync(localTranscript, files.transcript);
                        }
                        if (files.transcriptFull) {
                            fs.writeFileSync(localTranscriptFull, files.transcriptFull);
                        }

                        currentCacheMap.set(cid, meta);
                        importedCount++;
                    } catch (err: any) {
                        console.error(`Failed to write conversation ${cid}:`, err);
                    }
                }

                progress.report({ message: 'Updating cache and refreshing views...', increment: 10 });

                // Write merged cache back to disk
                ConversationManagerProvider.writeDiskCache(Array.from(currentCacheMap.values()));

                // Refresh active views
                try {
                    ConversationManagerProvider.currentInstance?.reload();
                } catch {}

                try {
                    vscode.commands.executeCommand('antigravity.refreshConversationTree');
                } catch {}

                vscode.window.showInformationMessage(
                    `Import completed: ${importedCount} new conversation(s) restored, ${skippedDuplicates} duplicate(s) skipped.`
                );
            }
        );
    }
}
