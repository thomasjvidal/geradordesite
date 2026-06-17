import JSZip from "jszip";
import { saveAs } from "file-saver";
import { tagHtmlForAI, rewriteWithAI, applyAIToTaggedHtml, applyAIToDataSettings, applyReplacements } from "./groq-ai";

export interface ClientData {
  name: string;
  oldClientName: string;
  area: string;
  description: string;
  city: string;
  oldCity: string;
  whatsapp: string;
  oldPhone: string;
  colors: string;
  originalColors: string;
  colors2: string;
  originalColors2: string;
  groqApiKey: string;
  images: File[];
  minichatWhatsapp?: string;
  minichatBotName?: string;
  josephPayId?: string;
}

export interface ImageEntry {
  path: string;
  name: string;
  dataUrl: string;
  mime: string;
}

export interface MinichatInfo {
  detected: boolean;
  whatsapp: string;
  botName: string;
}

const COLOR_MAP: Record<string, string> = {
  azul:"#2196F3",blue:"#2196F3",vermelho:"#F44336",red:"#F44336",
  verde:"#4CAF50",green:"#4CAF50",amarelo:"#FFEB3B",yellow:"#FFEB3B",
  rosa:"#E91E63",pink:"#E91E63",roxo:"#9C27B0",purple:"#9C27B0",
  laranja:"#FF9800",orange:"#FF9800",preto:"#212121",black:"#212121",
  branco:"#FFFFFF",white:"#FFFFFF",cinza:"#9E9E9E",gray:"#9E9E9E",
  marrom:"#795548",brown:"#795548",dourado:"#FFD700",gold:"#FFD700",
  bordo:"#800020",bege:"#F5F5DC",coral:"#FF7F50",nude:"#E3BC9A",
  lilas:"#C8A2C8",turquesa:"#40E0D0",
};

