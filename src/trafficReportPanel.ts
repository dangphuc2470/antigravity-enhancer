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
  <title>API Traffic & Token Analytics</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      --accent: var(--vscode-focusBorder, #007acc);
      --muted: var(--vscode-descriptionForeground, #888888);
      --hover-bg: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
      --badge-bg: var(--vscode-badge-background, #3a3d41);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --blue: #4daafc;
      --purple: #a371f7;
      --amber: #e5a93c;
      --green: #3fb950;
      --red: #f85149;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: 13px;
      line-height: 1.5;
      padding: 24px 32px 60px 32px;
      overflow-y: auto;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }

    /* Header */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 16px;
    }

    .report-title-area h1 {
      font-size: 20px;
      font-weight: 600;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.3px;
    }

    .report-title-area h1 svg {
      color: var(--blue);
      flex-shrink: 0;
    }

    .report-title-area p {
      color: var(--muted);
      font-size: 12.5px;
      margin-top: 4px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* Range filter pills */
    .range-selector {
      display: flex;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }

    .range-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .range-btn:hover {
      color: var(--fg);
      background: rgba(255, 255, 255, 0.05);
    }

    .range-btn.active {
      background: var(--accent);
      color: #ffffff;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .btn-primary {
      background: var(--accent);
      color: #ffffff;
      border-color: var(--accent);
    }
    .btn-primary:hover {
      background: #008be5;
    }

    /* KPI Cards Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }

    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      position: relative;
      overflow: hidden;
      transition: transform 0.15s, border-color 0.15s;
    }

    .kpi-card:hover {
      border-color: rgba(255, 255, 255, 0.18);
      transform: translateY(-1px);
    }

    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--card-accent, var(--border));
    }

    .kpi-card.traffic::before { background: var(--blue); }
    .kpi-card.requests::before { background: var(--green); }
    .kpi-card.input::before { background: #388bfd; }
    .kpi-card.output::before { background: var(--purple); }
    .kpi-card.thinking::before { background: var(--amber); }
    .kpi-card.context::before { background: #1f6feb; }

    .kpi-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--muted);
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .kpi-value {
      font-size: 26px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.5px;
      line-height: 1.2;
    }

    .kpi-sub {
      font-size: 11.5px;
      color: var(--muted);
      margin-top: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .kpi-pill {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 99px;
      font-weight: 600;
    }
    .kpi-pill.blue { background: rgba(77, 170, 252, 0.18); color: var(--blue); }
    .kpi-pill.purple { background: rgba(163, 113, 247, 0.18); color: var(--purple); }
    .kpi-pill.amber { background: rgba(229, 169, 60, 0.18); color: var(--amber); }

    /* Section layout */
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .charts-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
      margin-bottom: 28px;
    }

    @media (max-width: 900px) {
      .charts-row {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
    }

    /* Timeline Bar Chart */
    .timeline-chart-container {
      position: relative;
      width: 100%;
      height: 240px;
      display: flex;
      flex-direction: column;
    }

    .chart-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--muted);
    }

    .chart-legend {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }

    .chart-svg-wrap {
      flex: 1;
      width: 100%;
      position: relative;
    }

    svg.chart-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Tooltip */
    .chart-tooltip {
      position: absolute;
      z-index: 100;
      background: #181818;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.6);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 11.5px;
      color: #ffffff;
      pointer-events: none;
      display: none;
      min-width: 180px;
    }

    .chart-tooltip .tip-date {
      font-weight: 600;
      margin-bottom: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 4px;
      color: #ffffff;
    }

    .chart-tooltip .tip-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      line-height: 1.6;
    }

    /* Breakdown progress bar */
    .ratio-bar {
      height: 14px;
      border-radius: 7px;
      display: flex;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.05);
      margin: 16px 0 20px 0;
    }

    .ratio-segment {
      height: 100%;
      transition: width 0.3s ease;
    }

    .breakdown-legend {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .breakdown-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12.5px;
    }

    .breakdown-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .breakdown-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .breakdown-pct {
      font-weight: 600;
      font-size: 13px;
      color: #ffffff;
    }

    .breakdown-tok {
      font-size: 11.5px;
      color: var(--muted);
      min-width: 65px;
      text-align: right;
    }

    /* Rankings bar */
    .ranking-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ranking-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px 8px;
      border-radius: 6px;
      transition: background 0.15s;
    }
    .ranking-item:hover {
      background: var(--hover-bg);
    }

    .ranking-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12.5px;
    }

    .ranking-title {
      font-weight: 500;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 70%;
      cursor: pointer;
    }
    .ranking-title:hover {
      color: var(--blue);
      text-decoration: underline;
    }

    .ranking-meta {
      font-size: 11px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ranking-bar-bg {
      height: 6px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
      overflow: hidden;
    }

    .ranking-bar-fill {
      height: 100%;
      background: var(--blue);
      border-radius: 3px;
    }

    /* Table Section */
    .table-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0;
      overflow: hidden;
      margin-top: 24px;
    }

    .table-tabs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      flex-wrap: wrap;
      gap: 12px;
    }

    .table-tabs {
      display: flex;
      gap: 6px;
    }

    .table-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--muted);
      font-size: 12.5px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .table-tab:hover {
      color: var(--fg);
      background: rgba(255, 255, 255, 0.04);
    }
    .table-tab.active {
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.1);
    }

    .table-search-box {
      display: flex;
      align-items: center;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 10px;
      width: 260px;
      gap: 8px;
    }

    .table-search-box input {
      background: transparent;
      border: none;
      outline: none;
      color: #ffffff;
      font-size: 12px;
      width: 100%;
    }

    .table-wrap {
      max-height: 440px;
      overflow-y: auto;
    }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }

    table.data-table th {
      background: rgba(0, 0, 0, 0.3);
      color: var(--muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    table.data-table td {
      padding: 9px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--fg);
    }

    table.data-table tr:hover td {
      background: var(--hover-bg);
    }

    .cell-title {
      font-weight: 500;
      color: #ffffff;
      cursor: pointer;
    }
    .cell-title:hover {
      color: var(--blue);
      text-decoration: underline;
    }

    .cell-badge {
      display: inline-block;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 99px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--muted);
      margin-left: 6px;
    }

    .action-btn-sm {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      margin-right: 4px;
    }
    .action-btn-sm:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--muted);
      font-size: 13px;
    }
  </style>
