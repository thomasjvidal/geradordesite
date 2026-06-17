import JSZip from "jszip";
import { saveAs } from "file-saver";
import { groqExtractSiteInfo, groqRewriteBlocks } from "./groq";

export interface ClientData {
  name: string;
  area: string;
  description: string;
  city: string;
  whatsapp: string;
  colors: string;
  images: File[];
  minichatWhatsapp?: string;
  minichatBotName?: string;
  josephPayId?: string;
}

// Color name to hex mapping
const COLOR_MAP: Record<string, string> = {
  azul: "#2196F3", blue: "#2196F3",
  vermelho: "#F44336", red: "#F44336",
  verde: "#4CAF50", green: "#4CAF50",
  amarelo: "#FFEB3B", yellow: "#FFEB3B",
  rosa: "#E91E63", pink: "#E91E63",
  roxo: "#9C27B0", purple: "#9C27B0",
  laranja: "#FF9800", orange: "#FF9800",
  preto: "#212121", black: "#212121",
  branco: "#FFFFFF", white: "#FFFFFF",
  cinza: "#9E9E9E", gray: "#9E9E9E",
  marrom: "#795548", brown: "#795548",
  dourado: "#FFD700", gold: "#FFD700",
};

function parseColors(colorStr: string): string[] {
  return colorStr
    .toLowerCase()
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => COLOR_MAP[c] || c)
    .filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c));
}

function replaceTextInContent(text: string, data: ClientData): string {
  const replacements: [RegExp, string][] = [
    [/\{\{nome\}\}/gi, data.name],
    [/\{\{name\}\}/gi, data.name],
    [/\{\{area\}\}/gi, data.area],
    [/\{\{descricao\}\}/gi, data.description],
    [/\{\{description\}\}/gi, data.description],
    [/\{\{cidade\}\}/gi, data.city],
    [/\{\{city\}\}/gi, data.city],
    [/\{\{whatsapp\}\}/gi, data.whatsapp],
    [/\{\{telefone\}\}/gi, data.whatsapp],
    [/\{\{phone\}\}/gi, data.whatsapp],
    [/\{\{minichat_whatsapp\}\}/gi, data.minichatWhatsapp || data.whatsapp],
    [/\{\{minichat_nome\}\}/gi, data.minichatBotName || data.name],
    [/\{\{josephpay_id\}\}/gi, data.josephPayId || ''],
    [/\{\{sensor_id\}\}/gi, data.josephPayId || ''],
  ];

  let result = text;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, () => replacement);
  }
  return result;
}

function replaceColorsInCSS(css: string, colors: string[]): string {
  if (colors.length === 0) return css;
  const primary = colors[0];
  const secondary = colors[1] || primary;

  let result = css;
  const commonPrimaries = [
    "#007bff", "#0066cc", "#2196f3", "#1976d2", "#3f51b5",
    "#4caf50", "#00bcd4", "#009688", "#ff5722", "#e91e63",
    "#0d6efd", "#6200ee", "#03a9f4",
  ];
  for (const cp of commonPrimaries) {
    result = result.replace(new RegExp(cp.replace("#", "\\#"), "gi"), primary);
  }

  const commonSecondaries = ["#6c757d", "#757575", "#78909c"];
  for (const cs of commonSecondaries) {
    result = result.replace(new RegExp(cs.replace("#", "\\#"), "gi"), secondary);
  }

  return result;
}

