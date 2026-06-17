import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState } from "react";
import type { ClientData, MinichatInfo } from "@/lib/site-processor";
import { ImagePlus, Info, X, ChevronDown, ChevronUp, ClipboardPaste, Sparkles, MessageSquare } from "lucide-react";

interface ClientFormProps {
  data: ClientData;
  onChange: (data: ClientData) => void;
  onSubmit: () => void;
  onBack: () => void;
  minichatInfo?: MinichatInfo;
}

/** Extrai valor de qualquer label → valor (aceita qualquer separador) */
function getField(text: string, keys: string[]): string {
  for (const key of keys) {
    // "Chave: valor" ou "Chave - valor" ou "Chave valor"
    const rx = new RegExp(`${key}\\s*[:\\-–|]?\\s*([^\\n]{2,80})`, "i");
    const m = text.match(rx);
    if (m) {
      const val = m[1].trim().replace(/^[:\\-–|]\s*/, "").trim();
      if (val && val.toLowerCase() !== "não encontrado" && val !== "-" && val.length > 1) return val;
    }
  }
  return "";
}

function parseFicha(text: string): Partial<ClientData> {
  // ── Nome ──────────────────────────────────────────────────
  let name = getField(text, [
    "Nome do Perfil do Instagram", "Nome do perfil", "Nome completo", "Nome",
    "Cliente", "Profissional", "Responsável",
  ]);
  // Se nome veio com "| área" junto, separar
  const pipeParts = name.split(/\s*[|\/]\s*/);
  if (pipeParts.length >= 2) name = pipeParts[0].trim();

  // Fallback: primeira linha não-vazia que parece nome próprio (2+ palavras capitalizadas)
  if (!name) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 6)) {
      const clean = line.replace(/^[-•*#>]+\s*/, "").trim();
      if (/^[A-ZÁÉÍÓÚÀÂÊÔÃÕÜ][a-záéíóúàâêôãõü]+ [A-ZÁÉÍÓÚÀÂÊÔÃÕÜ]/.test(clean) && clean.length < 60) {
        name = clean.split(/[|\/–\-:]/)[0].trim();
        break;
      }
    }
  }

  // ── Área / Especialidade ──────────────────────────────────
  let area = getField(text, [
    "Área de atuação", "Área", "Atuação", "Especialidade", "Especialidades",
    "Profissão", "Segmento", "Cargo", "Função", "Ocupação",
  ]);
  // Tenta pegar da mesma linha do nome (após |)
  if (!area && pipeParts.length >= 2) area = pipeParts[1].trim();
  area = area.split(",")[0].trim(); // pega só a primeira especialidade

  // ── Descrição / Serviços ──────────────────────────────────
  let description = "";
  // Bloco de serviços (lista)
  const servBlock = text.match(/servi[çc]os?[^:\n]*[:\n]([\s\S]{10,500}?)(?=\n[A-ZÁÉÍÓÚ][^:\n]{0,40}:\s|\n\n[A-ZÁÉÍÓÚ]|$)/i);
  if (servBlock) {
    description = servBlock[1].trim().split("\n")
      .map(l => l.trim().replace(/^[-•*\d.]+\s*/, "")).filter(l => l.length > 2).join(", ");
  }
  if (!description) description = getField(text, [
    "Descrição", "Sobre", "Bio", "Resumo", "Tagline", "Frase de impacto",
    "Serviços", "Serviço", "Especialidades",
  ]);
  if (!description) description = area; // fallback mínimo

  // ── Cidade ────────────────────────────────────────────────
  let city = getField(text, ["Cidade", "City", "Local", "Localização", "Região", "Endereço"]);
  city = city.split(/[-–,\/]/)[0].trim(); // remove " - SP", ", Brasil", etc

  // ── WhatsApp ──────────────────────────────────────────────
  const waRaw = getField(text, ["WhatsApp", "Whatsapp", "WhatsApps", "Telefone", "Celular", "Tel", "Contato"]);
  // Também busca qualquer número de telefone no texto
  const anyPhone = text.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/);
  const whatsappClean = (waRaw || (anyPhone ? anyPhone[0] : "")).replace(/\D/g, "");
  const whatsapp = whatsappClean.length >= 8 ? whatsappClean : "";

  return { name, area, description, city, whatsapp };
}

