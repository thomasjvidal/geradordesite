import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download, Maximize2, Minimize2, RotateCcw, Pencil, Trash2,
  Link2, Palette, ChevronLeft, X, Undo2, Smartphone, Monitor,
  MessageSquare, Image as ImageIcon, Globe, Save, RefreshCw,
} from "lucide-react";
import JSZip from "jszip";
import { useState, useEffect, useRef, useCallback } from "react";
import { buildPreviewHTML, extractImages, type ImageEntry, type ClientData } from "@/lib/site-processor";
import { publishToVercel, pushToGitHub } from "@/lib/publisher";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Embedded credentials — never exposed in UI
const EMBEDDED_VERCEL_TOKEN = (import.meta as any).env?.VITE_VERCEL_TOKEN || "";
const EMBEDDED_GH_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || "";

interface PreviewStepProps {
  zip: JSZip | null;
  clientName: string;
  clientData?: ClientData;
  onReset: () => void;
  onBack: () => void;
  sourceLabel?: string;
}

type PreviewTab = "site" | "minichat" | "images";

interface McFile { path: string; content: string; }

interface McStep {
  id?: string;
  text?: string;
  message?: string;
  options?: Array<{ label?: string; text?: string; value?: string; next?: string }>;
  type?: string;
  placeholder?: string;
}

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

  function findTarget(el) {
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

  function messageHandler(e) {
    var data = e.data;
    if (!data || !data.type) return;
    if (data.type === 'setColor' && selectedEl) {
      selectedEl.style.color = data.color;
    } else if (data.type === 'setBgColor' && selectedEl) {
      selectedEl.style.backgroundColor = data.color;
    } else if (data.type === 'setHref' && selectedEl) {
      selectedEl.setAttribute('href', data.href);
    } else if (data.type === 'delete' && selectedEl) {
      var toRemove = selectedEl;
      window.__undoStack.push({ el: toRemove, parent: toRemove.parentElement, next: toRemove.nextSibling });
      if (window.__undoStack.length > 10) window.__undoStack.shift();
      toRemove.remove();
      selectedEl = null;
      window.parent.postMessage({ type: 'deselect' }, '*');
      window.parent.postMessage({ type: 'hasUndo', value: true }, '*');
    } else if (data.type === 'replaceImage' && selectedEl) {
      if (selectedEl.tagName === 'IMG') {
        selectedEl.src = data.dataUrl;
      } else {
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
        if (action.next) action.parent.insertBefore(action.el, action.next);
        else action.parent.appendChild(action.el);
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

const MC_VAR_NAMES = ['steps', 'questions', 'messages', 'perguntas', 'flow', 'chatFlow', 'fluxo', 'etapas'];

function findMcArray(content: string): { startIdx: number; endIdx: number; varStart: number; varDecl: string } | null {
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
    return { startIdx, endIdx, varStart: m.index, varDecl: m[0] };
  }
  return null;
}

function parseSteps(content: string): McStep[] {
  const found = findMcArray(content);
  if (!found) return [];
  const arrayStr = content.substring(found.startIdx, found.endIdx + 1);
  try {
    const raw = (new Function(`return ${arrayStr}`) as () => any[])();
    return raw.map(item => ({
      ...item,
      options: item.options?.map((o: any) =>
        typeof o === 'string' ? { label: o, text: o } : o
      ),
    }));
  } catch { return []; }
}

function serializeSteps(content: string, steps: McStep[]): string {
  const found = findMcArray(content);
  if (!found) return content;
  const prefix = content.substring(0, found.varStart) + content.substring(found.varStart, found.startIdx);
  const suffix = content.substring(found.endIdx + 1);
  const toSerialize = steps.map(step => ({
    ...step,
    options: step.options?.map(o => {
      const keys = Object.keys(o).filter(k => (o as any)[k] !== undefined);
      const isSimple = keys.length <= 2 && keys.every(k => k === 'label' || k === 'text');
      return isSimple ? (o.label || o.text) : o;
    }),
  }));
  return prefix + JSON.stringify(toSerialize, null, 2) + suffix;
}

const PreviewStep = ({ zip, clientName, clientData, onReset, onBack, sourceLabel }: PreviewStepProps) => {
  const [workingZip, setWorkingZip] = useState<JSZip | null>(zip);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [linkHref, setLinkHref] = useState("");
  const [showLinkEdit, setShowLinkEdit] = useState(false);
  const [fontColor, setFontColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [hasUndo, setHasUndo] = useState(false);
  const [mobileView, setMobileView] = useState(false);

  const [activeTab, setActiveTab] = useState<PreviewTab>("site");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const imageInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Minichat state
  const [mcFiles, setMcFiles] = useState<McFile[]>([]);
  const [activeMcPath, setActiveMcPath] = useState<string>("");
  const [mcFileContent, setMcFileContent] = useState<string>("");
  const [mcPhone, setMcPhone] = useState("");
  const [mcBotName, setMcBotName] = useState("");
  const [mcSensorId, setMcSensorId] = useState("");
  const [mcSaving, setMcSaving] = useState(false);
  const [mcSteps, setMcSteps] = useState<McStep[]>([]);
  const [mcStepsFile, setMcStepsFile] = useState<string>("");
  const [mcPreviewUrl, setMcPreviewUrl] = useState<string | null>(null);

  // Publish state — tokens come from env vars, never shown to user
  const [showPublish, setShowPublish] = useState(false);
  const [pubSiteName, setPubSiteName] = useState("");
  const [pubLoading, setPubLoading] = useState(false);
  const [pubResult, setPubResult] = useState<{ vercel?: string; github?: string } | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);

  const blobUrlRef = useRef<string | null>(null);
  const mcPreviewBlobRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUrlImport = sourceLabel?.startsWith("http");

  useEffect(() => { setWorkingZip(zip); }, [zip]);

  const githubSource = sourceLabel?.includes("github.com") ? sourceLabel : undefined;

  const rebuildPreview = useCallback(async (z: JSZip) => {
    const html = await buildPreviewHTML(z, githubSource, true);
    if (html) {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPreviewUrl(url);
    }
  }, [githubSource]);

  const buildMcPreview = useCallback(async (z: JSZip) => {
    // Find minichat index.html
    const mcPaths = Object.keys(z.files).filter(
      (f) => !z.files[f].dir && f.toLowerCase().includes("minichat")
    );
    const indexPath = mcPaths.find(
      (f) => f.toLowerCase().endsWith("index.html") || f.toLowerCase().endsWith("index.htm")
    );
    if (!indexPath) return;

    // Build sub-zip with minichat files, stripping the folder prefix
    const prefix = indexPath.includes("/")
      ? indexPath.substring(0, indexPath.lastIndexOf("/") + 1)
      : "";
    const subZip = new JSZip();
    for (const path of Object.keys(z.files)) {
      if (z.files[path].dir) continue;
      const inFolder = prefix ? path.startsWith(prefix) : mcPaths.includes(path);
      if (!inFolder) continue;
      const newPath = prefix ? path.substring(prefix.length) : path;
      if (!newPath) continue;
      try {
        const content = await z.files[path].async("arraybuffer");
        subZip.file(newPath, content);
      } catch { /* skip */ }
    }

    const html = await buildPreviewHTML(subZip);
    if (html) {
      if (mcPreviewBlobRef.current) URL.revokeObjectURL(mcPreviewBlobRef.current);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      mcPreviewBlobRef.current = url;
      setMcPreviewUrl(url);
    }
  }, []);

  const loadMiniChatData = useCallback(async (z: JSZip) => {
    const files: McFile[] = [];
    for (const path of Object.keys(z.files)) {
      if (z.files[path].dir) continue;
      if (!path.toLowerCase().includes("minichat")) continue;
      const ext = path.split(".").pop()?.toLowerCase() || "";
      if (!["js", "json", "html", "htm", "css", "txt", "php"].includes(ext)) continue;
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

      // Phone — client data takes priority, then detect from template
      if (clientData?.whatsapp || clientData?.minichatWhatsapp) {
        setMcPhone(((clientData.minichatWhatsapp || clientData.whatsapp) ?? "").replace(/\D/g, ""));
      } else {
        const waConst = allText.match(/WHATSAPP_NUMBER\s*[=:]\s*['"]([0-9+\s\-()]{8,20})['"]/i);
        const phoneMatch = waConst || allText.match(/(\+?55\d{10,11})/);
        if (phoneMatch) setMcPhone(phoneMatch[1].replace(/\D/g, ""));
      }

      // Bot name — client data takes priority, then JS variable, then <h3>
      if (clientData?.minichatBotName || clientData?.name) {
        setMcBotName((clientData.minichatBotName || clientData.name) ?? "");
      } else {
        const nameVarMatch = allText.match(
          /(?:BOT_NAME|botName|nome_bot|assistente)\s*[=:]\s*['"]([^'"]{2,50})['"]/i
        );
        const nameH3Match = !nameVarMatch ? allText.match(/<h3[^>]*>([^<]{2,50})<\/h3>/i) : null;
        const nameMatch = nameVarMatch || nameH3Match;
        if (nameMatch) setMcBotName(nameMatch[1]);
      }

      // JosephPay sensor UID — client data takes priority
      if (clientData?.josephPayId) {
        setMcSensorId(clientData.josephPayId);
      } else {
        const jpKeyMatch = allText.match(/JP_OWNER_KEY\s*=\s*['"]([A-Za-z0-9_\-]{4,64})['"]/i);
        const sensorUrlMatch = allText.match(/sensor\.js\?uid=([A-Za-z0-9_\-]{4,64})/i);
        const sensorGenMatch = allText.match(
          /(?:sensor_id|josephpay_id|uid)\s*[=:]\s*['"]?([A-Za-z0-9_\-]{4,64})['"]?/i
        );
        const sensorMatch = jpKeyMatch || sensorUrlMatch || sensorGenMatch;
        if (sensorMatch) setMcSensorId(sensorMatch[1]);
      }

      // Parse conversation steps
      for (const f of files) {
        if (/\.(js|html|htm)$/i.test(f.path)) {
          const steps = parseSteps(f.content);
          if (steps.length > 0) {
            setMcSteps(steps);
            setMcStepsFile(f.path);
            break;
          }
        }
      }
    }
    await buildMcPreview(z);
  }, [buildMcPreview, clientData]);

  useEffect(() => {
    if (!workingZip) return;
    setLoading(true);
    rebuildPreview(workingZip).then(() => setLoading(false));
    extractImages(workingZip).then(setImages);
    loadMiniChatData(workingZip);
    return () => {
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      if (mcPreviewBlobRef.current) { URL.revokeObjectURL(mcPreviewBlobRef.current); mcPreviewBlobRef.current = null; }
    };
  }, [workingZip, rebuildPreview, loadMiniChatData]);

  useEffect(() => {
    const slug = clientName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    setPubSiteName(slug);
  }, [clientName]);

  const injectEditor = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.body) return;
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
      const data = e.data;
      if (!data?.type) return;
      if (data.type === "select") {
        setSelectedType(data.elType);
        if (data.elType === "link" || data.elType === "button") {
          setLinkHref(data.info.href || "");
          setShowLinkEdit(true);
        } else { setShowLinkEdit(false); }
      } else if (data.type === "deselect") {
        setSelectedType(null); setShowLinkEdit(false);
      } else if (data.type === "html") {
        const safe = clientName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const blob = new Blob([data.content], { type: "text/html" });
        saveAs(blob, `site-${safe}-editado.html`);
        toast.success("HTML editado baixado!");
      } else if (data.type === "hasUndo") {
        setHasUndo(data.value);
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
  const handleColorChange = (color: string) => { setFontColor(color); sendToIframe({ type: "setColor", color }); };
  const handleBgColorChange = (color: string) => { setBgColor(color); sendToIframe({ type: "setBgColor", color }); };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => sendToIframe({ type: "replaceImage", dataUrl: ev.target?.result as string });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleApplyLink = () => {
    sendToIframe({ type: "setHref", href: linkHref });
    setShowLinkEdit(false);
    toast.success("Link atualizado!");
  };

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

  // Minichat: save raw file and rebuild previews
  const handleMcSaveFile = async () => {
    if (!workingZip || !activeMcPath) return;
    setMcSaving(true);
    workingZip.file(activeMcPath, mcFileContent);
    setMcFiles((prev) =>
      prev.map((f) => f.path === activeMcPath ? { ...f, content: mcFileContent } : f)
    );
    if (activeMcPath === mcStepsFile) {
      const steps = parseSteps(mcFileContent);
      if (steps.length > 0) setMcSteps(steps);
    }
    await rebuildPreview(workingZip);
    await buildMcPreview(workingZip);
    toast.success("Arquivo salvo!");
    setMcSaving(false);
  };

  // Minichat: save conversation steps back to file
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

  const handleMcStepTextChange = (stepIdx: number, newText: string) => {
    setMcSteps((prev) =>
      prev.map((s, i) => i === stepIdx ? { ...s, text: newText, message: newText } : s)
    );
  };

  const handleMcOptionChange = (stepIdx: number, optIdx: number, newLabel: string) => {
    setMcSteps((prev) =>
      prev.map((s, i) =>
        i !== stepIdx ? s : {
          ...s,
          options: s.options?.map((o, j) =>
            j === optIdx ? { ...o, label: newLabel, text: newLabel } : o
          ),
        }
      )
    );
  };

  // Minichat: apply phone/name/sensor config across all files
  const handleMcApplyConfig = async () => {
    if (!workingZip) return;
    setMcSaving(true);
    const updated: McFile[] = [];
    for (const f of mcFiles) {
      let c = f.content;

      if (mcPhone) {
        // WHATSAPP_NUMBER = "..."
        c = c.replace(/(WHATSAPP_NUMBER\s*=\s*['"])([^'"]*?)(['"])/g, `$1${mcPhone}$3`);
        // wa.me/NUMBER
        c = c.replace(/(wa\.me\/)(\+?[0-9]{8,15})/g, `$1${mcPhone}`);
        // +55 numbers in strings
        c = c.replace(/(["'])(\+?55[0-9]{10,11})(["'])/g, `$1${mcPhone}$3`);
      }

      if (mcBotName) {
        // JS variable
        c = c.replace(
          /((?:BOT_NAME|botName|nome_bot)\s*=\s*['"])([^'"]*?)(['"])/g,
          `$1${mcBotName}$3`
        );
        // H3 tag in MiniChat chat header
        c = c.replace(/<h3([^>]*)>[^<]*<\/h3>/gi, `<h3$1>${mcBotName}</h3>`);
      }

      if (mcSensorId) {
        // JP_OWNER_KEY constant (JosephPay producer UUID)
        c = c.replace(
          /(JP_OWNER_KEY\s*=\s*["'])([^"']*)(['"])/g,
          `$1${mcSensorId}$3`
        );
        // sensor.js?uid=UUID in script tags
        c = c.replace(
          /(sensor\.js\?uid=)([A-Za-z0-9_\-]{4,64})/gi,
          `$1${mcSensorId}`
        );
        // fallback: sensor_id / josephpay_id / uid references
        c = c.replace(
          /((?:sensor_id|josephpay_id|uid)\s*[=:]\s*['"]?)([A-Za-z0-9_\-]{4,64})(['"]?)/gi,
          `$1${mcSensorId}$3`
        );
      }

      workingZip.file(f.path, c);
      updated.push({ ...f, content: c });
    }
    setMcFiles(updated);
    if (activeMcPath) {
      const cur = updated.find((f) => f.path === activeMcPath);
      if (cur) setMcFileContent(cur.content);
    }
    // Re-parse steps after config update
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

  const handlePublish = async () => {
    if (!workingZip) return;
    const vercelToken = EMBEDDED_VERCEL_TOKEN;
    if (!vercelToken) {
      toast.error("Publicação não disponível. Contate o suporte.");
      return;
    }
    setPubLoading(true); setPubError(null); setPubResult(null);
    try {
      const vercelUrl = await publishToVercel(workingZip, pubSiteName, vercelToken);
      const result: { vercel?: string; github?: string } = { vercel: vercelUrl };
      if (EMBEDDED_GH_TOKEN) {
        try {
          const ghUrl = await pushToGitHub(workingZip, pubSiteName, EMBEDDED_GH_TOKEN, "thomasjvidal");
          result.github = ghUrl;
        } catch { /* GitHub push is optional */ }
      }
      setPubResult(result);
      toast.success("Publicado com sucesso!");
    } catch (err: any) {
      setPubError(err?.message || "Erro ao publicar");
    } finally { setPubLoading(false); }
  };

  const showTextColor = selectedType === "text" || selectedType === "link" || selectedType === "button";
  const showBgColor = selectedType === "block" || selectedType === "bgimage";
  const showImageReplace = selectedType === "image" || selectedType === "bgimage";

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-blue-50 border-b border-blue-200 text-sm shrink-0">
      <span className="text-xs font-medium text-blue-700 shrink-0">
        {selectedType
          ? `✏️ ${selectedType === "bgimage" ? "imagem de fundo" : selectedType}`
          : "Clique em qualquer elemento"}
      </span>
      {selectedType && (
        <>
          <div className="h-4 w-px bg-blue-200" />
          <Button size="sm" variant="ghost" onClick={handleDeselect}
            className="h-7 w-7 p-0 text-blue-600" title="Desselecionar (Esc)">
            <X className="w-3.5 h-3.5" />
          </Button>
          {showTextColor && (
            <label className="flex items-center gap-1 cursor-pointer" title="Cor do texto">
              <Palette className="w-3.5 h-3.5 text-blue-600" />
              <input type="color" value={fontColor} onChange={(e) => handleColorChange(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-blue-200 p-0" />
            </label>
          )}
          {showBgColor && (
            <label className="flex items-center gap-1 cursor-pointer" title="Cor de fundo">
              <Palette className="w-3.5 h-3.5 text-purple-600" />
              <input type="color" value={bgColor} onChange={(e) => handleBgColorChange(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border border-purple-200 p-0" />
            </label>
          )}
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
      {hasUndo && (
        <>
          <div className="h-4 w-px bg-blue-200" />
          <Button size="sm" variant="ghost" onClick={handleUndo} className="h-7 text-xs text-blue-600">
            <Undo2 className="w-3.5 h-3.5 mr-1" /> Desfazer
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Publish modal — no token fields, uses embedded credentials */}
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
                      O site ficará em <strong>{pubSiteName || "nome-do-site"}.vercel.app</strong>
                    </p>
                  </div>
                  {pubError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      {pubError}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="ghost"
                    onClick={() => { setShowPublish(false); setPubError(null); }}>
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
        <h3 className="text-lg font-semibold text-foreground">Site gerado!</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
          </Button>
          {previewUrl && activeTab === "site" && (
            <>
              <Button variant="outline" size="sm"
                onClick={() => setMobileView((v) => !v)}
                className={cn(mobileView && "border-indigo-400 text-indigo-600 bg-indigo-50")}>
                {mobileView ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={toggleEditMode}
                className={cn(editMode && "border-blue-500 text-blue-600 bg-blue-50")}>
                <Pencil className="w-4 h-4 mr-1" />{editMode ? "Sair da edição" : "Editar"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFullscreen((f) => !f)}>
                {fullscreen
                  ? <><Minimize2 className="w-4 h-4 mr-1" />Minimizar</>
                  : <><Maximize2 className="w-4 h-4 mr-1" />Tela cheia</>}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm"
            onClick={() => { setPubResult(null); setPubError(null); setShowPublish(true); }}>
            Publicar
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="w-4 h-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      {isUrlImport && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          Site importado por URL — use <strong>Editar</strong> para ajustar os textos manualmente.
        </div>
      )}

      {editMode && activeTab === "site" && !fullscreen && toolbar}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "site" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("site")}
        >
          <Globe className="w-3.5 h-3.5" /> Site
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "minichat" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("minichat")}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Minichat
          {mcFiles.length > 0 && (
            <span className="ml-1 text-xs bg-green-100 text-green-700 rounded-full px-1.5">
              {mcFiles.length}
            </span>
          )}
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "images" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("images")}
        >
          <ImageIcon className="w-3.5 h-3.5" /> Imagens ({images.length})
        </button>
      </div>

      {/* ── SITE TAB ── */}
      {activeTab === "site" && (
        <>
          {loading ? (
            <div className="border rounded-xl p-12 text-center bg-card">
              <p className="text-muted-foreground animate-pulse">Preparando preview...</p>
            </div>
          ) : previewUrl ? (
            <div className={cn(
              "border rounded-xl overflow-hidden shadow-card bg-white",
              fullscreen && "fixed inset-0 z-50 rounded-none border-0 flex flex-col"
            )}>
              <div className={cn(
                "flex items-center justify-between px-3 py-2 border-b bg-white shrink-0",
                !fullscreen && "hidden"
              )}>
                <span className="text-sm font-medium text-foreground truncate mr-2">
                  Preview — {clientName}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMobileView((v) => !v)}>
                    {mobileView ? <Monitor className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
                  </Button>
                  {!editMode ? (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={toggleEditMode}>
                      <Pencil className="w-3 h-3 mr-1" /> Editar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm"
                      className="h-7 text-xs border-blue-400 text-blue-600" onClick={toggleEditMode}>
                      Sair da edição
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFullscreen(false)}>
                    Fechar
                  </Button>
                </div>
              </div>
              <div className={cn((!editMode || !fullscreen) && "hidden")}>
                {toolbar}
              </div>
              <div className={cn(
                "bg-white",
                fullscreen && "flex-1 overflow-auto",
                mobileView && "flex justify-center items-start bg-gray-100",
                mobileView && fullscreen && "pt-6",
                mobileView && !fullscreen && "py-4"
              )}>
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className={cn(
                    "border-0",
                    mobileView
                      ? "w-[390px] h-[844px] shadow-2xl rounded-2xl"
                      : cn("w-full", fullscreen ? "h-full" : "h-[50vh] min-h-[300px] sm:h-[600px]")
                  )}
                  title="Preview do site"
                  sandbox="allow-scripts allow-same-origin"
                  onLoad={() => { if (editMode) injectEditor(); }}
                />
              </div>
            </div>
          ) : (
            <div className="border rounded-xl p-12 text-center bg-card">
              <p className="text-muted-foreground">Nenhum index.html encontrado no projeto.</p>
            </div>
          )}
        </>
      )}

      {/* ── MINICHAT TAB ── */}
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
              {/* Left column: config + conversation editor */}
              <div className="flex-1 space-y-4 min-w-0">
                {/* Config */}
                <div className="border rounded-xl p-4 space-y-3 bg-white">
                  <p className="text-sm font-semibold text-foreground">Configuração</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-phone">WhatsApp do bot</Label>
                      <Input id="mc-phone" placeholder="5511999998888" value={mcPhone}
                        onChange={(e) => setMcPhone(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-name">Nome do assistente</Label>
                      <Input id="mc-name" placeholder="Ex: Assistente Virtual" value={mcBotName}
                        onChange={(e) => setMcBotName(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-sensor" className="text-xs font-medium">
                      UID do Sensor JosephPay
                    </Label>
                    <Input id="mc-sensor" placeholder="Ex: abc123-uuid" value={mcSensorId}
                      onChange={(e) => setMcSensorId(e.target.value)} className="text-sm font-mono" />
                    <p className="text-xs text-muted-foreground">
                      Cole o UID do produtor no painel JosephPay (campo "uid" do sensor.js)
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleMcApplyConfig} disabled={mcSaving}
                    className="flex items-center gap-1.5">
                    <RefreshCw className={cn("w-3.5 h-3.5", mcSaving && "animate-spin")} />
                    {mcSaving ? "Atualizando..." : "Salvar configuração"}
                  </Button>
                </div>

                {/* Conversation editor */}
                {mcSteps.length > 0 ? (
                  <div className="border rounded-xl overflow-hidden bg-white">
                    <div className="px-4 py-2.5 border-b bg-[#075E54]">
                      <p className="text-xs font-semibold text-white">
                        Perguntas — {mcBotName || "Assistente"}
                      </p>
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
                                {step.type && (
                                  <span className="text-xs text-muted-foreground mt-1 block">
                                    tipo: {step.type}
                                  </span>
                                )}
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
                      <Button size="sm" variant="hero" onClick={handleMcSaveSteps} disabled={mcSaving}
                        className="flex items-center gap-1.5">
                        <Save className="w-3.5 h-3.5" />
                        {mcSaving ? "Salvando..." : "Salvar conversa"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border rounded-xl p-6 text-center bg-white text-muted-foreground text-sm">
                    Nenhuma conversa encontrada neste MiniChat.
                  </div>
                )}
              </div>

              {/* Right column: live preview */}
              {mcPreviewUrl && (
                <div className="shrink-0 lg:w-[300px]">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Preview</p>
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

      {/* ── IMAGES TAB ── */}
      {activeTab === "images" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground text-center py-8">
              Nenhuma imagem encontrada no projeto.
            </p>
          )}
          {images.map((img) => (
            <div key={img.path} className="border rounded-xl overflow-hidden bg-white shadow-sm flex flex-col">
              <div className="bg-gray-50 flex items-center justify-center h-24">
                <img src={img.dataUrl} alt={img.name} className="max-h-24 max-w-full object-contain" />
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
      )}
    </div>
  );
};

export default PreviewStep;
