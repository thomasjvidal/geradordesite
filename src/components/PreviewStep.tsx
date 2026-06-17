import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download, Maximize2, Minimize2, RotateCcw, Pencil, Trash2,
  Link2, Palette, X, Undo2, Smartphone, Monitor,
  MessageSquare, Image as ImageIcon, Globe, Save, RefreshCw,
  ChevronLeft, ScrollText, ChevronDown, ChevronUp,
} from "lucide-react";
import JSZip from "jszip";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  downloadProject, buildPreviewHTML, extractImages,
  type ImageEntry, type ClientData,
} from "@/lib/site-processor";
import { publishToVercel, pushToGitHub } from "@/lib/publisher";
import { saveAs } from "file-saver";
import { toast } from "sonner";

const VERCEL_TOKEN = (import.meta as any).env?.VITE_VERCEL_TOKEN || "";
const GH_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || "";
const GH_OWNER = (import.meta as any).env?.VITE_GITHUB_OWNER || "";

// ── Inline editor script injected into iframe ──────────────────────────────
const EDITOR_SCRIPT = `
(function() {
  if (window.__editorActive) return;
  window.__editorActive = true;

  var selectedEl = null;
  var hoveredEl = null;
  window.__undoStack = [];

  var style = document.createElement('style');
  style.id = '__ed-style__';
  style.textContent =
    '.__ed-hover { outline: 2px dashed #38bdf8 !important; cursor: pointer !important; }' +
    '.__ed-selected { outline: 2px solid #0284c7 !important; background: rgba(2,132,199,0.04) !important; }' +
    '[contenteditable]:focus { outline: 2px solid #0ea5e9 !important; }' +
    'a, button { pointer-events: none !important; }';
  document.head.appendChild(style);

  var TEXT_TAGS = ['P','H1','H2','H3','H4','H5','H6','SPAN','LI','STRONG','EM','TD','TH','BLOCKQUOTE','LABEL','SMALL'];
  var BLOCK_TAGS = ['SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','DIV','NAV','FIGURE','UL','OL'];

  function classify(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.tagName === 'IMG') return 'image';
    if (el.tagName === 'A') return 'link';
    if (el.tagName === 'BUTTON') return 'button';
    if (TEXT_TAGS.indexOf(el.tagName) !== -1) return 'text';
    if (BLOCK_TAGS.indexOf(el.tagName) !== -1) return 'block';
    return null;
  }

  function hasBgImage(el) {
    try {
      var bg = window.getComputedStyle(el).backgroundImage;
      return bg && bg !== 'none' && bg.indexOf('url(') !== -1;
    } catch(e) { return false; }
  }

  // For Elementor: drill into widget to find the real text element
  function findElementorText(el) {
    var cur = el;
    for (var i = 0; i < 12 && cur && cur !== document.body; i++) {
      var cls = cur.className || '';
      if (typeof cls === 'string' && (
        cls.indexOf('elementor-heading-title') !== -1 ||
        cls.indexOf('elementor-cta-title') !== -1 ||
        cls.indexOf('elementor-cta-description') !== -1
      )) return cur;
      cur = cur.parentElement;
    }
    // Inside a text-editor widget: find first p/span with actual text
    cur = el;
    for (var j = 0; j < 12 && cur && cur !== document.body; j++) {
      var cls2 = cur.className || '';
      if (typeof cls2 === 'string' && cls2.indexOf('elementor-widget-text-editor') !== -1) {
        var p = cur.querySelector('p, span, li');
        return p || cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function findTarget(el) {
    // Check Elementor-specific elements first
    var elText = findElementorText(el);
    if (elText) return elText;

    var cur = el;
    for (var i = 0; i < 8 && cur && cur !== document.body; i++) {
      var t = classify(cur);
      if (t && t !== 'block') return cur;
      cur = cur.parentElement;
    }
    cur = el;
    for (var j = 0; j < 8 && cur && cur !== document.body; j++) {
      if (classify(cur) === 'block') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function deselect() {
    if (selectedEl) { selectedEl.classList.remove('__ed-selected'); selectedEl = null; }
    window.parent.postMessage({ type: 'deselect' }, '*');
  }

  function clickHandler(e) {
    if (selectedEl && selectedEl.getAttribute('contenteditable') &&
        (e.target === selectedEl || selectedEl.contains(e.target))) return;

    var stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
    var imageEl = null;
    for (var k = 0; k < stack.length; k++) {
      if (stack[k].tagName === 'IMG') { imageEl = stack[k]; break; }
    }
    var bgImageEl = null;
    if (!imageEl) {
      for (var m = 0; m < stack.length; m++) {
        var c = stack[m];
        if (c !== document.body && c !== document.documentElement && hasBgImage(c)) {
          bgImageEl = c; break;
        }
      }
    }
    var target = imageEl || bgImageEl || findTarget(e.target);
    if (!target) { deselect(); return; }

    e.preventDefault();
    e.stopPropagation();

    if (selectedEl) selectedEl.classList.remove('__ed-selected');
    selectedEl = target;
    target.classList.add('__ed-selected');

    var elType = imageEl ? 'image' : bgImageEl ? 'bgimage' : classify(target);
    var info = { tagName: target.tagName, href: target.getAttribute('href') || '', src: target.getAttribute('src') || '' };

    if (elType === 'text' || elType === 'button') {
      pushUndo({ type: 'text', el: target, prev: target.innerHTML });
      target.setAttribute('contenteditable', 'true');
      target.focus();
      try {
        var range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      } catch (_) {}
    }

    window.parent.postMessage({ type: 'select', elType: elType, info: info }, '*');
  }

  function mouseoverHandler(e) {
    var stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
    var imageEl = null;
    for (var k = 0; k < stack.length; k++) {
      if (stack[k].tagName === 'IMG') { imageEl = stack[k]; break; }
    }
    var target = imageEl || findTarget(e.target);
    if (hoveredEl && hoveredEl !== selectedEl) hoveredEl.classList.remove('__ed-hover');
    if (target && target !== selectedEl) { target.classList.add('__ed-hover'); hoveredEl = target; }
  }

  function mouseoutHandler() {
    if (hoveredEl && hoveredEl !== selectedEl) { hoveredEl.classList.remove('__ed-hover'); hoveredEl = null; }
  }

  function keydownHandler(e) {
    if (e.key === 'Escape') {
      if (selectedEl && selectedEl.getAttribute('contenteditable')) {
        selectedEl.removeAttribute('contenteditable');
        selectedEl.blur();
      }
      deselect();
    }
  }

  function pushUndo(action) {
    window.__undoStack.push(action);
    if (window.__undoStack.length > 30) window.__undoStack.shift();
    window.parent.postMessage({ type: 'hasUndo', value: true }, '*');
  }

  function messageHandler(e) {
    var data = e.data;
    if (!data || !data.type) return;
    if (data.type === 'setColor' && selectedEl) {
      pushUndo({ type: 'style', el: selectedEl, prop: 'color', prev: selectedEl.style.color });
      selectedEl.style.color = data.color;
    } else if (data.type === 'setBgColor' && selectedEl) {
      pushUndo({ type: 'style', el: selectedEl, prop: 'backgroundColor', prev: selectedEl.style.backgroundColor });
      selectedEl.style.backgroundColor = data.color;
    } else if (data.type === 'setHref' && selectedEl) {
      pushUndo({ type: 'href', el: selectedEl, prev: selectedEl.getAttribute('href') || '' });
      selectedEl.setAttribute('href', data.href);
    } else if (data.type === 'delete' && selectedEl) {
      var toRemove = selectedEl;
      pushUndo({ type: 'delete', el: toRemove, parent: toRemove.parentElement, next: toRemove.nextSibling });
      toRemove.remove();
      selectedEl = null;
      window.parent.postMessage({ type: 'deselect' }, '*');
    } else if (data.type === 'replaceImage' && selectedEl) {
      if (selectedEl.tagName === 'IMG') {
        pushUndo({ type: 'src', el: selectedEl, prev: selectedEl.src });
        selectedEl.src = data.dataUrl;
      } else {
        pushUndo({ type: 'style', el: selectedEl, prop: 'backgroundImage', prev: selectedEl.style.backgroundImage });
        selectedEl.style.backgroundImage = 'url(' + data.dataUrl + ')';
        selectedEl.style.backgroundSize = 'cover';
        selectedEl.style.backgroundPosition = 'center';
      }
    } else if (data.type === 'deselectAll') {
      if (selectedEl && selectedEl.getAttribute('contenteditable')) {
        selectedEl.removeAttribute('contenteditable');
        selectedEl.blur();
      }
      deselect();
    } else if (data.type === 'undoDelete') {
      if (window.__undoStack.length > 0) {
        var action = window.__undoStack.pop();
        if (action.type === 'delete') {
          if (action.next) action.parent.insertBefore(action.el, action.next);
          else action.parent.appendChild(action.el);
        } else if (action.type === 'style') {
          action.el.style[action.prop] = action.prev;
        } else if (action.type === 'href') {
          action.el.setAttribute('href', action.prev);
        } else if (action.type === 'src') {
          action.el.src = action.prev;
        } else if (action.type === 'text') {
          action.el.innerHTML = action.prev;
        }
        window.parent.postMessage({ type: 'hasUndo', value: window.__undoStack.length > 0 }, '*');
      }
    } else if (data.type === 'getHTML') {
      window.__editorCleanup();
      window.parent.postMessage({ type: 'html', content: '<!DOCTYPE html>' + document.documentElement.outerHTML }, '*');
    }
  }

  document.addEventListener('click', clickHandler, true);
  document.addEventListener('mouseover', mouseoverHandler);
  document.addEventListener('mouseout', mouseoutHandler);
  document.addEventListener('keydown', keydownHandler);
  window.addEventListener('message', messageHandler);

  window.__editorCleanup = function() {
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('mouseover', mouseoverHandler);
    document.removeEventListener('mouseout', mouseoutHandler);
    document.removeEventListener('keydown', keydownHandler);
    window.removeEventListener('message', messageHandler);
    var s = document.getElementById('__ed-style__');
    if (s) s.remove();
    document.querySelectorAll('.__ed-selected, .__ed-hover').forEach(function(el) {
      el.classList.remove('__ed-selected', '__ed-hover');
    });
    document.querySelectorAll('[contenteditable]').forEach(function(el) {
      el.removeAttribute('contenteditable');
    });
    window.__editorActive = false;
    window.__editorCleanup = null;
    selectedEl = null;
    hoveredEl = null;
  };
})();
`;

