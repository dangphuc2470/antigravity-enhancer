import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CachedConversation, ConversationManagerProvider } from './conversationManager';

export class TrafficReportPanel {
    public static currentPanel: TrafficReportPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _conversations: CachedConversation[] = [];

    public static createOrShow(extensionUri: vscode.Uri, conversations?: CachedConversation[]) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (TrafficReportPanel.currentPanel) {
            TrafficReportPanel.currentPanel._panel.reveal(column);
            if (conversations && conversations.length > 0) {
                TrafficReportPanel.currentPanel.updateData(conversations);
            } else {
                TrafficReportPanel.currentPanel.reload();
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'antigravityTrafficReport',
            'API Traffic & Token Analytics',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        TrafficReportPanel.currentPanel = new TrafficReportPanel(panel, extensionUri, conversations);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialConversations?: CachedConversation[]) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        if (initialConversations && initialConversations.length > 0) {
            this._conversations = initialConversations;
        } else {
            this._conversations = ConversationManagerProvider.readDiskCache();
        }

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'ready':
                    case 'refresh':
                        await this.reload();
                        break;
                    case 'openInChat':
                        await ConversationManagerProvider.openInChat(message.id);
                        break;
                    case 'openLog':
                        await ConversationManagerProvider.openTranscriptLog(message.id);
                        break;
                    case 'openManager':
                        ConversationManagerProvider.createOrShow(this._extensionUri);
                        break;
                }
            },
            null,
            this._disposables
        );

        this._updateHtml();
        this._sendData();
    }

    public updateData(conversations: CachedConversation[]) {
        this._conversations = conversations;
        this._sendData();
    }

    public async reload() {
        this._conversations = ConversationManagerProvider.readDiskCache();
        this._sendData();
    }

    public dispose() {
        TrafficReportPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _sendData() {
        const payload = this._conversations.map(c => ({
            id: c.id,
            title: c.title,
            workspaces: c.workspaces || [],
            userWorkspaces: c.userWorkspaces || [],
            lastModifiedTime: c.lastModifiedTime,
            createdTime: c.createdTime || c.lastModifiedTime,
            userMsgs: c.userMsgs || 0,
            modelMsgs: c.modelMsgs || 0,
            stepCount: c.stepCount || 0,
            toolCalls: c.toolCalls || 0,
            estInputTokens: c.estInputTokens || 0,
            estOutputTokens: c.estOutputTokens || 0,
            estThinkingTokens: c.estThinkingTokens || 0,
            estTotalTokens: c.estTotalTokens || 0,
            cumulativeTokens: c.cumulativeTokens || c.estTotalTokens || 0,
            modelName: c.modelName || 'Gemini'
        }));

        this._panel.webview.postMessage({
            type: 'data',
            conversations: payload
        });
    }

    private _updateHtml() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Traffic &amp; Token Analytics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
  <style>
    /* ============================================================
       Material Design 3 Expressive Design System
       Follows M3 Expressive Tokens, Surfaces, Elevation & Typography
       ============================================================ */
    :root {
      /* M3 Dark Theme Surface Containers */
      --md-sys-color-background: #0f1318;
      --md-sys-color-surface: #12171f;
      --md-sys-color-surface-container-lowest: #0a0d12;
      --md-sys-color-surface-container-low: #161b24;
      --md-sys-color-surface-container: #1b212c;
      --md-sys-color-surface-container-high: #212936;
      --md-sys-color-surface-container-highest: #283242;

      /* M3 On-Surface & Typography */
      --md-sys-color-on-surface: #e2e7f0;
      --md-sys-color-on-surface-variant: #9aa5b8;
      --md-sys-color-outline: #4b5568;
      --md-sys-color-outline-variant: rgba(255, 255, 255, 0.08);

      /* M3 Expressive Primary (Cyan-Blue) */
      --md-sys-color-primary: #7cacf8;
      --md-sys-color-on-primary: #002f65;
      --md-sys-color-primary-container: #15325b;
      --md-sys-color-on-primary-container: #d2e4ff;

      /* M3 Secondary (Slate Lavender) */
      --md-sys-color-secondary: #bec6dc;
      --md-sys-color-secondary-container: #323b4c;
      --md-sys-color-on-secondary-container: #dbe2f9;

      /* M3 Tertiary (Expressive Orchid Violet) */
      --md-sys-color-tertiary: #d9b9f9;
      --md-sys-color-tertiary-container: #3f275e;
      --md-sys-color-on-tertiary-container: #f1dcff;

      /* M3 Semantic Accents */
      --md-sys-color-emerald: #6dd58c;
      --md-sys-color-emerald-container: #103822;
      --md-sys-color-on-emerald-container: #9bf2b6;

      --md-sys-color-amber: #f8be52;
      --md-sys-color-amber-container: #3e2d08;
      --md-sys-color-on-amber-container: #ffe099;

      /* M3 Expressive Shapes Scale */
      --md-shape-corner-none: 0px;
      --md-shape-corner-extra-small: 4px;
      --md-shape-corner-small: 8px;
      --md-shape-corner-medium: 12px;
      --md-shape-corner-large: 16px;
      --md-shape-corner-large-increased: 20px;
      --md-shape-corner-extra-large: 28px;
      --md-shape-corner-full: 9999px;

      --layout-max-width: 1240px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--md-sys-color-background);
      color: var(--md-sys-color-on-surface);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      overflow-y: auto;
      padding-bottom: 80px;
    }

    /* M3 Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--md-sys-color-surface-container-highest); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--md-sys-color-outline); }

    /* M3 Sticky Top App Bar */
    .top-app-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background-color: rgba(18, 23, 31, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      padding: 14px 28px;
    }

    .bar-container {
      max-width: var(--layout-max-width);
      margin: 0 auto;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon-box {
      width: 40px;
      height: 40px;
      border-radius: var(--md-shape-corner-medium);
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
    }

    .brand-title {
      font-size: 17px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }

    .brand-subtitle {
      font-size: 12px;
      font-weight: 500;
      color: var(--md-sys-color-on-surface-variant);
    }

    .bar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* M3 Segmented Filter Chips */
    .segmented-chips {
      display: flex;
      background-color: var(--md-sys-color-surface-container);
      padding: 3px;
      border-radius: var(--md-shape-corner-full);
      border: 1px solid var(--md-sys-color-outline-variant);
      gap: 3px;
    }

    .seg-chip {
      background: transparent;
      border: none;
      color: var(--md-sys-color-on-surface-variant);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: var(--md-shape-corner-full);
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.2, 0.0, 0, 1.0);
    }

    .seg-chip:hover {
      color: var(--md-sys-color-on-surface);
      background-color: var(--md-sys-color-surface-container-high);
    }

    .seg-chip.active {
      background-color: var(--md-sys-color-primary);
      color: var(--md-sys-color-on-primary);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }

    /* M3 Buttons */
    .m3-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 16px;
      border-radius: var(--md-shape-corner-full);
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s cubic-bezier(0.2, 0.0, 0, 1.0);
    }

    .m3-btn-tonal {
      background-color: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface);
      border-color: var(--md-sys-color-outline-variant);
    }

    .m3-btn-tonal:hover {
      background-color: var(--md-sys-color-surface-container-highest);
      color: #ffffff;
      transform: translateY(-1px);
    }

    .m3-btn-filled {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      border-color: rgba(124, 172, 248, 0.25);
    }

    .m3-btn-filled:hover {
      background-color: #1e4277;
      color: #ffffff;
      transform: translateY(-1px);
    }

    /* Main Content Container */
    .main-content {
      max-width: var(--layout-max-width);
      margin: 0 auto;
      padding: 32px 24px;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    /* Hero Overview Card (M3 Expressive Containment) */
    .m3-hero-card {
      background-color: var(--md-sys-color-surface-container);
      border-radius: var(--md-shape-corner-extra-large);
      border: 1px solid var(--md-sys-color-outline-variant);
      padding: 36px 40px;
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 32px;
      align-items: center;
      position: relative;
      overflow: hidden;
    }

    .m3-hero-card::after {
      content: '';
      position: absolute;
      top: -80px;
      right: -80px;
      width: 260px;
      height: 260px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(124, 172, 248, 0.12) 0%, transparent 70%);
      pointer-events: none;
    }

    .hero-text {
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 1;
    }

    .hero-badge-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .m3-pill-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: var(--md-shape-corner-full);
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .m3-pill-badge.primary {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
    }

    .m3-pill-badge.emerald {
      background-color: var(--md-sys-color-emerald-container);
      color: var(--md-sys-color-on-emerald-container);
    }

    .hero-title {
      font-size: clamp(26px, 3.2vw, 36px);
      font-weight: 800;
      color: #ffffff;
      line-height: 1.18;
      letter-spacing: -0.02em;
    }

    .hero-desc {
      font-size: 14.5px;
      color: var(--md-sys-color-on-surface-variant);
      line-height: 1.6;
      max-width: 580px;
    }

    /* Hero Insight Callout */
    .hero-callout-box {
      background-color: var(--md-sys-color-surface-container-low);
      border-radius: var(--md-shape-corner-large-increased);
      border: 1px solid var(--md-sys-color-outline-variant);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      z-index: 1;
    }

    .callout-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .callout-label {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--md-sys-color-primary);
    }

    .callout-stat-huge {
      font-size: 38px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }

    .callout-stat-sub {
      font-size: 12.5px;
      color: var(--md-sys-color-on-surface-variant);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* M3 KPI Cards Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
    }

    .m3-kpi-card {
      background-color: var(--md-sys-color-surface-container-low);
      border-radius: var(--md-shape-corner-large-increased);
      border: 1px solid var(--md-sys-color-outline-variant);
      padding: 22px 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      transition: all 0.2s cubic-bezier(0.2, 0.0, 0, 1.0);
    }

    .m3-kpi-card:hover {
      background-color: var(--md-sys-color-surface-container);
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.14);
    }

    .kpi-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .kpi-icon-squircle {
      width: 44px;
      height: 44px;
      border-radius: var(--md-shape-corner-medium);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .kpi-icon-squircle.blue {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-primary);
    }

    .kpi-icon-squircle.emerald {
      background-color: var(--md-sys-color-emerald-container);
      color: var(--md-sys-color-emerald);
    }

    .kpi-icon-squircle.purple {
      background-color: var(--md-sys-color-tertiary-container);
      color: var(--md-sys-color-tertiary);
    }

    .kpi-icon-squircle.amber {
      background-color: var(--md-sys-color-amber-container);
      color: var(--md-sys-color-amber);
    }

    .kpi-category-tag {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--md-sys-color-on-surface-variant);
    }

    .kpi-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .kpi-num {
      font-size: 30px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }

    .kpi-detail {
      font-size: 12.5px;
      color: var(--md-sys-color-on-surface-variant);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Two Column Layout for Charts */
    .two-col-layout {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 20px;
      align-items: stretch;
    }

    @media (max-width: 960px) {
      .two-col-layout {
        grid-template-columns: 1fr;
      }
      .m3-hero-card {
        grid-template-columns: 1fr;
        padding: 28px 24px;
      }
    }

    /* M3 Container Card */
    .m3-surface-card {
      background-color: var(--md-sys-color-surface-container-low);
      border-radius: var(--md-shape-corner-extra-large);
      border: 1px solid var(--md-sys-color-outline-variant);
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .card-title-group h2 {
      font-size: 18px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.3;
      letter-spacing: -0.01em;
    }

    .card-title-group p {
      font-size: 12.5px;
      color: var(--md-sys-color-on-surface-variant);
    }

    /* Timeline Chart Visual */
    .chart-container-m3 {
      position: relative;
      width: 100%;
      height: 250px;
    }

    svg.m3-timeline-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Chart Legend */
    .m3-legend-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .m3-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--md-sys-color-on-surface-variant);
    }

    .m3-legend-dot {
      width: 10px;
      height: 10px;
      border-radius: var(--md-shape-corner-extra-small);
    }

    /* Floating Tooltip */
    .m3-floating-tooltip {
      position: absolute;
      z-index: 120;
      background-color: var(--md-sys-color-surface-container-highest);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: var(--md-shape-corner-large);
      padding: 12px 16px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
      color: #ffffff;
      font-size: 12px;
      pointer-events: none;
      display: none;
      min-width: 210px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .m3-floating-tooltip .tip-header {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      color: #ffffff;
    }

    .m3-floating-tooltip .tip-line {
      display: flex;
      justify-content: space-between;
      line-height: 1.7;
      gap: 12px;
    }

    /* Ratio Progress Bar */
    .m3-ratio-track {
      height: 16px;
      background-color: var(--md-sys-color-surface-container);
      border-radius: var(--md-shape-corner-full);
      display: flex;
      overflow: hidden;
      margin: 8px 0;
      border: 1px solid var(--md-sys-color-outline-variant);
    }

    .m3-ratio-segment {
      height: 100%;
      transition: width 0.3s cubic-bezier(0.2, 0, 0, 1);
    }

    /* Breakdown list */
    .m3-breakdown-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 6px;
    }

    .m3-breakdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: var(--md-shape-corner-medium);
      background-color: var(--md-sys-color-surface-container);
    }

    .m3-breakdown-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--md-sys-color-on-surface);
    }

    .m3-breakdown-values {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .m3-breakdown-pct {
      font-weight: 700;
      font-size: 13.5px;
      color: #ffffff;
    }

    .m3-breakdown-count {
      font-size: 12px;
      color: var(--md-sys-color-on-surface-variant);
      min-width: 65px;
      text-align: right;
    }

    /* Ranking Rows */
    .m3-ranking-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .m3-ranking-card {
      background-color: var(--md-sys-color-surface-container);
      border-radius: var(--md-shape-corner-large);
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.15s ease;
    }

    .m3-ranking-card:hover {
      background-color: var(--md-sys-color-surface-container-high);
    }

    .ranking-meta-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .ranking-conv-title {
      font-size: 13.5px;
      font-weight: 600;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }

    .ranking-conv-title:hover {
      color: var(--md-sys-color-primary);
      text-decoration: underline;
    }

    .ranking-conv-stats {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .m3-tag {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: var(--md-shape-corner-full);
      background-color: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface-variant);
    }

    .m3-progress-track {
      height: 6px;
      background-color: var(--md-sys-color-surface-container-highest);
      border-radius: var(--md-shape-corner-full);
      overflow: hidden;
    }

    .m3-progress-fill {
      height: 100%;
      border-radius: var(--md-shape-corner-full);
    }

    /* M3 Table Section */
    .m3-table-container {
      background-color: var(--md-sys-color-surface-container-low);
      border-radius: var(--md-shape-corner-extra-large);
      border: 1px solid var(--md-sys-color-outline-variant);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .table-top-bar {
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 14px;
      background-color: var(--md-sys-color-surface-container);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
    }

    .m3-nav-tabs {
      display: flex;
      gap: 6px;
    }

    .m3-nav-tab {
      background: transparent;
      border: none;
      font-family: inherit;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 13px;
      font-weight: 600;
      padding: 8px 18px;
      border-radius: var(--md-shape-corner-full);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .m3-nav-tab:hover {
      background-color: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface);
    }

    .m3-nav-tab.active {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
    }

    .m3-search-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: var(--md-sys-color-surface-container-low);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-shape-corner-full);
      padding: 6px 16px;
      width: 280px;
    }

    .m3-search-pill input {
      background: transparent;
      border: none;
      outline: none;
      color: #ffffff;
      font-family: inherit;
      font-size: 12.5px;
      width: 100%;
    }

    .m3-table-scroll {
      max-height: 480px;
      overflow-y: auto;
    }

    table.m3-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    table.m3-table th {
      background-color: var(--md-sys-color-surface-container);
      color: var(--md-sys-color-on-surface-variant);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 12px 20px;
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    table.m3-table td {
      padding: 12px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--md-sys-color-on-surface);
    }

    table.m3-table tr:hover td {
      background-color: var(--md-sys-color-surface-container);
    }

    .mono-cell {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 500;
    }

    .action-chip-sm {
      background-color: var(--md-sys-color-surface-container-high);
      border: 1px solid var(--md-sys-color-outline-variant);
      color: var(--md-sys-color-on-surface);
      font-family: inherit;
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: var(--md-shape-corner-full);
      cursor: pointer;
      transition: all 0.15s ease;
      margin-right: 4px;
    }

    .action-chip-sm:hover {
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      border-color: rgba(124, 172, 248, 0.3);
    }

    .empty-state-m3 {
      text-align: center;
      padding: 48px 24px;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 13.5px;
    }
  </style>