function parseColors(s: string): string[] {
  if (!s?.trim()) return [];
  const hex = s.match(/#[0-9a-fA-F]{3,8}/g);
  if (hex?.length) return hex;
  return s.toLowerCase().split(/[,;]+/).map(c=>c.trim()).filter(Boolean)
    .map(c=>COLOR_MAP[c]||c).filter(c=>/^#[0-9a-fA-F]{3,8}$/.test(c));
}

/** Replace old client text with new client text */
function smartReplaceOldClient(content: string, data: ClientData): string {
  const oldName = data.oldClientName?.trim();
  const newName = data.name?.trim();
  if (!oldName || !newName) return content;

  content = replaceAll(content, oldName, newName);
  content = replaceAll(content, oldName.toUpperCase(), newName.toUpperCase());
  content = replaceAll(content, oldName.toLowerCase(), newName.toLowerCase());

  for (const t of ["Dra.","Dr.","DRA.","DR.","Prof.","PROF."]) {
    content = replaceAll(content, `${t} ${oldName}`, `${t} ${newName}`);
    content = replaceAll(content, `${t} ${oldName.toUpperCase()}`, `${t} ${newName.toUpperCase()}`);
  }

  const oldSlug = oldName.toLowerCase().replace(/\s+/g, "-");
  const newSlug = newName.toLowerCase().replace(/\s+/g, "-");
  content = replaceAll(content, oldSlug, newSlug);
  content = replaceAll(content, oldName.toLowerCase().replace(/\s+/g, "_"), newName.toLowerCase().replace(/\s+/g, "_"));

  const oldParts = oldName.split(/\s+/);
  const newParts = newName.split(/\s+/);
  if (oldParts[0].length >= 4) {
    content = replaceAll(content, oldParts[0], newParts[0] || newName);
    content = replaceAll(content, oldParts[0].toUpperCase(), (newParts[0] || newName).toUpperCase());
  }

  if (oldParts.length > 1 && newParts.length > 1 && oldParts[oldParts.length-1].length >= 4) {
    content = replaceAll(content, oldParts[oldParts.length-1], newParts[newParts.length-1]);
    content = replaceAll(content, oldParts[oldParts.length-1].toUpperCase(), newParts[newParts.length-1].toUpperCase());
  }

  if (data.oldCity?.trim() && data.city?.trim()) {
    content = replaceAll(content, data.oldCity.trim(), data.city.trim());
    content = replaceAll(content, data.oldCity.trim().toUpperCase(), data.city.trim().toUpperCase());
  }

  if (data.oldPhone?.trim() && data.whatsapp?.trim()) {
    const oldP = data.oldPhone.trim();
    const newP = data.whatsapp.trim();
    const oldClean = oldP.replace(/\D/g, "");
    const newClean = newP.replace(/\D/g, "");
    content = replaceAll(content, oldP, newP);
    if (oldClean.length >= 8) content = replaceAll(content, oldClean, newClean);
    content = content.replace(new RegExp(`wa\\.me\\/${oldClean}`, "gi"), `wa.me/${newClean}`);
    content = content.replace(new RegExp(`phone=${oldClean}`, "gi"), `phone=${newClean}`);
  }

  return content;
}

function replaceAll(s: string, find: string, rep: string): string {
  if (!find) return s;
  return s.split(find).join(rep);
}

function replaceTextPlaceholders(text: string, data: ClientData): string {
  const fields: [string[], string][] = [
    [["nome","name","cliente","empresa"], data.name],
    [["area","atuacao","segmento","especialidade"], data.area],
    [["descricao","description","servicos","sobre"], data.description],
    [["cidade","city","local","regiao"], data.city],
    [["whatsapp","telefone","phone","celular","contato","tel"], data.whatsapp],
  ];
  let r = text;
  for (const [keys, val] of fields) {
    if (!val) continue;
    for (const k of keys) {
      for (const p of [
        new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`,"gi"),
        new RegExp(`\\{\\s*${k}\\s*\\}`,"gi"),
        new RegExp(`\\[\\s*${k}\\s*\\]`,"gi"),
        new RegExp(`%\\s*${k}\\s*%`,"gi"),
        new RegExp(`__${k}__`,"gi"),
      ]) r = r.replace(p, val);
    }
  }
  return r;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const l = (max+min)/2;
  if (max===min) return [0,0,l];
  const d = max-min;
  const s = l>0.5 ? d/(2-max-min) : d/(max+min);
  let h = 0;
  if (max===r) h = ((g-b)/d + (g<b?6:0))/6;
  else if (max===g) h = ((b-r)/d + 2)/6;
  else h = ((r-g)/d + 4)/6;
  return [h*360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h%360)+360)%360;
  const hh = h/360;
  const q = l<0.5 ? l*(1+s) : l+s-l*s;
  const p = 2*l-q;
  const toC = (t: number) => {
    if (t<0) t+=1; if (t>1) t-=1;
    if (t<1/6) return p+(q-p)*6*t;
    if (t<1/2) return q;
    if (t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  };
  const r = Math.round(toC(hh+1/3)*255);
  const g = Math.round(toC(hh)*255);
  const b = Math.round(toC(hh-1/3)*255);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

function hueDiff(a: number, b: number): number {
  const d = Math.abs(a-b) % 360;
  return d > 180 ? 360-d : d;
}

function isNeutral(hex: string): boolean {
  const [, s, l] = hexToHsl(hex);
  if (l > 0.80) return true;  // near-white / very light — NEVER touch
  if (l < 0.08) return true;  // near-black
  if (s < 0.12) return true;  // near-gray / unsaturated
  return false;
}

function replaceElementorColorVars(content: string, origHex: string, destHex: string): string {
  // Replace Elementor CSS variables: --e-global-color-*: #hex
  let r = content;
  const varRx = /(--e-global-color-[^:]+:\s*)(#[0-9a-fA-F]{6})/gi;
  r = r.replace(varRx, (_m, varName, hexVal) => {
    try {
      const [oh] = hexToHsl(origHex);
      const [vh] = hexToHsl(hexVal);
      if (hueDiff(oh, vh) <= 40) return varName + destHex;
    } catch { /* skip */ }
    return _m;
  });
  // Also replace inside data-settings JSON (Elementor widget settings)
  r = r.replace(/(["']__globals__["'][\s\S]{0,200}?["']color["'][\s\S]{0,100}?["'])(#[0-9a-fA-F]{6})(["'])/gi,
    (_m, pre, hexVal, post) => {
      try {
        const [oh] = hexToHsl(origHex);
        const [vh] = hexToHsl(hexVal);
        if (hueDiff(oh, vh) <= 40) return pre + destHex + post;
      } catch { /* skip */ }
      return _m;
    }
  );
  return r;
}

function replaceColors(content: string, newC: string[], origC: string[]): string {
  if (!newC.length || !origC.length) return content;
  let r = content;

  for (let ci = 0; ci < origC.length; ci++) {
    const orig = origC[ci];
    const dest = newC[ci] || newC[0];

    // Skip if the user selected a neutral color as original — nothing to do
    if (isNeutral(orig)) continue;

    const [origH, , ] = hexToHsl(orig);
    const [destH, , ] = hexToHsl(dest);

    // Also replace Elementor CSS variables (--e-global-color-*)
    r = replaceElementorColorVars(r, orig, dest);

    // Collect all hex values in the content
    const allHex = [...new Set(r.match(/#[0-9a-fA-F]{6}\b/gi) || [])];
    for (const hex of allHex) {
      if (isNeutral(hex)) continue;
      const [h, s, l] = hexToHsl(hex);
      if (hueDiff(h, origH) > 35) continue;
      const newHex = hslToHex(destH, s, l);
      r = r.split(hex).join(newHex);
      r = r.split(hex.toUpperCase()).join(newHex);
    }
  }

  return r;
}

const IMG_EXT = /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i;
const TXT_EXT = /\.(html|htm|css|js|json|txt|xml|php|scss|sass|less)$/i;

/** Scan all CSS/HTML files in ZIP and return the most-used non-neutral color hex */
async function detectDominantColor(files: string[], zip: JSZip): Promise<string | null> {
  const counts = new Map<string, number>(); // hex → count (normalized to lowercase)
  const cssHtmlFiles = files.filter(f => !zip.files[f].dir && /\.(css|html|htm)$/i.test(f));

  for (const path of cssHtmlFiles.slice(0, 20)) { // limit to avoid slowness
    try {
      const text = await zip.files[path].async("string");
      const matches = text.match(/#[0-9a-fA-F]{6}\b/g) || [];
      for (const hex of matches) {
        const h = hex.toLowerCase();
        if (isNeutral(h)) continue;
        counts.set(h, (counts.get(h) || 0) + 1);
      }
    } catch { /* skip unreadable files */ }
  }

  if (counts.size === 0) return null;

  // Group by hue family (±30°) and sum counts
  type HueGroup = { hue: number; total: number; best: string; bestCount: number };
  const groups: HueGroup[] = [];

  for (const [hex, cnt] of counts) {
    const [h] = hexToHsl(hex);
    const existing = groups.find(g => hueDiff(g.hue, h) <= 30);
    if (existing) {
      existing.total += cnt;
      if (cnt > existing.bestCount) { existing.best = hex; existing.bestCount = cnt; }
    } else {
      groups.push({ hue: h, total: cnt, best: hex, bestCount: cnt });
    }
  }

  if (groups.length === 0) return null;
  groups.sort((a, b) => b.total - a.total);
  return groups[0].best;
}

// ── AI: detect existing site info (site-factory approach) ──────────────────
async function groqDetectSiteInfo(
  html: string, key: string
): Promise<{ name?: string; phone?: string; city?: string; service?: string }> {
  if (!key) return {};
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 3000);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content:
          `From this website text, extract the professional or business info. Return ONLY a JSON object with: name (full professional name), phone (digits only), city, service (main specialty). Omit missing fields.\n\nText:\n${text}` }],
        max_tokens: 200, temperature: 0,
      }),
    });
    if (!res.ok) return {};
    const d = await res.json();
    const raw: string = d.choices?.[0]?.message?.content || "{}";
    const m = raw.match(/\{[\s\S]*?\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch { return {}; }
}

// ── AI: rewrite text blocks for new professional ───────────────────────────
async function groqRewriteSiteBlocks(
  html: string,
  data: ClientData,
  existing: { name?: string; service?: string; city?: string },
  key: string
): Promise<Array<{ old: string; new: string }>> {
  if (!key) return [];
  const blocks: string[] = [];
  const tagRx = /<(h[1-3]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = tagRx.exec(html)) !== null) {
    const t = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t.length >= 15 && t.length <= 400 && !blocks.includes(t)) blocks.push(t);
    if (blocks.length >= 25) break;
  }
  if (!blocks.length) return [];

  const ctx = `Template atual: profissional="${existing.name||"?"}", área="${existing.service||"?"}", cidade="${existing.city||"?"}".
Novo cliente: nome="${data.name}", área="${data.area}"${data.city ? `, cidade="${data.city}"` : ""}${data.description ? `, serviços="${data.description}"` : ""}.`;

  const prompt = `${ctx}

Textos do site (numerados):
${blocks.map((b,i) => `${i+1}. "${b}"`).join("\n")}

Reescreva EM PORTUGUÊS os textos que mencionam o profissional antigo, área, cidade ou serviços antigos — adaptando para o novo cliente. Retorne SOMENTE JSON válido: [{"i": número, "new": "texto reescrito"}]. Máximo 15 itens. Não inclua textos genéricos que não precisam mudar.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200, temperature: 0.3,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content || "[]";
    const arr = raw.match(/\[[\s\S]*\]/);
    if (!arr) return [];
    const parsed: Array<{ i: number; new: string }> = JSON.parse(arr[0]);
    return parsed
      .filter(x => typeof x.i === "number" && x.i >= 1 && x.i <= blocks.length && typeof x.new === "string")
      .map(x => ({ old: blocks[x.i - 1], new: x.new }))
      .filter(p => p.old && p.new && p.old !== p.new);
  } catch { return []; }
}

// ── Simple direct color replacement (site-factory approach) ────────────────
function replaceCommonColors(content: string, targetColor: string): string {
  const COMMON_PRIMARIES = [
    "#007bff","#0066cc","#2196f3","#1976d2","#3f51b5","#4caf50",
    "#00bcd4","#009688","#ff5722","#e91e63","#0d6efd","#6200ee",
    "#03a9f4","#f44336","#ff9800","#9c27b0","#673ab7","#00897b",
  ];
  let r = content;
  for (const c of COMMON_PRIMARIES) {
    r = r.split(c).join(targetColor);
    r = r.split(c.toUpperCase()).join(targetColor);
  }
  return r;
}

export async function processProject(
  zip: JSZip, data: ClientData, onProgress?: (msg: string) => void
): Promise<JSZip> {
  const out = new JSZip();
  const newColors = parseColors(data.colors);
  const origColors = parseColors(data.originalColors);
  const newColors2 = parseColors(data.colors2);
  const origColors2 = parseColors(data.originalColors2);
  const files = Object.keys(zip.files);

  // ── Color setup ──
  if (newColors.length && !origColors.length) {
    onProgress?.("🔍 Detectando cor dominante do template...");
    const dominant = await detectDominantColor(files, zip);
    if (dominant) {
      origColors.push(dominant);
      onProgress?.(`🎨 Cor detectada: ${dominant} → ${newColors[0]}`);
    } else {
      onProgress?.("ℹ️ Cor original não detectada — aplicando substituição direta de cores comuns");
    }
  } else if (newColors.length && origColors.length) {
    onProgress?.(`🎨 Primária: ${origColors[0]} → ${newColors[0]}`);
  }
  if (newColors2.length && origColors2.length) {
    onProgress?.(`🎨 Secundária: ${origColors2[0]} → ${newColors2[0]}`);
  }

  // ── Find main HTML (exclude minichat) ──
  const allHtmls = files.filter(f => !zip.files[f].dir && /index\.html?$/i.test(f));
  const mainHtmlCands = allHtmls.filter(f => !/minichat\//i.test(f));
  const htmlCands = mainHtmlCands.length ? mainHtmlCands : allHtmls;
  htmlCands.sort((a,b) => a.split("/").length - b.split("/").length);
  const mainHtmlPath = htmlCands[0] || null;

  // ── Phase 1: Detect existing site info with AI ──
  let siteInfo: { name?: string; phone?: string; city?: string; service?: string } = {};
  const taggedHtmlMap = new Map<string, string>();
  const aiResultMap = new Map<string, Map<number, string>>();
  const aiItemsMap = new Map<string, import("./groq-ai").TaggedItem[]>();
  let blockRewrites: Array<{ old: string; new: string }> = [];

  if (mainHtmlPath) {
    onProgress?.(`📄 HTML principal: ${mainHtmlPath}`);
    const rawHtml = await zip.files[mainHtmlPath].async("string");
    onProgress?.(`📊 ${Math.round(rawHtml.length / 1024)}KB — analisando com IA...`);

    if (data.groqApiKey) {
      // Detect existing professional info
      siteInfo = await groqDetectSiteInfo(rawHtml, data.groqApiKey);
      if (siteInfo.name) onProgress?.(`✅ Detectado: "${siteInfo.name}" / "${siteInfo.service || "?"}" / "${siteInfo.city || "?"}"`);

      // Tag-based AI (detailed rewriting via IDs)
      const { taggedHtml, items } = tagHtmlForAI(rawHtml);
      onProgress?.(`🏷️ ${items.length} blocos identificados para reescrita`);
      taggedHtmlMap.set(mainHtmlPath, taggedHtml);
      aiItemsMap.set(mainHtmlPath, items);
      const aiResult = await rewriteWithAI(items, data, data.groqApiKey, onProgress);
      aiResultMap.set(mainHtmlPath, aiResult);
      onProgress?.(`✅ IA reescreveu ${aiResult.size} blocos`);

      // Block-level rewrites (H1/H2/H3/p) using site-factory approach
      blockRewrites = await groqRewriteSiteBlocks(rawHtml, data, siteInfo, data.groqApiKey);
      if (blockRewrites.length) onProgress?.(`✅ ${blockRewrites.length} seções reescritas com IA`);
    } else {
      onProgress?.("ℹ️ Sem chave Groq — aplicando substituições diretas");
      // Minimal: try to detect name from <title>
      const titleM = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleM) {
        const parts = titleM[1].split(/\s*[|–\-]\s*/);
        if (parts[0]?.trim().length >= 3) siteInfo.name = parts[0].trim();
        if (parts[1]?.trim().length >= 3) siteInfo.service = parts[1].trim();
      }
    }
  } else {
    onProgress?.("⚠️ Nenhum index.html encontrado no ZIP");
  }

  // ── Image setup ──
  const imgMap = new Map<string, File>();
  for (const img of data.images) imgMap.set(img.name.toLowerCase(), img);

  onProgress?.("📂 Processando arquivos...");

  for (const path of files) {
    const file = zip.files[path];
    if (file.dir) { out.folder(path); continue; }
    const fn = path.split("/").pop()?.toLowerCase() || "";

    // Images
    if (IMG_EXT.test(fn)) {
      const m = imgMap.get(fn);
      if (m) {
        onProgress?.(`✅ Imagem substituída: ${fn}`);
        out.file(path, await m.arrayBuffer());
      } else {
        out.file(path, await file.async("arraybuffer"));
      }
      continue;
    }

    if (TXT_EXT.test(fn)) {
      let c: string;

      if (path === mainHtmlPath && taggedHtmlMap.has(path)) {
        // Main HTML: apply tag-based AI results
        const tagged = taggedHtmlMap.get(path)!;
        const aiResult = aiResultMap.get(path)!;
        const aiItems = aiItemsMap.get(path)!;
        c = applyAIToTaggedHtml(tagged, aiResult);
        c = applyAIToDataSettings(c, aiItems, aiResult);
      } else {
        c = await file.async("string");
      }

      // Phase 2: Direct replacement of AI-detected values
      if (siteInfo.name && data.name && siteInfo.name !== data.name) {
        c = replaceAll(c, siteInfo.name, data.name);
        c = replaceAll(c, siteInfo.name.toUpperCase(), data.name.toUpperCase());
      }
      if (siteInfo.phone && data.whatsapp) {
        const oldP = siteInfo.phone.replace(/\D/g, "");
        const newP = data.whatsapp.replace(/\D/g, "");
        if (oldP && oldP !== newP) c = replaceAll(c, oldP, newP);
      }
      if (siteInfo.city && data.city && siteInfo.city !== data.city) {
        c = replaceAll(c, siteInfo.city, data.city);
      }

      // Phase 3: Block-level rewrites (H1/H2/H3 text content)
      if (path === mainHtmlPath) {
        for (const { old: oldText, new: newText } of blockRewrites) {
          if (c.includes(oldText)) c = replaceAll(c, oldText, newText);
        }
      }

      // Phase 4: Old client manual mapping
      c = smartReplaceOldClient(c, data);

      // Phase 5: Placeholder replacement
      c = replaceTextPlaceholders(c, data);

      // Phase 6: Color replacement
      if (/\.(css|html|htm|js|scss|sass|less)$/i.test(fn)) {
        if (newColors.length && origColors.length) {
          c = replaceColors(c, newColors, origColors);
        } else if (newColors.length) {
          // Fallback: replace common primary colors directly
          c = replaceCommonColors(c, newColors[0]);
        }
        // Secondary color replacement
        if (newColors2.length && origColors2.length) {
          c = replaceColors(c, newColors2, origColors2);
        }
      }

      out.file(path, c);
      continue;
    }

    out.file(path, await file.async("arraybuffer"));
  }

  onProgress?.("✅ Projeto gerado com sucesso!");
  return out;
}

export async function downloadProject(zip: JSZip, name: string) {
  const blob = await zip.generateAsync({type:"blob"});
  saveAs(blob, `site-${name.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,"")}.zip`);
}

export async function loadZipFromFiles(files: FileList): Promise<JSZip> {
  if (files.length===1 && files[0].name.endsWith(".zip"))
    return JSZip.loadAsync(await files[0].arrayBuffer());
  const zip = new JSZip();
  for (let i=0;i<files.length;i++) {
    const f = files[i];
    zip.file((f as any).webkitRelativePath||f.name, await f.arrayBuffer());
  }
  return zip;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const MIME_MAP: Record<string, string> = {
  png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",
  gif:"image/gif",svg:"image/svg+xml",webp:"image/webp",ico:"image/x-icon"
};
const mimeOf = (e: string) => MIME_MAP[e] || "application/octet-stream";

const INTERACTIVE_SCRIPT = `(function(){
var M='none',SEL=null,CNT=0;

function hasDirectText(el){
  for(var i=0;i<el.childNodes.length;i++){
    var n=el.childNodes[i];
    if(n.nodeType===3&&(n.textContent||'').trim().length>2) return true;
  }
  return false;
}

function rgb2hex(c){
  var m=(c||'').match(/(\\d+)[^,]*,\\s*(\\d+)[^,]*,\\s*(\\d+)/);
  return m?'#'+[m[1],m[2],m[3]].map(function(n){return('0'+parseInt(n).toString(16)).slice(-2)}).join(''):null;
}

function isBgTransparent(bg){
  if(!bg||bg==='transparent') return true;
  if(bg==='rgba(0, 0, 0, 0)') return true;
  if(bg.indexOf('rgba')!==-1){
    var p=bg.split(',');
    if(p.length>=4&&parseFloat(p[3])===0) return true;
  }
  return false;
}

function findSelector(el){
  var cur=el;
  while(cur&&cur!==document.documentElement){
    var did=cur.getAttribute?cur.getAttribute('data-id'):null;
    if(did) return '.elementor-element[data-id="'+did+'"]';
    cur=cur.parentElement;
  }
  var sid=el.getAttribute?el.getAttribute('data-sf-id'):null;
  if(sid) return '[data-sf-id="'+sid+'"]';
  return null;
}

function init(){
  document.querySelectorAll('*').forEach(function(e){
    if(e.getAttribute('data-sf-id')) return;
    if(!hasDirectText(e)) return;
    var text=(e.textContent||'').replace(/\\s+/g,' ').trim();
    if(text.length<3||/^\\d+$/.test(text)) return;
    e.setAttribute('data-sf-id',++CNT);
  });
  var s=document.createElement('style');s.id='sf-s';
  s.textContent='body[data-sf-mode=text] [data-sf-id]:hover{outline:2px dashed #818cf8!important;cursor:pointer!important;}body[data-sf-mode=color] *{cursor:crosshair!important;}';
  document.head.appendChild(s);
  var m={};
  document.querySelectorAll('[data-sf-id]').forEach(function(e){m[e.getAttribute('data-sf-id')]=(e.textContent||'').replace(/\\s+/g,' ').trim();});
  try{window.parent.postMessage({type:'sf-ready',sfIdMap:m},'*');}catch(ex){}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

window.addEventListener('message',function(e){
  var d=e.data;if(!d||!d.type)return;
  if(d.type==='sf-set-mode'){M=d.mode;document.body.setAttribute('data-sf-mode',d.mode);}
  if(d.type==='sf-update-text'){var el=document.querySelector('[data-sf-id="'+d.sfId+'"]');if(el)el.textContent=d.text;}
  if(d.type==='sf-clear-sel'){if(SEL){SEL.style.outline='';SEL=null;}}
  if(d.type==='sf-apply-css'){
    var st=document.getElementById('sf-co');
    if(!st){st=document.createElement('style');st.id='sf-co';document.head.appendChild(st);}
    st.textContent+='\\n'+d.selector+'{'+d.property+':'+d.value+' !important;}';
  }
});

document.addEventListener('click',function(e){
  if(M==='none')return;
  e.preventDefault();e.stopPropagation();
  var el=e.target;

  if(M==='text'){
    var id=null,cur=el;
    while(cur&&!id){id=cur.getAttribute?cur.getAttribute('data-sf-id'):null;if(!id)cur=cur.parentElement;}
    var t=id?document.querySelector('[data-sf-id="'+id+'"]'):null;
    if(!t)return;
    if(SEL)SEL.style.outline='';t.style.outline='2px solid #6366f1';SEL=t;
    var r=t.getBoundingClientRect();
    try{window.parent.postMessage({type:'sf-text-click',sfId:+id,text:(t.textContent||'').replace(/\\s+/g,' ').trim(),rect:{top:r.top,left:r.left,width:r.width,height:r.height,bottom:r.bottom}},'*');}catch(ex){}
  }

  if(M==='color'){
    var fgHex=rgb2hex(window.getComputedStyle(el).color);
    var bgHex=null,cur2=el;
    while(cur2&&cur2!==document.documentElement){
      var bg=window.getComputedStyle(cur2).backgroundColor;
      if(!isBgTransparent(bg)){bgHex=rgb2hex(bg);break;}
      cur2=cur2.parentElement;
    }
    var picked=bgHex||fgHex;
    var cssProperty=bgHex?'background-color':'color';
    var sel=findSelector(el);
    var r2=el.getBoundingClientRect();
    try{window.parent.postMessage({type:'sf-color-pick',hex:picked,bgHex:bgHex,fgHex:fgHex,selector:sel,cssProperty:cssProperty,rect:{top:r2.top,left:r2.left,width:r2.width,height:r2.height}},'*');}catch(ex){}
  }
},true);
})();`;

export async function buildPreviewHTML(
  zip: JSZip,
  imageOverrides?: Map<string, ArrayBuffer>,
  onProgress?: (msg: string) => void,
  options?: {
    linkOverrides?: Map<string, string>;
    colorOverrides?: Array<{ selector: string; property: string; value: string }>;
  }
): Promise<string|null> {
  const allIndexCands = Object.keys(zip.files).filter(f => !zip.files[f].dir && /index\.html?$/i.test(f));
  // Prefer index.html NOT inside minichat/ folder (site principal)
  const cands = allIndexCands.filter(f => !/minichat\//i.test(f));
  const finalCands = cands.length ? cands : allIndexCands;
  finalCands.sort((a,b) => a.split("/").length - b.split("/").length);
  if (!finalCands.length) { onProgress?.("❌ Nenhum index.html encontrado no ZIP"); return null; }

  const idx = finalCands[0];
  const base = idx.includes("/") ? idx.substring(0, idx.lastIndexOf("/")+1) : "";
  onProgress?.(`📄 Preview usando: ${idx} (base: "${base || "/"}")`);
  let html = await zip.files[idx].async("string");

  // All ZIP paths for searching
  const allZipPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);

  // Build filename → zip-path index
  const zipByFilename = new Map<string, string>();
  for (const p of allZipPaths) {
    const fname = p.split("/").pop()?.toLowerCase() || "";
    if (IMG_EXT.test(fname)) zipByFilename.set(fname, p);
  }

  // Override index by filename
  const overrideByFilename = new Map<string, ArrayBuffer>();
  if (imageOverrides) {
    for (const [p, buf] of imageOverrides) {
      const fname = p.split("/").pop()?.toLowerCase() || "";
      if (fname) overrideByFilename.set(fname, buf);
    }
  }

  // Override index by normalized filename (WP variants: -scaled, -300x200, etc.)
  const overrideByNormFilename = new Map<string, ArrayBuffer>();
  if (imageOverrides) {
    for (const [p, buf] of imageOverrides) {
      const fname = p.split("/").pop()?.toLowerCase() || "";
      if (fname) {
        const norm = normalizeWpName(fname);
        if (norm) overrideByNormFilename.set(norm, buf);
      }
    }
  }

  // Normalize WordPress filenames: strip -scaled, -300x200, etc.
  const normalizeWpName = (fname: string) =>
    fname.replace(/\.[^.]+$/, "")
         .replace(/-\d+x\d+$/, "")
         .replace(/-scaled$/, "")
         .replace(/-e\d+$/, "")
         .toLowerCase();

  const zipByNormName = new Map<string, string>();
  for (const [fname, path] of zipByFilename) {
    zipByNormName.set(normalizeWpName(fname), path);
  }

  // Robust path resolution: handles absolute paths (/wp-content/...) by trying
  // multiple strategies to find the file in the ZIP
  const resolveZipPath = (ref: string, cssBase?: string): string | null => {
    const effectiveBase = cssBase ?? base;

    // If it's an absolute http URL, can't resolve from ZIP
    if (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("//")) return null;

    // Try relative resolution first
    if (!ref.startsWith("/")) {
      const resolved = resolvePath(effectiveBase, ref);
      if (zip.files[resolved]) return resolved;
    }

    // For absolute paths (starting with /), try multiple strategies:
    const stripped = ref.startsWith("/") ? ref.slice(1) : ref; // remove leading slash

    // Strategy 1: direct stripped path
    if (zip.files[stripped]) return stripped;

    // Strategy 2: with base folder prefix (e.g., "site-name/wp-content/...")
    const baseFolder = (effectiveBase || base).split("/")[0];
    if (baseFolder) {
      const withBase = `${baseFolder}/${stripped}`;
      if (zip.files[withBase]) return withBase;
    }

    // Strategy 3: search all zip paths that end with the path segments
    // (handles any folder prefix in the ZIP)
    const pathParts = stripped.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      const tail = pathParts.slice(-2).join("/"); // last 2 segments
      const found = allZipPaths.find(p => p.endsWith(tail) || p.endsWith("/" + tail));
      if (found) return found;
    }

    return null;
  };

  const usedZipPaths = new Set<string>();
  const zipImgList: string[] = [...zipByFilename.values()].filter(p => !p.includes("favicon"));

  const getImgData = async (src: string, ext: string, cssBase?: string): Promise<string | null> => {
    const mime = mimeOf(ext);
    const fname = src.split("/").pop()?.split("?")[0].toLowerCase() || "";

    // Helper: pick correct MIME for a buffer (transparent PNGs are always image/png)
    const overrideMime = (buf: ArrayBuffer) => buf.byteLength < 200 ? "image/png" : mime;

    // 1. Exact path override
    if (imageOverrides) {
      for (const [op] of imageOverrides) {
        if (op === src || op.endsWith("/" + fname)) {
          usedZipPaths.add(op);
          const buf = imageOverrides.get(op)!;
          return `data:${overrideMime(buf)};base64,${arrayBufferToBase64(buf)}`;
        }
      }
    }
    // 2. Filename override
    if (fname && overrideByFilename.has(fname)) {
      const buf = overrideByFilename.get(fname)!;
      return `data:${overrideMime(buf)};base64,${arrayBufferToBase64(buf)}`;
    }
    // 2.5. Normalized filename override (WP -scaled, -300x200, etc.)
    if (fname) {
      const normFname = normalizeWpName(fname);
      if (overrideByNormFilename.has(normFname)) {
        const buf = overrideByNormFilename.get(normFname)!;
        return `data:${overrideMime(buf)};base64,${arrayBufferToBase64(buf)}`;
      }
    }

    // 3. Resolve path in ZIP (robust — handles absolute paths)
    const resolved = resolveZipPath(src, cssBase);
    if (resolved && zip.files[resolved]) {
      usedZipPaths.add(resolved);
      return `data:${mime};base64,${await zip.files[resolved].async("base64")}`;
    }

    // 4. Exact filename match
    if (fname && zipByFilename.has(fname)) {
      const fp = zipByFilename.get(fname)!;
      usedZipPaths.add(fp);
      return `data:${mime};base64,${await zip.files[fp].async("base64")}`;
    }
    // 5. Normalized/fuzzy filename match
    if (fname) {
      const norm = normalizeWpName(fname);
      if (zipByNormName.has(norm)) {
        const fp = zipByNormName.get(norm)!;
        usedZipPaths.add(fp);
        return `data:${mime};base64,${await zip.files[fp].async("base64")}`;
      }
    }
    return null;
  };

  // ── Inline CSS ──
  // Resolve url() inside each CSS file using THAT file's path as base (not the HTML base)
  let cssInlined = 0, cssFailed = 0;
  for (const m of [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["'][^>]*\/?>/gi)]) {
    const cssHref = m[1];
    const cssZipPath = resolveZipPath(cssHref);
    const f = cssZipPath ? zip.files[cssZipPath] : null;
    if (!f) {
      onProgress?.(`⚠️ CSS não encontrado no ZIP: ${cssHref}`);
      cssFailed++;
      continue;
    }
    cssInlined++;
    const cssBase = cssZipPath.includes("/") ? cssZipPath.substring(0, cssZipPath.lastIndexOf("/")+1) : "";
    let cssContent = await f.async("string");

    // Resolve url() inside this CSS file using the CSS file's own base path
    const urlMatches = [...cssContent.matchAll(/url\(["']?([^"')]+\.(png|jpg|jpeg|gif|svg|webp|ico))["']?\)/gi)];
    for (const um of urlMatches) {
      const imgData = await getImgData(um[1], um[2].toLowerCase(), cssBase);
      if (imgData) {
        cssContent = cssContent.split(um[0]).join(`url("${imgData}")`);
      }
    }

    html = html.replace(m[0], `<style>${cssContent}</style>`);
  }
  onProgress?.(`🎨 CSS: ${cssInlined} inlinados, ${cssFailed} não encontrados`);

  // ── Inline images (src) ──
  const unresolvedSrc: string[] = [];
  let srcResolved = 0, srcFailed = 0;
  for (const m of [...html.matchAll(/src=["']([^"']+\.(png|jpg|jpeg|gif|svg|webp|ico))["']/gi)]) {
    const data = await getImgData(m[1], m[2].toLowerCase());
    if (data) {
      html = html.split(m[0]).join(`src="${data}"`);
      srcResolved++;
    } else if (m[1].startsWith("http") || m[1].startsWith("//") || m[1].startsWith("/")) {
      unresolvedSrc.push(m[0]);
      srcFailed++;
    }
  }

  // Fallback: assign remaining ZIP images in order to unresolved images
  const unusedZipImgs = zipImgList.filter(p => !usedZipPaths.has(p));
  let srcFallback = 0;
  for (let i = 0; i < Math.min(unresolvedSrc.length, unusedZipImgs.length); i++) {
    const zipPath = unusedZipImgs[i];
    const ext = zipPath.split(".").pop()?.toLowerCase() || "jpg";
    const b64 = await zip.files[zipPath].async("base64");
    html = html.split(unresolvedSrc[i]).join(`src="data:${mimeOf(ext)};base64,${b64}"`);
    usedZipPaths.add(zipPath);
    srcFallback++;
  }
  onProgress?.(`🖼️ Imagens src=: ${srcResolved} resolvidas, ${srcFailed - srcFallback} falharam, ${srcFallback} por fallback`);

  // ── Inline background-image url() remaining in HTML (not already handled in CSS) ──
  const unresolvedUrl: string[] = [];
  let urlResolved = 0, urlFailed = 0;
  for (const m of [...html.matchAll(/url\(["']?([^"')]+\.(png|jpg|jpeg|gif|svg|webp))["']?\)/gi)]) {
    if (m[1].startsWith("data:")) continue; // already inlined
    const data = await getImgData(m[1], m[2].toLowerCase());
    if (data) {
      html = html.split(m[0]).join(`url("${data}")`);
      urlResolved++;
    } else if (m[1].startsWith("http") || m[1].startsWith("//") || m[1].startsWith("/")) {
      unresolvedUrl.push(m[0]);
      urlFailed++;
    }
  }

  // Fallback for unresolved url() background images
  const unusedForUrl = zipImgList.filter(p => !usedZipPaths.has(p));
  let urlFallback = 0;
  for (let i = 0; i < Math.min(unresolvedUrl.length, unusedForUrl.length); i++) {
    const zipPath = unusedForUrl[i];
    const ext = zipPath.split(".").pop()?.toLowerCase() || "jpg";
    const b64 = await zip.files[zipPath].async("base64");
    html = html.split(unresolvedUrl[i]).join(`url("data:${mimeOf(ext)};base64,${b64}")`);
    usedZipPaths.add(zipPath);
    urlFallback++;
  }
  onProgress?.(`🖼️ Imagens url(): ${urlResolved} resolvidas, ${urlFailed - urlFallback} falharam, ${urlFallback} por fallback`);

  // ── Elementor data-settings background images → CSS injection ──
  const inlineJsonImg = async (imgPath: string): Promise<string | null> => {
    if (!imgPath || imgPath.startsWith("data:")) return null;
    const ext = (imgPath.split("?")[0].split(".").pop() || "").toLowerCase();
    if (!MIME_MAP[ext]) return null;
    const fname = imgPath.split("/").pop()?.split("?")[0].toLowerCase() || "";

    if (!imgPath.startsWith("http")) {
      const resolved = resolveZipPath(imgPath);
      if (resolved && zip.files[resolved]) {
        if (imageOverrides?.has(resolved)) {
          const buf = imageOverrides.get(resolved)!;
          const m = buf.byteLength < 200 ? "image/png" : mimeOf(ext);
          return `data:${m};base64,${arrayBufferToBase64(buf)}`;
        }
        usedZipPaths.add(resolved);
        return `data:${mimeOf(ext)};base64,${await zip.files[resolved].async("base64")}`;
      }
    }
    if (fname && overrideByFilename.has(fname))
      return `data:${mimeOf(ext)};base64,${arrayBufferToBase64(overrideByFilename.get(fname)!)}`;
    if (fname && zipByFilename.has(fname)) {
      const fp = zipByFilename.get(fname)!;
      usedZipPaths.add(fp);
      return `data:${mimeOf(ext)};base64,${await zip.files[fp].async("base64")}`;
    }
    if (fname) {
      const norm = normalizeWpName(fname);
      if (zipByNormName.has(norm)) {
        const fp = zipByNormName.get(norm)!;
        usedZipPaths.add(fp);
        return `data:${mimeOf(ext)};base64,${await zip.files[fp].async("base64")}`;
      }
    }
    return null;
  };

  const bgCssRules: string[] = [];

  // HTML-entity-encoded data-settings (&quot; variant)
  const elemBgMatches = [...html.matchAll(/data-id="([^"]+)"[^>]*data-settings="[^"]*&quot;background_image&quot;\s*:\s*\{&quot;url&quot;\s*:\s*&quot;([^&"]+\.(png|jpg|jpeg|gif|svg|webp))[^"]*&quot;/gi)];
  for (const m of elemBgMatches) {
    const dataId = m[1];
    const imgUrl = m[2];
    const inlined = await inlineJsonImg(imgUrl);
    if (inlined) {
      bgCssRules.push(`.elementor-element[data-id="${dataId}"] { background-image: url('${inlined}') !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`);
      html = html.split(`&quot;url&quot;:&quot;${imgUrl}`).join(`&quot;url&quot;:&quot;${inlined}`);
    } else {
      onProgress?.(`⚠️ Imagem de fundo não encontrada no ZIP: ${imgUrl.split("/").pop()}`);
    }
  }

  // Plain JSON (data-settings with single-quote wrapper)
  const plainJsonMatches = [...html.matchAll(/data-id="([^"]+)"[^']*data-settings='[^']*"background_image"\s*:\s*\{"url"\s*:\s*"([^"]+\.(png|jpg|jpeg|gif|svg|webp))[^"]*"/gi)];
  for (const m of plainJsonMatches) {
    const dataId = m[1];
    const imgUrl = m[2];
    const inlined = await inlineJsonImg(imgUrl);
    if (inlined) {
      bgCssRules.push(`.elementor-element[data-id="${dataId}"] { background-image: url('${inlined}') !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`);
    } else {
      onProgress?.(`⚠️ Imagem de fundo (plain JSON) não encontrada: ${imgUrl.split("/").pop()}`);
    }
  }

  if (bgCssRules.length > 0) {
    const styleBlock = `<style id="site-factory-bg">\n${bgCssRules.join("\n")}\n</style>`;
    html = html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
    onProgress?.(`✅ ${bgCssRules.length} imagem(ns) de fundo Elementor injetadas via CSS`);
  } else if (elemBgMatches.length + plainJsonMatches.length === 0) {
    onProgress?.(`ℹ️ Nenhum data-settings com background_image encontrado no HTML`);
  }

  // JS via base64 data URIs
  let jsInlined = 0;
  for (const m of [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi)]) {
    const src = m[1];
    if (src.startsWith("http") || src.startsWith("//")) continue;
    const resolved = resolveZipPath(src);
    const f = resolved ? zip.files[resolved] : null;
    if (f) {
      const b64 = await f.async("base64");
      html = html.replace(m[0], `<script src="data:text/javascript;base64,${b64}"></script>`);
      jsInlined++;
    }
  }
  onProgress?.(`⚙️ JS: ${jsInlined} scripts inlinados`);

  // ── Apply link overrides ──
  if (options?.linkOverrides && options.linkOverrides.size > 0) {
    for (const [oldHref, newHref] of options.linkOverrides) {
      if (!oldHref || !newHref) continue;
      const esc = oldHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(`href=["']${esc}["']`, "g"), `href="${newHref}"`);
    }
    onProgress?.(`🔗 ${options.linkOverrides.size} link(s) com URL substituída`);
  }

  // ── Apply color overrides via CSS injection ──
  if (options?.colorOverrides && options.colorOverrides.length > 0) {
    const cssRules = options.colorOverrides
      .filter(co => co.selector && co.property && co.value)
      .map(co => `${co.selector} { ${co.property}: ${co.value} !important; }`)
      .join("\n");
    if (cssRules) {
      const styleBlock = `<style id="sf-color-overrides">\n${cssRules}\n</style>`;
      html = html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
      onProgress?.(`🎨 ${options.colorOverrides.length} substituição(ões) de cor aplicada(s)`);
    }
  }

  // ── Inject interactive script (text editing, color eyedropper) ──
  const scriptTag = `<script>${INTERACTIVE_SCRIPT}</script>`;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${scriptTag}\n</body>`);
  } else {
    html += scriptTag;
  }

  return html;
}

export function getZipImages(zip: JSZip): string[] {
  return Object.keys(zip.files).filter(
    f => !zip.files[f].dir && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f) && !/favicon/i.test(f)
  );
}

export async function getZipLinks(zip: JSZip): Promise<{ id: string; text: string; href: string }[]> {
  const cands = Object.keys(zip.files).filter(f => !zip.files[f].dir && /index\.html?$/i.test(f));
  cands.sort((a, b) => a.split("/").length - b.split("/").length);
  if (!cands.length) return [];
  const html = await zip.files[cands[0]].async("string");
  const links: { id: string; text: string; href: string }[] = [];
  const seen = new Set<string>();
  let counter = 0;
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!href || href === "#" || href.startsWith("javascript:")) continue;
    if (text.length < 1) continue;
    const key = `${href}|||${text.slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: String(++counter), text: text.slice(0, 80), href });
    if (counter >= 60) break;
  }
  return links;
}

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/") || rel.startsWith("http")) return rel;
  let r = rel.replace(/^\.\//, "");
  let b = base;
  while (r.startsWith("../")) { r = r.substring(3); b = b.replace(/[^/]+\/$/, ""); }
  return b + r;
}

const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon",
};

export async function extractImages(zip: JSZip): Promise<ImageEntry[]> {
  const result: ImageEntry[] = [];
  for (const path of Object.keys(zip.files)) {
    const file = zip.files[path];
    if (file.dir) continue;
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const mime = IMG_MIME[ext];
    if (!mime || /favicon/i.test(path)) continue;
    try {
      const data = await file.async("base64");
      result.push({ path, name: path.split("/").pop() || path, dataUrl: `data:${mime};base64,${data}`, mime });
    } catch { /* skip */ }
  }
  return result;
}

export async function detectMinichat(zip: JSZip): Promise<MinichatInfo> {
  const info: MinichatInfo = { detected: false, whatsapp: "", botName: "" };
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir) continue;
    if (!path.toLowerCase().includes("minichat")) continue;
    info.detected = true;
    try {
      const content = await zip.files[path].async("string");
      const waMatch =
        content.match(/(?:whatsapp|phone|numero)['":\s]*['"]?([\d\s\-\+\(\)]{8,15})/i) ||
        content.match(/(\+?55\d{10,11})/);
      if (waMatch) info.whatsapp = waMatch[1].replace(/\D/g, "");
      const nameMatch = content.match(/(?:botName|nome|name|assistente)['":\s]+['"]([^'"]{2,50})['"]/i);
      if (nameMatch) info.botName = nameMatch[1];
    } catch { /* skip */ }
    if (info.whatsapp) break;
  }
  return info;
}

async function tryDownloadZip(zipUrl: string, token?: string): Promise<ArrayBuffer | null> {
  // Try direct fetch with token first (avoids proxies, works when CORS allows)
  if (token) {
    try {
      const res = await fetch(zipUrl, {
        headers: { Authorization: `token ${token}` },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const magic = new Uint8Array(buf.slice(0, 4));
        if (magic[0] === 0x50 && magic[1] === 0x4b) return buf;
      }
    } catch { /* fall through to proxies */ }
  }

  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(zipUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(zipUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(zipUrl)}`,
  ];
  try {
    return await Promise.any(
      proxies.map(async (proxyUrl) => {
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const magic = new Uint8Array(buf.slice(0, 4));
        if (magic[0] !== 0x50 || magic[1] !== 0x4B) throw new Error("Not a ZIP");
        return buf;
      })
    );
  } catch {
    return null;
  }
}

export async function loadFromGitHub(
  url: string,
  onProgress?: (msg: string) => void,
  token?: string
): Promise<JSZip> {
  const match = url.match(/github\.com\/([^\/\s?#]+)\/([^\/\s?#]+)/);
  if (!match) throw new Error("URL inválida. Use: github.com/usuario/repositorio");

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, "");
  const ghToken = token || (import.meta as any).env?.VITE_GITHUB_TOKEN || "";

  onProgress?.("🔍 Baixando repositório...");
  const zipResult = await Promise.any(
    ["main", "master"].map(async (branch) => {
      const zipUrl = `https://github.com/${owner}/${cleanRepo}/archive/refs/heads/${branch}.zip`;
      const buf = await tryDownloadZip(zipUrl, ghToken);
      if (!buf) throw new Error("no zip");
      return { buf, branch };
    })
  ).catch(() => null);

  if (zipResult) {
    const { buf, branch } = zipResult;
    try {
      const raw = await JSZip.loadAsync(buf);
      const stripped = new JSZip();
      const prefix = `${cleanRepo}-${branch}/`;
      const entries: Array<[string, Promise<ArrayBuffer>]> = [];
      raw.forEach((path, file) => {
        if (!file.dir) {
          const newPath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
          if (newPath) entries.push([newPath, file.async("arraybuffer")]);
        }
      });
      const resolved = await Promise.all(entries.map(async ([p, b]) => [p, await b] as [string, ArrayBuffer]));
      for (const [p, b] of resolved) stripped.file(p, b);
      onProgress?.("✅ Repositório carregado!");
      return stripped;
    } catch { /* fall through to API */ }
  }

  onProgress?.("🔄 Conectando via API GitHub...");
  const headers: HeadersInit = { Accept: "application/vnd.github.v3+json" };
  if (ghToken) headers["Authorization"] = `token ${ghToken}`;
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/HEAD?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) {
    if (treeRes.status === 404) throw new Error("Repositório não encontrado ou é privado");
    if (treeRes.status === 403) throw new Error(
      ghToken
        ? "Token GitHub inválido ou sem permissão para este repositório."
        : "Limite de acesso atingido. Adicione um token GitHub ou tente em alguns minutos."
    );
    throw new Error(`Erro ao acessar repositório: ${treeRes.status}`);
  }

  const treeData = await treeRes.json();
  const blobs: any[] = treeData.tree.filter((f: any) => f.type === "blob");
  onProgress?.(`📂 Carregando ${blobs.length} arquivo(s)...`);

  const zip = new JSZip();
  const batchSize = 8;
  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (f: any) => {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/contents/${f.path}`, { headers });
        if (!r.ok) return;
        const d = await r.json();
        if (d.content) {
          const binary = atob(d.content.replace(/\n/g, ""));
          const bytes = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
          zip.file(f.path, bytes);
        }
      } catch { /* skip */ }
    }));
    onProgress?.(`📂 ${Math.min(i + batchSize, blobs.length)}/${blobs.length} arquivo(s)...`);
  }
  return zip;
}
