/**
 * Groq AI — sistema de etiquetas (data-ai-id).
 * Injeta IDs únicos nos elementos, IA reescreve por ID, aplica de volta pelo ID.
 * Nunca falha por tags internas, whitespace ou encoding.
 */

const GROQ_API_KEYS = [
  import.meta.env.VITE_GROQ_API_KEY_1 ?? "",
  import.meta.env.VITE_GROQ_API_KEY_2 ?? "",
];

const MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-8b-8192",
];

export interface TaggedItem {
  id: number;
  text: string; // clean text sent to AI
  innerHtml: string; // original innerHTML (preserved for fallback)
}

/**
 * Step 1: inject data-ai-id="N" on every visible text element.
 * Returns the tagged HTML and the list of items to send to AI.
 */
export function tagHtmlForAI(html: string): { taggedHtml: string; items: TaggedItem[] } {
  // Work on a copy without scripts/styles for detection, but tag the real HTML
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const seen = new Set<string>();
  const items: TaggedItem[] = [];
  let counter = 0;

  let taggedHtml = html;

  // Process in priority order: headings first, then paragraphs, lists, links/buttons
  // Also include divs with Elementor text classes (elementor-heading-title, elementor-widget-container, etc.)
  const patterns: [RegExp, number][] = [
    [/<(h[1-3])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, 1],
    [/<(h[4-6])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, 2],
    [/<(p)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, 3],
    [/<(li)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, 4],
    [/<(a|button)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, 5],
    // Elementor-specific: div with text-only content (no child divs/sections)
    [/<(div)(\s[^>]*class="[^"]*elementor-(?:heading-title|text-editor|widget-container|cta-title|cta-description)[^"]*"[^>]*)>([\s\S]*?)<\/\1>/gi, 6],
  ];

  // Collect candidates from stripped HTML (for dedup), tag in real HTML
  for (const [pattern] of patterns) {
    for (const m of stripped.matchAll(pattern)) {
      const inner = m[3];
      // Skip divs that contain block-level children (only want leaf text nodes)
      if (m[1] === "div" && /<(div|section|article|aside|header|footer|ul|ol|table)/i.test(inner)) continue;

      const text = inner
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (text.length < 4 || /^\d+$/.test(text) || seen.has(text)) continue;
      if (items.length >= 80) break;

      seen.add(text);
      counter++;
      const id = counter;
      items.push({ id, text, innerHtml: inner });

      // Inject data-ai-id into the real HTML (first occurrence of this exact inner content)
      const escapedInner = inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagName = m[1];
      const attrs = m[2] || "";
      // Replace first occurrence that doesn't already have data-ai-id
      const findRe = new RegExp(
        `(<${tagName}${attrs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(>)(${escapedInner})(<\\/${tagName}>)`,
        "i"
      );
      taggedHtml = taggedHtml.replace(findRe, (full, open, gt, content, close) => {
        if (open.includes("data-ai-id")) return full; // already tagged
        return `${open} data-ai-id="${id}"${gt}${content}${close}`;
      });
    }
    if (items.length >= 80) break;
  }

  return { taggedHtml, items };
}

/**
 * Rewrite Elementor data-settings JSON text fields with AI results.
 * Called after applyAIToTaggedHtml to keep data-settings in sync with visible text.
 */
export function applyAIToDataSettings(html: string, items: TaggedItem[], replacements: Map<number, string>): string {
  // Build old→new text map
  const textMap = new Map<string, string>();
  for (const [id, newText] of replacements) {
    const item = items.find(t => t.id === id);
    if (item) textMap.set(item.text, newText);
  }
  if (textMap.size === 0) return html;

  // Replace text inside &quot;-encoded JSON values in data-settings
  // Matches: &quot;title&quot;:&quot;OLD TEXT&quot; or &quot;text&quot;:&quot;OLD TEXT&quot;
  for (const [oldText, newText] of textMap) {
    const escapedOld = oldText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // HTML-encoded variant (&quot;)
    html = html.replace(
      new RegExp(`(&quot;(?:title|text|editor|description|button_text|heading|sub_heading)&quot;:&quot;)${escapedOld}(&quot;)`, "g"),
      (_, pre, post) => `${pre}${newText}${post}`
    );
  }
  return html;
}