</head>
<body>

  <!-- Material 3 Expressive Top App Bar -->
  <header class="top-app-bar">
    <div class="bar-container">
      <div class="brand-group">
        <div class="brand-icon-box">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12h1v1H0v-1h1V8a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6h2V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v10h2V2zm-7 7H2v5h2V9zm5-4H7v9h2V5zm5-2h-2v11h2V3z"/>
          </svg>
        </div>
        <div class="brand-text">
          <span class="brand-title">API Traffic &amp; Token Analytics</span>
          <span class="brand-subtitle">Material 3 Expressive Observability</span>
        </div>
      </div>

      <div class="bar-actions">
        <div class="segmented-chips" id="rangeSelector">
          <button class="seg-chip active" data-range="all">All Time</button>
          <button class="seg-chip" data-range="30d">30 Days</button>
          <button class="seg-chip" data-range="7d">7 Days</button>
          <button class="seg-chip" data-range="today">Today</button>
        </div>

        <button class="m3-btn m3-btn-tonal" id="btnRefresh" title="Refresh conversation cache">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
          </svg>
          Sync
        </button>

        <button class="m3-btn m3-btn-filled" id="btnOpenManager" title="Return to Conversation Manager">
          Conversation Manager &rarr;
        </button>
      </div>
    </div>
  </header>

  <!-- Main View Container -->
  <main class="main-content">

    <!-- M3 Hero Overview Card -->
    <section class="m3-hero-card">
      <div class="hero-text">
        <div class="hero-badge-row">
          <span class="m3-pill-badge primary">Cumulative Intelligence</span>
          <span class="m3-pill-badge emerald" id="heroActiveConvs">0 Conversations Tracked</span>
        </div>
        <h1 class="hero-title">Token Consumption &amp; Traffic Horizon</h1>
        <p class="hero-desc">
          Continuous token accounting across Gemini agentic sessions, tools, and background subagents. Track prompt context, reasoning tokens, and API turns in real-time.
        </p>
      </div>

      <div class="hero-callout-box">
        <div class="callout-header">
          <span class="callout-label">Cumulative Traffic</span>
          <span class="m3-tag" id="heroReqsCount">0 turns</span>
        </div>
        <div class="callout-stat-huge" id="heroTotalTokens">~0</div>
        <div class="callout-stat-sub" id="heroTotalTokensExact">0 exact tokens across all calls</div>
      </div>
    </section>

    <!-- M3 KPI Cards Grid -->
    <section class="kpi-grid">
      <!-- Card 1: API Requests -->
      <div class="m3-kpi-card">
        <div class="kpi-top-row">
          <div class="kpi-icon-squircle emerald">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.251.068a.5.5 0 0 1 .42.58L10.477 6.5H14a.5.5 0 0 1 .372.832l-9.5 10.5a.5.5 0 0 1-.84-.528l1.2-5.804H1.5a.5.5 0 0 1-.372-.832l9.5-10.5a.5.5 0 0 1 .623-.1z"/>
            </svg>
          </div>
          <span class="kpi-category-tag">Requests</span>
        </div>
        <div class="kpi-body">
          <span class="kpi-num" id="kpiTotalRequests">0</span>
          <span class="kpi-detail" id="kpiAvgTokensPerReq">~0 tokens / request avg</span>
        </div>
      </div>

      <!-- Card 2: Prompt / Input Tokens -->
      <div class="m3-kpi-card">
        <div class="kpi-top-row">
          <div class="kpi-icon-squircle blue">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
              <path d="M4 4h8v1H4V4zm0 3h8v1H4V7zm0 3h5v1H4v-1z"/>
            </svg>
          </div>
          <span class="kpi-category-tag" id="kpiInputPct">Prompt 0%</span>
        </div>
        <div class="kpi-body">
          <span class="kpi-num" id="kpiInputTokens">~0</span>
          <span class="kpi-detail">Input instructions &amp; context</span>
        </div>
      </div>

      <!-- Card 3: Completion / Output Tokens -->
      <div class="m3-kpi-card">
        <div class="kpi-top-row">
          <div class="kpi-icon-squircle purple">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zm-1 10H3V4h10v7z"/>
            </svg>
          </div>
          <span class="kpi-category-tag" id="kpiOutputPct">Output 0%</span>
        </div>
        <div class="kpi-body">
          <span class="kpi-num" id="kpiOutputTokens">~0</span>
          <span class="kpi-detail">Agent candidates &amp; responses</span>
        </div>
      </div>

      <!-- Card 4: Reasoning / Thinking Tokens -->
      <div class="m3-kpi-card">
        <div class="kpi-top-row">
          <div class="kpi-icon-squircle amber">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a5 5 0 0 0-5 5v1h1a2 2 0 0 1 2 2v1h4V9a2 2 0 0 1 2-2h1V6a5 5 0 0 0-5-5zm-2 9v1a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-1H6z"/>
            </svg>
          </div>
          <span class="kpi-category-tag" id="kpiThinkingPct">Thinking 0%</span>
        </div>
        <div class="kpi-body">
          <span class="kpi-num" id="kpiThinkingTokens">~0</span>
          <span class="kpi-detail">Internal reasoning chains</span>
        </div>
      </div>
    </section>

    <!-- Charts Row: Timeline & Breakdown -->
    <section class="two-col-layout">

      <!-- Timeline Chart Surface -->
      <div class="m3-surface-card">
        <div class="card-title-row">
          <div class="card-title-group">
            <h2>Daily API Traffic Timeline</h2>
            <p>Chronological distribution of token consumption</p>
          </div>
          <div class="m3-legend-row">
            <div class="m3-legend-item">
              <span class="m3-legend-dot" style="background:var(--md-sys-color-primary)"></span> Prompt
            </div>
            <div class="m3-legend-item">
              <span class="m3-legend-dot" style="background:var(--md-sys-color-tertiary)"></span> Output
            </div>
            <div class="m3-legend-item">
              <span class="m3-legend-dot" style="background:var(--md-sys-color-amber)"></span> Thinking
            </div>
          </div>
        </div>

        <div class="chart-container-m3" id="timelineContainer">
          <svg class="m3-timeline-svg" id="timelineSvg" preserveAspectRatio="none"></svg>
        </div>
      </div>

      <!-- Token Distribution & Top Workspaces -->
      <div class="m3-surface-card">
        <div class="card-title-group">
          <h2>Token Composition</h2>
          <p>Proportional ratio of cumulative volume</p>
        </div>

        <div class="m3-ratio-track">
          <div class="m3-ratio-segment" id="segInput" style="background:var(--md-sys-color-primary); width:0%;"></div>
          <div class="m3-ratio-segment" id="segOutput" style="background:var(--md-sys-color-tertiary); width:0%;"></div>
          <div class="m3-ratio-segment" id="segThinking" style="background:var(--md-sys-color-amber); width:0%;"></div>
        </div>

        <div class="m3-breakdown-list">
          <div class="m3-breakdown-item">
            <div class="m3-breakdown-title">
              <span class="m3-legend-dot" style="background:var(--md-sys-color-primary)"></span>
              <span>Prompt (Input)</span>
            </div>
            <div class="m3-breakdown-values">
              <span class="m3-breakdown-pct" id="legInputPct">0%</span>
              <span class="m3-breakdown-count" id="legInputTok">~0</span>
            </div>
          </div>

          <div class="m3-breakdown-item">
            <div class="m3-breakdown-title">
              <span class="m3-legend-dot" style="background:var(--md-sys-color-tertiary)"></span>
              <span>Output (Candidate)</span>
            </div>
            <div class="m3-breakdown-values">
              <span class="m3-breakdown-pct" id="legOutputPct">0%</span>
              <span class="m3-breakdown-count" id="legOutputTok">~0</span>
            </div>
          </div>

          <div class="m3-breakdown-item">
            <div class="m3-breakdown-title">
              <span class="m3-legend-dot" style="background:var(--md-sys-color-amber)"></span>
              <span>Thinking (Reasoning)</span>
            </div>
            <div class="m3-breakdown-values">
              <span class="m3-breakdown-pct" id="legThinkingPct">0%</span>
              <span class="m3-breakdown-count" id="legThinkingTok">~0</span>
            </div>
          </div>
        </div>

        <div style="margin-top: 14px; padding-top: 16px; border-top: 1px solid var(--md-sys-color-outline-variant);">
          <div class="card-title-group" style="margin-bottom: 12px;">
            <h2 style="font-size: 15px;">Top Workspace Horizon</h2>
          </div>
          <div class="m3-ranking-list" id="workspaceRanking"></div>
        </div>
      </div>
    </section>

    <!-- Top Conversations Leaderboard -->
    <section class="m3-surface-card">
      <div class="card-title-row">
        <div class="card-title-group">
          <h2>Top Conversations by Traffic</h2>
          <p>Heaviest token consumption sessions across workspace</p>
        </div>
        <span class="m3-tag" id="topConvsSubtitle">Top 8 Sessions</span>
      </div>
      <div class="m3-ranking-list" id="topConvsRanking"></div>
    </section>

    <!-- Detailed Analytics Table -->
    <section class="m3-table-container">
      <div class="table-top-bar">
        <div class="m3-nav-tabs" id="tableTabs">
          <button class="m3-nav-tab active" data-tab="dates">Daily Breakdown</button>
          <button class="m3-nav-tab" data-tab="conversations">All Conversations</button>
          <button class="m3-nav-tab" data-tab="workspaces">By Workspace</button>
        </div>

        <div class="m3-search-pill">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--md-sys-color-on-surface-variant)">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
          </svg>
          <input type="text" id="tableSearchInput" placeholder="Filter rows...">
        </div>
      </div>

      <div class="m3-table-scroll">
        <div id="tableContent"></div>
      </div>
    </section>

  </main>

  <!-- M3 Floating Tooltip -->
  <div class="m3-floating-tooltip" id="chartTooltip"></div>

  <script>
    const vscode = acquireVsCodeApi();

    let rawConversations = [];
    let currentRange = 'all';
    let currentTab = 'dates';
    let searchQuery = '';

    function formatNumber(num) {
      if (!num || isNaN(num)) return '0';
      if (num >= 1000000000) {
        return (num / 1000000000).toFixed(2).replace(/\\.00$/, '').replace(/(\\.[1-9])0$/, '$1') + 'B';
      }
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\\.0$/, '') + 'M';
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\\.0$/, '') + 'K';
      }
      return String(num);
    }

    function formatExact(num) {
      return (num || 0).toLocaleString();
    }

    function escapeHtml(s) {
      if (!s) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getFilteredConversations() {
      const now = Date.now();
      let cutoff = 0;
      if (currentRange === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        cutoff = d.getTime();
      } else if (currentRange === '7d') {
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
      } else if (currentRange === '30d') {
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
      }

      return rawConversations.filter(c => {
        const time = c.lastModifiedTime || c.createdTime || 0;
        return time >= cutoff;
      });
    }

    function renderAll() {
      const convs = getFilteredConversations();
      renderHeroAndKpis(convs);
      renderTimeline(convs);
      renderBreakdown(convs);
      renderWorkspaceRanking(convs);
      renderTopConversations(convs);
      renderTable(convs);
    }

    function renderHeroAndKpis(convs) {
      let totalTokens = 0;
      let totalRequests = 0;
      let totalInput = 0;
      let totalOutput = 0;
      let totalThinking = 0;
      let peakContext = 0;

      for (const c of convs) {
        const traffic = c.cumulativeTokens || c.estTotalTokens || 0;
        totalTokens += traffic;
        totalRequests += (c.modelMsgs || 0);
        totalInput += (c.estInputTokens || 0);
        totalOutput += (c.estOutputTokens || 0);
        totalThinking += (c.estThinkingTokens || 0);
        if ((c.estTotalTokens || 0) > peakContext) {
          peakContext = c.estTotalTokens || 0;
        }
      }

      // Hero Card
      document.getElementById('heroActiveConvs').innerText = convs.length + ' Conversations Tracked';
      document.getElementById('heroReqsCount').innerText = formatExact(totalRequests) + ' turns';
      document.getElementById('heroTotalTokens').innerText = '~' + formatNumber(totalTokens);
      document.getElementById('heroTotalTokensExact').innerText = formatExact(totalTokens) + ' exact tokens across all calls';

      // KPI 1: Requests
      document.getElementById('kpiTotalRequests').innerText = formatExact(totalRequests);
      const avgPerReq = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;
      document.getElementById('kpiAvgTokensPerReq').innerText = '~' + formatNumber(avgPerReq) + ' tokens / request avg';

      // KPI 2: Input
      document.getElementById('kpiInputTokens').innerText = '~' + formatNumber(totalInput);
      const inputPct = totalTokens > 0 ? ((totalInput / totalTokens) * 100).toFixed(1) : '0';
      document.getElementById('kpiInputPct').innerText = 'Prompt ' + inputPct + '%';

      // KPI 3: Output
      document.getElementById('kpiOutputTokens').innerText = '~' + formatNumber(totalOutput);
      const outputPct = totalTokens > 0 ? ((totalOutput / totalTokens) * 100).toFixed(1) : '0';
      document.getElementById('kpiOutputPct').innerText = 'Output ' + outputPct + '%';

      // KPI 4: Thinking
      document.getElementById('kpiThinkingTokens').innerText = '~' + formatNumber(totalThinking);
      const thinkingPct = totalTokens > 0 ? ((totalThinking / totalTokens) * 100).toFixed(1) : '0';
      document.getElementById('kpiThinkingPct').innerText = 'Thinking ' + thinkingPct + '%';
    }

    function renderBreakdown(convs) {
      let totalTokens = 0;
      let totalInput = 0;
      let totalOutput = 0;
      let totalThinking = 0;

      for (const c of convs) {
        totalTokens += (c.cumulativeTokens || c.estTotalTokens || 0);
        totalInput += (c.estInputTokens || 0);
        totalOutput += (c.estOutputTokens || 0);
        totalThinking += (c.estThinkingTokens || 0);
      }

      const inputPct = totalTokens > 0 ? (totalInput / totalTokens) * 100 : 0;
      const outputPct = totalTokens > 0 ? (totalOutput / totalTokens) * 100 : 0;
      const thinkingPct = totalTokens > 0 ? (totalThinking / totalTokens) * 100 : 0;

      document.getElementById('segInput').style.width = inputPct.toFixed(1) + '%';
      document.getElementById('segOutput').style.width = outputPct.toFixed(1) + '%';
      document.getElementById('segThinking').style.width = thinkingPct.toFixed(1) + '%';

      document.getElementById('legInputPct').innerText = inputPct.toFixed(1) + '%';
      document.getElementById('legInputTok').innerText = '~' + formatNumber(totalInput);

      document.getElementById('legOutputPct').innerText = outputPct.toFixed(1) + '%';
      document.getElementById('legOutputTok').innerText = '~' + formatNumber(totalOutput);

      document.getElementById('legThinkingPct').innerText = thinkingPct.toFixed(1) + '%';
      document.getElementById('legThinkingTok').innerText = '~' + formatNumber(totalThinking);
    }

    function renderTimeline(convs) {
      const svg = document.getElementById('timelineSvg');
      const tooltip = document.getElementById('chartTooltip');
      if (!svg) return;

      const dayMap = new Map();
      for (const c of convs) {
        const t = c.lastModifiedTime || c.createdTime || 0;
        if (!t) continue;
        const d = new Date(t);
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (!dayMap.has(key)) {
          dayMap.set(key, {
            dateKey: key,
            dateObj: d,
            total: 0,
            input: 0,
            output: 0,
            thinking: 0,
            requests: 0,
            convs: 0
          });
        }
        const item = dayMap.get(key);
        item.total += (c.cumulativeTokens || c.estTotalTokens || 0);
        item.input += (c.estInputTokens || 0);
        item.output += (c.estOutputTokens || 0);
        item.thinking += (c.estThinkingTokens || 0);
        item.requests += (c.modelMsgs || 0);
        item.convs += 1;
      }

      const days = Array.from(dayMap.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

      if (days.length === 0) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--md-sys-color-on-surface-variant)" font-size="13">No conversation data in selected horizon</text>';
        return;
      }

      let maxTokens = 0;
      for (const d of days) {
        if (d.total > maxTokens) maxTokens = d.total;
      }
      if (maxTokens === 0) maxTokens = 1;

      const paddingLeft = 48;
      const paddingRight = 16;
      const paddingTop = 20;
      const paddingBottom = 34;

      const rect = svg.getBoundingClientRect();
      const width = rect.width || 600;
      const height = rect.height || 230;

      const chartW = width - paddingLeft - paddingRight;
      const chartH = height - paddingTop - paddingBottom;

      const barSlot = chartW / days.length;
      const barW = Math.max(6, Math.min(32, barSlot * 0.6));

      let svgHtml = '';

      // M3 subtle horizontal grid lines
      const gridSteps = 4;
      for (let i = 0; i <= gridSteps; i++) {
        const y = paddingTop + (chartH / gridSteps) * i;
        const val = maxTokens * (1 - i / gridSteps);
        svgHtml += '<line x1="' + paddingLeft + '" y1="' + y + '" x2="' + (width - paddingRight) + '" y2="' + y + '" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="4 4"/>';
        svgHtml += '<text x="' + (paddingLeft - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="var(--md-sys-color-on-surface-variant)" font-size="10.5" font-weight="600" font-family="Plus Jakarta Sans">' + formatNumber(val) + '</text>';
      }

      // M3 Expressive pill bars
      days.forEach((d, idx) => {
        const x = paddingLeft + idx * barSlot + (barSlot - barW) / 2;
        const totalBarH = Math.max(4, (d.total / maxTokens) * chartH);
        const yBase = paddingTop + chartH;

        // Heights
        const inputH = (d.input / d.total) * totalBarH || 0;
        const outputH = (d.output / d.total) * totalBarH || 0;
        const thinkingH = Math.max(0, totalBarH - inputH - outputH);

        const yInput = yBase - inputH;
        const yOutput = yInput - outputH;
        const yThinking = yOutput - thinkingH;

        // Tonal background pill track (Android 15 style)
        svgHtml += '<rect x="' + x + '" y="' + paddingTop + '" width="' + barW + '" height="' + chartH + '" fill="rgba(255,255,255,0.03)" rx="6"/>';

        // Stacked pill bars
        svgHtml += '<g class="bar-group" data-idx="' + idx + '">' +
          '<rect x="' + x + '" y="' + yInput + '" width="' + barW + '" height="' + inputH + '" fill="var(--md-sys-color-primary)" rx="4"/>' +
          '<rect x="' + x + '" y="' + yOutput + '" width="' + barW + '" height="' + outputH + '" fill="var(--md-sys-color-tertiary)" rx="4"/>' +
          '<rect x="' + x + '" y="' + yThinking + '" width="' + barW + '" height="' + thinkingH + '" fill="var(--md-sys-color-amber)" rx="4"/>' +
          '<rect x="' + (x - (barSlot - barW) / 2) + '" y="' + paddingTop + '" width="' + barSlot + '" height="' + chartH + '" fill="transparent" style="cursor:pointer;" data-tip="' + idx + '"/>' +
          '</g>';

        // X Axis labels
        const showLabel = days.length <= 14 || idx % Math.ceil(days.length / 10) === 0 || idx === days.length - 1;
        if (showLabel) {
          const labelParts = d.dateKey.split('-');
          const labelStr = labelParts[1] + '/' + labelParts[2];
          svgHtml += '<text x="' + (x + barW / 2) + '" y="' + (height - 10) + '" text-anchor="middle" fill="var(--md-sys-color-on-surface-variant)" font-size="11" font-weight="600" font-family="Plus Jakarta Sans">' + labelStr + '</text>';
        }
      });

      svg.innerHTML = svgHtml;

      svg.querySelectorAll('[data-tip]').forEach(el => {
        el.addEventListener('mousemove', ev => {
          const idx = parseInt(el.getAttribute('data-tip'), 10);
          const d = days[idx];
          if (!d) return;

          tooltip.innerHTML = '<div class="tip-header">' + d.dateKey + ' &middot; ' + d.convs + ' convs</div>' +
            '<div class="tip-line"><span>Total Traffic:</span><b>~' + formatNumber(d.total) + '</b></div>' +
            '<div class="tip-line" style="color:var(--md-sys-color-primary)"><span>Prompt (Input):</span><span>~' + formatNumber(d.input) + '</span></div>' +
            '<div class="tip-line" style="color:var(--md-sys-color-tertiary)"><span>Output:</span><span>~' + formatNumber(d.output) + '</span></div>' +
            '<div class="tip-line" style="color:var(--md-sys-color-amber)"><span>Thinking:</span><span>~' + formatNumber(d.thinking) + '</span></div>' +
            '<div class="tip-line"><span>API Requests:</span><b>' + formatExact(d.requests) + '</b></div>';

          tooltip.style.display = 'block';

          let posX = ev.pageX + 14;
          let posY = ev.pageY - 24;
          if (posX + 230 > window.innerWidth) {
            posX = ev.pageX - 240;
          }
          tooltip.style.left = posX + 'px';
          tooltip.style.top = posY + 'px';
        });

        el.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }

    function renderWorkspaceRanking(convs) {
      const container = document.getElementById('workspaceRanking');
      if (!container) return;

      const wsMap = new Map();
      let maxWs = 0;

      for (const c of convs) {
        const traffic = c.cumulativeTokens || c.estTotalTokens || 0;
        let wsName = 'Standalone';
        if (c.workspaces && c.workspaces.length > 0) {
          const w = c.workspaces[0];
          wsName = w.split('/').filter(Boolean).pop() || w;
        }

        if (!wsMap.has(wsName)) {
          wsMap.set(wsName, { name: wsName, tokens: 0, convs: 0 });
        }
        const item = wsMap.get(wsName);
        item.tokens += traffic;
        item.convs += 1;
        if (item.tokens > maxWs) maxWs = item.tokens;
      }

      const list = Array.from(wsMap.values()).sort((a, b) => b.tokens - a.tokens).slice(0, 5);

      if (list.length === 0) {
        container.innerHTML = '<div class="empty-state-m3">No workspace data</div>';
        return;
      }

      let html = '';
      for (const item of list) {
        const pct = maxWs > 0 ? (item.tokens / maxWs) * 100 : 0;
        html += '<div class="m3-ranking-card">' +
          '<div class="ranking-meta-top">' +
            '<span class="ranking-conv-title" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
            '<div class="ranking-conv-stats">' +
              '<span class="m3-tag">' + item.convs + ' convs</span>' +
              '<b style="color:var(--md-sys-color-primary); font-size:12.5px;">~' + formatNumber(item.tokens) + '</b>' +
            '</div>' +
          '</div>' +
          '<div class="m3-progress-track">' +
            '<div class="m3-progress-fill" style="width:' + pct + '%; background:var(--md-sys-color-primary)"></div>' +
          '</div>' +
        '</div>';
      }

      container.innerHTML = html;
    }

    function renderTopConversations(convs) {
      const container = document.getElementById('topConvsRanking');
      if (!container) return;

      const sorted = [...convs].sort((a, b) => {
        const ta = a.cumulativeTokens || a.estTotalTokens || 0;
        const tb = b.cumulativeTokens || b.estTotalTokens || 0;
        return tb - ta;
      }).slice(0, 8);

      if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-state-m3">No conversation sessions found</div>';
        return;
      }

      let maxTok = (sorted[0].cumulativeTokens || sorted[0].estTotalTokens || 1);

      let html = '';
      for (const c of sorted) {
        const traffic = c.cumulativeTokens || c.estTotalTokens || 0;
        const pct = maxTok > 0 ? (traffic / maxTok) * 100 : 0;
        const ws = (c.workspaces && c.workspaces[0]) ? (c.workspaces[0].split('/').filter(Boolean).pop() || c.workspaces[0]) : 'Standalone';

        html += '<div class="m3-ranking-card">' +
          '<div class="ranking-meta-top">' +
            '<span class="ranking-conv-title" data-conv-id="' + c.id + '" title="Open chat session">' + escapeHtml(c.title) + '</span>' +
            '<div class="ranking-conv-stats">' +
              '<span class="m3-tag">' + escapeHtml(ws) + '</span>' +
              '<span style="color:var(--md-sys-color-on-surface-variant); font-size:12px;">' + (c.modelMsgs || 0) + ' reqs</span>' +
              '<b style="color:var(--md-sys-color-primary); font-size:13px;">~' + formatNumber(traffic) + '</b>' +
              '<button class="action-chip-sm" data-action="chat" data-id="' + c.id + '">Chat</button>' +
              '<button class="action-chip-sm" data-action="log" data-id="' + c.id + '">Log</button>' +
            '</div>' +
          '</div>' +
          '<div class="m3-progress-track">' +
            '<div class="m3-progress-fill" style="width:' + pct + '%; background:var(--md-sys-color-primary)"></div>' +
          '</div>' +
        '</div>';
      }

      container.innerHTML = html;
    }

    function renderTable(convs) {
      const container = document.getElementById('tableContent');
      if (!container) return;

      const q = (searchQuery || '').trim().toLowerCase();

      if (currentTab === 'dates') {
        const dayMap = new Map();
        for (const c of convs) {
          const t = c.lastModifiedTime || c.createdTime || 0;
          if (!t) continue;
          const d = new Date(t);
          const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          if (!dayMap.has(key)) {
            dayMap.set(key, {
              dateKey: key,
              total: 0,
              input: 0,
              output: 0,
              thinking: 0,
              requests: 0,
              convs: 0
            });
          }
          const item = dayMap.get(key);
          item.total += (c.cumulativeTokens || c.estTotalTokens || 0);
          item.input += (c.estInputTokens || 0);
          item.output += (c.estOutputTokens || 0);
          item.thinking += (c.estThinkingTokens || 0);
          item.requests += (c.modelMsgs || 0);
          item.convs += 1;
        }

        let list = Array.from(dayMap.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
        if (q) {
          list = list.filter(item => item.dateKey.toLowerCase().includes(q));
        }

        if (list.length === 0) {
          container.innerHTML = '<div class="empty-state-m3">No matching date records</div>';
          return;
        }

        let html = '<table class="m3-table"><thead><tr>' +
          '<th>Date</th>' +
          '<th>Active Convs</th>' +
          '<th>API Requests</th>' +
          '<th>Prompt (Input)</th>' +
          '<th>Output</th>' +
          '<th>Thinking</th>' +
          '<th>Total Cumulative</th>' +
          '<th>Avg / Req</th>' +
          '</tr></thead><tbody>';

        for (const d of list) {
          const avg = d.requests > 0 ? Math.round(d.total / d.requests) : 0;
          html += '<tr>' +
            '<td><b>' + d.dateKey + '</b></td>' +
            '<td>' + d.convs + '</td>' +
            '<td class="mono-cell">' + formatExact(d.requests) + '</td>' +
            '<td class="mono-cell" style="color:var(--md-sys-color-primary)">~' + formatNumber(d.input) + '</td>' +
            '<td class="mono-cell" style="color:var(--md-sys-color-tertiary)">~' + formatNumber(d.output) + '</td>' +
            '<td class="mono-cell" style="color:var(--md-sys-color-amber)">~' + formatNumber(d.thinking) + '</td>' +
            '<td class="mono-cell"><b>~' + formatNumber(d.total) + '</b> <span style="color:var(--md-sys-color-on-surface-variant); font-size:11px;">(' + formatExact(d.total) + ')</span></td>' +
            '<td class="mono-cell">~' + formatNumber(avg) + '</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;

      } else if (currentTab === 'conversations') {
        let list = [...convs];
        if (q) {
          list = list.filter(c => 
            (c.title || '').toLowerCase().includes(q) ||
            (c.workspaces || []).some(w => w.toLowerCase().includes(q))
          );
        }

        list.sort((a, b) => (b.cumulativeTokens || b.estTotalTokens || 0) - (a.cumulativeTokens || a.estTotalTokens || 0));

        if (list.length === 0) {
          container.innerHTML = '<div class="empty-state-m3">No matching conversation records</div>';
          return;
        }

        let html = '<table class="m3-table"><thead><tr>' +
          '<th>Conversation Title</th>' +
          '<th>Workspace</th>' +
          '<th>Last Active</th>' +
          '<th>Requests</th>' +
          '<th>Active Context</th>' +
          '<th>Cumulative Traffic</th>' +
          '<th>Actions</th>' +
          '</tr></thead><tbody>';

        for (const c of list) {
          const traffic = c.cumulativeTokens || c.estTotalTokens || 0;
          const ws = (c.workspaces && c.workspaces[0]) ? (c.workspaces[0].split('/').filter(Boolean).pop() || c.workspaces[0]) : 'Standalone';
          const dt = c.lastModifiedTime ? new Date(c.lastModifiedTime).toLocaleDateString() : '-';

          html += '<tr>' +
            '<td><span class="ranking-conv-title" data-conv-id="' + c.id + '" title="' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</span></td>' +
            '<td><span class="m3-tag">' + escapeHtml(ws) + '</span></td>' +
            '<td>' + dt + '</td>' +
            '<td class="mono-cell">' + (c.modelMsgs || 0) + '</td>' +
            '<td class="mono-cell">~' + formatNumber(c.estTotalTokens || 0) + '</td>' +
            '<td class="mono-cell"><b>~' + formatNumber(traffic) + '</b> <span style="color:var(--md-sys-color-on-surface-variant); font-size:11px;">(' + formatExact(traffic) + ')</span></td>' +
            '<td>' +
              '<button class="action-chip-sm" data-action="chat" data-id="' + c.id + '">Chat</button>' +
              '<button class="action-chip-sm" data-action="log" data-id="' + c.id + '">Log</button>' +
            '</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;

      } else if (currentTab === 'workspaces') {
        const wsMap = new Map();
        let grandTotal = 0;

        for (const c of convs) {
          const traffic = c.cumulativeTokens || c.estTotalTokens || 0;
          grandTotal += traffic;
          let wsPath = 'Standalone';
          if (c.workspaces && c.workspaces.length > 0) {
            wsPath = c.workspaces[0];
          }

          if (!wsMap.has(wsPath)) {
            wsMap.set(wsPath, { path: wsPath, tokens: 0, convs: 0, requests: 0 });
          }
          const item = wsMap.get(wsPath);
          item.tokens += traffic;
          item.convs += 1;
          item.requests += (c.modelMsgs || 0);
        }

        let list = Array.from(wsMap.values()).sort((a, b) => b.tokens - a.tokens);
        if (q) {
          list = list.filter(item => item.path.toLowerCase().includes(q));
        }

        if (list.length === 0) {
          container.innerHTML = '<div class="empty-state-m3">No matching workspace records</div>';
          return;
        }

        let html = '<table class="m3-table"><thead><tr>' +
          '<th>Workspace / Folder</th>' +
          '<th>Conversations</th>' +
          '<th>API Requests</th>' +
          '<th>Total Cumulative Traffic</th>' +
          '<th>% of Total</th>' +
          '</tr></thead><tbody>';

        for (const w of list) {
          const pct = grandTotal > 0 ? ((w.tokens / grandTotal) * 100).toFixed(1) : '0';
          html += '<tr>' +
            '<td><b>' + escapeHtml(w.path) + '</b></td>' +
            '<td>' + w.convs + '</td>' +
            '<td class="mono-cell">' + formatExact(w.requests) + '</td>' +
            '<td class="mono-cell"><b>~' + formatNumber(w.tokens) + '</b> <span style="color:var(--md-sys-color-on-surface-variant); font-size:11px;">(' + formatExact(w.tokens) + ')</span></td>' +
            '<td class="mono-cell">' + pct + '%</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
      }
    }

    // Event listeners
    document.getElementById('rangeSelector').addEventListener('click', ev => {
      const btn = ev.target.closest('.seg-chip');
      if (!btn) return;
      document.querySelectorAll('.seg-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.getAttribute('data-range') || 'all';
      renderAll();
    });

    document.getElementById('tableTabs').addEventListener('click', ev => {
      const btn = ev.target.closest('.m3-nav-tab');
      if (!btn) return;
      document.querySelectorAll('.m3-nav-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.getAttribute('data-tab') || 'dates';
      renderTable(getFilteredConversations());
    });

    document.getElementById('tableSearchInput').addEventListener('input', ev => {
      searchQuery = ev.target.value;
      renderTable(getFilteredConversations());
    });

    document.getElementById('btnRefresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('btnOpenManager').addEventListener('click', () => {
      vscode.postMessage({ type: 'openManager' });
    });

    document.body.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-action]');
      if (btn) {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (action === 'chat' && id) {
          vscode.postMessage({ type: 'openInChat', id });
        } else if (action === 'log' && id) {
          vscode.postMessage({ type: 'openLog', id });
        }
        return;
      }

      const titleEl = ev.target.closest('[data-conv-id]');
      if (titleEl) {
        const id = titleEl.getAttribute('data-conv-id');
        if (id) {
          vscode.postMessage({ type: 'openInChat', id });
        }
      }
    });

    // Window resize -> redraw chart
    window.addEventListener('resize', () => {
      renderTimeline(getFilteredConversations());
    });

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if (msg.type === 'data') {
        rawConversations = msg.conversations || [];
        renderAll();
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}
