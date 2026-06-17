import { useState, useCallback, useRef } from "react";
import JSZip from "jszip";
import StepIndicator from "@/components/StepIndicator";
import UploadStep from "@/components/UploadStep";
import ClientForm from "@/components/ClientForm";
import GeneratingStep from "@/components/GeneratingStep";
import PreviewStep from "@/components/PreviewStep";
import {
  loadZipFromFiles, loadFromImage, loadFromUrl, loadFromGitHub,
  processProject, detectMinichat, type ClientData, type MinichatInfo,
} from "@/lib/site-processor";
import { getNextGroqKey } from "@/lib/groq";
import { Upload, FileText, Sparkles, Eye } from "lucide-react";
import { toast } from "sonner";

const STEPS = [
  { label: "Upload", icon: <Upload className="w-4 h-4" /> },
  { label: "Dados", icon: <FileText className="w-4 h-4" /> },
  { label: "Gerar", icon: <Sparkles className="w-4 h-4" /> },
  { label: "Preview", icon: <Eye className="w-4 h-4" /> },
];

const INITIAL_DATA: ClientData = {
  name: "", area: "", description: "", city: "", whatsapp: "", colors: "", images: [],
  minichatWhatsapp: undefined,
  minichatBotName: undefined,
  josephPayId: undefined,
};

const Index = () => {
  const [step, setStep] = useState(0);
  const [projectZip, setProjectZip] = useState<JSZip | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [sourceLabel, setSourceLabel] = useState("");
  const [clientData, setClientData] = useState<ClientData>(INITIAL_DATA);
  const [minichatInfo, setMinichatInfo] = useState<MinichatInfo | undefined>(undefined);
  const [logs, setLogs] = useState<string[]>([]);
  const [outputZip, setOutputZip] = useState<JSZip | null>(null);
  // Prevents stale async result from advancing step if user navigated back
  const cancelledRef = useRef(false);

  const handleUpload = useCallback(async (files: FileList) => {
    try {
      const zip = await loadZipFromFiles(files);
      const count = Object.keys(zip.files).filter((f) => !zip.files[f].dir).length;
      setProjectZip(zip);
      setFileCount(count);
      setSourceLabel(files.length === 1 && files[0].name.endsWith(".zip") ? "arquivo .zip" : "pasta");
      const mc = await detectMinichat(zip);
      setMinichatInfo(mc);
      toast.success(`Projeto carregado com ${count} arquivos`);
      setTimeout(() => setStep(1), 600);
    } catch {
      toast.error("Erro ao carregar o projeto. Verifique o arquivo.");
    }
  }, []);

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const zip = await loadFromImage(file);
      const count = Object.keys(zip.files).filter((f) => !zip.files[f].dir).length;
      setProjectZip(zip);
      setFileCount(count);
      setSourceLabel("imagem");
      const mc = await detectMinichat(zip);
      setMinichatInfo(mc);
      toast.success("Imagem carregada! Preencha os dados do cliente.");
      setTimeout(() => setStep(1), 600);
    } catch {
      toast.error("Erro ao carregar a imagem.");
    }
  }, []);

  const handleUrlImport = useCallback(async (url: string) => {
    try {
      const zip = await loadFromUrl(url, (msg) => toast.info(msg));
      setProjectZip(zip);
      setFileCount(1);
      setSourceLabel(url);
      const mc = await detectMinichat(zip);
      setMinichatInfo(mc);
      toast.success("Site importado! Preencha os dados do cliente.");
      setTimeout(() => setStep(1), 600);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao importar o link. Verifique a URL.");
    }
  }, []);

  const handleGitHubImport = useCallback(async (url: string) => {
    try {
      const token = localStorage.getItem("gt") || undefined;
      const zip = await loadFromGitHub(url, token, (msg) => toast.info(msg));
      const count = Object.keys(zip.files).filter((f) => !zip.files[f].dir).length;
      setProjectZip(zip);
      setFileCount(count);
      setSourceLabel(url);
      const mc = await detectMinichat(zip);
      setMinichatInfo(mc);
      toast.success(`Repositório importado com ${count} arquivo(s)!`);
      setTimeout(() => setStep(1), 600);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao importar o repositório GitHub.");
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!projectZip) return;
    cancelledRef.current = false;
    setStep(2);
    setLogs([]);

    try {
      const groqKey = getNextGroqKey() || undefined;
      const result = await processProject(projectZip, clientData, (msg) => {
        setLogs((prev) => [...prev, msg]);
      }, groqKey);
      if (cancelledRef.current) return;
      setOutputZip(result);
      toast.success("Site gerado com sucesso!");
      setStep(3);
    } catch {
      if (cancelledRef.current) return;
      toast.error("Erro ao gerar o site.");
      setStep(1);
    }
  }, [projectZip, clientData]);

  const handleBackFromGenerate = useCallback(() => {
    cancelledRef.current = true;
    setStep(1);
  }, []);

  const handleReset = () => {
    setStep(0);
    setProjectZip(null);
    setFileCount(0);
    setSourceLabel("");
    setClientData(INITIAL_DATA);
    setMinichatInfo(undefined);
    setLogs([]);
    setOutputZip(null);
  };

  return (
    <div className="min-h-screen gradient-hero">
      <div className="container max-w-3xl py-6 sm:py-10 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            Gerador de Sites Inteligente
          </h1>
          <p className="text-muted-foreground mt-2">
            Gere um site completo em minutos a partir do seu projeto
          </p>
        </div>

        <StepIndicator steps={STEPS} currentStep={step} />

        <div className="bg-card rounded-2xl border shadow-card p-6 sm:p-8">
          {step === 0 && (
            <UploadStep
              onUpload={handleUpload}
              onImageUpload={handleImageUpload}
              onUrlImport={handleUrlImport}
              onGitHubImport={handleGitHubImport}
              projectLoaded={!!projectZip}
              fileCount={fileCount}
              sourceLabel={sourceLabel}
            />
          )}
          {step === 1 && (
            <ClientForm
              data={clientData}
              onChange={setClientData}
              onSubmit={handleGenerate}
              onBack={() => setStep(0)}
              sourceLabel={sourceLabel}
              minichatInfo={minichatInfo}
            />
          )}
          {step === 2 && (
            <GeneratingStep logs={logs} onBack={handleBackFromGenerate} />
          )}
          {step === 3 && (
            <PreviewStep
              zip={outputZip}
              clientName={clientData.name}
              clientData={clientData}
              onReset={handleReset}
              onBack={() => setStep(1)}
              sourceLabel={sourceLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