export async function processProject(
  projectZip: JSZip,
  data: ClientData,
  onProgress?: (msg: string) => void,
  groqKey?: string
): Promise<JSZip> {
  const output = new JSZip();
  const colors = parseColors(data.colors);

  const imageMap = new Map<string, File>();
  for (const img of data.images) {
    imageMap.set(img.name.toLowerCase(), img);
  }

  onProgress?.("Duplicando projeto...");

  const files = Object.keys(projectZip.files);

  for (const path of files) {
    const file = projectZip.files[path];
    if (file.dir) {
      output.folder(path);
      continue;
    }

    const lowerPath = path.toLowerCase();
    const fileName = path.split("/").pop()?.toLowerCase() || "";

    // Handle images - replace if user uploaded matching name
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(fileName)) {
      const matchingImage = imageMap.get(fileName);
      if (matchingImage) {
        onProgress?.(`Substituindo imagem: ${fileName}`);
        const buf = await matchingImage.arrayBuffer();
        output.file(path, buf);
        continue;
      }
      const content = await file.async("arraybuffer");
      output.file(path, content);
      continue;
    }

    // Process text files
    if (/\.(html|htm|css|js|json|txt|xml|php)$/i.test(fileName)) {
      const rawContent = await file.async("string");
      const hasPlaceholders = rawContent.includes("{{");

      let content = replaceTextInContent(rawContent, data);

      if (/\.css$/i.test(fileName)) {
        onProgress?.(`Ajustando cores CSS: ${fileName}`);
        content = replaceColorsInCSS(content, colors);
      }

      if (/\.(html|htm)$/i.test(fileName)) {
        onProgress?.(`Processando HTML: ${fileName}`);
        content = replaceColorsInCSS(content, colors);

        if (!hasPlaceholders && !lowerPath.includes("minichat")) {
          if (groqKey) {
            onProgress?.(`IA analisando página: ${fileName}`);
            const existing = await groqExtractSiteInfo(rawContent, groqKey);

            // Replace exact detected values (name, city, phone, service term)
            if (existing.name && data.name && existing.name !== data.name)
              content = content.split(existing.name).join(data.name);
            if (existing.city && data.city && existing.city !== data.city)
              content = content.split(existing.city).join(data.city);
            if (existing.phone && data.whatsapp) {
              const cleanExisting = existing.phone.replace(/\D/g, "");
              const cleanNew = data.whatsapp.replace(/\D/g, "");
              if (cleanExisting && cleanExisting !== cleanNew) {
                content = content.split(cleanExisting).join(cleanNew);
                const formatted = cleanExisting.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
                content = content.split(formatted).join(cleanNew);
              }
            }
            if (existing.service && data.area && existing.service !== data.area)
              content = content.split(existing.service).join(data.area);

            // Rewrite section text blocks (H1/H2/H3/paragraphs) for new professional
            onProgress?.(`IA reescrevendo seções: ${fileName}`);
            const rewrites = await groqRewriteBlocks(content, data, existing, groqKey);
            for (const { old: oldText, new: newText } of rewrites) {
              if (content.includes(oldText)) {
                content = content.split(oldText).join(newText);
              }
            }
          } else {
            // Fallback replacement — no Groq key available
            // 1. Name + area: try <title> then og:title
            const titleMatch = rawContent.match(/<title[^>]*>([^<]+)<\/title>/i);
            const ogMatch =
              rawContent.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
              rawContent.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
            const titleText = titleMatch?.[1] || ogMatch?.[1] || "";
            const titleParts = titleText.split(/\s*[|–\-]\s*/);
            const existingName = titleParts[0]?.trim();
            let existingArea = titleParts[1]?.trim();

            if (existingName && data.name &&
                existingName.toLowerCase() !== data.name.toLowerCase() &&
                existingName.length >= 3) {
              content = content.split(existingName).join(data.name);
            }
            if (existingArea && data.area &&
                existingArea.toLowerCase() !== data.area.toLowerCase() &&
                existingArea.length >= 3) {
              const esc = existingArea.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              content = content.replace(new RegExp(esc, "gi"), () => data.area);
            } else if (data.area) {
              // Scan for common professional terms when title doesn't contain area
              const PT_TERMS = [
                "nutricionista", "médico", "médica", "fisioterapeuta", "dentista",
                "psicólogo", "psicóloga", "terapeuta", "advogado", "advogada",
                "personal trainer", "treinador", "coach", "enfermeiro", "enfermeira",
                "farmacêutico", "farmacêutica", "dermatologista", "cardiologista",
                "pediatra", "ginecologista", "ortopedista", "cirurgião", "cirurgiã",
                "neurologista", "endocrinologista", "oftalmologista",
              ];
              const lc = rawContent.toLowerCase();
              for (const term of PT_TERMS) {
                if (lc.includes(term) && term.toLowerCase() !== data.area.toLowerCase()) {
                  content = content.replace(new RegExp(term, "gi"), () => data.area);
                  break;
                }
              }
            }

            // 2. City: detect from "City - UF" pattern (e.g., "Cataguases - MG")
            if (data.city) {
              const cityMatch = rawContent.match(
                /([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][a-záéíóúàèìòùâêîôûãõç]+(?:\s+[A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][a-záéíóúàèìòùâêîôûãõç]+)*)\s*[-–]\s*[A-Z]{2}\b/
              );
              const existingCity = cityMatch?.[1];
              if (existingCity && existingCity.toLowerCase() !== data.city.toLowerCase() && existingCity.length >= 3) {
                content = content.split(existingCity).join(data.city);
              }
            }

            // 3. Phone: replace existing number found in wa.me link
            if (data.whatsapp) {
              const waMatch = rawContent.match(/wa\.me\/(\+?[0-9]{10,15})/);
              if (waMatch) {
                const existingPhone = waMatch[1].replace(/\D/g, "");
                const newPhone = data.whatsapp.replace(/\D/g, "");
                if (existingPhone && existingPhone !== newPhone) {
                  content = content.split(existingPhone).join(newPhone);
                }
              }
            }
          }
        }
      }

      // Apply client data directly to MiniChat files
      if (lowerPath.includes("minichat")) {
        onProgress?.(`Configurando minichat: ${fileName}`);
        const phone = ((data.minichatWhatsapp || data.whatsapp) ?? "").replace(/\D/g, "");
        if (phone) {
          content = content.replace(/(WHATSAPP_NUMBER\s*=\s*['"])([^'"]*?)(['"]\s*;?)/g, `$1${phone}$3`);
          content = content.replace(/(wa\.me\/)(\+?[0-9]{8,15})/g, `$1${phone}`);
          content = content.replace(/(["'])(\+?55[0-9]{10,11})(["'])/g, `$1${phone}$3`);
        }
        const botName = data.minichatBotName || data.name;
        if (botName) {
          content = content.replace(/((?:BOT_NAME|botName|nome_bot)\s*=\s*['"])([^'"]*?)(['"])/g, `$1${botName}$3`);
          content = content.replace(/<h3([^>]*)>[^<]{2,80}<\/h3>/gi, `<h3$1>${botName}</h3>`);
        }
        if (data.josephPayId) {
          content = content.replace(/(JP_OWNER_KEY\s*=\s*["'])([^"']*)(['"])/g, `$1${data.josephPayId}$3`);
          content = content.replace(/(sensor\.js\?uid=)([A-Za-z0-9_\-]{4,64})/gi, `$1${data.josephPayId}`);
        }
      }

      output.file(path, content);
    } else {
      const content = await file.async("arraybuffer");
      output.file(path, content);
    }
  }

  onProgress?.("Projeto gerado com sucesso!");
  return output;
}

// Create a ZIP from a single image, wrapping it in a responsive one-page template
export async function loadFromImage(file: File): Promise<JSZip> {
  const zip = new JSZip();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const imageName = `imagem.${ext}`;
  const buf = await file.arrayBuffer();

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{nome}}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,system-ui,sans-serif}
    .hero{position:relative;min-height:100vh}
    .hero-img{width:100%;height:100vh;object-fit:cover;display:block}
    .hero-overlay{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;color:#fff}
    h1{font-size:clamp(2rem,5vw,4rem);font-weight:700}
    .sub{font-size:clamp(1rem,2vw,1.4rem);margin-top:1rem;max-width:600px;opacity:.9}
    .cta{margin-top:2rem;padding:1rem 2.5rem;background:#007bff;color:#fff;border-radius:.5rem;text-decoration:none;font-weight:600;font-size:1.1rem}
    .cta:hover{opacity:.85}
    .info{background:#f9fafb;padding:4rem 2rem;text-align:center}
    .info h2{font-size:2rem;color:#1a202c;margin-bottom:1rem}
    .info p{color:#6b7280;max-width:600px;margin:0 auto;font-size:1.1rem}
    footer{background:#1a202c;color:#9ca3af;text-align:center;padding:2rem}
  </style>
</head>
<body>
  <section class="hero">
    <img class="hero-img" src="${imageName}" alt="{{nome}}" />
    <div class="hero-overlay">
      <h1>{{nome}}</h1>
      <p class="sub">{{descricao}}</p>
      <a class="cta" href="https://wa.me/{{whatsapp}}">Fale conosco no WhatsApp</a>
    </div>
  </section>
  <section class="info">
    <h2>{{area}} em {{cidade}}</h2>
    <p>{{descricao}}</p>
  </section>
  <footer>
    <p>© {{nome}} — {{cidade}} · WhatsApp: {{whatsapp}}</p>
  </footer>
</body>
</html>`;

  zip.file("index.html", html);
  zip.file(imageName, buf);
  return zip;
}

// Fetch HTML from a URL and wrap in a ZIP, with absolute URLs injected via <base>
export async function loadFromUrl(
  url: string,
  onProgress?: (msg: string) => void
): Promise<JSZip> {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  onProgress?.(`Buscando HTML de ${normalized}...`);

  let html: string | null = null;

  try {
    const res = await fetch(normalized, { mode: "cors" });
    if (res.ok) html = await res.text();
  } catch {
    // CORS blocked — fall through to proxy
  }

  if (!html) {
    onProgress?.("Usando proxy CORS...");
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(normalized)}`;
    const res = await fetch(proxy);
    if (!res.ok) throw new Error(`Não foi possível buscar a URL (status ${res.status})`);
    html = await res.text();
  }

  // Inject <base href> so relative URLs resolve correctly in preview
  if (/<base\s/i.test(html)) {
    html = html.replace(/<base[^>]*>/i, `<base href="${normalized}">`);
  } else {
    html = html.replace(/(<head[^>]*>)/i, `$1<base href="${normalized}">`);
  }

  onProgress?.("HTML importado com sucesso!");
  const zip = new JSZip();
  zip.file("index.html", html);
  return zip;
}

export async function downloadProject(zip: JSZip, clientName: string) {
  const blob = await zip.generateAsync({ type: "blob" });
  const safeName = clientName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  saveAs(blob, `site-${safeName}.zip`);
}

export async function loadZipFromFiles(files: FileList): Promise<JSZip> {
  const zip = new JSZip();

  if (files.length === 1 && files[0].name.endsWith(".zip")) {
    const content = await files[0].arrayBuffer();
    return await JSZip.loadAsync(content);
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = (file as any).webkitRelativePath || file.name;
    const buf = await file.arrayBuffer();
    zip.file(path, buf);
  }

  return zip;
}

const CSS_ASSET_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
  ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", eot: "application/vnd.ms-fontobject",
};

async function inlineCSSUrls(css: string, cssFilePath: string, zip: JSZip): Promise<string> {
  const base = cssFilePath.includes("/")
    ? cssFilePath.substring(0, cssFilePath.lastIndexOf("/") + 1)
    : "";
  const urlRegex = /url\(["']?([^"')]+)["']?\)/gi;
  const matches = [...css.matchAll(urlRegex)];
  for (const match of matches) {
    const ref = match[1];
    if (ref.startsWith("data:") || ref.startsWith("http")) continue;
    const ext = ref.split(".").pop()?.toLowerCase() ?? "";
    if (!CSS_ASSET_MIME[ext]) continue;
    const resolved = resolvePath(base, ref);
    const assetFile = zip.files[resolved];
    if (!assetFile) continue;
    const data = await assetFile.async("base64");
    css = css.replace(match[0], `url("data:${CSS_ASSET_MIME[ext]};base64,${data}")`);
  }
  return css;
}

// Build a fully self-contained HTML preview with inlined CSS, images, and JS.
export async function buildPreviewHTML(zip: JSZip, sourceGitHubUrl?: string): Promise<string | null> {
  // Find index.html — prefer non-minichat paths, then shallower depth
  const candidates = Object.keys(zip.files).filter(
    (f) => !zip.files[f].dir && (f.toLowerCase().endsWith("index.html") || f.toLowerCase().endsWith("index.htm"))
  );
  candidates.sort((a, b) => {
    const aIsMinichat = a.toLowerCase().includes("minichat") ? 1 : 0;
    const bIsMinichat = b.toLowerCase().includes("minichat") ? 1 : 0;
    if (aIsMinichat !== bIsMinichat) return aIsMinichat - bIsMinichat;
    return a.split("/").length - b.split("/").length;
  });
  if (candidates.length === 0) return null;

  const indexPath = candidates[0];
  const basePath = indexPath.includes("/") ? indexPath.substring(0, indexPath.lastIndexOf("/") + 1) : "";
  let html = await zip.files[indexPath].async("string");

  // Strip WP Rocket lazy loader (freezes document.readyState, breaks static preview)
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, _attrs, content) => {
    if (content.includes('RocketLazyLoadScripts') || content.includes('RocketElementorAnimation')) return '';
    return match;
  });
  // Convert WP Rocket deferred scripts to regular so they can load
  html = html.replace(/\s+type="rocketlazyloadscript"/gi, '');
  html = html.replace(/\bdata-rocket-src=/gi, 'src=');

  // Inline CSS: replace <link rel="stylesheet" href="..."> with <style>contents</style>
  const cssLinkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi;
  const cssMatches = [...html.matchAll(cssLinkRegex)];
  for (const match of cssMatches) {
    const href = match[1];
    if (href.startsWith("http")) continue;
    const cssPath = resolvePath(basePath, href);
    const cssFile = zip.files[cssPath];
    if (cssFile) {
      let cssContent = await cssFile.async("string");
      cssContent = await inlineCSSUrls(cssContent, cssPath, zip);
      const tag = match[0];
      const inlined = `<style>${cssContent}</style>`;
      html = html.replace(tag, () => inlined);
    }
  }
  // Also handle href before rel
  const cssLinkRegex2 = /<link[^>]+href=["']([^"']+\.css)["'][^>]*\/?>/gi;
  const cssMatches2 = [...html.matchAll(cssLinkRegex2)];
  for (const match of cssMatches2) {
    const href = match[1];
    if (href.startsWith("http")) continue;
    const cssPath = resolvePath(basePath, href);
    const cssFile = zip.files[cssPath];
    if (cssFile) {
      let cssContent = await cssFile.async("string");
      cssContent = await inlineCSSUrls(cssContent, cssPath, zip);
      const tag = match[0];
      const inlined = `<style>${cssContent}</style>`;
      html = html.replace(tag, () => inlined);
    }
  }

  // Inline images: replace src="..." with base64 data URIs
  const imgRegex = /src=["']([^"']+\.(png|jpg|jpeg|gif|svg|webp|ico))["']/gi;
  const imgMatches = [...html.matchAll(imgRegex)];
  for (const match of imgMatches) {
    const src = match[1];
    const ext = match[2].toLowerCase();
    if (src.startsWith("http") || src.startsWith("data:")) continue;
    const imgPath = resolvePath(basePath, src);
    const imgFile = zip.files[imgPath];
    if (imgFile) {
      const imgData = await imgFile.async("base64");
      const mimeMap: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon",
      };
      const mime = mimeMap[ext] || "application/octet-stream";
      const tag = match[0];
      const inlined = `src="data:${mime};base64,${imgData}"`;
      html = html.replace(tag, () => inlined);
    }
  }

  // Inline url() references remaining in HTML — catches Elementor/WP hero background images
  // set via style="background-image: url(path)" which inlineCSSUrls doesn't reach
  {
    const urlInHtmlRegex = /url\(["']?((?!data:|https?:|\/\/)([^"')#?\s]+))["']?\)/gi;
    const urlMatches = [...html.matchAll(urlInHtmlRegex)];
    const seen = new Set<string>();
    for (const match of urlMatches) {
      const ref = match[1].split("?")[0].split("#")[0];
      if (seen.has(ref)) continue;
      seen.add(ref);
      const ext = ref.split(".").pop()?.toLowerCase() ?? "";
      const mime = CSS_ASSET_MIME[ext];
      if (!mime) continue;
      const imgPath = resolvePath(basePath, ref);
      const imgFile = zip.files[imgPath];
      if (!imgFile) continue;
      const data = await imgFile.async("base64");
      const dataUrl = `data:${mime};base64,${data}`;
      const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(
        new RegExp(`url\\(["']?${escapedRef}["']?\\)`, "gi"),
        () => `url("${dataUrl}")`
      );
    }
  }

  // Inline JS from ZIP — skips external http URLs, embeds local scripts
  // Use () => replacement to prevent $ in JS content from being treated as regex special chars
  const jsRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const jsMatches = [...html.matchAll(jsRegex)];
  for (const match of jsMatches) {
    const src = match[1];
    if (src.startsWith("http")) continue;
    const jsPath = resolvePath(basePath, src);
    const jsFile = zip.files[jsPath];
    if (jsFile) {
      const jsContent = await jsFile.async("string");
      const safeContent = jsContent.replace(/<\/script>/gi, "<\\/script>");
      const tag = match[0];
      const inlined = `<script>${safeContent}</script>`;
      html = html.replace(tag, () => inlined);
    }
  }

  return html;
}

export interface ImageEntry {
  path: string;
  name: string;
  dataUrl: string;
  mime: string;
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
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const mime = IMG_MIME[ext];
    if (!mime) continue;
    try {
      const data = await file.async('base64');
      result.push({ path, name: path.split('/').pop() || path, dataUrl: `data:${mime};base64,${data}`, mime });
    } catch {}
  }
  return result;
}

export interface MinichatInfo {
  detected: boolean;
  whatsapp: string;
  botName: string;
}

export async function detectMinichat(zip: JSZip): Promise<MinichatInfo> {
  const info: MinichatInfo = { detected: false, whatsapp: '', botName: '' };
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir) continue;
    if (!path.toLowerCase().includes('minichat')) continue;
    info.detected = true;
    try {
      const content = await zip.files[path].async('string');
      const waMatch = content.match(/(?:whatsapp|phone|numero)['":\s]*['"]?([\d\s\-\+\(\)]{8,15})/i)
                   || content.match(/(\+?55\d{10,11})/);
      if (waMatch) info.whatsapp = waMatch[1].replace(/\D/g, '');
      const nameMatch = content.match(/(?:botName|nome|name|assistente)['":\s]+['"]([^'"]{2,50})['"]/i);
      if (nameMatch) info.botName = nameMatch[1];
    } catch {}
    if (info.whatsapp) break;
  }
  return info;
}

// Embedded token read from Vercel environment variable — never visible in UI
const EMBEDDED_GH_TOKEN = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_GITHUB_TOKEN) || "";

async function tryDownloadZip(zipUrl: string): Promise<ArrayBuffer | null> {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(zipUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(zipUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(zipUrl)}`,
  ];
  // Race all proxies in parallel — use whichever responds first with a valid ZIP
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
  _token?: string,
  onProgress?: (msg: string) => void
): Promise<JSZip> {
  const match = url.match(/github\.com\/([^\/\s?#]+)\/([^\/\s?#]+)/);
  if (!match) throw new Error("URL inválida. Use: github.com/usuario/repositorio");

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, "");
  const token = EMBEDDED_GH_TOKEN;

  // Try main and master branches in parallel — use whichever ZIP arrives first
  onProgress?.("Baixando repositório...");
  const zipResult = await Promise.any(
    ["main", "master"].map(async (branch) => {
      const zipUrl = `https://github.com/${owner}/${cleanRepo}/archive/refs/heads/${branch}.zip`;
      const buf = await tryDownloadZip(zipUrl);
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
      onProgress?.("Repositório carregado!");
      return stripped;
    } catch { /* corrupted — fall through to API */ }
  }

  // Fallback: GitHub API (uses embedded token — 5000 req/h, invisible to user)
  onProgress?.("Conectando via API...");
  const headers: HeadersInit = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `token ${token}`;

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/HEAD?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) {
    if (treeRes.status === 404) throw new Error("Repositório não encontrado ou é privado");
    if (treeRes.status === 401) throw new Error("Acesso negado ao repositório.");
    if (treeRes.status === 403) throw new Error("Limite de acesso atingido. Tente novamente em alguns minutos.");
    throw new Error(`Erro ao acessar repositório: ${treeRes.status}`);
  }

  const treeData = await treeRes.json();
  const blobs: any[] = treeData.tree.filter((f: any) => f.type === "blob");
  onProgress?.(`Carregando ${blobs.length} arquivo(s)...`);

  const zip = new JSZip();
  const batchSize = 8;
  for (let i = 0; i < blobs.length; i += batchSize) {
    const batch = blobs.slice(i, i + batchSize);
    await Promise.all(batch.map(async (f: any) => {
      try {
        const r = await fetch(
          `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${f.path}`,
          { headers }
        );
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
    onProgress?.(`${Math.min(i + batchSize, blobs.length)}/${blobs.length} arquivo(s) carregados...`);
  }
  return zip;
}

function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/") || relative.startsWith("http")) return relative;
  // Remove leading ./
  let rel = relative.replace(/^\.\//, "");
  let b = base;
  // Handle ../
  while (rel.startsWith("../")) {
    rel = rel.substring(3);
    b = b.replace(/[^/]+\/$/, "");
  }
  return b + rel;
}