</head>
<body>

  <div class="report-header">
    <div class="report-title-area">
      <h1>
        <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11 2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12h1v1H0v-1h1V8a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6h2V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v10h2V2zm-7 7H2v5h2V9zm5-4H7v9h2V5zm5-2h-2v11h2V3z"/>
        </svg>
        API Traffic &amp; Token Analytics
      </h1>
      <p id="reportSubtitle">Comprehensive cumulative token consumption, daily trends, model distribution &amp; conversation stats</p>
    </div>

    <div class="header-actions">
      <div class="range-selector" id="rangeSelector">
        <button class="range-btn active" data-range="all">All Time</button>
        <button class="range-btn" data-range="30d">Last 30 Days</button>
        <button class="range-btn" data-range="7d">Last 7 Days</button>
        <button class="range-btn" data-range="today">Today</button>
      </div>

      <button class="btn" id="btnRefresh" title="Refresh data">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
        Refresh
      </button>

      <button class="btn btn-primary" id="btnOpenManager" title="Open Conversation Manager">
        Conversation Manager &rarr;
      </button>
    </div>
  </div>

  <!-- KPI Cards Grid -->
  <div class="kpi-grid">
    <div class="kpi-card traffic">
      <div class="kpi-label">
        <span>Cumulative Traffic</span>
        <span class="kpi-pill blue">All Calls</span>
      </div>
      <div class="kpi-value" id="kpiTotalTokens">~0</div>
      <div class="kpi-sub" id="kpiTotalTokensSub">0 exact tokens</div>
    </div>

    <div class="kpi-card requests">
      <div class="kpi-label">
        <span>API Requests</span>
        <span class="kpi-pill" style="background:rgba(63,185,80,0.18); color:var(--green)">Model Turns</span>
      </div>
      <div class="kpi-value" id="kpiTotalRequests">0</div>
      <div class="kpi-sub" id="kpiAvgTokensPerReq">~0 tok / request avg</div>
    </div>

    <div class="kpi-card input">
      <div class="kpi-label">
        <span>Prompt (Input)</span>
        <span class="kpi-pill blue" id="kpiInputPct">0%</span>
      </div>
      <div class="kpi-value" id="kpiInputTokens">~0</div>
      <div class="kpi-sub" id="kpiInputTokensSub">Context &amp; instructions</div>
    </div>

    <div class="kpi-card output">
      <div class="kpi-label">
        <span>Output (Candidates)</span>
        <span class="kpi-pill purple" id="kpiOutputPct">0%</span>
      </div>
      <div class="kpi-value" id="kpiOutputTokens">~0</div>
      <div class="kpi-sub" id="kpiOutputTokensSub">Model responses</div>
    </div>

    <div class="kpi-card thinking">
      <div class="kpi-label">
        <span>Reasoning (Thinking)</span>
        <span class="kpi-pill amber" id="kpiThinkingPct">0%</span>
      </div>
      <div class="kpi-value" id="kpiThinkingTokens">~0</div>
      <div class="kpi-sub" id="kpiThinkingTokensSub">Chain-of-thought tokens</div>
    </div>

    <div class="kpi-card context">
      <div class="kpi-label">
        <span>Context Size Peak</span>
        <span class="kpi-pill blue">Single Conv</span>
      </div>
      <div class="kpi-value" id="kpiPeakContext">~0</div>
      <div class="kpi-sub" id="kpiActiveConvsSub">In 0 conversations</div>
    </div>
  </div>

  <!-- Charts Row -->
  <div class="charts-row">
    <!-- Chart 1: Daily Usage Timeline -->
    <div class="card">
      <div class="chart-controls">
        <div style="font-weight: 600; font-size: 14px; color: #ffffff;">Daily API Traffic Timeline</div>
        <div class="chart-legend">
          <div class="legend-item"><span class="legend-dot" style="background:var(--blue)"></span> Input (Prompt)</div>
          <div class="legend-item"><span class="legend-dot" style="background:var(--purple)"></span> Output (Response)</div>
          <div class="legend-item"><span class="legend-dot" style="background:var(--amber)"></span> Thinking</div>
        </div>
      </div>
      <div class="timeline-chart-container" id="timelineContainer">
        <div class="chart-svg-wrap" id="chartSvgWrap">
          <svg class="chart-svg" id="timelineSvg" preserveAspectRatio="none"></svg>
        </div>
      </div>
    </div>

    <!-- Chart 2: Token Breakdown & Top Workspaces -->
    <div class="card">
      <div style="font-weight: 600; font-size: 14px; color: #ffffff; margin-bottom: 8px;">Token Type Breakdown</div>
      
      <div class="ratio-bar">
        <div class="ratio-segment" id="segInput" style="background:var(--blue); width:0%;"></div>
        <div class="ratio-segment" id="segOutput" style="background:var(--purple); width:0%;"></div>
        <div class="ratio-segment" id="segThinking" style="background:var(--amber); width:0%;"></div>
      </div>

      <div class="breakdown-legend">
        <div class="breakdown-item">
          <div class="breakdown-left">
            <span class="legend-dot" style="background:var(--blue)"></span>
            <span>Prompt (Input) Tokens</span>
          </div>
          <div class="breakdown-right">
            <span class="breakdown-pct" id="legInputPct">0%</span>
            <span class="breakdown-tok" id="legInputTok">~0</span>
          </div>
        </div>

        <div class="breakdown-item">
          <div class="breakdown-left">
            <span class="legend-dot" style="background:var(--purple)"></span>
            <span>Output (Candidate) Tokens</span>
          </div>
          <div class="breakdown-right">
            <span class="breakdown-pct" id="legOutputPct">0%</span>
            <span class="breakdown-tok" id="legOutputTok">~0</span>
          </div>
        </div>

        <div class="breakdown-item">
          <div class="breakdown-left">
            <span class="legend-dot" style="background:var(--amber)"></span>
            <span>Thinking (Reasoning) Tokens</span>
          </div>
          <div class="breakdown-right">
            <span class="breakdown-pct" id="legThinkingPct">0%</span>
            <span class="breakdown-tok" id="legThinkingTok">~0</span>
          </div>
        </div>
      </div>

      <div style="font-weight: 600; font-size: 13px; color: #ffffff; margin: 24px 0 10px 0; border-top: 1px solid var(--border); padding-top: 14px;">
        Top Projects by Traffic
      </div>
      <div class="ranking-list" id="workspaceRanking"></div>
    </div>
  </div>

  <!-- Top Conversations Ranking -->
  <div class="card" style="margin-bottom: 24px;">
    <div class="section-title">
      <span>Top Conversations by Cumulative Traffic</span>
      <span style="font-size:12px; color:var(--muted); font-weight:normal;" id="topConvsSubtitle">Highest consumption</span>
    </div>
    <div class="ranking-list" id="topConvsRanking"></div>
  </div>

  <!-- Detailed Data Table -->
  <div class="table-card">
    <div class="table-tabs-header">
      <div class="table-tabs" id="tableTabs">
        <button class="table-tab active" data-tab="dates">Daily Breakdown</button>
        <button class="table-tab" data-tab="conversations">All Conversations</button>
        <button class="table-tab" data-tab="workspaces">By Workspace</button>
      </div>

      <div class="table-search-box">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="color:var(--muted)">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
        <input type="text" id="tableSearchInput" placeholder="Filter rows by title, date, or path...">
      </div>
    </div>

    <div class="table-wrap">
      <div id="tableContent"></div>
    </div>
  </div>

  <!-- Tooltip Element -->
  <div class="chart-tooltip" id="chartTooltip"></div>

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
      renderKpis(convs);
      renderTimeline(convs);
      renderBreakdown(convs);
      renderWorkspaceRanking(convs);
      renderTopConversations(convs);
      renderTable(convs);
    }

    function renderKpis(convs) {
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

      document.getElementById('kpiTotalTokens').innerText = '~' + formatNumber(totalTokens);
      document.getElementById('kpiTotalTokensSub').innerText = formatExact(totalTokens) + ' exact tokens';

      document.getElementById('kpiTotalRequests').innerText = formatExact(totalRequests);
      const avgPerReq = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;
      document.getElementById('kpiAvgTokensPerReq').innerText = '~' + formatNumber(avgPerReq) + ' tok / request avg';

      document.getElementById('kpiInputTokens').innerText = '~' + formatNumber(totalInput);
      const inputPct = totalTokens > 0 ? ((totalInput / totalTokens) * 100).toFixed(1) : '0';
      document.getElementById('kpiInputPct').innerText = inputPct + '%';

      document.getElementById('kpiOutputTokens').innerText = '~' + formatNumber(totalOutput);
      const outputPct = totalTokens > 0 ? ((totalOutput / totalTokens) * 100).toFixed(1) : '0';
      document.getElementById('kpiOutputPct').innerText = outputPct + '%';

      document.getElementById('kpiThinkingTokens').innerText = '~' + formatNumber(totalThinking);
      const thinkingPct = totalTokens > 0 ? ((totalThinking / totalTokens) * 100).toFixed(1) : '0';
      document.getElementById('kpiThinkingPct').innerText = thinkingPct + '%';

      document.getElementById('kpiPeakContext').innerText = '~' + formatNumber(peakContext);
      document.getElementById('kpiActiveConvsSub').innerText = 'Across ' + convs.length + ' conversations';
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

      // Group by day YYYY-MM-DD
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
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--muted)" font-size="12">No data in selected range</text>';
        return;
      }

      // Find max value
      let maxTokens = 0;
      for (const d of days) {
        if (d.total > maxTokens) maxTokens = d.total;
      }
      if (maxTokens === 0) maxTokens = 1;

      const paddingLeft = 45;
      const paddingRight = 10;
      const paddingTop = 20;
      const paddingBottom = 30;

      const rect = svg.getBoundingClientRect();
      const width = rect.width || 600;
      const height = rect.height || 220;

      const chartW = width - paddingLeft - paddingRight;
      const chartH = height - paddingTop - paddingBottom;

      const barSlot = chartW / days.length;
      const barW = Math.max(4, Math.min(36, barSlot * 0.65));

      let svgHtml = '';

      // Grid horizontal lines
      const gridSteps = 4;
      for (let i = 0; i <= gridSteps; i++) {
        const y = paddingTop + (chartH / gridSteps) * i;
        const val = maxTokens * (1 - i / gridSteps);
        svgHtml += '<line x1="' + paddingLeft + '" y1="' + y + '" x2="' + (width - paddingRight) + '" y2="' + y + '" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3 3"/>';
        svgHtml += '<text x="' + (paddingLeft - 6) + '" y="' + (y + 4) + '" text-anchor="end" fill="var(--muted)" font-size="10">' + formatNumber(val) + '</text>';
      }

      // Bars
      days.forEach((d, idx) => {
        const x = paddingLeft + idx * barSlot + (barSlot - barW) / 2;
        const totalBarH = Math.max(2, (d.total / maxTokens) * chartH);
        const yBase = paddingTop + chartH;

        // Heights
        const inputH = (d.input / d.total) * totalBarH || 0;
        const outputH = (d.output / d.total) * totalBarH || 0;
        const thinkingH = Math.max(0, totalBarH - inputH - outputH);

        const yInput = yBase - inputH;
        const yOutput = yInput - outputH;
        const yThinking = yOutput - thinkingH;

        svgHtml += '<g class="bar-group" data-idx="' + idx + '">' +
          '<rect x="' + x + '" y="' + yInput + '" width="' + barW + '" height="' + inputH + '" fill="var(--blue)" rx="0"/>' +
          '<rect x="' + x + '" y="' + yOutput + '" width="' + barW + '" height="' + outputH + '" fill="var(--purple)" rx="0"/>' +
          '<rect x="' + x + '" y="' + yThinking + '" width="' + barW + '" height="' + thinkingH + '" fill="var(--amber)" rx="2"/>' +
          // invisible wider hit area for hovering
          '<rect x="' + (x - (barSlot - barW) / 2) + '" y="' + paddingTop + '" width="' + barSlot + '" height="' + chartH + '" fill="transparent" style="cursor:pointer;" data-tip="' + idx + '"/>' +
          '</g>';

        // X label
        const showLabel = days.length <= 14 || idx % Math.ceil(days.length / 10) === 0 || idx === days.length - 1;
        if (showLabel) {
          const labelParts = d.dateKey.split('-');
          const labelStr = labelParts[1] + '/' + labelParts[2];
          svgHtml += '<text x="' + (x + barW / 2) + '" y="' + (height - 8) + '" text-anchor="middle" fill="var(--muted)" font-size="10">' + labelStr + '</text>';
        }
      });

      svg.innerHTML = svgHtml;

      // Tooltip interaction
      svg.querySelectorAll('[data-tip]').forEach(el => {
        el.addEventListener('mousemove', ev => {
          const idx = parseInt(el.getAttribute('data-tip'), 10);
          const d = days[idx];
          if (!d) return;

          tooltip.innerHTML = '<div class="tip-date">' + d.dateKey + ' (' + d.convs + ' convs)</div>' +
            '<div class="tip-row"><span>Total Traffic:</span><b>~' + formatNumber(d.total) + '</b></div>' +
            '<div class="tip-row" style="color:var(--blue)"><span>Input:</span><span>~' + formatNumber(d.input) + '</span></div>' +
            '<div class="tip-row" style="color:var(--purple)"><span>Output:</span><span>~' + formatNumber(d.output) + '</span></div>' +
            '<div class="tip-row" style="color:var(--amber)"><span>Thinking:</span><span>~' + formatNumber(d.thinking) + '</span></div>' +
            '<div class="tip-row"><span>API Requests:</span><b>' + formatExact(d.requests) + '</b></div>';

          tooltip.style.display = 'block';

          let posX = ev.pageX + 12;
          let posY = ev.pageY - 20;
          if (posX + 200 > window.innerWidth) {
            posX = ev.pageX - 210;
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
        container.innerHTML = '<div style="color:var(--muted); font-size:12px;">No workspace data</div>';
        return;
      }

      let html = '';
      for (const item of list) {
        const pct = maxWs > 0 ? (item.tokens / maxWs) * 100 : 0;
        html += '<div class="ranking-item">' +
          '<div class="ranking-top">' +
            '<span class="ranking-title" title="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>' +
            '<div class="ranking-meta">' +
              '<span>' + item.convs + ' convs</span> &middot; ' +
              '<b style="color:#ffffff">~' + formatNumber(item.tokens) + '</b>' +
            '</div>' +
          '</div>' +
          '<div class="ranking-bar-bg">' +
            '<div class="ranking-bar-fill" style="width:' + pct + '%; background:var(--blue)"></div>' +
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
        container.innerHTML = '<div class="empty-state">No conversations found</div>';
        return;
      }

      let maxTok = (sorted[0].cumulativeTokens || sorted[0].estTotalTokens || 1);

      let html = '';
      for (const c of sorted) {
        const traffic = c.cumulativeTokens || c.estTotalTokens || 0;
        const pct = maxTok > 0 ? (traffic / maxTok) * 100 : 0;
        const ws = (c.workspaces && c.workspaces[0]) ? (c.workspaces[0].split('/').filter(Boolean).pop() || c.workspaces[0]) : 'Standalone';

        html += '<div class="ranking-item">' +
          '<div class="ranking-top">' +
            '<span class="ranking-title" data-conv-id="' + c.id + '" title="Open chat: ' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</span>' +
            '<div class="ranking-meta">' +
              '<span class="cell-badge">' + escapeHtml(ws) + '</span>' +
              '<span>' + (c.modelMsgs || 0) + ' reqs</span>' +
              '<b style="color:var(--blue); font-size:12px;">~' + formatNumber(traffic) + '</b>' +
              '<button class="action-btn-sm" data-action="chat" data-id="' + c.id + '">Chat</button>' +
              '<button class="action-btn-sm" data-action="log" data-id="' + c.id + '">Log</button>' +
            '</div>' +
          '</div>' +
          '<div class="ranking-bar-bg">' +
            '<div class="ranking-bar-fill" style="width:' + pct + '%; background:var(--blue)"></div>' +
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
        // Group by Date
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
          container.innerHTML = '<div class="empty-state">No matching dates found</div>';
          return;
        }

        let html = '<table class="data-table"><thead><tr>' +
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
            '<td>' + formatExact(d.requests) + '</td>' +
            '<td style="color:var(--blue)">~' + formatNumber(d.input) + '</td>' +
            '<td style="color:var(--purple)">~' + formatNumber(d.output) + '</td>' +
            '<td style="color:var(--amber)">~' + formatNumber(d.thinking) + '</td>' +
            '<td><b>~' + formatNumber(d.total) + '</b> <span style="color:var(--muted); font-size:10.5px">(' + formatExact(d.total) + ')</span></td>' +
            '<td>~' + formatNumber(avg) + '</td>' +
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
          container.innerHTML = '<div class="empty-state">No matching conversations found</div>';
          return;
        }

        let html = '<table class="data-table"><thead><tr>' +
          '<th>Conversation Title</th>' +
          '<th>Workspace</th>' +
          '<th>Last Modified</th>' +
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
            '<td><span class="cell-title" data-conv-id="' + c.id + '" title="' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</span></td>' +
            '<td><span class="cell-badge">' + escapeHtml(ws) + '</span></td>' +
            '<td>' + dt + '</td>' +
            '<td>' + (c.modelMsgs || 0) + '</td>' +
            '<td>~' + formatNumber(c.estTotalTokens || 0) + '</td>' +
            '<td><b>~' + formatNumber(traffic) + '</b> <span style="color:var(--muted); font-size:10.5px">(' + formatExact(traffic) + ')</span></td>' +
            '<td>' +
              '<button class="action-btn-sm" data-action="chat" data-id="' + c.id + '">Chat</button>' +
              '<button class="action-btn-sm" data-action="log" data-id="' + c.id + '">Log</button>' +
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
          container.innerHTML = '<div class="empty-state">No matching workspaces found</div>';
          return;
        }

        let html = '<table class="data-table"><thead><tr>' +
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
            '<td>' + formatExact(w.requests) + '</td>' +
            '<td><b>~' + formatNumber(w.tokens) + '</b> <span style="color:var(--muted); font-size:10.5px">(' + formatExact(w.tokens) + ')</span></td>' +
            '<td>' + pct + '%</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
      }
    }

    // Event listeners
    document.getElementById('rangeSelector').addEventListener('click', ev => {
      const btn = ev.target.closest('.range-btn');
      if (!btn) return;
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.getAttribute('data-range') || 'all';
      renderAll();
    });

    document.getElementById('tableTabs').addEventListener('click', ev => {
      const btn = ev.target.closest('.table-tab');
      if (!btn) return;
      document.querySelectorAll('.table-tab').forEach(b => b.classList.remove('active'));
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