// ── Minichat helpers ────────────────────────────────────────────────────────
const MC_VAR_NAMES = ["steps", "questions", "messages", "perguntas", "flow", "chatFlow", "fluxo", "etapas"];

interface McFile { path: string; content: string; }
interface McStep {
  id?: string;
  text?: string;
  message?: string;
  options?: Array<{ label?: string; text?: string; value?: string; next?: string }>;
  type?: string;
}

function findMcArray(content: string): { startIdx: number; endIdx: number; varStart: number } | null {
  for (const varName of MC_VAR_NAMES) {
    const regex = new RegExp(`(?:const|var|let)\\s+${varName}\\s*=\\s*\\[`);
    const m = content.match(regex);
    if (!m || m.index === undefined) continue;
    const startIdx = m.index + m[0].length - 1;
    let depth = 0, endIdx = -1;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === "[") depth++;
      else if (content[i] === "]") { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    if (endIdx === -1) continue;
    return { startIdx, endIdx, varStart: m.index };
  }
  return null;
}

function parseSteps(content: string): McStep[] {
  const found = findMcArray(content);
  if (!found) return [];
  const arrayStr = content.substring(found.startIdx, found.endIdx + 1);
  try {
    const raw = (new Function(`return ${arrayStr}`) as () => any[])();
    return raw.map((item) => ({
      ...item,
      options: item.options?.map((o: any) =>
        typeof o === "string" ? { label: o, text: o } : o
      ),
    }));
  } catch { return []; }
}

