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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const externalOpener_1 = require("./externalOpener");
// Unique marker embedded in the patched code
const PATCH_MARKER = '/* agy-chat-fixed */';
const LEGACY_MARKER = '/* agy-clipboard-fixed */';
// ==========================================
// Module 1: Clipboard & Context Menu
// ==========================================
const ORIGINAL_PSR = 'PSr=class extends oe{constructor(e,i){super(),this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation()}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&t.key==="a"}function Zvf(t){const e=t.ctrlKey||t.metaKey,i=t.shiftKey&&t.key==="Insert";return e&&["c","v","x"].includes(t.key)||i}function Xvf(t){return(t.ctrlKey||t.metaKey)&&["z","y"].includes(t.key)}';
const V1_PATCHED_PSR = `/* agy-clipboard-fixed */PSr=class extends oe{constructor(e,i){super(),this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65);if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const V2_LEGACY_PATCHED_PSR = `/* agy-clipboard-fixed */PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){let p=!1;try{p=bI().execCommand("paste")}catch(t){}if(!p){kn.navigator.clipboard?.readText().then(t=>{if(!t)return;let el=e.target;const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");if(!ed(el)){const act=bI().activeElement;el=ed(act)?act:(this._domNode?.querySelector?.('[contenteditable="true"],textarea,input')||el)}if(!el)return;if(typeof el.focus==="function"&&bI().activeElement!==el)el.focus();if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){const r=el.selectionStart||0,s=el.selectionEnd||0,proto=Object.getPrototypeOf(el),set=Object.getOwnPropertyDescriptor(proto,"value")?.set,val=el.value.substring(0,r)+t+el.value.substring(s);set?set.call(el,val):(el.value=val),el.selectionStart=el.selectionEnd=r+t.length,el.dispatchEvent(new Event("input",{bubbles:!0,cancelable:!0}))}else{let h=!1;try{const dt=new DataTransfer();dt.setData("text/plain",t);const pe=new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0});el.dispatchEvent(pe),h=pe.defaultPrevented}catch(t){}if(!h)bI().execCommand("insertText",!1,t)}}).catch(()=>{})}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const V2_PATCHED_PSR = `${PATCH_MARKER}PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){let p=!1;try{p=bI().execCommand("paste")}catch(t){}if(!p){kn.navigator.clipboard?.readText().then(t=>{if(!t)return;let el=e.target;const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");if(!ed(el)){const act=bI().activeElement;el=ed(act)?act:(this._domNode?.querySelector?.('[contenteditable="true"],textarea,input')||el)}if(!el)return;if(typeof el.focus==="function"&&bI().activeElement!==el)el.focus();if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){const r=el.selectionStart||0,s=el.selectionEnd||0,proto=Object.getPrototypeOf(el),set=Object.getOwnPropertyDescriptor(proto,"value")?.set,val=el.value.substring(0,r)+t+el.value.substring(s);set?set.call(el,val):(el.value=val),el.selectionStart=el.selectionEnd=r+t.length,el.dispatchEvent(new Event("input",{bubbles:!0,cancelable:!0}))}else{let h=!1;try{const dt=new DataTransfer();dt.setData("text/plain",t);const pe=new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0});el.dispatchEvent(pe),h=pe.defaultPrevented}catch(t){}if(!h)bI().execCommand("insertText",!1,t)}}).catch(()=>{})}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const V3_PATCHED_PSR = `${PATCH_MARKER}PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");if(!ed(e.target)&&!ed(bI().activeElement)){const el=this._domNode?.querySelector?.('[contenteditable="true"],textarea,input');if(el){if(typeof el.focus==="function")el.focus();kn.navigator.clipboard?.readText().then(t=>{if(!t)return;if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){const r=el.selectionStart||0,s=el.selectionEnd||0,proto=Object.getPrototypeOf(el),set=Object.getOwnPropertyDescriptor(proto,"value")?.set,val=el.value.substring(0,r)+t+el.value.substring(s);set?set.call(el,val):(el.value=val),el.selectionStart=el.selectionEnd=r+t.length,el.dispatchEvent(new Event("input",{bubbles:!0,cancelable:!0}))}else{let h=!1;try{const dt=new DataTransfer();dt.setData("text/plain",t);const pe=new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0});el.dispatchEvent(pe),h=pe.defaultPrevented}catch(t){}if(!h)bI().execCommand("insertText",!1,t)}}).catch(()=>{})}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const BROKEN_V4_PATCHED_PSR = `${PATCH_MARKER}PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){const isMac=/Mac/i.test(kn.navigator.userAgent);const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");const inEd=ed(e.target)||ed(bI().activeElement);if(!inEd||isMac){let el=inEd?(ed(e.target)?e.target:bI().activeElement):(this._domNode?.querySelector?.('[contenteditable="true"],textarea,input'));if(el){if(typeof el.focus==="function"&&bI().activeElement!==el)el.focus();if(inEd&&isMac)e.preventDefault();kn.navigator.clipboard?.readText().then(t=>{if(!t)return;if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){const r=el.selectionStart||0,s=el.selectionEnd||0,proto=Object.getPrototypeOf(el),set=Object.getOwnPropertyDescriptor(proto,"value")?.set,val=el.value.substring(0,r)+t+el.value.substring(s);set?set.call(el,val):(el.value=val),el.selectionStart=el.selectionEnd=r+t.length,el.dispatchEvent(new Event("input",{bubbles:!0,cancelable:!0}))}else{let h=!1;try{const dt=new DataTransfer();dt.setData("text/plain",t);const pe=new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0});el.dispatchEvent(pe),h=pe.defaultPrevented}catch(t){}if(!h)bI().execCommand("insertText",!1,t)}}).catch(()=>{})}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const BROKEN_V4_1_PATCHED_PSR = `${PATCH_MARKER}PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this)))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){const isMac=/Mac/i.test(kn.navigator.userAgent);const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");const inEd=ed(e.target)||ed(bI().activeElement);if(!inEd||isMac){let el=inEd?(ed(e.target)?e.target:bI().activeElement):(this._domNode?.querySelector?.('[contenteditable="true"],textarea,input'));if(el){if(typeof el.focus==="function"&&bI().activeElement!==el)el.focus();if(inEd&&isMac)e.preventDefault();kn.navigator.clipboard?.readText().then(t=>{if(!t)return;if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){const r=el.selectionStart||0,s=el.selectionEnd||0,proto=Object.getPrototypeOf(el),set=Object.getOwnPropertyDescriptor(proto,"value")?.set,val=el.value.substring(0,r)+t+el.value.substring(s);set?set.call(el,val):(el.value=val),el.selectionStart=el.selectionEnd=r+t.length,el.dispatchEvent(new Event("input",{bubbles:!0,cancelable:!0}))}else{let h=!1;try{const dt=new DataTransfer();dt.setData("text/plain",t);const pe=new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0});el.dispatchEvent(pe),h=pe.defaultPrevented}catch(t){}if(!h)bI().execCommand("insertText",!1,t)}}).catch(()=>{})}}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const V5_PATCHED_PSR = `${PATCH_MARKER}PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this))),this._register(Ze(e,Gt.MOUSE_DOWN,t=>{const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");if(!ed(t.target)&&!t.target?.closest?.("button,a,[role=button],.monaco-action-bar,select")){const el=e?.querySelector?.('[contenteditable="true"],textarea,input');if(el&&typeof el.focus==="function")el.focus()}}))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;e.stopPropagation();const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox");if(!ed(e.target)&&!ed(bI().activeElement)){const el=this._domNode?.querySelector?.('[contenteditable="true"],textarea,input');if(el&&typeof el.focus==="function")el.focus()}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
const PATCHED_PSR = `${PATCH_MARKER}PSr=class extends oe{constructor(e,i){super(),this._domNode=e,this._terminalService=i,this._register(Ze(e,Gt.KEY_DOWN,this.handleInnerKeydown.bind(this))),this._register(Ze(e,Gt.MOUSE_DOWN,t=>{const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox"||x.closest?.('[contenteditable="true"],textarea,input'));if(!ed(t.target)&&!t.target?.closest?.("button,a,[role=button],.monaco-action-bar,select")){const el=e?.querySelector?.('[contenteditable="true"],textarea,input');if(el&&typeof el.focus==="function")el.focus()}}))}handleInnerKeydown(e){if(Zvf(e)||Xvf(e)||Gvf(e)){if(this._terminalService.getTerminals().some(n=>n.component.domNode.contains(e.target)))return;const m=e.ctrlKey||e.metaKey,k=(e.key||"").toLowerCase(),c=e.keyCode;const isC=m&&(k==="c"||c===67),isX=m&&(k==="x"||c===88),isA=m&&(k==="a"||c===65),isV=m&&(k==="v"||c===86)||(e.shiftKey&&(k==="insert"||c===45));const ed=x=>x&&(x.tagName==="TEXTAREA"||x.tagName==="INPUT"||x.isContentEditable||x.getAttribute?.("contenteditable")==="true"||x.getAttribute?.("role")==="textbox"||x.closest?.('[contenteditable="true"],textarea,input'));const inEd=ed(e.target)||ed(bI().activeElement);if(isV&&inEd)return;e.stopPropagation();if(isC){const s=bI().getSelection()?.toString();if(s)kn.navigator.clipboard?.writeText(s).catch(()=>{});bI().execCommand("copy")}else if(isX){bI().execCommand("cut")}else if(isA){bI().execCommand("selectAll")}else if(isV){const el=this._domNode?.querySelector?.('[contenteditable="true"],textarea,input');if(el){if(typeof el.focus==="function"&&bI().activeElement!==el)el.focus();if(kn.navigator.clipboard?.read){kn.navigator.clipboard.read().then(async items=>{for(const it of items){const imgType=it.types.find(t=>t.startsWith("image/"));if(imgType){const blob=await it.getType(imgType);const file=new File([blob],"screenshot.png",{type:imgType});const dt=new DataTransfer();dt.items.add(file);el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0}));return}}const text=await kn.navigator.clipboard.readText();if(text){const dt=new DataTransfer();dt.setData("text/plain",text);el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0}))}}).catch(()=>{kn.navigator.clipboard?.readText().then(t=>{if(!t)return;const dt=new DataTransfer();dt.setData("text/plain",t);el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0}))}).catch(()=>{})})}else{kn.navigator.clipboard?.readText().then(t=>{if(!t)return;const dt=new DataTransfer();dt.setData("text/plain",t);el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:!0,cancelable:!0}))}).catch(()=>{})}}}}}};PSr=Uvf([Wvf(1,J1t)],PSr);function Gvf(t){return(t.ctrlKey||t.metaKey)&&!t.shiftKey&&((t.key||"").toLowerCase()==="a"||t.keyCode===65)}function Zvf(t){const e=t.ctrlKey||t.metaKey,k=(t.key||"").toLowerCase(),i=t.shiftKey&&(k==="insert"||t.keyCode===45);return e&&(["c","v","x"].includes(k)||[67,86,88].includes(t.keyCode))||i}function Xvf(t){const k=(t.key||"").toLowerCase();return(t.ctrlKey||t.metaKey)&&(["z","y"].includes(k)||[90,89].includes(t.keyCode))}`;
// Context menu patterns
const ORIGINAL_CM = 'onContextMenu(e,i){if(i.defaultPrevented)return;const n=i.target;if(!Yot(n)&&!_an(n))return;Ds.stop(i,!0);const r=new Ou(e,i);';
const OLD_PATCHED_CM = 'onContextMenu(e,i){if(i.defaultPrevented)return;const n=i.target;if(!Yot(n)&&!_an(n)&&!bI().getSelection()?.toString()&&!n?.closest?.(".antigravity-agent-side-panel"))return;Ds.stop(i,!0);const r=new Ou(e,i);';
const PATCHED_CM = 'onContextMenu(e,i){if(i.defaultPrevented)return;const n=i.target;if(!Yot(n)&&!_an(n)&&!(n?.closest?.(".antigravity-agent-side-panel")&&bI().getSelection()?.toString()))return;Ds.stop(i,!0);const r=new Ou(e,i);';
// Antigravity 1.107.0 Context menu patterns
const ORIGINAL_CM_V2 = 'onContextMenu(e,i){if(i.defaultPrevented)return;const n=i.target;if(!K7e(n)&&!oUi(n))return;Cr.stop(i,!0);const r=new nd(e,i);';
const PATCHED_CM_V2 = '/* agy-chat-fixed */onContextMenu(e,i){if(i.defaultPrevented)return;const n=i.target;if(!K7e(n)&&!oUi(n)&&!(n?.closest?.(".antigravity-agent-side-panel")&&window.getSelection()?.toString()))return;Cr.stop(i,!0);const r=new nd(e,i);';
// ==========================================
// Module 2: Windows Workspace URI Normalization
// ==========================================
const ORIGINAL_B5U = 'function B5u(t,e,i){return Object.entries(t.summaries).sort((n,r)=>Number((r[1].lastUserInputTime&&kb(r[1].lastUserInputTime))?.getTime()??0)-Number((n[1].lastUserInputTime&&kb(n[1].lastUserInputTime))?.getTime()??0)).filter(([,n])=>i&&n.trajectoryMetadata?.parentConversationId?!1:n.workspaces.map(r=>r.workspaceFolderAbsoluteUri).some(r=>e.includes(r))).map(([n])=>n)}';
const PATCHED_B5U = 'function B5u(t,e,i){let _n=u=>{try{let s=decodeURIComponent(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{let s=String(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}};let _E=(e||[]).map(_n);return Object.entries(t.summaries).sort((n,r)=>Number((r[1].lastUserInputTime&&kb(r[1].lastUserInputTime))?.getTime()??0)-Number((n[1].lastUserInputTime&&kb(n[1].lastUserInputTime))?.getTime()??0)).filter(([,n])=>i&&n.trajectoryMetadata?.parentConversationId?!1:n.workspaces.map(r=>_n(r.workspaceFolderAbsoluteUri)).some(r=>_E.includes(r))).map(([n])=>n)}';
const ORIGINAL_PD = 'function _Pd(t,e,i){return Object.entries(t.summaries).sort((n,r)=>Number((r[1].lastUserInputTime&&mg(r[1].lastUserInputTime))?.getTime()??0)-Number((n[1].lastUserInputTime&&mg(n[1].lastUserInputTime))?.getTime()??0)).filter(([,n])=>i&&n.trajectoryMetadata?.parentConversationId?!1:n.workspaces.map(r=>r.workspaceFolderAbsoluteUri).some(r=>e.includes(r))).map(([n])=>n)}';
const PATCHED_PD = 'function _Pd(t,e,i){let _n=u=>{try{let s=decodeURIComponent(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{let s=String(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}};let _E=(e||[]).map(_n);return Object.entries(t.summaries).sort((n,r)=>Number((r[1].lastUserInputTime&&mg(r[1].lastUserInputTime))?.getTime()??0)-Number((n[1].lastUserInputTime&&mg(n[1].lastUserInputTime))?.getTime()??0)).filter(([,n])=>i&&n.trajectoryMetadata?.parentConversationId?!1:n.workspaces.map(r=>_n(r.workspaceFolderAbsoluteUri)).some(r=>_E.includes(r))).map(([n])=>n)}';
const ORIGINAL_OCC1 = 'if(F.length===1&&F[0]===d.workspaceUris[0])';
const PATCHED_OCC1 = 'let _n2=u=>{try{let s=decodeURIComponent(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{let s=String(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}};if(F.length===1&&_n2(F[0])===_n2(d.workspaceUris[0]))';
const ORIGINAL_OCC1_V2 = 'if(y.length===1&&y[0]===d.workspaceUris[0])';
const PATCHED_OCC1_V2 = 'let _n2=u=>{try{let s=decodeURIComponent(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{let s=String(u||"").toLowerCase().split("\\\\").join("/");while(s.endsWith("/"))s=s.slice(0,-1);return s}};if(y.length===1&&_n2(y[0])===_n2(d.workspaceUris[0]))';
// ==========================================
// Module 3: Unlock Fork/Branch Conversation
// ==========================================
const ORIGINAL_FORK_FLAG = 'conversationForking")?.enabled??!1';
const PATCHED_FORK_FLAG = 'conversationForking")?.enabled??!0';
const ORIGINAL_FORK_ENABLED_V2 = 'conversationForkingEnabled??!1';
const PATCHED_FORK_ENABLED_V2 = 'conversationForkingEnabled??!0';
const ORIGINAL_FORK_HISTORICAL_V2 = 'conversationForkingHistoricalStep??!1';
const PATCHED_FORK_HISTORICAL_V2 = 'conversationForkingHistoricalStep??!0';
const ORIGINAL_FORK_BTN = 'i&&ue&&E(fxu,{steps:t})';
const PATCHED_FORK_BTN = 'ue&&E(fxu,{steps:t})';
// ==========================================
// Module 4: Legacy Archive Link Reverter
// ==========================================
const ORIGINAL_IXU = 'var ixu=({steps:t})=>txu(t)?E("div",{className:"flex items-center gap-2.5 p-4 my-2 bg-secondary/50 border border-border rounded-md",children:[E($e,{name:"info",size:16,className:"flex-shrink-0 text-secondary-foreground"}),E("p",{className:"text-sm",children:"The server cleared a prefix of the conversation as it grew too large."})]}):null';
const PATCHED_IXU = 'var ixu=({steps:t})=>{if(!txu(t))return null;let _id=wC(),{workspaceInfo:{homeDirUri:_h}={},stepHandler:{openFile:_op}={}}=co(),_uri=(_h?_h+"/.gemini/conversations/":"file:///C:/Users/phucdnh/.gemini/conversations/")+_id+".md";return E("div",{className:"flex flex-col gap-2 p-3 my-2 bg-secondary/50 border border-border rounded-md",children:[E("div",{className:"flex items-center gap-2.5",children:[E($e,{name:"info",size:16,className:"flex-shrink-0 text-secondary-foreground"}),E("p",{className:"text-sm font-medium",children:"Hội thoại đã đầy ngữ cảnh và được tự động lưu trữ."})]}),E("div",{className:"flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline pl-6",onClick:()=>{_op?.(_uri)},children:[E($e,{name:"description",size:14}),E("span",{children:"Bấm vào đây để mở toàn bộ lịch sử (.md)"})]})]})}';
// ==========================================
// Module 5: Multi-Window Notification Focus (in main.js)
// ==========================================
const ORIGINAL_NOTIF_PAYLOAD = 'payload:{cascadeId:t,type:"request_action",workspaceUri:void 0}';
const PATCHED_NOTIF_PAYLOAD = 'payload:{cascadeId:t,type:"request_action",workspaceUri:r?.workspaces?.[0]?.workspaceFolderAbsoluteUri}';
// ==========================================
// Module 6: Smart Cross-Workspace Window Navigation
// ==========================================
const ORIGINAL_SET_CASCADE_ID = 'setCascadeId:(t,e)=>{t.convoState.type==="active"&&t.convoState.cascadeId!==e.payload?.cascadeId&&(YXo(t),t.previousCascadeId=t.convoState.cascadeId),Egt(`Changed convo to ${e.payload?.cascadeId}`),t.convoState=e.payload?{type:"active",cascadeId:e.payload.cascadeId}:{type:"idle"}}';
const PATCHED_SET_CASCADE_ID = 'setCascadeId:(t,e)=>{window.__agi_active_cascade_id=e.payload?.cascadeId||null;t.convoState.type==="active"&&t.convoState.cascadeId!==e.payload?.cascadeId&&(YXo(t),t.previousCascadeId=t.convoState.cascadeId),Egt(`Changed convo to ${e.payload?.cascadeId}`),t.convoState=e.payload?{type:"active",cascadeId:e.payload.cascadeId}:{type:"idle"}}';
const ORIGINAL_SET_CASCADE_ID_V2 = 'setCascadeId:(t,e)=>{let i=e.payload?.cascadeId;';
const PATCHED_SET_CASCADE_ID_V2 = 'setCascadeId:(t,e)=>{window.__agi_active_cascade_id=e.payload?.cascadeId||null;let i=e.payload?.cascadeId;';
const ORIGINAL_SMART_FOCUS_TARGET = 'sn.registerCommand("workbench.action.isAntigravitySnoozed",n=>i.isSnoozed())';
const OLD_SMART_FOCUS_TARGET = 'sn.registerCommand("workbench.action.isAntigravitySnoozed",n=>i.isSnoozed()),sn.registerCommand("workbench.action.smartFocusConversation",(t,e)=>{try{t.get(AJ).togglePanelTab?.("conversation",e)}catch{}})';
const PATCHED_SMART_FOCUS_TARGET = 'sn.registerCommand("workbench.action.isAntigravitySnoozed",n=>i.isSnoozed()),sn.registerCommand("workbench.action.smartFocusConversation",(t,e)=>{try{if(e)window.__agi_active_cascade_id=e;t.get(AJ).togglePanelTab?.("conversation",e)}catch{}}),sn.registerCommand("workbench.action.getActiveCascadeId",()=>window.__agi_active_cascade_id||null)';
const ORIGINAL_SNOOZE_V2 = 'this._register(gi.registerCommand("workbench.action.isAntigravitySnoozed",r=>r.get(Imt).isSnoozed()))';
const PATCHED_SNOOZE_V2 = 'this._register(gi.registerCommand("workbench.action.isAntigravitySnoozed",r=>r.get(Imt).isSnoozed())),this._register(gi.registerCommand("workbench.action.smartFocusConversation",(r,e)=>{try{if(e)window.__agi_active_cascade_id=e;r.get(bse).togglePanelTab?.("conversation",e)}catch{}})),this._register(gi.registerCommand("workbench.action.getActiveCascadeId",()=>window.__agi_active_cascade_id||null))';
// ==========================================
// Module 7: Workspace Chat Tabs
// ==========================================
const ORIGINAL_HHU = "hHu=()=>{let{closeAgentPanel:t,downloadDiagnostics:e,chatParamsProvider:i}=Of(),{logEvent:n}=pc(),r=Qr().get(\"download\"),s=NR(),{cascadeContext:{events:{setCascadeId:o},state:{agentStateProvider:a}},devModeEnabled:l}=co(),d=wC(),u=Lc(a,uHu),{startNewConversation:h}=Cqo(),{convertTrajectoryToMarkdown:f}=Wa(),g=hA(),m=hA(),b=hA(),y=Js(),C=nl(i),_=Vn(Y=>Y.agentTab.activeTab),{currentModelConfig:A}=wqt(),F=bra(d,\"Agent\"),T=bra(u,\"Parent\"),{getLogs:D}=_uu(),V=me(async()=>{let Y=a.getState().trajectorySlice;if(Y)try{let J=await f({conversationId:Y.conversationId});await r?.downloadText(J.markdown,`${F}.md`),n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-export-md\",stepNum:Y.totalStepsLength.toString()}},\"static type and numeric step count\"))}catch(J){console.error(\"Failed to export conversation:\",J)}},[f,a,r,n,F]),k=Vn(qha),M=Re(()=>[{label:\"Customization\",onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-customizations\"}},\"static type string\")),y(ove(\"customization\"))}},{label:\"MCP Servers\",onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-mcp\"}},\"static type string\")),y(ove(\"mcp\"))}},C.isGoogleInternal?{label:\"Download Diagnostics\",onClick:()=>{let Y=a.getState().trajectorySlice;e({conversationId:d,currentLatestStepIndex:Y?.totalStepsLength??0,trajectoryId:Y?.trajectoryId??\"\",consoleLogs:D()})}}:null,d?{label:\"Export\",onClick:V}:null,l?{label:\"Toggle Dev View\",onClick:()=>{y(H7u(!k))}}:null].filter(Y=>Y!==null),[d,a,e,n,y,C.isGoogleInternal,V,l,k,D]),[B,P]=We(!1),U=Yk(),G=_===\"conversation\"&&!d,{showPastConversationsPicker:O,hasPastConversations:Z}=HTn();return E(\"div\",{className:\"flex items-center justify-between gap-2 px-2 py-[5.5px] !border-b !border-gray-500/20\",children:[_!==\"conversation\"?E(mn,{variant:\"ghost\",size:\"sm\",className:\"group font-normal text-foreground\",onClick:()=>{y(ove(\"conversation\"))},children:[E($e,{name:\"arrow_back\",size:14,className:\"relative flex-none transition-[transform] group-hover:-translate-x-0.5\"}),\"Back to Agent\"]}):E(Ii,{children:[s===\"Cider\"&&u&&E(mn,{variant:\"ghost\",size:\"icon-sm\",className:\"group text-foreground\",onClick:()=>{o(u)},\"data-tooltip-id\":b,children:[E($e,{name:\"arrow_back\",size:14,className:\"relative flex-none transition-[transform] group-hover:-translate-x-0.5\"}),E(Sr,{id:b,place:\"bottom-start\",children:\"Back to parent agent\"})]}),E(\"div\",{className:\"flex min-w-0 items-center overflow-hidden text-ellipsis whitespace-nowrap gap-1\",children:u?`${T} > ${F}`:F})]}),E(\"div\",{className:\"flex items-center gap-2 px-0.5\",children:[E(sq,{disabled:G,onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"new-conversation\",currentModel:A?LQo(A):\"No Model Selected\"}},\"static type and server-controlled model identifier\")),h()},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color !opacity-100\",\"data-tooltip-id\":\"new-conversation-tooltip\",children:[E($e,{name:\"add\",size:16}),E(Sr,{id:\"new-conversation-tooltip\",place:\"bottom-end\",children:[\"New Conversation\",\" \",E(\"span\",{className:\"opacity-50\",children:U?\"\\u2318\\u21E7L\":\"Ctrl+Shift+L\"})]})]}),E(sq,{disabled:!Z,onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"past-conversations\",currentModel:A?LQo(A):\"No Model Selected\"}},\"static type and server-controlled model identifier\")),O(),y(ove(\"conversation\"))},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":\"history-tooltip\",\"data-past-conversations-toggle\":\"true\",children:[E($e,{name:\"history\",className:\"h-4 w-4\",size:16}),E(Sr,{id:\"history-tooltip\",place:\"bottom-end\",children:\"Past Conversations\"})]}),s!==\"Cider\"&&E(Uu.Root,{open:B,onOpenChange:P,children:[E(Uu.Trigger,{children:E(sq,{className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":m,children:[E($e,{name:\"more_horiz\",size:16}),E(Sr,{id:m,place:\"bottom-end\",children:\"Additional Options\"})]})}),E(Uu.Content,{className:\"w-max border-gray-500/20\",children:E(\"div\",{className:\"rounded-bg py-1\",children:M.map((Y,J)=>E(Uu.Item,{onClick:()=>{Y.onClick(),P(!1)},children:Y.label},J))})})]}),E(sq,{onClick:()=>{t()},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":g,children:[E($e,{name:\"close\",size:16}),E(Sr,{id:g,place:\"bottom-end\",children:\"Close Agent View\"})]})]})]})}";
const OLD_V1_PATCHED_HHU = "hHu=()=>{let{closeAgentPanel:t,downloadDiagnostics:e,chatParamsProvider:i,workspaceInfoProvider:_wip,trajectorySummariesProvider:_tsp}=Of(),{logEvent:n}=pc(),r=Qr().get(\"download\"),s=NR(),{cascadeContext:{events:{setCascadeId:o},state:{agentStateProvider:a}},devModeEnabled:l}=co(),d=wC(),u=Lc(a,uHu),{startNewConversation:h}=Cqo(),{convertTrajectoryToMarkdown:f}=Wa(),g=hA(),m=hA(),b=hA(),y=Js(),C=nl(i),_=Vn(Y=>Y.agentTab.activeTab),{currentModelConfig:A}=wqt(),F=bra(d,\"Agent\"),T=bra(u,\"Parent\"),{getLogs:D}=_uu(),V=me(async()=>{let Y=a.getState().trajectorySlice;if(Y)try{let J=await f({conversationId:Y.conversationId});await r?.downloadText(J.markdown,`${F}.md`),n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-export-md\",stepNum:Y.totalStepsLength.toString()}},\"static type and numeric step count\"))}catch(J){console.error(\"Failed to export conversation:\",J)}},[f,a,r,n,F]),k=Vn(qha),M=Re(()=>[{label:\"Customization\",onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-customizations\"}},\"static type string\")),y(ove(\"customization\"))}},{label:\"MCP Servers\",onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-mcp\"}},\"static type string\")),y(ove(\"mcp\"))}},C.isGoogleInternal?{label:\"Download Diagnostics\",onClick:()=>{let Y=a.getState().trajectorySlice;e({conversationId:d,currentLatestStepIndex:Y?.totalStepsLength??0,trajectoryId:Y?.trajectoryId??\"\",consoleLogs:D()})}}:null,d?{label:\"Export\",onClick:V}:null,l?{label:\"Toggle Dev View\",onClick:()=>{y(H7u(!k))}}:null].filter(Y=>Y!==null),[d,a,e,n,y,C.isGoogleInternal,V,l,k,D]),[B,P]=We(!1),U=Yk(),G=_===\"conversation\"&&!d,{showPastConversationsPicker:O,hasPastConversations:Z}=HTn();let _wInfo=_wip?nl(_wip):null,_nWs=u=>{try{let S=decodeURIComponent(u||\"\").toLowerCase().replace(/\\\\/g,\"/\");while(S.endsWith(\"/\"))S=S.slice(0,-1);if(S.startsWith(\"file://\"))S=S.slice(7);while(S.startsWith(\"/\"))S=S.slice(1);if(/^[a-z]:/i.test(S))S=\"/\"+S;return S}catch{return String(u||\"\").toLowerCase()}},_curNormWs=_nWs(_wInfo?.workspaceUris?.[0]||_wip?.getState?.()?.workspaceUris?.[0]||\"\"),_storageKey=\"agi_chat_tabs_\"+(_curNormWs||\"global\"),_tSumm=_tsp?.getState?.()?.summaries||{},_dedup=arr=>{let seen=new Set();return(arr||[]).filter(x=>{if(!x||seen.has(x))return!1;seen.add(x);return!0})},_isSameWs=cid=>{if(!cid||cid===\"__new__\")return!0;let S=_tSumm[cid]?.workspaces;if(!S||S.length===0||!_curNormWs)return!0;return S.map(w=>_nWs(w?.workspaceFolderAbsoluteUri)).some(w=>w===_curNormWs)},_insertAfterRef=mt(null),[_tabs,_setTabs]=We(()=>{try{localStorage.removeItem(_storageKey)}catch(_){}try{let S=sessionStorage.getItem(_storageKey);if(S){let p=JSON.parse(S);if(Array.isArray(p)&&p.length>0){let valid=_dedup(p.filter(_isSameWs));if(valid.length>0)return valid}}}catch(_){}return d?[d]:[\"__new__\"]});yt(()=>{if(d){if(!_isSameWs(d))return;_setTabs(prev=>{if(prev.includes(d))return prev;let next=[...prev];let after=_insertAfterRef.current;_insertAfterRef.current=null;if(after&&next.includes(after)){let idx=next.indexOf(after);next.splice(idx+1,0,d)}else{next.push(d)}let clean=_dedup(next.filter(x=>x!==\"__new__\"&&_isSameWs(x)));try{sessionStorage.setItem(_storageKey,JSON.stringify(clean))}catch(_){}return clean.length>0?clean:[d]})}else{_setTabs(p=>p.includes(\"__new__\")?p:[...p,\"__new__\"])}},[d,_storageKey]);yt(()=>{try{localStorage.removeItem(_storageKey)}catch(_){}try{let S=sessionStorage.getItem(_storageKey);if(S){let p=JSON.parse(S);if(Array.isArray(p)&&p.length>0){let valid=_dedup(p.filter(_isSameWs));if(d&&_isSameWs(d)&&!valid.includes(d))valid.push(d);if(valid.length>0){_setTabs(_dedup(valid));return}}}}catch(_){}_setTabs(d?[d]:[\"__new__\"])},[_storageKey]);let _scrollRef=mt(null),_activeTabRef=mt(null);yt(()=>{_activeTabRef.current?.scrollIntoView({behavior:\"smooth\",block:\"nearest\",inline:\"nearest\"})},[d,_tabs]);let _onSelectTab=K=>{if(K===\"__new__\"){if(d)h()}else if(K!==d){o(K)}};let _onCloseTab=(K,ev)=>{ev.stopPropagation();let idx=_tabs.indexOf(K),next=_tabs.filter(x=>x!==K);if(next.length===0){h();return}let clean=_dedup(next);_setTabs(clean);try{sessionStorage.setItem(_storageKey,JSON.stringify(clean))}catch(_){}if(K===d){let target=clean[Math.min(idx,clean.length-1)];o(target)}};let _onAddNewTab=()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"new-conversation\",currentModel:A?LQo(A):\"No Model Selected\"}},\"static type and server-controlled model identifier\"));_insertAfterRef.current=d;h()};let _onWheel=ev=>{if(ev.deltaY&&_scrollRef.current)_scrollRef.current.scrollLeft+=ev.deltaY};let _getTabTitle=K=>{if(K===\"__new__\")return\"New Chat\";if(K===d&&F)return F;let s=_tSumm[K]?.summary;return s||\"Chat\"};let _tabBar=E(\"div\",{ref:_scrollRef,onWheel:_onWheel,className:\"flex items-center gap-1 overflow-x-auto flex-1 min-w-0 py-0.5 select-none\",style:{scrollbarWidth:\"none\"},children:_tabs.map(K=>{let isActive=(K===\"__new__\"&&!d)||(K===d),title=_getTabTitle(K);return E(\"div\",{ref:isActive?_activeTabRef:null,onClick:()=>_onSelectTab(K),title:title,className:\"group/tab relative flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer select-none max-w-[130px] flex-shrink-0 transition-colors \"+(isActive?\"bg-[var(--vscode-tab-activeBackground,#2d2d2d)] text-[var(--vscode-tab-activeForeground,#ffffff)] font-medium border-t-2 border-t-[var(--vscode-tab-activeBorderTop,#007fd4)] shadow-sm\":\"text-[var(--vscode-tab-inactiveForeground,#8b949e)] hover:bg-[var(--vscode-tab-hoverBackground,rgba(255,255,255,0.06))] hover:text-[var(--vscode-tab-activeForeground,#ffffff)] border-t-2 border-t-transparent\"),children:[E(\"span\",{className:\"truncate flex-1 min-w-0\",children:title}),E(\"span\",{onClick:ev=>_onCloseTab(K,ev),title:\"Close Tab\",className:\"opacity-40 group-hover/tab:opacity-100 hover:bg-white/10 rounded p-0.5 flex items-center justify-center transition-opacity\",children:[E($e,{name:\"close\",size:12})]})]},K)})});return E(\"div\",{className:\"flex items-center justify-between gap-2 px-2 py-[5.5px] !border-b !border-gray-500/20\",children:[_!==\"conversation\"?E(mn,{variant:\"ghost\",size:\"sm\",className:\"group font-normal text-foreground\",onClick:()=>{y(ove(\"conversation\"))},children:[E($e,{name:\"arrow_back\",size:14,className:\"relative flex-none transition-[transform] group-hover:-translate-x-0.5\"}),\"Back to Agent\"]}):E(Ii,{children:[s===\"Cider\"&&u&&E(mn,{variant:\"ghost\",size:\"icon-sm\",className:\"group text-foreground flex-none\",onClick:()=>{o(u)},\"data-tooltip-id\":b,children:[E($e,{name:\"arrow_back\",size:14,className:\"relative flex-none transition-[transform] group-hover:-translate-x-0.5\"}),E(Sr,{id:b,place:\"bottom-start\",children:\"Back to parent agent\"})]}),_tabBar]}),E(\"div\",{className:\"flex items-center gap-2 px-0.5 flex-none\",children:[E(sq,{disabled:G,onClick:_onAddNewTab,className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color !opacity-100\",\"data-tooltip-id\":\"new-conversation-tooltip\",children:[E($e,{name:\"add\",size:16}),E(Sr,{id:\"new-conversation-tooltip\",place:\"bottom-end\",children:[\"New Conversation\",\" \",E(\"span\",{className:\"opacity-50\",children:U?\"\\u2318\\u21E7L\":\"Ctrl+Shift+L\"})]})]}),E(sq,{disabled:!Z,onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"past-conversations\",currentModel:A?LQo(A):\"No Model Selected\"}},\"static type and server-controlled model identifier\")),O(),y(ove(\"conversation\"))},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":\"history-tooltip\",\"data-past-conversations-toggle\":\"true\",children:[E($e,{name:\"history\",className:\"h-4 w-4\",size:16}),E(Sr,{id:\"history-tooltip\",place:\"bottom-end\",children:\"Past Conversations\"})]}),s!==\"Cider\"&&E(Uu.Root,{open:B,onOpenChange:P,children:[E(Uu.Trigger,{children:E(sq,{className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":m,children:[E($e,{name:\"more_horiz\",size:16}),E(Sr,{id:m,place:\"bottom-end\",children:\"Additional Options\"})]})}),E(Uu.Content,{className:\"w-max border-gray-500/20\",children:E(\"div\",{className:\"rounded-bg py-1\",children:M.map((Y,J)=>E(Uu.Item,{onClick:()=>{Y.onClick(),P(!1)},children:Y.label},J))})})]}),E(sq,{onClick:()=>{t()},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":g,children:[E($e,{name:\"close\",size:16}),E(Sr,{id:g,place:\"bottom-end\",children:\"Close Agent View\"})]})]})]})}";
const PATCHED_HHU = "hHu=()=>{let{closeAgentPanel:t,downloadDiagnostics:e,chatParamsProvider:i,workspaceInfoProvider:_wip,trajectorySummariesProvider:_tsp}=Of(),{logEvent:n}=pc(),r=Qr().get(\"download\"),s=NR(),{cascadeContext:{events:{setCascadeId:o},state:{agentStateProvider:a}},devModeEnabled:l}=co(),d=wC(),u=Lc(a,uHu),{startNewConversation:h}=Cqo(),{convertTrajectoryToMarkdown:f}=Wa(),g=hA(),m=hA(),b=hA(),y=Js(),C=nl(i),_=Vn(Y=>Y.agentTab.activeTab),{currentModelConfig:A}=wqt(),F=bra(d,\"Agent\"),T=bra(u,\"Parent\"),{getLogs:D}=_uu(),V=me(async()=>{let Y=a.getState().trajectorySlice;if(Y)try{let J=await f({conversationId:Y.conversationId});await r?.downloadText(J.markdown,`${F}.md`),n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-export-md\",stepNum:Y.totalStepsLength.toString()}},\"static type and numeric step count\"))}catch(J){console.error(\"Failed to export conversation:\",J)}},[f,a,r,n,F]),k=Vn(qha),M=Re(()=>[{label:\"Customization\",onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-customizations\"}},\"static type string\")),y(ove(\"customization\"))}},{label:\"MCP Servers\",onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"header-mcp\"}},\"static type string\")),y(ove(\"mcp\"))}},C.isGoogleInternal?{label:\"Download Diagnostics\",onClick:()=>{let Y=a.getState().trajectorySlice;e({conversationId:d,currentLatestStepIndex:Y?.totalStepsLength??0,trajectoryId:Y?.trajectoryId??\"\",consoleLogs:D()})}}:null,d?{label:\"Export\",onClick:V}:null,l?{label:\"Toggle Dev View\",onClick:()=>{y(H7u(!k))}}:null].filter(Y=>Y!==null),[d,a,e,n,y,C.isGoogleInternal,V,l,k,D]),[B,P]=We(!1),U=Yk(),G=_===\"conversation\"&&!d,{showPastConversationsPicker:O,hasPastConversations:Z}=HTn();let _wInfo=_wip?nl(_wip):null,_nWs=u=>{try{let S=decodeURIComponent(u||\"\").toLowerCase().replace(/\\\\/g,\"/\");while(S.endsWith(\"/\"))S=S.slice(0,-1);if(S.startsWith(\"file://\"))S=S.slice(7);while(S.startsWith(\"/\"))S=S.slice(1);if(/^[a-z]:/i.test(S))S=\"/\"+S;return S}catch{return String(u||\"\").toLowerCase()}},_curNormWs=_nWs(_wInfo?.workspaceUris?.[0]||_wip?.getState?.()?.workspaceUris?.[0]||\"\"),_storageKey=\"agi_chat_tabs_\"+(_curNormWs||\"global\"),_tSumm=_tsp?.getState?.()?.summaries||{},_dedup=arr=>{let seen=new Set();return(arr||[]).filter(x=>{if(!x||seen.has(x))return!1;seen.add(x);return!0})},_isSameWs=cid=>{if(!cid||cid===\"__new__\")return!0;let S=_tSumm[cid]?.workspaces;if(!S||S.length===0||!_curNormWs)return!0;return S.map(w=>_nWs(w?.workspaceFolderAbsoluteUri)).some(w=>w===_curNormWs)},_insertAfterRef=mt(null),[_tabs,_setTabs]=We(()=>{try{localStorage.removeItem(_storageKey)}catch(_){}try{let S=sessionStorage.getItem(_storageKey);if(S){let p=JSON.parse(S);if(Array.isArray(p)&&p.length>0){let valid=_dedup(p.filter(_isSameWs));if(valid.length>0)return valid}}}catch(_){}return d?[d]:[\"__new__\"]});yt(()=>{if(d){if(!_isSameWs(d))return;_setTabs(prev=>{if(prev.includes(d))return prev;let next=[...prev];let after=_insertAfterRef.current;_insertAfterRef.current=null;if(after&&next.includes(after)){let idx=next.indexOf(after);next.splice(idx+1,0,d)}else{next.push(d)}let clean=_dedup(next.filter(x=>x!==\"__new__\"&&_isSameWs(x)));try{sessionStorage.setItem(_storageKey,JSON.stringify(clean))}catch(_){}return clean.length>0?clean:[d]})}else{_setTabs(p=>p.includes(\"__new__\")?p:[...p,\"__new__\"])}},[d,_storageKey]);yt(()=>{try{localStorage.removeItem(_storageKey)}catch(_){}try{let S=sessionStorage.getItem(_storageKey);if(S){let p=JSON.parse(S);if(Array.isArray(p)&&p.length>0){let valid=_dedup(p.filter(_isSameWs));if(d&&_isSameWs(d)&&!valid.includes(d))valid.push(d);if(valid.length>0){_setTabs(_dedup(valid));return}}}}catch(_){}_setTabs(d?[d]:[\"__new__\"])},[_storageKey]);let _scrollRef=mt(null),_activeTabRef=mt(null);yt(()=>{_activeTabRef.current?.scrollIntoView({behavior:\"smooth\",block:\"nearest\",inline:\"nearest\"})},[d,_tabs]);let _onSelectTab=K=>{if(K===\"__new__\"){if(d)h()}else if(K!==d){o(K)}};let _onCloseTab=(K,ev)=>{ev?.stopPropagation?.();let idx=_tabs.indexOf(K),next=_tabs.filter(x=>x!==K);if(next.length===0){_setTabs([\"__new__\"]);try{sessionStorage.setItem(_storageKey,JSON.stringify([\"__new__\"]))}catch(_){}if(d)h();return}let clean=_dedup(next);_setTabs(clean);try{sessionStorage.setItem(_storageKey,JSON.stringify(clean))}catch(_){}let wasActive=(K===d)||(K===\"__new__\"&&!d);if(wasActive){let target=clean[Math.min(idx,clean.length-1)];if(target===\"__new__\"){if(d)h()}else{o(target)}}};let _onAddNewTab=()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"new-conversation\",currentModel:A?LQo(A):\"No Model Selected\"}},\"static type and server-controlled model identifier\"));_insertAfterRef.current=d;h()};yt(()=>{let _onKey=ev=>{let m=ev.ctrlKey||ev.metaKey;if(!m||ev.altKey)return;let k=(ev.key||\"\").toLowerCase(),c=ev.keyCode;let isT=!ev.shiftKey&&(k===\"t\"||c===84);let isW=!ev.shiftKey&&(k===\"w\"||c===87);if(!isT&&!isW)return;let act=document.activeElement;let target=ev.target;let panel=document.querySelector(\".antigravity-agent-side-panel\");let inChat=Boolean((act&&act.closest&&act.closest(\".antigravity-agent-side-panel\"))||(target&&target.closest&&target.closest(\".antigravity-agent-side-panel\"))||(panel&&panel.matches(\":focus-within\")));if(!inChat)return;ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();if(isT){_onAddNewTab();setTimeout(()=>{let el=document.querySelector(\".antigravity-agent-side-panel [contenteditable='true'],.antigravity-agent-side-panel textarea,.antigravity-agent-side-panel input\");if(el&&typeof el.focus===\"function\")el.focus()},80)}else if(isW){let curTab=d||(_tabs.includes(\"__new__\")?\"__new__\":_tabs[0]);if(curTab)_onCloseTab(curTab,ev);setTimeout(()=>{let el=document.querySelector(\".antigravity-agent-side-panel [contenteditable='true'],.antigravity-agent-side-panel textarea,.antigravity-agent-side-panel input\");if(el&&typeof el.focus===\"function\")el.focus()},80)}};window.addEventListener(\"keydown\",_onKey,!0);return()=>window.removeEventListener(\"keydown\",_onKey,!0)},[d,_tabs,_storageKey]);let _onWheel=ev=>{if(ev.deltaY&&_scrollRef.current)_scrollRef.current.scrollLeft+=ev.deltaY};let _getTabTitle=K=>{if(K===\"__new__\")return\"New Chat\";if(K===d&&F)return F;let s=_tSumm[K]?.summary;return s||\"Chat\"};let _tabBar=E(\"div\",{ref:_scrollRef,onWheel:_onWheel,className:\"flex items-center gap-1 overflow-x-auto flex-1 min-w-0 py-0.5 select-none\",style:{scrollbarWidth:\"none\"},children:_tabs.map(K=>{let isActive=(K===\"__new__\"&&!d)||(K===d),title=_getTabTitle(K);return E(\"div\",{ref:isActive?_activeTabRef:null,onClick:()=>_onSelectTab(K),title:title,className:\"group/tab relative flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer select-none max-w-[130px] flex-shrink-0 transition-colors \"+(isActive?\"bg-[var(--vscode-tab-activeBackground,#2d2d2d)] text-[var(--vscode-tab-activeForeground,#ffffff)] font-medium border-t-2 border-t-[var(--vscode-tab-activeBorderTop,#007fd4)] shadow-sm\":\"text-[var(--vscode-tab-inactiveForeground,#8b949e)] hover:bg-[var(--vscode-tab-hoverBackground,rgba(255,255,255,0.06))] hover:text-[var(--vscode-tab-activeForeground,#ffffff)] border-t-2 border-t-transparent\"),children:[E(\"span\",{className:\"truncate flex-1 min-w-0\",children:title}),E(\"span\",{onClick:ev=>_onCloseTab(K,ev),title:\"Close Tab\",className:\"opacity-40 group-hover/tab:opacity-100 hover:bg-white/10 rounded p-0.5 flex items-center justify-center transition-opacity\",children:[E($e,{name:\"close\",size:12})]})]},K)})});return E(\"div\",{className:\"flex items-center justify-between gap-2 px-2 py-[5.5px] !border-b !border-gray-500/20\",children:[_!==\"conversation\"?E(mn,{variant:\"ghost\",size:\"sm\",className:\"group font-normal text-foreground\",onClick:()=>{y(ove(\"conversation\"))},children:[E($e,{name:\"arrow_back\",size:14,className:\"relative flex-none transition-[transform] group-hover:-translate-x-0.5\"}),\"Back to Agent\"]}):E(Ii,{children:[s===\"Cider\"&&u&&E(mn,{variant:\"ghost\",size:\"icon-sm\",className:\"group text-foreground flex-none\",onClick:()=>{o(u)},\"data-tooltip-id\":b,children:[E($e,{name:\"arrow_back\",size:14,className:\"relative flex-none transition-[transform] group-hover:-translate-x-0.5\"}),E(Sr,{id:b,place:\"bottom-start\",children:\"Back to parent agent\"})]}),_tabBar]}),E(\"div\",{className:\"flex items-center gap-2 px-0.5 flex-none\",children:[E(sq,{disabled:G,onClick:_onAddNewTab,className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color !opacity-100\",\"data-tooltip-id\":\"new-conversation-tooltip\",children:[E($e,{name:\"add\",size:16}),E(Sr,{id:\"new-conversation-tooltip\",place:\"bottom-end\",children:[\"New Conversation\",\" \",E(\"span\",{className:\"opacity-50\",children:U?\"\\u2318\\u21E7L\":\"Ctrl+Shift+L\"})]})]}),E(sq,{disabled:!Z,onClick:()=>{n(Ts.CASCADE_CLICK_EVENT,go({extra:{type:\"past-conversations\",currentModel:A?LQo(A):\"No Model Selected\"}},\"static type and server-controlled model identifier\")),O(),y(ove(\"conversation\"))},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":\"history-tooltip\",\"data-past-conversations-toggle\":\"true\",children:[E($e,{name:\"history\",className:\"h-4 w-4\",size:16}),E(Sr,{id:\"history-tooltip\",place:\"bottom-end\",children:\"Past Conversations\"})]}),s!==\"Cider\"&&E(Uu.Root,{open:B,onOpenChange:P,children:[E(Uu.Trigger,{children:E(sq,{className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":m,children:[E($e,{name:\"more_horiz\",size:16}),E(Sr,{id:m,place:\"bottom-end\",children:\"Additional Options\"})]})}),E(Uu.Content,{className:\"w-max border-gray-500/20\",children:E(\"div\",{className:\"rounded-bg py-1\",children:M.map((Y,J)=>E(Uu.Item,{onClick:()=>{Y.onClick(),P(!1)},children:Y.label},J))})})]}),E(sq,{onClick:()=>{t()},className:\"!hover:text-ide-icon-color flex w-4 items-center justify-center !text-ide-icon-color\",\"data-tooltip-id\":g,children:[E($e,{name:\"close\",size:16}),E(Sr,{id:g,place:\"bottom-end\",children:\"Close Agent View\"})]})]})]})}";
// ==========================================
// Module 8: Auto-Submit Permission Dialogs
// ==========================================
const ORIGINAL_PERMISSION_SUBMIT = 'Ee=me(()=>{ue(!1)},[ue]);return s?E(T9n';
const PATCHED_PERMISSION_SUBMIT = 'Ee=me(()=>{ue(!1)},[ue]);yt(()=>{if(s&&ae){let _t=setTimeout(()=>{try{ae()}catch(_){}},80);return()=>clearTimeout(_t)}},[s,ae]);return s?E(T9n';
// ==========================================
// Module 9: Mute Completion Sound on Chat Switch
// ==========================================
const ORIGINAL_SOUND_SWITCH = 'var CHu=()=>{let{stepHandler:t,cascadeContext:{state:{agentStateProvider:e}}}=co(),i=j4e(),n=Lc(e,{selector:yHu}),r=Lc(e,{selector:SHu}),s=mt(n),o=mt(r),a=t?.enableSoundsForSpecialEvents;return yt(()=>{let l=!s.current,d=n,u=r;(l&&d||!o.current&&u)&&a&&t?.playSound(Ut(Afu,{soundType:XTn.CASCADE_DONE})),s.current=n,o.current=u},[i,n,r,t,a]),null}';
const PATCHED_SOUND_SWITCH = 'var CHu=()=>{let{stepHandler:t,cascadeContext:{state:{agentStateProvider:e}}}=co(),c=wC(),_lastC=mt(c),_canPlay=mt(!1),i=j4e(),n=Lc(e,{selector:yHu}),r=Lc(e,{selector:SHu}),s=mt(n),o=mt(r),a=t?.enableSoundsForSpecialEvents;return yt(()=>{if(_lastC.current!==c){_lastC.current=c,s.current=n,o.current=r,_canPlay.current=!1;return}if(!n)_canPlay.current=!0;let l=!s.current,d=n,u=r;_canPlay.current&&(l&&d||!o.current&&u)&&a&&(t?.playSound(Ut(Afu,{soundType:XTn.CASCADE_DONE})),_canPlay.current=!1),s.current=n,o.current=u},[i,n,r,t,a,c]),null}';
// Module 0: Silence Integrity / Corrupt Installation Notification
const ORIGINAL_SHOW_NOTIF = '_showNotification(){const e=this.productService.checksumFailMoreInfoUrl';
const PATCHED_SHOW_NOTIF = '_showNotification(){return;const e=this.productService.checksumFailMoreInfoUrl';
// Top-level ESM imports for extension.js
const TOP_IMPORT_MARKER = '/* agy-imports */';
const ORIGINAL_TOP_IMPORT = 'import{createRequire as e}from"node:module";import*as t from"vscode";';
const PATCHED_TOP_IMPORT = `import{createRequire as e}from"node:module";import*as t from"vscode";${TOP_IMPORT_MARKER}import*as _fs from"node:fs";import*as _p from"node:path";import*as _os from"node:os";`;
// Legacy QuickPick patterns
const ORIGINAL_QUICKPICK = 'l.commands.registerCommand("antigravity.openConversationWorkspaceQuickPick",async e=>{const t=e.workspaceUris,n=e.cascadeId;if(0===t.length)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const o=[{label:"Open in current window",description:"Continue conversation in the current workspace"},...t.map(e=>({label:"Open in workspace: ",description:l.Uri.parse(e).fsPath}))],i=await l.window.showQuickPick(o,{placeHolder:"Select where to open the conversation",ignoreFocusOut:!1});if(!i||void 0===i.description)return(0,c.v)(d.Lm,{openInCurrentWindow:!1});if("Open in current window"===i.label)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const r=i.description;try{const e=l.Uri.file(r);return await q.F.getInstance().setWorkspaceCascadeMap(e.toString(),n),await l.commands.executeCommand("vscode.openFolder",e,{forceNewWindow:!0}),(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(e){return console.error("Error opening workspace:",e),l.window.showErrorMessage("Failed to open workspace"),(0,c.v)(d.Lm,{openInCurrentWindow:!1})}})';
const AUTO_QUICKPICK = 'l.commands.registerCommand("antigravity.openConversationWorkspaceQuickPick",async e=>{const t=e.workspaceUris,n=e.cascadeId;if(!t||0===t.length)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});try{const targetUri=l.Uri.parse(t[0]);await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(err){console.error("Error opening workspace:",err);return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}})';
const INTERACTIVE_QUICKPICK = 'l.commands.registerCommand("antigravity.openConversationWorkspaceQuickPick",async e=>{const t=e.workspaceUris,n=e.cascadeId;if(!t||0===t.length)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const o=[{label:"Open in current window",description:"Continue conversation in the current workspace",uri:null},...t.map(u=>{const p=l.Uri.parse(u);return{label:"Open in workspace: ",description:p.fsPath,uri:p}})];const i=await l.window.showQuickPick(o,{placeHolder:"Select where to open the conversation",ignoreFocusOut:!1});if(!i)return(0,c.v)(d.Lm,{openInCurrentWindow:!1});if("Open in current window"===i.label)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});try{const targetUri=i.uri||l.Uri.file(i.description);await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(err){console.error("Error opening workspace:",err);l.window.showErrorMessage("Failed to open workspace");return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}})';
const OLD_REQUIRE_PATCHED_QUICKPICK = 'l.commands.registerCommand("antigravity.openConversationWorkspaceQuickPick",async e=>{const t=e.workspaceUris,n=e.cascadeId;if(!t||0===t.length)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});try{const _curWs=l.workspace.workspaceFolders?.[0]?.uri.toString();const _normWs=u=>{if(!u)return"";try{let s=decodeURIComponent(String(u)).toLowerCase().split("\\\\").join("/");if(s.startsWith("file:///"))s=s.slice(8);else if(s.startsWith("file://"))s=s.slice(7);while(s.endsWith("/"))s=s.slice(0,-1);if(/^\\/[a-z]:/i.test(s))s=s.slice(1);return s}catch{return String(u).toLowerCase()}};const _curNorm=_normWs(_curWs),_tgtNorm=_normWs(t[0]);if(_tgtNorm&&_curNorm===_tgtNorm)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const _fs=require("fs"),_p=require("path"),_os=require("os"),_f=_p.join(_os.homedir(),".gemini","antigravity_windows.json");let _data={};try{if(_fs.existsSync(_f))_data=JSON.parse(_fs.readFileSync(_f,"utf8"))||{}}catch(_){}const _tgtWin=_data[_tgtNorm];let _isTargetOpen=!1;if(_tgtWin&&_tgtWin.pid){try{process.kill(_tgtWin.pid,0);_isTargetOpen=!0}catch(_){}}const shouldForceNew=Boolean(_curWs);if(!_isTargetOpen){const targetUri=l.Uri.parse(t[0]);await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:shouldForceNew});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}if(_tgtWin.activeCascadeId&&_tgtWin.activeCascadeId!==n){return(0,c.v)(d.Lm,{openInCurrentWindow:!0})}const targetUri=l.Uri.parse(t[0]);await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(err){console.error("Error opening workspace:",err);return(0,c.v)(d.Lm,{openInCurrentWindow:!0})}})';
const OLD_V1_PATCHED_QUICKPICK = 'l.commands.registerCommand("antigravity.openConversationWorkspaceQuickPick",async e=>{const t=e.workspaceUris,n=e.cascadeId;if(!t||0===t.length)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});try{const _curWs=l.workspace.workspaceFolders?.[0]?.uri.toString();const _normWs=u=>{if(!u)return"";try{let s=decodeURIComponent(String(u)).toLowerCase().split("\\\\").join("/");if(s.startsWith("file://"))s=s.slice(7);while(s.startsWith("/"))s=s.slice(1);if(!/^[a-z]:/i.test(s))s="/"+s;while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{return String(u).toLowerCase()}};const _curNorm=_normWs(_curWs),_tgtNorm=_normWs(t[0]);if(_tgtNorm&&_curNorm===_tgtNorm)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const __fs=typeof _fs!=="undefined"?_fs:null,__p=typeof _p!=="undefined"?_p:null,__os=typeof _os!=="undefined"?_os:null,_f=__p&&__os?__p.join(__os.homedir(),".gemini","antigravity_windows.json"):null;let _data={};try{if(_f&&__fs&&__fs.existsSync(_f))_data=JSON.parse(__fs.readFileSync(_f,"utf8"))||{}}catch(_){}const _tgtWin=_data[_tgtNorm];let _isTargetOpen=!1;if(_tgtWin&&_tgtWin.pid){try{process.kill(_tgtWin.pid,0);_isTargetOpen=!0}catch(_){}}const targetUri=t[0].startsWith("file:")?l.Uri.parse(t[0]):l.Uri.file(t[0]);if(!_isTargetOpen){await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}if(_tgtWin.activeCascadeId&&_tgtWin.activeCascadeId!==n){return(0,c.v)(d.Lm,{openInCurrentWindow:!0})}await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(err){console.error("Error opening workspace:",err);return(0,c.v)(d.Lm,{openInCurrentWindow:!0})}})';
const PATCHED_QUICKPICK = 'l.commands.registerCommand("antigravity.openConversationWorkspaceQuickPick",async e=>{const t=e?.workspaceUris,n=e?.cascadeId;if(!t||0===t.length)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const _fallback=async()=>{try{const o=[{label:"Open in current window",description:"Continue conversation in the current workspace"},...t.map(u=>{try{return{label:"Open in workspace: ",description:l.Uri.parse(u).fsPath}}catch(_){return{label:"Open in workspace: ",description:String(u)}}})];const i=await l.window.showQuickPick(o,{placeHolder:"Select where to open the conversation",ignoreFocusOut:!1});if(!i||void 0===i.description)return(0,c.v)(d.Lm,{openInCurrentWindow:!1});if("Open in current window"===i.label)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const r=i.description;const target=l.Uri.file(r);await q.F.getInstance().setWorkspaceCascadeMap(target.toString(),n);await l.commands.executeCommand("vscode.openFolder",target,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(err2){console.error("Fallback failed:",err2);l.window.showErrorMessage("Failed to open workspace: "+(err2?.message||String(err2)));return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}};try{const _curWs=l.workspace.workspaceFolders?.[0]?.uri.toString();const _normWs=u=>{if(!u)return"";try{let s=decodeURIComponent(String(u)).toLowerCase().split("\\\\").join("/");if(s.startsWith("file://"))s=s.slice(7);while(s.startsWith("/"))s=s.slice(1);if(!/^[a-z]:/i.test(s))s="/"+s;while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{return String(u).toLowerCase()}};const _curNorm=_normWs(_curWs),_tgtNorm=_normWs(t[0]);if(_tgtNorm&&_curNorm===_tgtNorm)return(0,c.v)(d.Lm,{openInCurrentWindow:!0});const __fs=typeof _fs!=="undefined"?_fs:null,__p=typeof _p!=="undefined"?_p:null,__os=typeof _os!=="undefined"?_os:null,_pendFile=__p&&__os?__p.join(__os.homedir(),".gemini","antigravity_pending_cascade.json"):null;if(_pendFile&&__fs){try{let pData={};if(__fs.existsSync(_pendFile))pData=JSON.parse(__fs.readFileSync(_pendFile,"utf8"))||{};pData[_tgtNorm]=n;__fs.writeFileSync(_pendFile,JSON.stringify(pData,null,2),"utf8")}catch(_){}}const targetUri=t[0].startsWith("file:")?l.Uri.parse(t[0]):l.Uri.file(t[0]);await q.F.getInstance().setWorkspaceCascadeMap(targetUri.toString(),n);await l.commands.executeCommand("vscode.openFolder",targetUri,{forceNewWindow:!0});return(0,c.v)(d.Lm,{openInCurrentWindow:!1})}catch(err){console.error("Auto open workspace failed:",err);l.window.showErrorMessage("Antigravity Quick Switch Error: "+(err?.message||String(err)));return await _fallback()}})';
const ORIGINAL_EXT_STORAGE = 'getCascadeIdForCurrentWorkspace(){const e=this.getStoredValue(i.b.WORKSPACE_CASCADE_MAP),t=o.workspace.workspaceFolders?.[0]?.uri.toString();let n="";return void 0!==t&&void 0!==e&&(n=e[t]),n&&void 0!==t&&this.setWorkspaceCascadeMap(t,void 0),n}';
const PATCHED_EXT_STORAGE = 'getCascadeIdForCurrentWorkspace(){const e=this.getStoredValue(i.b.WORKSPACE_CASCADE_MAP),t=o.workspace.workspaceFolders?.[0]?.uri.toString();let n="";if(void 0!==t&&void 0!==e){let _norm=u=>{try{return decodeURIComponent(u||"").toLowerCase().replace(/\\\\/g,"/").replace(/\\/+$/,"")}catch{return String(u||"").toLowerCase().replace(/\\\\/g,"/").replace(/\\/+$/,"")}};let _t=_norm(t);for(let[k,v]of Object.entries(e)){if(_norm(k)===_t){n=v;this.setWorkspaceCascadeMap(k,void 0);break}}}return n}';
const ORIGINAL_EXT_ACT = 'q.F.initialize(e),ce.end()';
const OLD_PATCHED_EXT_ACT = 'q.F.initialize(e),ce.end(),(()=>{try{const _pId=q.F.getInstance().getCascadeIdForCurrentWorkspace();if(_pId){const _f=()=>l.commands.executeCommand("workbench.action.smartFocusConversation",_pId);setTimeout(_f,800);setTimeout(_f,1800);setTimeout(_f,3000)}}catch(_e){}})()';
const OLD_PATCHED_EXT_ACT_V2 = 'q.F.initialize(e),ce.end(),(()=>{try{const _check=()=>{try{const _pId=q.F.getInstance().getCascadeIdForCurrentWorkspace();if(_pId){const _f=()=>l.commands.executeCommand("workbench.action.smartFocusConversation",_pId);setTimeout(_f,300);setTimeout(_f,1000);setTimeout(_f,2500)}}catch(_e){}};_check();l.window.onDidChangeWindowState?.(ws=>{if(ws.focused)_check()})}catch(_e){}})()';
const OLD_REQUIRE_PATCHED_EXT_ACT = 'q.F.initialize(e),ce.end(),(()=>{try{const _normWs=u=>{if(!u)return"";try{let s=decodeURIComponent(String(u)).toLowerCase().split("\\\\").join("/");if(s.startsWith("file:///"))s=s.slice(8);else if(s.startsWith("file://"))s=s.slice(7);while(s.endsWith("/"))s=s.slice(0,-1);if(/^\\/[a-z]:/i.test(s))s=s.slice(1);return s}catch{return String(u).toLowerCase()}};const _sync=async()=>{try{const _fs=require("fs"),_p=require("path"),_os=require("os"),_f=_p.join(_os.homedir(),".gemini","antigravity_windows.json");let _data={};try{if(_fs.existsSync(_f))_data=JSON.parse(_fs.readFileSync(_f,"utf8"))||{}}catch(_){}for(const[k,v]of Object.entries(_data)){if(v&&v.pid){let _alive=!1;try{process.kill(v.pid,0);_alive=!0}catch(_){}_alive||delete _data[k]}}const _curWs=l.workspace.workspaceFolders?.[0]?.uri.toString();if(_curWs){let _actC=null;try{_actC=await l.commands.executeCommand("workbench.action.getActiveCascadeId")}catch(_){}_data[_normWs(_curWs)]={ws:_curWs,pid:process.pid,activeCascadeId:_actC||null,updatedAt:Date.now()}}_fs.writeFileSync(_f,JSON.stringify(_data,null,2),"utf8")}catch(_){}};const _check=()=>{try{const _pId=q.F.getInstance().getCascadeIdForCurrentWorkspace();if(_pId){const _f=()=>l.commands.executeCommand("workbench.action.smartFocusConversation",_pId);setTimeout(_f,300);setTimeout(_f,1000);setTimeout(_f,2500)}}catch(_e){}};_check();_sync();setInterval(_sync,2500);l.window.onDidChangeWindowState?.(ws=>{if(ws.focused){_check();_sync()}})}catch(_e){}})()';
const PATCHED_EXT_ACT = 'q.F.initialize(e),ce.end(),(()=>{try{const _normWs=u=>{if(!u)return"";try{let s=decodeURIComponent(String(u)).toLowerCase().split("\\\\").join("/");if(s.startsWith("file://"))s=s.slice(7);while(s.startsWith("/"))s=s.slice(1);if(!/^[a-z]:/i.test(s))s="/"+s;while(s.endsWith("/"))s=s.slice(0,-1);return s}catch{return String(u).toLowerCase()}};const __fs=typeof _fs!=="undefined"?_fs:null,__p=typeof _p!=="undefined"?_p:null,__os=typeof _os!=="undefined"?_os:null,_f=__p&&__os?__p.join(__os.homedir(),".gemini","antigravity_windows.json"):null;const _sync=async()=>{try{if(!_f||!__fs)return;let _data={};try{if(__fs.existsSync(_f))_data=JSON.parse(__fs.readFileSync(_f,"utf8"))||{}}catch(_){}for(const[k,v]of Object.entries(_data)){if(v&&v.pid){let _alive=!1;try{process.kill(v.pid,0);_alive=!0}catch(_){}_alive||delete _data[k]}}const _curWs=l.workspace.workspaceFolders?.[0]?.uri.toString();if(_curWs){let _actC=null;try{_actC=await l.commands.executeCommand("workbench.action.getActiveCascadeId")}catch(_){}_data[_normWs(_curWs)]={ws:_curWs,pid:process.pid,activeCascadeId:_actC||null,updatedAt:Date.now()}}__fs.writeFileSync(_f,JSON.stringify(_data,null,2),"utf8")}catch(_){}};const _check=()=>{try{const _pId=q.F.getInstance().getCascadeIdForCurrentWorkspace();if(_pId){const _f=()=>l.commands.executeCommand("workbench.action.smartFocusConversation",_pId);setTimeout(_f,300);setTimeout(_f,1000);setTimeout(_f,2500)}}catch(_e){}};_check();_sync();setInterval(_sync,2500);l.window.onDidChangeWindowState?.(ws=>{if(ws.focused){_check();_sync()}})}catch(_e){}})()';
// Antigravity 1.107.0 Subextension Injection (in extensions/agy/dist/extension.js)
const ORIGINAL_AGY_ACT = 'try{l=await b.activate(E)}finally{c.commands.registerCommand=V}';
const PATCHED_AGY_ACT = `;(()=>{try{const _m='/* agy-chat-fixed */';const _normWs=u=>{if(!u)return'';try{let s=decodeURIComponent(String(u)).toLowerCase().split('\\\\').join('/');if(s.startsWith('file://'))s=s.slice(7);while(s.startsWith('/'))s=s.slice(1);if(!/^[a-z]:/i.test(s))s='/'+s;while(s.endsWith('/'))s=s.slice(0,-1);return s}catch{return String(u).toLowerCase()}};c.commands.registerCommand('antigravity.openConversationWorkspaceQuickPick',async e=>{const t=e?.workspaceUris,n=e?.cascadeId;if(!t||0===t.length)return{openInCurrentWindow:!0};try{const _curWs=c.workspace.workspaceFolders?.[0]?.uri.toString();const _curNorm=_normWs(_curWs);const _tgtNorm=_normWs(t[0]);if(_tgtNorm&&_curNorm===_tgtNorm)return{openInCurrentWindow:!0};const __fs=typeof _fs!=='undefined'?_fs:null,__p=typeof _p!=='undefined'?_p:null,__os=typeof _os!=='undefined'?_os:null;const _winFile=__p&&__os?__p.join(__os.homedir(),'.gemini','antigravity_windows.json'):null;const _pendFile=__p&&__os?__p.join(__os.homedir(),'.gemini','antigravity_pending_cascade.json'):null;let _winData={};try{if(_winFile&&__fs&&__fs.existsSync(_winFile))_winData=JSON.parse(__fs.readFileSync(_winFile,'utf8'))||{}}catch(_){}const _tgtWin=_winData[_tgtNorm];let _isTargetOpen=!1;if(_tgtWin&&_tgtWin.pid){try{process.kill(_tgtWin.pid,0);_isTargetOpen=!0}catch(_){}}const _setPending=()=>{try{if(!_pendFile||!__fs)return;let pData={};if(__fs.existsSync(_pendFile))pData=JSON.parse(__fs.readFileSync(_pendFile,'utf8'))||{};pData[_tgtNorm]=n;__fs.writeFileSync(_pendFile,JSON.stringify(pData,null,2),'utf8')}catch(_){}};const targetUri=t[0].startsWith('file:')?c.Uri.parse(t[0]):c.Uri.file(t[0]);if(!_isTargetOpen){_setPending();await c.commands.executeCommand('vscode.openFolder',targetUri,{forceNewWindow:!0});return{openInCurrentWindow:!1}}if(_tgtWin.activeCascadeId&&_tgtWin.activeCascadeId!==n){return{openInCurrentWindow:!0}}_setPending();await c.commands.executeCommand('vscode.openFolder',targetUri,{forceNewWindow:!0});return{openInCurrentWindow:!1}}catch(err){console.error('[AGI-Fix] QuickPick error:',err);return{openInCurrentWindow:!0}}});const _sync=async()=>{try{const __fs=typeof _fs!=='undefined'?_fs:null,__p=typeof _p!=='undefined'?_p:null,__os=typeof _os!=='undefined'?_os:null;const _winFile=__p&&__os?__p.join(__os.homedir(),'.gemini','antigravity_windows.json'):null;if(!_winFile||!__fs)return;let _winData={};try{if(__fs.existsSync(_winFile))_winData=JSON.parse(__fs.readFileSync(_winFile,'utf8'))||{}}catch(_){}for(const[k,v]of Object.entries(_winData)){if(v&&v.pid){let _alive=!1;try{process.kill(v.pid,0);_alive=!0}catch(_){}_alive||delete _winData[k]}}const _curWs=c.workspace.workspaceFolders?.[0]?.uri.toString();if(_curWs){let _actC=null;try{_actC=await c.commands.executeCommand('workbench.action.getActiveCascadeId')}catch(_){}_winData[_normWs(_curWs)]={ws:_curWs,pid:process.pid,activeCascadeId:_actC||null,updatedAt:Date.now()}}__fs.writeFileSync(_winFile,JSON.stringify(_winData,null,2),'utf8')}catch(_){}};const _checkPending=()=>{try{const _curWs=c.workspace.workspaceFolders?.[0]?.uri.toString();if(!_curWs)return;const __fs=typeof _fs!=='undefined'?_fs:null,__p=typeof _p!=='undefined'?_p:null,__os=typeof _os!=='undefined'?_os:null;const _pendFile=__p&&__os?__p.join(__os.homedir(),'.gemini','antigravity_pending_cascade.json'):null;if(!_pendFile||!__fs||!__fs.existsSync(_pendFile))return;let pData=JSON.parse(__fs.readFileSync(_pendFile,'utf8'))||{};const _curNorm=_normWs(_curWs);const pId=pData[_curNorm];if(pId){delete pData[_curNorm];try{__fs.writeFileSync(_pendFile,JSON.stringify(pData,null,2),'utf8')}catch(_){};const _f=()=>c.commands.executeCommand('workbench.action.smartFocusConversation',pId);setTimeout(_f,300);setTimeout(_f,1000);setTimeout(_f,2500)}}catch(_){}};_checkPending();_sync();setInterval(_sync,2500);c.window.onDidChangeWindowState?.(ws=>{if(ws.focused){_checkPending();_sync()}})}catch(err){console.warn('[AGI-Fix] Injected hook failed:',err)}})();';[AGI-Fix] Injected hook failed:',err)}})();`;
function getWorkbenchPath(appRoot) {
    return path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
}
function getMainJsPath(appRoot) {
    return path.join(appRoot, 'out', 'main.js');
}
function getAntigravityExtensionPath(appRoot) {
    const agyDist = path.join(appRoot, 'extensions', 'agy', 'dist', 'extension.js');
    if (fs.existsSync(agyDist)) {
        return agyDist;
    }
    return path.join(appRoot, 'extensions', 'antigravity', 'dist', 'extension.js');
}
function getProductJsonPath(appRoot) {
    return path.join(appRoot, 'product.json');
}
function computeSha256Base64(buf) {
    return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}
function updateChecksumInProductJson(appRoot, fileRelativePath, newHash) {
    const productPath = getProductJsonPath(appRoot);
    if (!fs.existsSync(productPath))
        return false;
    try {
        const raw = fs.readFileSync(productPath, 'utf8');
        const json = JSON.parse(raw);
        if (!json.checksums) {
            json.checksums = {};
        }
        json.checksums[fileRelativePath] = newHash;
        fs.writeFileSync(productPath, JSON.stringify(json, null, '\t'), 'utf8');
        return true;
    }
    catch (e) {
        console.error('Failed to update product.json:', e);
        return false;
    }
}
function cleanAutoArchiveHook() {
    try {
        const homeDir = os.homedir();
        const hooksPath = path.join(homeDir, '.gemini', 'config', 'hooks.json');
        if (fs.existsSync(hooksPath)) {
            const hooksJson = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
            if (hooksJson.hooks?.Stop) {
                hooksJson.hooks.Stop = hooksJson.hooks.Stop.filter((h) => !(h.command && h.command.includes('archive_cleared_conversations.py')) &&
                    !(h.script && h.script.includes('archive_cleared_conversations.py')));
                fs.writeFileSync(hooksPath, JSON.stringify(hooksJson, null, 2), 'utf8');
            }
        }
        const scriptPath = path.join(homeDir, '.gemini', 'scripts', 'archive_cleared_conversations.py');
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
        }
    }
    catch (e) {
        console.error('Failed to clean auto-archive hook:', e);
    }
}
function checkAndAutoLoadPendingCascade() {
    try {
        const homeDir = os.homedir();
        const pendingFiles = [
            path.join(homeDir, '.gemini', 'antigravity_pending_cascade.json'),
            path.join(homeDir, '.gemini', 'pending_workspace_cascade.json')
        ];
        const folders = vscode.workspace.workspaceFolders || [];
        if (folders.length === 0)
            return;
        const norm = (u) => {
            if (!u)
                return '';
            try {
                let s = decodeURIComponent(String(u)).toLowerCase().split('\\').join('/');
                if (s.startsWith('file://'))
                    s = s.slice(7);
                while (s.startsWith('/'))
                    s = s.slice(1);
                if (!/^[a-z]:/i.test(s))
                    s = '/' + s;
                while (s.endsWith('/'))
                    s = s.slice(0, -1);
                return s;
            }
            catch {
                return String(u).toLowerCase();
            }
        };
        const currentUri = norm(folders[0].uri.toString());
        for (const pendingFile of pendingFiles) {
            if (!fs.existsSync(pendingFile))
                continue;
            let map = {};
            try {
                map = JSON.parse(fs.readFileSync(pendingFile, 'utf8')) || {};
            }
            catch {
                continue;
            }
            for (const [savedUri, cascadeId] of Object.entries(map)) {
                const normSaved = norm(savedUri);
                if (normSaved === currentUri && typeof cascadeId === 'string' && cascadeId) {
                    delete map[savedUri];
                    try {
                        fs.writeFileSync(pendingFile, JSON.stringify(map, null, 2), 'utf8');
                    }
                    catch { }
                    const focus = () => {
                        vscode.commands.executeCommand('workbench.action.smartFocusConversation', cascadeId);
                    };
                    setTimeout(focus, 300);
                    setTimeout(focus, 1000);
                    setTimeout(focus, 2500);
                    return;
                }
            }
        }
    }
    catch (e) {
        console.error('Failed to auto-load pending cascade:', e);
    }
}
async function applyFix(silent = false) {
    const appRoot = vscode.env.appRoot;
    const wbPath = getWorkbenchPath(appRoot);
    const mainPath = getMainJsPath(appRoot);
    const extPath = getAntigravityExtensionPath(appRoot);
    if (!fs.existsSync(wbPath)) {
        if (!silent) {
            vscode.window.showErrorMessage(`AGI Chat Fix: File not found: ${wbPath}`);
        }
        return false;
    }
    let wbContent;
    try {
        wbContent = fs.readFileSync(wbPath, 'utf8');
    }
    catch (e) {
        if (!silent) {
            vscode.window.showErrorMessage(`AGI Chat Fix: Cannot read ${wbPath} - ${e}`);
        }
        return false;
    }
    // Create backups if not already present
    const wbBakPath = `${wbPath}.bak`;
    if (!fs.existsSync(wbBakPath)) {
        try {
            fs.copyFileSync(wbPath, wbBakPath);
        }
        catch { }
    }
    const mainBakPath = `${mainPath}.bak`;
    if (fs.existsSync(mainPath) && !fs.existsSync(mainBakPath)) {
        try {
            fs.copyFileSync(mainPath, mainBakPath);
        }
        catch { }
    }
    const extBakPath = `${extPath}.bak`;
    if (fs.existsSync(extPath) && !fs.existsSync(extBakPath)) {
        try {
            fs.copyFileSync(extPath, extBakPath);
        }
        catch { }
    }
    let wbModified = false;
    // Module 1: Clipboard & Context Menu
    if (wbContent.includes(V5_PATCHED_PSR)) {
        wbContent = wbContent.replace(V5_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(BROKEN_V4_1_PATCHED_PSR)) {
        wbContent = wbContent.replace(BROKEN_V4_1_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(BROKEN_V4_PATCHED_PSR)) {
        wbContent = wbContent.replace(BROKEN_V4_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(V3_PATCHED_PSR)) {
        wbContent = wbContent.replace(V3_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(V2_PATCHED_PSR)) {
        wbContent = wbContent.replace(V2_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(V2_LEGACY_PATCHED_PSR)) {
        wbContent = wbContent.replace(V2_LEGACY_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(V1_PATCHED_PSR)) {
        wbContent = wbContent.replace(V1_PATCHED_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_PSR)) {
        wbContent = wbContent.replace(ORIGINAL_PSR, () => PATCHED_PSR);
        wbModified = true;
    }
    if (wbContent.includes(OLD_PATCHED_CM)) {
        wbContent = wbContent.replace(OLD_PATCHED_CM, () => PATCHED_CM);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_CM)) {
        wbContent = wbContent.replace(ORIGINAL_CM, () => PATCHED_CM);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_CM_V2)) {
        wbContent = wbContent.replace(ORIGINAL_CM_V2, () => PATCHED_CM_V2);
        wbModified = true;
    }
    // Module 2: Windows Workspace URI Normalization
    if (wbContent.includes(ORIGINAL_B5U)) {
        wbContent = wbContent.replace(ORIGINAL_B5U, () => PATCHED_B5U);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_PD)) {
        wbContent = wbContent.replace(ORIGINAL_PD, () => PATCHED_PD);
        wbModified = true;
    }
    if (wbContent.includes(ORIGINAL_OCC1)) {
        wbContent = wbContent.replace(ORIGINAL_OCC1, () => PATCHED_OCC1);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_OCC1_V2)) {
        wbContent = wbContent.replace(ORIGINAL_OCC1_V2, () => PATCHED_OCC1_V2);
        wbModified = true;
    }
    // Module 3: Unlock Fork/Branch Conversation
    if (wbContent.includes(ORIGINAL_FORK_FLAG)) {
        wbContent = wbContent.split(ORIGINAL_FORK_FLAG).join(PATCHED_FORK_FLAG);
        wbModified = true;
    }
    if (wbContent.includes(ORIGINAL_FORK_ENABLED_V2)) {
        wbContent = wbContent.split(ORIGINAL_FORK_ENABLED_V2).join(PATCHED_FORK_ENABLED_V2);
        wbModified = true;
    }
    if (wbContent.includes(ORIGINAL_FORK_HISTORICAL_V2)) {
        wbContent = wbContent.split(ORIGINAL_FORK_HISTORICAL_V2).join(PATCHED_FORK_HISTORICAL_V2);
        wbModified = true;
    }
    if (wbContent.includes(ORIGINAL_FORK_BTN)) {
        wbContent = wbContent.replace(ORIGINAL_FORK_BTN, () => PATCHED_FORK_BTN);
        wbModified = true;
    }
    // Module 4: Revert Archive Link if previously patched
    if (wbContent.includes(PATCHED_IXU)) {
        wbContent = wbContent.replace(PATCHED_IXU, () => ORIGINAL_IXU);
        wbModified = true;
    }
    // Module 0: Silence Integrity / Corrupt Installation Notification
    if (wbContent.includes(ORIGINAL_SHOW_NOTIF)) {
        wbContent = wbContent.replace(ORIGINAL_SHOW_NOTIF, () => PATCHED_SHOW_NOTIF);
        wbModified = true;
    }
    // Module 7: Workspace Chat Tabs
    if (wbContent.includes(PATCHED_HHU)) {
        // already on latest
    }
    else if (wbContent.includes(OLD_V1_PATCHED_HHU)) {
        wbContent = wbContent.replace(OLD_V1_PATCHED_HHU, () => PATCHED_HHU);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_HHU)) {
        wbContent = wbContent.replace(ORIGINAL_HHU, () => PATCHED_HHU);
        wbModified = true;
    }
    // Module 8: Auto-Submit Permission Dialogs
    if (wbContent.includes(ORIGINAL_PERMISSION_SUBMIT)) {
        wbContent = wbContent.replace(ORIGINAL_PERMISSION_SUBMIT, () => PATCHED_PERMISSION_SUBMIT);
        wbModified = true;
    }
    // Module 9: Mute Completion Sound on Chat Switch
    if (wbContent.includes(ORIGINAL_SOUND_SWITCH)) {
        wbContent = wbContent.replace(ORIGINAL_SOUND_SWITCH, () => PATCHED_SOUND_SWITCH);
        wbModified = true;
    }
    // Module 6: Register smartFocusConversation & active cascade tracking in workbench
    if (wbContent.includes(OLD_SMART_FOCUS_TARGET)) {
        wbContent = wbContent.replace(OLD_SMART_FOCUS_TARGET, () => PATCHED_SMART_FOCUS_TARGET);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_SMART_FOCUS_TARGET) && !wbContent.includes('smartFocusConversation')) {
        wbContent = wbContent.replace(ORIGINAL_SMART_FOCUS_TARGET, () => PATCHED_SMART_FOCUS_TARGET);
        wbModified = true;
    }
    if (wbContent.includes(ORIGINAL_SNOOZE_V2) && !wbContent.includes('smartFocusConversation')) {
        wbContent = wbContent.replace(ORIGINAL_SNOOZE_V2, () => PATCHED_SNOOZE_V2);
        wbModified = true;
    }
    if (wbContent.includes(ORIGINAL_SET_CASCADE_ID)) {
        wbContent = wbContent.replace(ORIGINAL_SET_CASCADE_ID, () => PATCHED_SET_CASCADE_ID);
        wbModified = true;
    }
    else if (wbContent.includes(ORIGINAL_SET_CASCADE_ID_V2) && !wbContent.includes('__agi_active_cascade_id')) {
        wbContent = wbContent.replace(ORIGINAL_SET_CASCADE_ID_V2, () => PATCHED_SET_CASCADE_ID_V2);
        wbModified = true;
    }
    if (wbModified) {
        try {
            fs.writeFileSync(wbPath, wbContent, 'utf8');
        }
        catch (e) {
            if (!silent) {
                vscode.window.showErrorMessage(`AGI Chat Fix: Failed to write ${wbPath}: ${e}`);
            }
            return false;
        }
    }
    // Module 5: Multi-Window Notification Focus in main.js
    let mainModified = false;
    if (fs.existsSync(mainPath)) {
        try {
            let mainContent = fs.readFileSync(mainPath, 'utf8');
            if (mainContent.includes(ORIGINAL_NOTIF_PAYLOAD)) {
                mainContent = mainContent.replace(ORIGINAL_NOTIF_PAYLOAD, PATCHED_NOTIF_PAYLOAD);
                fs.writeFileSync(mainPath, mainContent, 'utf8');
                mainModified = true;
            }
        }
        catch (e) {
            console.warn('Failed to patch main.js:', e);
        }
    }
    // Module 6: QuickPick Routing & Auto-Load Chat in extension.js
    if (fs.existsSync(extPath)) {
        try {
            let extContent = fs.readFileSync(extPath, 'utf8');
            let extModified = false;
            // Ensure ESM imports exist at top of extension.js safely (strictly once)
            if (!extContent.includes(TOP_IMPORT_MARKER)) {
                extContent = extContent.replace(/import\*as _fs from"node:fs";import\*as _p from"node:path";import\*as _os from"node:os";/g, '');
                if (extContent.includes(ORIGINAL_TOP_IMPORT)) {
                    extContent = extContent.replace(ORIGINAL_TOP_IMPORT, () => PATCHED_TOP_IMPORT);
                    extModified = true;
                }
            }
            // QuickPick routing with fallback & error handling
            if (extContent.includes(PATCHED_QUICKPICK)) {
                // already up to date
            }
            else if (extContent.includes(OLD_V1_PATCHED_QUICKPICK)) {
                extContent = extContent.replace(OLD_V1_PATCHED_QUICKPICK, () => PATCHED_QUICKPICK);
                extModified = true;
            }
            else if (extContent.includes(OLD_REQUIRE_PATCHED_QUICKPICK)) {
                extContent = extContent.replace(OLD_REQUIRE_PATCHED_QUICKPICK, () => PATCHED_QUICKPICK);
                extModified = true;
            }
            else if (extContent.includes(INTERACTIVE_QUICKPICK)) {
                extContent = extContent.replace(INTERACTIVE_QUICKPICK, () => PATCHED_QUICKPICK);
                extModified = true;
            }
            else if (extContent.includes(AUTO_QUICKPICK)) {
                extContent = extContent.replace(AUTO_QUICKPICK, () => PATCHED_QUICKPICK);
                extModified = true;
            }
            else if (extContent.includes(ORIGINAL_QUICKPICK)) {
                extContent = extContent.replace(ORIGINAL_QUICKPICK, () => PATCHED_QUICKPICK);
                extModified = true;
            }
            if (extContent.includes(ORIGINAL_EXT_STORAGE)) {
                extContent = extContent.replace(ORIGINAL_EXT_STORAGE, () => PATCHED_EXT_STORAGE);
                extModified = true;
            }
            if (extContent.includes(OLD_REQUIRE_PATCHED_EXT_ACT)) {
                extContent = extContent.replace(OLD_REQUIRE_PATCHED_EXT_ACT, () => PATCHED_EXT_ACT);
                extModified = true;
            }
            else if (extContent.includes(OLD_PATCHED_EXT_ACT_V2)) {
                extContent = extContent.replace(OLD_PATCHED_EXT_ACT_V2, () => PATCHED_EXT_ACT);
                extModified = true;
            }
            else if (extContent.includes(OLD_PATCHED_EXT_ACT)) {
                extContent = extContent.replace(OLD_PATCHED_EXT_ACT, () => PATCHED_EXT_ACT);
                extModified = true;
            }
            else if (extContent.includes(ORIGINAL_EXT_ACT)) {
                extContent = extContent.replace(ORIGINAL_EXT_ACT, () => PATCHED_EXT_ACT);
                extModified = true;
            }
            // Antigravity 1.107.0 extension injection
            if (extContent.includes(ORIGINAL_AGY_ACT) && !extContent.includes('antigravity.openConversationWorkspaceQuickPick')) {
                extContent = extContent.replace(ORIGINAL_AGY_ACT, () => `${ORIGINAL_AGY_ACT}${PATCHED_AGY_ACT}`);
                extModified = true;
            }
            if (extModified) {
                fs.writeFileSync(extPath, extContent, 'utf8');
            }
        }
        catch (e) {
            console.warn('Failed to patch extension.js:', e);
        }
    }
    // Ensure legacy auto-archive hook is removed
    // Ensure legacy auto-archive hook is removed
    cleanAutoArchiveHook();
    // Sync product.json checksums
    const newBuf = Buffer.from(wbContent, 'utf8');
    const newHash = computeSha256Base64(newBuf);
    updateChecksumInProductJson(appRoot, 'vs/workbench/workbench.desktop.main.js', newHash);
    if (!silent) {
        const message = mainModified
            ? 'All AGI Chat Fixes applied! Restart IDE to complete main process update.'
            : 'All AGI Chat Fixes applied! Reload window to take effect.';
        const choice = await vscode.window.showInformationMessage(message, 'Reload Window');
        if (choice === 'Reload Window') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
    return true;
}
async function removeFix() {
    const appRoot = vscode.env.appRoot;
    const wbPath = getWorkbenchPath(appRoot);
    const mainPath = getMainJsPath(appRoot);
    const extPath = getAntigravityExtensionPath(appRoot);
    const wbBakPath = `${wbPath}.bak`;
    const mainBakPath = `${mainPath}.bak`;
    const extBakPath = `${extPath}.bak`;
    let restoredAny = false;
    if (fs.existsSync(wbBakPath)) {
        try {
            fs.copyFileSync(wbBakPath, wbPath);
            const buf = fs.readFileSync(wbPath);
            const hash = computeSha256Base64(buf);
            updateChecksumInProductJson(appRoot, 'vs/workbench/workbench.desktop.main.js', hash);
            restoredAny = true;
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to restore workbench from backup: ${e}`);
        }
    }
    else if (fs.existsSync(wbPath)) {
        try {
            let wbContent = fs.readFileSync(wbPath, 'utf8');
            let modified = false;
            if (wbContent.includes(PATCHED_HHU)) {
                wbContent = wbContent.replace(PATCHED_HHU, () => ORIGINAL_HHU);
                modified = true;
            }
            else if (wbContent.includes(OLD_V1_PATCHED_HHU)) {
                wbContent = wbContent.replace(OLD_V1_PATCHED_HHU, () => ORIGINAL_HHU);
                modified = true;
            }
            if (wbContent.includes(PATCHED_PERMISSION_SUBMIT)) {
                wbContent = wbContent.replace(PATCHED_PERMISSION_SUBMIT, () => ORIGINAL_PERMISSION_SUBMIT);
                modified = true;
            }
            if (wbContent.includes(PATCHED_SOUND_SWITCH)) {
                wbContent = wbContent.replace(PATCHED_SOUND_SWITCH, () => ORIGINAL_SOUND_SWITCH);
                modified = true;
            }
            if (modified) {
                fs.writeFileSync(wbPath, wbContent, 'utf8');
                const buf = fs.readFileSync(wbPath);
                const hash = computeSha256Base64(buf);
                updateChecksumInProductJson(appRoot, 'vs/workbench/workbench.desktop.main.js', hash);
                restoredAny = true;
            }
        }
        catch (_) { }
    }
    if (fs.existsSync(mainBakPath) && fs.existsSync(mainPath)) {
        try {
            fs.copyFileSync(mainBakPath, mainPath);
            restoredAny = true;
        }
        catch (e) {
            console.warn('Failed to restore main.js from backup:', e);
        }
    }
    if (fs.existsSync(extBakPath) && fs.existsSync(extPath)) {
        try {
            fs.copyFileSync(extBakPath, extPath);
            restoredAny = true;
        }
        catch (e) {
            console.warn('Failed to restore extension.js from backup:', e);
        }
    }
    cleanAutoArchiveHook();
    if (restoredAny) {
        const choice = await vscode.window.showInformationMessage('AGI Chat Fix removed! Restored original files.', 'Reload Window');
        if (choice === 'Reload Window') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return true;
    }
    return false;
}
async function fixChecksumsOnly() {
    const appRoot = vscode.env.appRoot;
    const wbPath = getWorkbenchPath(appRoot);
    if (!fs.existsSync(wbPath)) {
        vscode.window.showErrorMessage(`File not found: ${wbPath}`);
        return;
    }
    const buf = fs.readFileSync(wbPath);
    const hash = computeSha256Base64(buf);
    const ok = updateChecksumInProductJson(appRoot, 'vs/workbench/workbench.desktop.main.js', hash);
    if (ok) {
        vscode.window.showInformationMessage('AGI Chat Fix: Checksums updated! Corrupted warning dismissed.');
    }
    else {
        vscode.window.showErrorMessage('Failed to update product.json checksum.');
    }
}
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('antigravity-enhancer.apply', () => applyFix(false)), vscode.commands.registerCommand('antigravity-enhancer.remove', () => removeFix()), vscode.commands.registerCommand('antigravity-enhancer.fixChecksums', () => fixChecksumsOnly()), vscode.commands.registerCommand('agi-chat-fix.apply', () => applyFix(false)), vscode.commands.registerCommand('agi-chat-fix.remove', () => removeFix()), vscode.commands.registerCommand('agi-chat-fix.fixChecksums', () => fixChecksumsOnly()), vscode.commands.registerCommand('antigravity-clipboard-fix.apply', () => applyFix(false)), vscode.commands.registerCommand('antigravity-clipboard-fix.remove', () => removeFix()), vscode.commands.registerCommand('antigravity-clipboard-fix.fixChecksums', () => fixChecksumsOnly()));
    // Register external file opener for binaries, office, media, archives
    (0, externalOpener_1.registerExternalOpener)(context);
    // Auto-load pending cascade on window activation or focus
    checkAndAutoLoadPendingCascade();
    context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
            checkAndAutoLoadPendingCascade();
        }
    }));
    // Auto-check on startup
    const appRoot = vscode.env.appRoot;
    const wbPath = getWorkbenchPath(appRoot);
    const mainPath = getMainJsPath(appRoot);
    const extPath = getAntigravityExtensionPath(appRoot);
    if (fs.existsSync(wbPath)) {
        try {
            const wbContent = fs.readFileSync(wbPath, 'utf8');
            let needsPatch = false;
            if (wbContent.includes(V5_PATCHED_PSR) || wbContent.includes(BROKEN_V4_1_PATCHED_PSR) || wbContent.includes(BROKEN_V4_PATCHED_PSR) || wbContent.includes(V3_PATCHED_PSR) || wbContent.includes(V2_PATCHED_PSR) || wbContent.includes(V2_LEGACY_PATCHED_PSR) || wbContent.includes(V1_PATCHED_PSR) || (!wbContent.includes(PATCH_MARKER) && wbContent.includes(ORIGINAL_PSR))) {
                needsPatch = true;
            }
            if (wbContent.includes(ORIGINAL_B5U) || wbContent.includes(ORIGINAL_PD) || wbContent.includes(ORIGINAL_FORK_FLAG) || wbContent.includes(ORIGINAL_FORK_ENABLED_V2) || wbContent.includes(PATCHED_IXU) || wbContent.includes(ORIGINAL_CM_V2)) {
                needsPatch = true;
            }
            if (wbContent.includes(OLD_V1_PATCHED_HHU) || (!wbContent.includes(PATCHED_HHU) && wbContent.includes(ORIGINAL_HHU))) {
                needsPatch = true;
            }
            if (wbContent.includes(OLD_SMART_FOCUS_TARGET) || wbContent.includes(ORIGINAL_SET_CASCADE_ID) || (wbContent.includes(ORIGINAL_SMART_FOCUS_TARGET) && !wbContent.includes('smartFocusConversation')) || (wbContent.includes(ORIGINAL_SNOOZE_V2) && !wbContent.includes('smartFocusConversation'))) {
                needsPatch = true;
            }
            if (fs.existsSync(mainPath)) {
                const mainContent = fs.readFileSync(mainPath, 'utf8');
                if (mainContent.includes(ORIGINAL_NOTIF_PAYLOAD)) {
                    needsPatch = true;
                }
            }
            if (fs.existsSync(extPath)) {
                const extContent = fs.readFileSync(extPath, 'utf8');
                if (!extContent.includes(TOP_IMPORT_MARKER) || extContent.includes(OLD_V1_PATCHED_QUICKPICK) || extContent.includes(ORIGINAL_QUICKPICK) || extContent.includes(AUTO_QUICKPICK) || extContent.includes(INTERACTIVE_QUICKPICK) || extContent.includes(OLD_PATCHED_EXT_ACT) || extContent.includes(OLD_PATCHED_EXT_ACT_V2)) {
                    needsPatch = true;
                }
                if (extContent.includes(ORIGINAL_AGY_ACT) && !extContent.includes('antigravity.openConversationWorkspaceQuickPick')) {
                    needsPatch = true;
                }
            }
            if (needsPatch) {
                vscode.window.showInformationMessage('AGI Chat Fix: Antigravity IDE has unpatched components. Would you like to apply all fixes?', 'Apply All Fixes & Reload').then((choice) => {
                    if (choice === 'Apply All Fixes & Reload') {
                        applyFix(false);
                    }
                });
            }
            else {
                // Checksum integrity guard: ensure product.json matches so no corruption warning shows
                const buf = Buffer.from(wbContent, 'utf8');
                const hash = computeSha256Base64(buf);
                updateChecksumInProductJson(appRoot, 'vs/workbench/workbench.desktop.main.js', hash);
            }
        }
        catch {
            // Ignore startup check errors
        }
    }
}
function deactivate() { }
