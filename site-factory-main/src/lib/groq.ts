const KEYS_KEY = "gk";
const IDX_KEY = "gki";
const EMBEDDED_GROQ_KEY = (import.meta as any).env?.VITE_GROQ_KEY || "";

export function saveGroqKeys(keys: string[]) {
  const clean = keys.map((k) => k.trim()).filter(Boolean);
  localStorage.setItem(KEYS_KEY, JSON.stringify(clean));
  localStorage.setItem(IDX_KEY, "0");
}

export function loadGroqKeys(): string[] {
  try { return JSON.parse(localStorage.getItem(KEYS_KEY) || "[]"); } catch { return []; }
}

export function getNextGroqKey(): string | null {
  const keys = loadGroqKeys();
  if (keys.length) {
    const idx = parseInt(localStorage.getItem(IDX_KEY) || "0") % keys.length;
    localStorage.setItem(IDX_KEY, String((idx + 1) % keys.length));
    return keys[idx];
  }
  return EMBEDDED_GROQ_KEY || null;
}

export interface SiteInfo {
  name?: string;
  phone?: string;
  city?: string;
  service?: string;
}

export async function groqExtractSiteInfo(
  htmlText: string,
  key: string
): Promise<SiteInfo> {
  // Strip tags, keep visible text only
  const text = htmlText
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "user",
            content: `From this website text, extract the main professional or business info. Return ONLY a JSON object (no markdown, no explanation) with these keys: name (full professional or business name), phone (digits only, may be whatsapp), city, service (specialty or main service). If a field is not found, omit it.\n\nText:\n${text}`,
          },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content || "{}";
    const match = raw.match(/\{[\s\S]*?\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch {
    return {};
  }
}

export async function groqGenerateDescription(
  name: string,
  area: string,
  key: string
): Promise<string> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "user",
            content: `Escreva uma descrição profissional curta (2-3 frases) para um site de ${name}, que atua na área de ${area}. Escreva em português do Brasil, tom profissional, sem clichês. Retorne APENAS o texto, sem aspas.`,
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}

export interface RewritePair { old: string; new: string; }

export async function groqRewriteBlocks(
  html: string,
  data: { name: string; area: string; description?: string; city?: string },
  existing: SiteInfo,
  key: string
): Promise<RewritePair[]> {
  // Extract visible text from h1-h3 and short paragraphs
  const blocks: string[] = [];
  const tagRx = /<(h[1-3]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = tagRx.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length >= 15 && text.length <= 300 && !blocks.includes(text)) {
      blocks.push(text);
    }
    if (blocks.length >= 20) break;
  }
  if (!blocks.length) return [];

  const context = `Profissional atual: ${existing.name || "?"}, área: ${existing.service || "?"}, cidade: ${existing.city || "?"}.
Novo profissional: ${data.name}, área: ${data.area}${data.city ? `, cidade: ${data.city}` : ""}${data.description ? `, descrição: ${data.description}` : ""}.`;

  const prompt = `${context}

Textos numerados do site:
${blocks.map((b, i) => `${i + 1}. "${b}"`).join("\n")}

Reescreva em português os textos que mencionam o profissional antigo, a área antiga, a cidade ou os serviços antigos — adaptando para o novo profissional. Retorne SOMENTE JSON válido: [{"i": número, "new": "texto reescrito"}]. Máximo 10 itens. Não inclua textos que não precisam mudar.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw: string = json.choices?.[0]?.message?.content || "[]";
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    const parsed: Array<{ i: number; new: string }> = JSON.parse(arrayMatch[0]);
    return parsed
      .filter(item => typeof item.i === "number" && item.i >= 1 && item.i <= blocks.length && typeof item.new === "string")
      .map(item => ({ old: blocks[item.i - 1], new: item.new }))
      .filter(pair => pair.old && pair.new && pair.old !== pair.new);
  } catch {
    return [];
  }
}
