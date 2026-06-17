import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState } from "react";
import type { ClientData, MinichatInfo } from "@/lib/site-processor";
import { ImagePlus, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface ClientFormProps {
  data: ClientData;
  onChange: (data: ClientData) => void;
  onSubmit: () => void;
  onBack: () => void;
  sourceLabel?: string;
  minichatInfo?: MinichatInfo;
}

const ClientForm = ({ data, onChange, onSubmit, onBack, sourceLabel, minichatInfo }: ClientFormProps) => {
  const imgRef = useRef<HTMLInputElement>(null);
  const [fichaOpen, setFichaOpen] = useState(false);
  const [fichaText, setFichaText] = useState("");

  const update = (field: keyof ClientData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const handleImages = (files: FileList | null) => {
    if (!files) return;
    onChange({ ...data, images: [...data.images, ...Array.from(files)] });
  };

  const handleExtract = () => {
    const text = fichaText;
    const updates: Partial<ClientData> = {};

    const nameMatch = text.match(/(?:nome|cliente|dr[a]?\.?)[:\s]+([^\n\r]+)/i);
    if (nameMatch) updates.name = nameMatch[1].trim();

    const areaMatch = text.match(/(?:especialidade|área|area|profiss[aã]o)[:\s]+([^\n\r]+)/i);
    if (areaMatch) updates.area = areaMatch[1].trim();

    const cityMatch = text.match(/(?:cidade|localidade)[:\s]+([^\n\r]+)/i);
    if (cityMatch) updates.city = cityMatch[1].trim();

    const waMatch = text.match(/(?:whatsapp|telefone|fone|tel|zap)[:\s]+([\d\s\-\+\(\)]{8,})/i);
    if (waMatch) updates.whatsapp = waMatch[1].replace(/\D/g, "");

    const descMatch = text.match(/(?:descri[çc][aã]o|descricao|servi[çc]os|sobre)[:\s]+([^\n\r]+)/i);
    if (descMatch) updates.description = descMatch[1].trim();

    onChange({ ...data, ...updates });
    setFichaOpen(false);
    toast.success("Dados extraídos!");
  };

  const canSubmit = data.name && data.area && data.description && data.city && data.whatsapp;
  const isUrlImport = sourceLabel?.startsWith("http");

  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* Ficha do Lead collapsible — at the very top */}
      <div className="border rounded-xl overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-left"
          onClick={() => setFichaOpen((v) => !v)}
        >
          <span>Colar ficha do lead</span>
          {fichaOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {fichaOpen && (
          <div className="p-4 space-y-3 border-t bg-white">
            <Textarea
              rows={5}
              value={fichaText}
              onChange={(e) => setFichaText(e.target.value)}
              placeholder={"Nome: Dr. Cláudio Filho\nEspecialidade: Cirurgia Plástica\nCidade: Belo Horizonte\nWhatsApp: 31999998888\nDescrição: Especialista em..."}
            />
            <Button size="sm" variant="outline" onClick={handleExtract}>
              Extrair dados
            </Button>
          </div>
        )}
      </div>

      {isUrlImport && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          Site importado por URL. Os dados serão aplicados automaticamente onde possível.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome do cliente / empresa</Label>
          <Input id="name" placeholder="Ex: Studio Maria" value={data.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="area">Área de atuação</Label>
          <Input id="area" placeholder="Ex: Estética, Advocacia" value={data.area} onChange={(e) => update("area", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="desc">Descrição dos serviços</Label>
        <Textarea id="desc" placeholder="Descreva os serviços oferecidos..." rows={3} value={data.description} onChange={(e) => update("description", e.target.value)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="city">Cidade</Label>
          <Input id="city" placeholder="Ex: São Paulo" value={data.city} onChange={(e) => update("city", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input id="whatsapp" placeholder="Ex: 11999998888" value={data.whatsapp} onChange={(e) => update("whatsapp", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="colors">Cores principais</Label>
        <Input id="colors" placeholder="Ex: azul, rosa, preto" value={data.colors} onChange={(e) => update("colors", e.target.value)} />
      </div>

      {/* Minichat section */}
      {minichatInfo?.detected && (
        <div className="border border-green-200 rounded-xl p-4 bg-green-50 space-y-3">
          <p className="text-sm font-semibold text-green-800">Minichat detectado</p>
          <div className="space-y-1.5">
            <Label htmlFor="minichat-wa">WhatsApp do bot</Label>
            <Input
              id="minichat-wa"
              placeholder={minichatInfo.whatsapp || "Número do bot"}
              value={data.minichatWhatsapp ?? minichatInfo.whatsapp}
              onChange={(e) => update("minichatWhatsapp", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="minichat-name">Nome do assistente</Label>
            <Input
              id="minichat-name"
              placeholder={minichatInfo.botName || "Nome do assistente"}
              value={data.minichatBotName ?? minichatInfo.botName}
              onChange={(e) => update("minichatBotName", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="joseph-id">ID JosephPay / Sensor</Label>
            <Input
              id="joseph-id"
              placeholder="ID do produto"
              value={data.josephPayId ?? ""}
              onChange={(e) => update("josephPayId", e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Imagens do cliente</Label>
        <div
          className="border border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => imgRef.current?.click()}
        >
          <ImagePlus className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {data.images.length > 0
              ? `${data.images.length} imagem(ns) selecionada(s)`
              : "Clique para adicionar imagens"}
          </p>
        </div>
        <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleImages(e.target.files)} />
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button variant="hero" size="lg" onClick={onSubmit} disabled={!canSubmit}>
          Gerar Site
        </Button>
      </div>
    </div>
  );
};

export default ClientForm;