/**
 * Step 2: send items to AI, get back Map<id, newText>.
 */
export async function rewriteWithAI(
  items: TaggedItem[],
  clientData: { name: string; area: string; description: string; city: string; whatsapp: string },
  apiKey?: string,
  onProgress?: (msg: string) => void
): Promise<Map<number, string>> {
  const keys = [...new Set([apiKey?.trim(), ...GROQ_API_KEYS].filter(Boolean))] as string[];
  if (!keys.length || !items.length) return new Map();

  onProgress?.(`🤖 IA reescrevendo ${items.length} blocos de texto...`);

  const cleanPhone = clientData.whatsapp?.replace(/\D/g, "") || "";

  // Detect old client from first items
  const profKw = /médic|doutor|dra?\.|enfermeir|fisioter|nutri|psicólog|advogad|dentist|cirurgi|dermatol|pediatr|ginecol|ortoped|cardiol|oncolog|neurolog|oftalmol|urologis|psiquiatr|coach|consultora?|arquitet|engenhei|contador|veterinár/i;
  let oldName = "", oldArea = "";
  for (const item of items.slice(0, 10)) {
    if (!oldName && /^[A-ZÁÉÍÓÚÀÂÊÔÃÕÜ]/.test(item.text) && item.text.split(" ").length <= 6 && item.text.length < 60) {
      oldName = item.text.replace(/^(Conheça (a?|o?)\s*|Sobre (a?|o?)\s*|Dr\.?a?\.?\s*)/i, "").trim();
    }
    if (!oldArea) {
      const m = item.text.match(profKw);
      if (m) oldArea = m[0];
    }
    if (oldName && oldArea) break;
  }

  if (oldName || oldArea) {
    onProgress?.(`🔍 Lead anterior detectada: ${oldName || "?"} / ${oldArea || "?"}`);
  }

  const oldClientSection = (oldName || oldArea)
    ? `\nCLIENTE ANTERIOR (substitua TUDO relacionado a este cliente):\n${oldName ? `Nome: ${oldName}\n` : ""}${oldArea ? `Especialidade/área: ${oldArea}\n` : ""}`
    : "";

  const numberedList = items.map(i => `${i.id}. ${i.text}`).join("\n");

  const systemPrompt = `Você adapta textos de templates de sites para novos clientes.
Receberá uma lista numerada de textos e os dados do novo cliente.
Reescreva TODOS e retorne APENAS a lista no mesmo formato:
1. [texto reescrito]
2. [texto reescrito]

REGRAS:
- Reescreva TODOS os itens sem exceção
- Substitua o nome do cliente anterior pelo novo
- Substitua a especialidade anterior pela nova
- Substitua cidade, telefone, serviços pelo do novo cliente
- Reescreva taglines/CTAs para a nova área
- Remova registros profissionais (CRM, CRO, OAB, etc.)
- Para textos genéricos ("Saiba mais", "Contato"), repita igual
- NUNCA retorne item vazio`;

  const userPrompt = `NOVO CLIENTE:
Nome: ${clientData.name}
Área: ${clientData.area}
Serviços: ${clientData.description}
Cidade: ${clientData.city}${cleanPhone ? `\nWhatsApp: ${cleanPhone}` : ""}
${oldClientSection}
TEXTOS:
${numberedList}`;

  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki];
    const keyLabel = `chave ${ki + 1}`;
    for (const model of MODELS) {
      onProgress?.(`🔄 IA: tentando ${keyLabel} / ${model}...`);
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 4096,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          let errMsg = "";
          try { errMsg = JSON.parse(errText).error?.message || ""; } catch { errMsg = errText; }
          if (response.status === 429 || errMsg.includes("rate_limit") || errMsg.includes("tokens")) {
            onProgress?.(`⚠️ ${keyLabel}/${model}: limite atingido, tentando próximo...`);
            continue;
          }
          onProgress?.(`⚠️ Erro ${response.status} (${keyLabel}/${model})`);
          continue;
        }

        const json = await response.json();
        const rawContent: string = json.choices?.[0]?.message?.content || "";
        if (!rawContent) { onProgress?.(`⚠️ ${keyLabel}/${model}: resposta vazia`); continue; }

        onProgress?.(`📥 Resposta recebida de ${model}, aplicando...`);

        const result = new Map<number, string>();
        for (const line of rawContent.split("\n")) {
          const m = line.match(/^(\d+)\.\s+(.+)$/);
          if (!m) continue;
          const id = parseInt(m[1]);
          const newText = m[2].trim();
          const original = items.find(t => t.id === id);
          if (original && newText) result.set(id, newText);
        }

        if (result.size === 0) { onProgress?.(`⚠️ ${model}: não retornou nenhum item`); continue; }

        // Second pass for any missing items
        const missing = items.filter(t => !result.has(t.id));
        if (missing.length > 0) {
          onProgress?.(`🔄 Segunda passagem: ${missing.length} itens restantes...`);
          const secondList = missing.map(t => `${t.id}. ${t.text}`).join("\n");
          try {
            const r2 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: `NOVO CLIENTE:\nNome: ${clientData.name}\nÁrea: ${clientData.area}\nServiços: ${clientData.description}\nCidade: ${clientData.city}${cleanPhone ? `\nWhatsApp: ${cleanPhone}` : ""}${oldClientSection}\nTEXTOS:\n${secondList}` },
                ],
                temperature: 0.3,
                max_tokens: 2048,
              }),
            });
            if (r2.ok) {
              const j2 = await r2.json();
              for (const line of (j2.choices?.[0]?.message?.content || "").split("\n")) {
                const m2 = line.match(/^(\d+)\.\s+(.+)$/);
                if (m2) result.set(parseInt(m2[1]), m2[2].trim());
              }
            }
          } catch { /* ignore */ }
        }

        onProgress?.(`✅ IA reescreveu ${result.size} de ${items.length} blocos (${model})`);
        return result;

      } catch (error) {
        onProgress?.(`⚠️ ${keyLabel}/${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  onProgress?.("⚠️ IA indisponível — todos os modelos/chaves falharam");
  return new Map();
}

/**
 * Step 3: apply AI results to tagged HTML by ID, then strip data-ai-id attributes.
 */
export function applyAIToTaggedHtml(taggedHtml: string, replacements: Map<number, string>): string {
  let result = taggedHtml;

  for (const [id, newText] of replacements) {
    // Replace innerHTML of the element with this data-ai-id
    result = result.replace(
      new RegExp(`(<[^>]+data-ai-id="${id}"[^>]*>)([\\s\\S]*?)(<\\/[^\\s>]+>)`, "i"),
      (_, open, _inner, close) => `${open}${newText}${close}`
    );
  }

  // Remove all injected data-ai-id attributes
  result = result.replace(/ data-ai-id="\d+"/g, "");
  return result;
}

// Legacy export kept for any remaining callers
export function applyReplacements(content: string, replacements: [string, string][]): string {
  let result = content;
  for (const [old, replacement] of replacements) {
    if (!old || !replacement) continue;
    if (result.includes(old)) {
      result = result.split(old).join(replacement);
    } else {
      const cleanKey = old.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
      if (cleanKey && cleanKey.length > 3 && result.includes(cleanKey)) {
        result = result.split(cleanKey).join(replacement);
      }
    }
  }
  return result;
}