function serializeSteps(content: string, steps: McStep[]): string {
  const found = findMcArray(content);
  if (!found) return content;
  const prefix = content.substring(0, found.varStart) + content.substring(found.varStart, found.startIdx);
  const suffix = content.substring(found.endIdx + 1);
  const toSerialize = steps.map((step) => ({
    ...step,
    options: step.options?.map((o) => {
      const keys = Object.keys(o).filter((k) => (o as any)[k] !== undefined);
      const isSimple = keys.length <= 2 && keys.every((k) => k === "label" || k === "text");
      return isSimple ? (o.label || o.text) : o;
    }),
  }));
  return prefix + JSON.stringify(toSerialize, null, 2) + suffix;
}

// ── Types ──────────────────────────────────────────────────────────────────
type PreviewTab = "site" | "minichat";

interface PreviewStepProps {
  zip: JSZip | null;
  clientName: string;
  clientData?: ClientData;
  onReset: () => void;
  onBack: () => void;
  logs?: string[];
}

// ── Component ──────────────────────────────────────────────────────────────
const PreviewStep = ({ zip, clientName, clientData, onReset, onBack, logs = [] }: PreviewStepProps) => {
  const [workingZip, setWorkingZip] = useState<JSZip | null>(zip);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileView, setMobileView] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewTab>("site");
  const [showImages, setShowImages] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Editor inline
  const [editMode, setEditMode] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [linkHref, setLinkHref] = useState("");
  const [showLinkEdit, setShowLinkEdit] = useState(false);
  const [fontColor, setFontColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [hasUndo, setHasUndo] = useState(false);

  // Images tab
  const [images, setImages] = useState<ImageEntry[]>([]);
  const imageInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Minichat tab
  const [mcFiles, setMcFiles] = useState<McFile[]>([]);
  const [activeMcPath, setActiveMcPath] = useState("");
  const [mcFileContent, setMcFileContent] = useState("");
  const [mcPhone, setMcPhone] = useState("");
  const [mcBotName, setMcBotName] = useState("");
  const [mcSensorId, setMcSensorId] = useState("");
  const [mcSaving, setMcSaving] = useState(false);
  const [mcSteps, setMcSteps] = useState<McStep[]>([]);
  const [mcStepsFile, setMcStepsFile] = useState("");
  const [mcPreviewUrl, setMcPreviewUrl] = useState<string | null>(null);

  // Publish
  const [showPublish, setShowPublish] = useState(false);
  const [pubSiteName, setPubSiteName] = useState("");
  const [pubLoading, setPubLoading] = useState(false);
  const [pubResult, setPubResult] = useState<{ vercel?: string; github?: string } | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);

  const blobUrlRef = useRef<string | null>(null);
  const mcBlobRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { setWorkingZip(zip); }, [zip]);

  // ── Build preview ──────────────────────────────────────────────────────
  const rebuildPreview = useCallback(async (z: JSZip) => {
    const html = await buildPreviewHTML(z);
    if (html) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPreviewUrl(url);
    }
  }, []);

  const buildMcPreview = useCallback(async (z: JSZip) => {
    const mcPaths = Object.keys(z.files).filter(
      (f) => !z.files[f].dir && f.toLowerCase().includes("minichat")
    );
    const indexPath = mcPaths.find(
      (f) => f.toLowerCase().endsWith("index.html") || f.toLowerCase().endsWith("index.htm")
    );
    if (!indexPath) return;
    const prefix = indexPath.includes("/") ? indexPath.substring(0, indexPath.lastIndexOf("/") + 1) : "";
    const subZip = new JSZip();
    for (const path of Object.keys(z.files)) {
      if (z.files[path].dir) continue;
      const inFolder = prefix ? path.startsWith(prefix) : mcPaths.includes(path);
      if (!inFolder) continue;
      const newPath = prefix ? path.substring(prefix.length) : path;
      if (!newPath) continue;
      try { subZip.file(newPath, await z.files[path].async("arraybuffer")); } catch { /* skip */ }
    }
    const html = await buildPreviewHTML(subZip);
    if (html) {
      if (mcBlobRef.current) URL.revokeObjectURL(mcBlobRef.current);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      mcBlobRef.current = url;
      setMcPreviewUrl(url);
    }
  }, []);

  const loadMiniChatData = useCallback(async (z: JSZip) => {
    const files: McFile[] = [];
    for (const path of Object.keys(z.files)) {
      if (z.files[path].dir || !path.toLowerCase().includes("minichat")) continue;
      const ext = path.split(".").pop()?.toLowerCase() || "";
      if (!["js", "json", "html", "htm", "css", "txt"].includes(ext)) continue;
      try {
        const content = await z.files[path].async("string");
        files.push({ path, content });
      } catch { /* skip binary */ }
    }
    setMcFiles(files);
    if (files.length > 0) {
      setActiveMcPath(files[0].path);
      setMcFileContent(files[0].content);
      const allText = files.map((f) => f.content).join("\n");

      if (clientData?.minichatWhatsapp || clientData?.whatsapp) {
        setMcPhone(((clientData.minichatWhatsapp || clientData.whatsapp) ?? "").replace(/\D/g, ""));
      } else {
        const waMatch = allText.match(/WHATSAPP_NUMBER\s*[=:]\s*['"]([0-9+\s\-()]{8,20})['"]/i)
          || allText.match(/(\+?55\d{10,11})/);
        if (waMatch) setMcPhone(waMatch[1].replace(/\D/g, ""));
      }

      if (clientData?.minichatBotName || clientData?.name) {
        setMcBotName((clientData.minichatBotName || clientData.name) ?? "");
      } else {
        const nameMatch = allText.match(/(?:BOT_NAME|botName|nome_bot)\s*[=:]\s*['"]([^'"]{2,50})['"]/i)
          || allText.match(/<h3[^>]*>([^<]{2,50})<\/h3>/i);
        if (nameMatch) setMcBotName(nameMatch[1]);
      }

      if (clientData?.josephPayId) {
        setMcSensorId(clientData.josephPayId);
      } else {
        const sensorMatch = allText.match(/JP_OWNER_KEY\s*=\s*['"]([A-Za-z0-9_\-]{4,64})['"]/i)
          || allText.match(/sensor\.js\?uid=([A-Za-z0-9_\-]{4,64})/i);
        if (sensorMatch) setMcSensorId(sensorMatch[1]);
      }

      for (const f of files) {
        if (/\.(js|html|htm)$/i.test(f.path)) {
          const steps = parseSteps(f.content);
          if (steps.length > 0) { setMcSteps(steps); setMcStepsFile(f.path); break; }
        }
      }
    }
    await buildMcPreview(z);
  }, [buildMcPreview, clientData]);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!workingZip) return;
    setLoading(true);
    rebuildPreview(workingZip).then(() => setLoading(false));
    extractImages(workingZip).then(setImages);
    loadMiniChatData(workingZip);
    const slug = clientName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    setPubSiteName(slug);
    return () => {
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      if (mcBlobRef.current) { URL.revokeObjectURL(mcBlobRef.current); mcBlobRef.current = null; }
    };
  }, [workingZip, rebuildPreview, loadMiniChatData, clientName]);

  // ── Editor inline ──────────────────────────────────────────────────────
  const injectEditor = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    const win = iframeRef.current?.contentWindow as any;
    if (win?.__editorActive) return;
    const script = doc.createElement("script");
    script.textContent = EDITOR_SCRIPT;
    doc.body.appendChild(script);
  }, []);

  const removeEditor = useCallback(() => {
    const win = iframeRef.current?.contentWindow as any;
    if (typeof win?.__editorCleanup === "function") win.__editorCleanup();
  }, []);

  const sendToIframe = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (!d?.type) return;
      if (d.type === "select") {
        setSelectedType(d.elType);
        if (d.elType === "link" || d.elType === "button") {
          setLinkHref(d.info.href || "");
          setShowLinkEdit(true);
        } else { setShowLinkEdit(false); }
      } else if (d.type === "deselect") {
        setSelectedType(null); setShowLinkEdit(false);
      } else if (d.type === "html") {
        const safe = clientName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const blob = new Blob([d.content], { type: "text/html" });
        saveAs(blob, `site-${safe}-editado.html`);
        toast.success("HTML editado baixado!");
      } else if (d.type === "hasUndo") {
        setHasUndo(d.value);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [clientName]);

  const toggleEditMode = () => {
    if (editMode) {
      removeEditor(); setEditMode(false); setSelectedType(null); setShowLinkEdit(false); setHasUndo(false);
    } else {
      injectEditor(); setEditMode(true);
    }
  };

  const handleDownloadEdited = () => sendToIframe({ type: "getHTML" });
  const handleDeselect = () => sendToIframe({ type: "deselectAll" });
  const handleDelete = () => sendToIframe({ type: "delete" });
  const handleUndo = () => sendToIframe({ type: "undoDelete" });
  const handleFontColorChange = (color: string) => { setFontColor(color); sendToIframe({ type: "setColor", color }); };
  const handleBgColorChange = (color: string) => { setBgColor(color); sendToIframe({ type: "setBgColor", color }); };
  const handleApplyLink = () => { sendToIframe({ type: "setHref", href: linkHref }); setShowLinkEdit(false); toast.success("Link atualizado!"); };

  const handleImageFileForEditor = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => sendToIframe({ type: "replaceImage", dataUrl: ev.target?.result as string });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── Images tab ──────────────────────────────────────────────────────────
  const handleImageReplace = useCallback(async (path: string, file: File) => {
    if (!workingZip) return;
    toast.info("Atualizando preview...");
    const buf = await file.arrayBuffer();
    workingZip.file(path, buf);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImages((prev) => prev.map((img) => img.path === path ? { ...img, dataUrl } : img));
    };
    reader.readAsDataURL(file);
    await rebuildPreview(workingZip);
  }, [workingZip, rebuildPreview]);

  // ── Minichat tab ────────────────────────────────────────────────────────
  const handleMcApplyConfig = async () => {
    if (!workingZip) return;
    setMcSaving(true);
    const updated: McFile[] = [];
    for (const f of mcFiles) {
      let c = f.content;
      if (mcPhone) {
        c = c.replace(/(WHATSAPP_NUMBER\s*=\s*['"])([^'"]*?)(['"]\s*;?)/g, `$1${mcPhone}$3`);
        c = c.replace(/(wa\.me\/)(\+?[0-9]{8,15})/g, `$1${mcPhone}`);
        c = c.replace(/(["'])(\+?55[0-9]{10,11})(["'])/g, `$1${mcPhone}$3`);
      }
      if (mcBotName) {
        c = c.replace(/((?:BOT_NAME|botName|nome_bot)\s*=\s*['"])([^'"]*?)(['"])/g, `$1${mcBotName}$3`);
        c = c.replace(/<h3([^>]*)>[^<]*<\/h3>/gi, `<h3$1>${mcBotName}</h3>`);
      }
      if (mcSensorId) {
        c = c.replace(/(JP_OWNER_KEY\s*=\s*["'])([^"']*)(['"])/g, `$1${mcSensorId}$3`);
        c = c.replace(/(sensor\.js\?uid=)([A-Za-z0-9_\-]{4,64})/gi, `$1${mcSensorId}`);
      }
      workingZip.file(f.path, c);
      updated.push({ ...f, content: c });
    }
    setMcFiles(updated);
    if (activeMcPath) {
      const cur = updated.find((f) => f.path === activeMcPath);
      if (cur) setMcFileContent(cur.content);
    }
    for (const f of updated) {
      if (/\.(js|html|htm)$/i.test(f.path)) {
        const steps = parseSteps(f.content);
        if (steps.length > 0) { setMcSteps(steps); setMcStepsFile(f.path); break; }
      }
    }
    await buildMcPreview(workingZip);
    toast.success("Configuração aplicada!");
    setMcSaving(false);
  };

  const handleMcSaveSteps = async () => {
    if (!workingZip || !mcStepsFile || mcSteps.length === 0) return;
    setMcSaving(true);
    const file = mcFiles.find((f) => f.path === mcStepsFile);
    if (!file) { setMcSaving(false); return; }
    const newContent = serializeSteps(file.content, mcSteps);
    workingZip.file(mcStepsFile, newContent);
    setMcFiles((prev) => prev.map((f) => f.path === mcStepsFile ? { ...f, content: newContent } : f));
    if (activeMcPath === mcStepsFile) setMcFileContent(newContent);
    await buildMcPreview(workingZip);
    toast.success("Conversa salva!");
    setMcSaving(false);
  };

  const handleMcStepTextChange = (idx: number, text: string) => {
    setMcSteps((prev) => prev.map((s, i) => i === idx ? { ...s, text, message: text } : s));
  };

  const handleMcOptionChange = (stepIdx: number, optIdx: number, label: string) => {
    setMcSteps((prev) => prev.map((s, i) =>
      i !== stepIdx ? s : {
        ...s,
        options: s.options?.map((o, j) => j === optIdx ? { ...o, label, text: label } : o),
      }
    ));
  };

  // ── Publish ────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!workingZip) return;
    if (!VERCEL_TOKEN) { toast.error("Token Vercel não configurado (VITE_VERCEL_TOKEN)."); return; }
    setPubLoading(true); setPubError(null); setPubResult(null);
    try {
      const vercelUrl = await publishToVercel(workingZip, pubSiteName, VERCEL_TOKEN);
      const result: { vercel?: string; github?: string } = { vercel: vercelUrl };
      if (GH_TOKEN && GH_OWNER) {
        try {
          const ghUrl = await pushToGitHub(workingZip, pubSiteName, GH_TOKEN, GH_OWNER);
          result.github = ghUrl;
        } catch { /* GitHub push é opcional */ }
      }
      setPubResult(result);
      toast.success("Publicado com sucesso!");
    } catch (err: any) {
      setPubError(err?.message || "Erro ao publicar");
    } finally { setPubLoading(false); }
  };

  // ── Download ZIP ────────────────────────────────────────────────────────
  const handleDownloadZip = () => workingZip && downloadProject(workingZip, clientName);

  // ── Toolbar editor ─────────────────────────────────────────────────────
  const showImageReplace = selectedType === "image" || selectedType === "bgimage";

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-blue-50 border-b border-blue-200 text-sm shrink-0">
      <span className="text-xs font-medium text-blue-700 shrink-0">
        {selectedType
          ? `✏️ ${selectedType === "bgimage" ? "imagem de fundo" : selectedType}`
          : "Clique em qualquer elemento para editar"}
      </span>

      {/* Undo — always visible in edit mode */}
      <div className="h-4 w-px bg-blue-200" />
      <Button size="sm" variant="ghost" onClick={handleUndo}
        disabled={!hasUndo}
        className={`h-7 text-xs ${hasUndo ? "text-blue-600" : "text-blue-300"}`}
        title="Desfazer última ação">
        <Undo2 className="w-3.5 h-3.5 mr-1" /> Desfazer
      </Button>

      {selectedType && (
        <>
          <div className="h-4 w-px bg-blue-200" />
          <Button size="sm" variant="ghost" onClick={handleDeselect}
            className="h-7 w-7 p-0 text-blue-600" title="Desselecionar (Esc)">
            <X className="w-3.5 h-3.5" />
          </Button>

          {/* Text color — always shown for any selected element */}
          <label className="flex items-center gap-1 cursor-pointer" title="Cor do texto">
            <span className="text-xs text-blue-600">A</span>
            <input type="color" value={fontColor} onChange={(e) => handleFontColorChange(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border border-blue-200 p-0" />
          </label>

          {/* Background color — always shown for any selected element */}
          <label className="flex items-center gap-1 cursor-pointer" title="Cor de fundo">
            <Palette className="w-3.5 h-3.5 text-purple-500" />
            <input type="color" value={bgColor} onChange={(e) => handleBgColorChange(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border border-purple-200 p-0" />
          </label>

          {showImageReplace && (
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => fileInputRef.current?.click()}>
              {selectedType === "bgimage" ? "Trocar fundo" : "Trocar foto"}
            </Button>
          )}
          {showLinkEdit && (
            <div className="flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <Input value={linkHref} onChange={(e) => setLinkHref(e.target.value)}
                placeholder="https://..." className="h-7 text-xs w-36"
                onKeyDown={(e) => e.key === "Enter" && handleApplyLink()} />
              <Button size="sm" variant="outline" onClick={handleApplyLink}
                className="h-7 px-2 text-xs shrink-0">OK</Button>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={handleDelete}
            className="h-7 text-xs text-red-500 border-red-200 hover:bg-red-50">
            <Trash2 className="w-3 h-3 mr-1" /> Remover
          </Button>
        </>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Publish modal */}
      {showPublish && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Publicar site</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                onClick={() => { setShowPublish(false); setPubResult(null); setPubError(null); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            {pubResult ? (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
                <p className="text-green-800 font-medium text-sm">Publicado com sucesso!</p>
                {pubResult.vercel && (
                  <a href={pubResult.vercel} target="_blank" rel="noopener noreferrer"
                    className="block text-blue-600 underline text-sm break-all">{pubResult.vercel}</a>
                )}
                {pubResult.github && (
                  <a href={pubResult.github} target="_blank" rel="noopener noreferrer"
                    className="block text-blue-600 underline text-sm break-all">{pubResult.github}</a>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="pub-name">Nome do site</Label>
                    <Input id="pub-name" value={pubSiteName}
                      onChange={(e) => setPubSiteName(e.target.value)}
                      placeholder="ex: dr-claudio-plastica" />
                    <p className="text-xs text-muted-foreground">
                      Ficará em <strong>{pubSiteName || "nome-do-site"}.vercel.app</strong>
                    </p>
                  </div>
                  {pubError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      {pubError}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="ghost" onClick={() => { setShowPublish(false); setPubError(null); }}>
                    Cancelar
                  </Button>
                  <Button variant="hero" onClick={handlePublish} disabled={pubLoading || !pubSiteName}>
                    {pubLoading ? "Publicando..." : "🚀 Publicar"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">✅ Site gerado!</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
          </Button>
          {previewUrl && activeTab === "site" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setMobileView((v) => !v)} title={mobileView ? "Ver desktop" : "Ver mobile"}>
                {mobileView ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
              </Button>
              <Button
                variant="outline" size="sm" onClick={toggleEditMode}
                className={editMode ? "border-blue-500 text-blue-600 bg-blue-50" : ""}
              >
                <Pencil className="w-4 h-4 mr-1" />{editMode ? "Sair edição" : "Editar"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFullscreen((f) => !f)}>
                {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </>
          )}
          <Button variant="hero" size="sm"
            onClick={() => { setPubResult(null); setPubError(null); setShowPublish(true); }}>
            🚀 Publicar
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="w-4 h-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      {/* Toolbar editor (fora do fullscreen) */}
      {editMode && activeTab === "site" && !fullscreen && toolbar}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileForEditor} />

      {/* Tabs — só Site e Minichat */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["site", "minichat"] as PreviewTab[]).map((tab) => {
          const icons = { site: <Globe className="w-3.5 h-3.5" />, minichat: <MessageSquare className="w-3.5 h-3.5" /> };
          const labels = { site: "Site", minichat: "Minichat" };
          return (
            <button
              key={tab}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {icons[tab]} {labels[tab]}
              {tab === "minichat" && mcFiles.length > 0 && (
                <span className="ml-1 text-xs bg-green-100 text-green-700 rounded-full px-1.5">{mcFiles.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── TAB: SITE ── */}
      {activeTab === "site" && (
        <>
          {loading ? (
            <div className="border rounded-xl p-12 text-center bg-card">
              <p className="text-muted-foreground animate-pulse">Preparando preview...</p>
            </div>
          ) : previewUrl ? (
            <div className={`border rounded-xl overflow-hidden shadow-card bg-white ${fullscreen ? "fixed inset-0 z-50 rounded-none border-0 flex flex-col" : ""}`}>
              {fullscreen && (
                <div className="flex items-center justify-between px-3 py-2 border-b bg-white shrink-0">
                  <span className="text-sm font-medium truncate mr-2">Preview — {clientName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMobileView((v) => !v)}>
                      {mobileView ? <Monitor className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
                    </Button>
                    <Button variant="outline" size="sm"
                      className={`h-7 text-xs ${editMode ? "border-blue-400 text-blue-600" : ""}`}
                      onClick={toggleEditMode}>
                      {editMode ? "Sair edição" : <><Pencil className="w-3 h-3 mr-1" />Editar</>}
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFullscreen(false)}>Fechar</Button>
                  </div>
                </div>
              )}
              {editMode && fullscreen && toolbar}
              <div className={`bg-white ${fullscreen ? "flex-1 overflow-auto" : ""} ${mobileView ? "flex justify-center items-start bg-gray-100" : ""} ${mobileView && fullscreen ? "pt-6" : ""} ${mobileView && !fullscreen ? "py-4" : ""}`}>
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className={`border-0 ${mobileView ? "w-[390px] h-[844px] shadow-2xl rounded-2xl" : `w-full ${fullscreen ? "h-full" : "h-[600px]"}`}`}
                  title="Preview do site"
                  sandbox="allow-scripts allow-same-origin"
                  onLoad={() => { if (editMode) injectEditor(); }}
                />
              </div>
            </div>
          ) : (
            <div className="border rounded-xl p-12 text-center bg-card">
              <p className="text-muted-foreground">Nenhum index.html encontrado. Use o botão ZIP para baixar.</p>
            </div>
          )}

          {/* Imagens — accordion abaixo do preview */}
          {images.length > 0 && (
            <div className="border rounded-xl overflow-hidden">
              <button
                type="button"
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-semibold hover:bg-accent/50 transition-colors"
                onClick={() => setShowImages(!showImages)}
              >
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Trocar imagens ({images.length} imagens no projeto)
                </div>
                {showImages ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showImages && (
                <div className="border-t p-3">
                  <p className="text-xs text-muted-foreground mb-3">Clique em "Trocar" para substituir qualquer imagem do site.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {images.map((img) => (
                      <div key={img.path} className="border rounded-xl overflow-hidden bg-white shadow-sm flex flex-col">
                        <div className="bg-gray-50 flex items-center justify-center h-20">
                          <img src={img.dataUrl} alt={img.name} className="max-h-20 max-w-full object-contain" />
                        </div>
                        <div className="p-2 flex flex-col gap-1.5 flex-1">
                          <p className="text-xs text-muted-foreground truncate" title={img.path}>{img.name}</p>
                          <Button size="sm" variant="outline" className="h-7 text-xs w-full"
                            onClick={() => {
                              let input = imageInputRefs.current.get(img.path);
                              if (!input) {
                                input = document.createElement("input");
                                input.type = "file";
                                input.accept = "image/*";
                                input.style.display = "none";
                                input.addEventListener("change", async (e) => {
                                  const file = (e.target as HTMLInputElement).files?.[0];
                                  if (file) await handleImageReplace(img.path, file);
                                  input!.value = "";
                                });
                                document.body.appendChild(input);
                                imageInputRefs.current.set(img.path, input);
                              }
                              input.click();
                            }}
                          >
                            Trocar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Log de geração */}
          {logs.length > 0 && (
            <div className="border rounded-xl overflow-hidden">
              <button
                type="button"
                className="flex items-center justify-between w-full px-4 py-3 text-sm font-semibold hover:bg-accent/50 transition-colors"
                onClick={() => setShowLogs(!showLogs)}
              >
                <div className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4" />
                  Log de geração ({logs.length} eventos)
                </div>
                {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showLogs && (
                <div className="border-t bg-muted/30 p-3 max-h-48 overflow-y-auto">
                  {logs.map((log, i) => (
                    <p key={i} className={`text-xs font-mono py-0.5 ${
                      log.startsWith("⚠️") || log.startsWith("❌") ? "text-yellow-600 dark:text-yellow-400"
                      : log.startsWith("✅") ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground"
                    }`}>→ {log}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── TAB: MINICHAT ── */}
      {activeTab === "minichat" && (
        <div className="space-y-4">
          {mcFiles.length === 0 ? (
            <div className="border rounded-xl p-10 text-center bg-gray-50">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground text-sm">Nenhum arquivo Minichat detectado.</p>
              <p className="text-xs text-muted-foreground mt-1">
                O Minichat é detectado quando há uma pasta <code>minichat/</code> no projeto.
              </p>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 space-y-4 min-w-0">
                {/* Config */}
                <div className="border rounded-xl p-4 space-y-3 bg-white">
                  <p className="text-sm font-semibold">Configuração do bot</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>WhatsApp do bot</Label>
                      <Input placeholder="5511999998888" value={mcPhone} onChange={(e) => setMcPhone(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Nome do assistente</Label>
                      <Input placeholder="Assistente Virtual" value={mcBotName} onChange={(e) => setMcBotName(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">UID do Sensor JosephPay</Label>
                    <Input placeholder="Ex: abc123-uuid" value={mcSensorId} onChange={(e) => setMcSensorId(e.target.value)} className="font-mono text-sm" />
                    <p className="text-xs text-muted-foreground">Cole o UID do produtor no painel JosephPay</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleMcApplyConfig} disabled={mcSaving} className="flex items-center gap-1.5">
                    <RefreshCw className={`w-3.5 h-3.5 ${mcSaving ? "animate-spin" : ""}`} />
                    {mcSaving ? "Aplicando..." : "Salvar configuração"}
                  </Button>
                </div>

                {/* Editor de conversa */}
                {mcSteps.length > 0 && (
                  <div className="border rounded-xl overflow-hidden bg-white">
                    <div className="px-4 py-2.5 border-b bg-[#075E54]">
                      <p className="text-xs font-semibold text-white">Perguntas — {mcBotName || "Assistente"}</p>
                    </div>
                    <div className="bg-[#ECE5DD] p-4 space-y-4 max-h-[420px] overflow-y-auto">
                      {mcSteps.map((step, i) => {
                        const txt = step.text || step.message || "";
                        return (
                          <div key={step.id || i} className="space-y-2">
                            <div className="flex items-start gap-2 max-w-[85%]">
                              <div className="w-7 h-7 rounded-full bg-[#075E54] flex items-center justify-center shrink-0 mt-0.5">
                                <MessageSquare className="w-3.5 h-3.5 text-white" />
                              </div>
                              <div className="bg-white rounded-2xl rounded-tl-none px-3 py-2 shadow-sm flex-1">
                                <textarea
                                  value={txt}
                                  onChange={(e) => handleMcStepTextChange(i, e.target.value)}
                                  className="w-full text-sm bg-transparent border-none resize-none focus:outline-none leading-relaxed"
                                  rows={Math.max(2, Math.ceil(txt.length / 40))}
                                  placeholder="Mensagem do bot..."
                                />
                              </div>
                            </div>
                            {step.options && step.options.length > 0 && (
                              <div className="ml-9 flex flex-wrap gap-2">
                                {step.options.map((opt, j) => (
                                  <input
                                    key={j}
                                    value={opt.label || opt.text || ""}
                                    onChange={(e) => handleMcOptionChange(i, j, e.target.value)}
                                    className="bg-white border border-[#25D366] rounded-full px-3 py-1 text-xs text-[#075E54] font-medium focus:outline-none focus:ring-1 focus:ring-[#25D366] min-w-[60px]"
                                    style={{ width: `${Math.max(60, ((opt.label || opt.text || "").length + 2) * 8)}px` }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 py-2.5 border-t bg-gray-50 flex justify-end">
                      <Button size="sm" variant="hero" onClick={handleMcSaveSteps} disabled={mcSaving} className="flex items-center gap-1.5">
                        <Save className="w-3.5 h-3.5" />
                        {mcSaving ? "Salvando..." : "Salvar conversa"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Minichat */}
              {mcPreviewUrl && (
                <div className="shrink-0 lg:w-[300px]">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Preview do Minichat</p>
                  <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
                    <iframe
                      src={mcPreviewUrl}
                      className="w-full h-[540px] border-0"
                      title="Preview Minichat"
                      sandbox="allow-scripts allow-same-origin"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PreviewStep;