const ClientForm = ({ data, onChange, onSubmit, onBack, minichatInfo }: ClientFormProps) => {
  const imgRef = useRef<HTMLInputElement>(null);
  const [showFicha, setShowFicha] = useState(false);
  const [fichaText, setFichaText] = useState("");

  const update = (field: keyof ClientData, value: string) =>
    onChange({ ...data, [field]: value });

  const handleImages = (files: FileList | null) => {
    if (!files) return;
    onChange({ ...data, images: [...data.images, ...Array.from(files)] });
  };

  const removeImage = (i: number) => {
    const imgs = [...data.images];
    imgs.splice(i, 1);
    onChange({ ...data, images: imgs });
  };

  const handleParseFicha = () => {
    if (!fichaText.trim()) return;
    const parsed = parseFicha(fichaText);
    onChange({ ...data, ...parsed });
    setShowFicha(false);
    setFichaText("");
  };

  // Only name + area + description + city required; WhatsApp optional
  const canSubmit = data.name && data.area && data.description && data.city;

  return (
    <div className="max-w-xl mx-auto space-y-5">

      {/* FICHA PARSER */}
      <div className="border-2 border-blue-400/50 rounded-lg bg-blue-50/50 dark:bg-blue-950/20">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-400 w-full p-4"
          onClick={() => setShowFicha(!showFicha)}
        >
          {showFicha ? <ChevronUp className="w-4 h-4" /> : <ClipboardPaste className="w-4 h-4" />}
          Colar Ficha do Lead (preenche tudo automaticamente)
        </button>
        {showFicha && (
          <div className="px-4 pb-4 space-y-3">
            <Textarea
              placeholder="Cole aqui a ficha completa do lead..."
              rows={8}
              value={fichaText}
              onChange={(e) => setFichaText(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              onClick={handleParseFicha}
              className="w-full"
              disabled={!fichaText.trim()}
            >
              <Sparkles className="w-4 h-4 mr-2" /> Extrair dados da ficha
            </Button>
          </div>
        )}
      </div>

      {/* NEW CLIENT INFO */}
      <div className="border rounded-lg p-4 space-y-3 bg-green-50/50 dark:bg-green-950/20 border-green-400/50">
        <div className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
          <Info className="w-4 h-4" />
          Dados do cliente
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              placeholder="Ex: Verônica Freitas"
              value={data.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="area">Área de atuação *</Label>
            <Input
              id="area"
              placeholder="Ex: Fisioterapeuta"
              value={data.area}
              onChange={(e) => update("area", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desc">Serviços / Descrição *</Label>
          <Textarea
            id="desc"
            placeholder="Descreva os serviços do cliente..."
            rows={3}
            value={data.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="city">Cidade *</Label>
            <Input
              id="city"
              placeholder="Ex: Goiânia"
              value={data.city}
              onChange={(e) => update("city", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
            <Input
              id="whatsapp"
              placeholder="Ex: 5562999998888"
              value={data.whatsapp}
              onChange={(e) => update("whatsapp", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Colors */}
      <div className="border rounded-lg p-4 space-y-4 bg-accent/30">
        {/* Primary color */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cor principal</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>🎨 Atual no template</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.originalColors && /^#[0-9a-fA-F]{6}$/.test(data.originalColors) ? data.originalColors : "#000000"}
                  onChange={(e) => update("originalColors", e.target.value)}
                  className="w-10 h-9 rounded cursor-pointer border border-input bg-background p-0.5"
                />
                <Input
                  placeholder="#cc0000"
                  value={data.originalColors}
                  onChange={(e) => update("originalColors", e.target.value)}
                  className="flex-1 font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>✨ Substituir por</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.colors && /^#[0-9a-fA-F]{6}$/.test(data.colors) ? data.colors : "#000000"}
                  onChange={(e) => update("colors", e.target.value)}
                  className="w-10 h-9 rounded cursor-pointer border border-input bg-background p-0.5"
                />
                <Input
                  placeholder="#1A2B3C"
                  value={data.colors}
                  onChange={(e) => update("colors", e.target.value)}
                  className="flex-1 font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Secondary color */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cor secundária <span className="font-normal normal-case">(opcional)</span></p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>🎨 Atual no template</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.originalColors2 && /^#[0-9a-fA-F]{6}$/.test(data.originalColors2) ? data.originalColors2 : "#000000"}
                  onChange={(e) => update("originalColors2", e.target.value)}
                  className="w-10 h-9 rounded cursor-pointer border border-input bg-background p-0.5"
                />
                <Input
                  placeholder="#ffffff"
                  value={data.originalColors2}
                  onChange={(e) => update("originalColors2", e.target.value)}
                  className="flex-1 font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>✨ Substituir por</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={data.colors2 && /^#[0-9a-fA-F]{6}$/.test(data.colors2) ? data.colors2 : "#000000"}
                  onChange={(e) => update("colors2", e.target.value)}
                  className="w-10 h-9 rounded cursor-pointer border border-input bg-background p-0.5"
                />
                <Input
                  placeholder="#ffffff"
                  value={data.colors2}
                  onChange={(e) => update("colors2", e.target.value)}
                  className="flex-1 font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Images */}
      <div className="space-y-1.5">
        <Label>Imagens do cliente</Label>
        <div
          className="border border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => imgRef.current?.click()}
        >
          <ImagePlus className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {data.images.length > 0
              ? `${data.images.length} imagem(ns) adicionada(s)`
              : "Clique para adicionar imagens"}
          </p>
        </div>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleImages(e.target.files)}
        />
        {data.images.length > 0 && (
          <div className="space-y-1 mt-2">
            {data.images.map((img, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm bg-accent/40 rounded-md px-3 py-1.5"
              >
                <span className="truncate max-w-[200px]">{img.name}</span>
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="text-destructive hover:text-destructive/80"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground flex items-start gap-1">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Nomes iguais = troca exata. Pode também trocar imagens no Preview depois de gerar.
        </p>
      </div>

      {/* Minichat — aparece só se detectado no ZIP */}
      {minichatInfo?.detected && (
        <div className="border border-green-300 rounded-xl p-4 bg-green-50/60 dark:bg-green-950/20 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-800 dark:text-green-400">
            <MessageSquare className="w-4 h-4" />
            Minichat detectado no projeto
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mc-whatsapp">WhatsApp do bot</Label>
              <Input
                id="mc-whatsapp"
                placeholder={minichatInfo.whatsapp || "5511999998888"}
                value={data.minichatWhatsapp ?? minichatInfo.whatsapp}
                onChange={(e) => onChange({ ...data, minichatWhatsapp: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-botname">Nome do assistente</Label>
              <Input
                id="mc-botname"
                placeholder={minichatInfo.botName || "Assistente Virtual"}
                value={data.minichatBotName ?? minichatInfo.botName}
                onChange={(e) => onChange({ ...data, minichatBotName: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-joseph">UID JosephPay / Sensor</Label>
            <Input
              id="mc-joseph"
              placeholder="Ex: abc123-uuid"
              value={data.josephPayId ?? ""}
              onChange={(e) => onChange({ ...data, josephPayId: e.target.value })}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Cole o UID do produtor no painel JosephPay (campo "uid" do sensor.js)
            </p>
          </div>
        </div>
      )}

      {/* AI status */}
      <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
        <Sparkles className="w-3.5 h-3.5" />
        IA Groq ativa — vai reescrever automaticamente todos os textos do template
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button variant="hero" size="lg" onClick={onSubmit} disabled={!canSubmit}>
          🚀 Gerar Site
        </Button>
      </div>
    </div>
  );
};

export default ClientForm;
