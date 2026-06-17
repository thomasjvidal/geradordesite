import { Upload, FileArchive, ImagePlus, Link, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRef, useState } from "react";

interface UploadStepProps {
  onUpload: (files: FileList) => void;
  onImageUpload: (file: File) => void;
  onUrlImport: (url: string) => void;
  onGitHubImport: (url: string) => void;
  projectLoaded: boolean;
  fileCount: number;
  sourceLabel?: string;
}

const UploadStep = ({ onUpload, onImageUpload, onUrlImport, onGitHubImport, projectLoaded, fileCount, sourceLabel }: UploadStepProps) => {
  const imageRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImageUpload(file);
    e.target.value = "";
  };

  const handleLinkImport = async () => {
    if (!linkUrl.trim()) return;
    setLinkLoading(true);
    try { await onUrlImport(linkUrl.trim()); }
    finally { setLinkLoading(false); }
  };

  const handleGitHubImport = async () => {
    if (!githubUrl.trim()) return;
    setGithubLoading(true);
    try { await onGitHubImport(githubUrl.trim()); }
    finally { setGithubLoading(false); }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${
          dragOver ? "border-primary bg-accent"
          : projectLoaded ? "border-success bg-accent/50"
          : "border-border"
        }`}
      >
        {projectLoaded ? (
          <>
            <FileArchive className="w-12 h-12 mx-auto mb-4 text-success" />
            <p className="text-lg font-semibold text-foreground">Projeto carregado!</p>
            <p className="text-sm text-muted-foreground mt-1">
              {fileCount} arquivo(s) · {sourceLabel || "projeto"}
            </p>
          </>
        ) : (
          <>
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-semibold text-foreground">Envie seu projeto</p>
            <p className="text-sm text-muted-foreground mt-2">
              Arraste arquivos ou escolha uma opção abaixo
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-3 mt-6">
          <Button variant="outline" onClick={() => imageRef.current?.click()}>
            <ImagePlus className="w-4 h-4 mr-2" /> Imagem
          </Button>
          <Button
            variant={showLink ? "default" : "outline"}
            onClick={() => { setShowLink((v) => !v); setShowGitHub(false); }}
          >
            <Link className="w-4 h-4 mr-2" /> Link
          </Button>
          <Button
            variant={showGitHub ? "default" : "outline"}
            className="col-span-2"
            onClick={() => { setShowGitHub((v) => !v); setShowLink(false); }}
          >
            <Github className="w-4 h-4 mr-2" /> Repositório GitHub
          </Button>
        </div>

        {showLink && (
          <div className="mt-4 flex gap-2">
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://seusite.com"
              className="text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleLinkImport()}
              autoFocus
            />
            <Button variant="hero" onClick={handleLinkImport}
              disabled={linkLoading || !linkUrl.trim()} className="shrink-0">
              {linkLoading ? "..." : "Importar"}
            </Button>
          </div>
        )}

        {showGitHub && (
          <div className="mt-4 flex gap-2">
            <Input
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/usuario/repositorio"
              className="text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleGitHubImport()}
              autoFocus
            />
            <Button variant="hero" onClick={handleGitHubImport}
              disabled={githubLoading || !githubUrl.trim()} className="shrink-0">
              {githubLoading ? "..." : "Importar"}
            </Button>
          </div>
        )}
      </div>

      <input ref={imageRef} type="file" accept="image/*" className="hidden"
        onChange={handleImageChange} />
    </div>
  );
};

export default UploadStep;
