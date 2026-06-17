import { Upload, FileArchive, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRef, useState } from "react";

const GH_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || "";

interface UploadStepProps {
  onUpload: (files: FileList) => void;
  onGitHubImport: (url: string, token?: string) => Promise<void>;
  projectLoaded: boolean;
  fileCount: number;
  sourceLabel?: string;
}

const UploadStep = ({ onUpload, onGitHubImport, projectLoaded, fileCount, sourceLabel }: UploadStepProps) => {
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files);
  };

  const handleGitHubImport = async () => {
    if (!githubUrl.trim()) return;
    setGithubLoading(true);
    try {
      await onGitHubImport(githubUrl.trim(), GH_TOKEN || undefined);
    } finally {
      setGithubLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
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
              Arraste um arquivo .zip ou selecione uma pasta
            </p>
          </>
        )}

        <div className="flex flex-col gap-3 mt-6">
          <Button
            variant={showGitHub ? "default" : "outline"}
            onClick={() => setShowGitHub((v) => !v)}
            className="w-full"
          >
            <Github className="w-4 h-4 mr-2" />
            Importar do GitHub
          </Button>

          {showGitHub && (
            <div className="flex gap-2 mt-1">
              <Input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/usuario/repositorio"
                className="text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleGitHubImport()}
                autoFocus
              />
              <Button
                variant="hero"
                onClick={handleGitHubImport}
                disabled={githubLoading || !githubUrl.trim()}
                className="shrink-0"
              >
                {githubLoading ? "..." : "Importar"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <input
        ref={zipRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => e.target.files && onUpload(e.target.files)}
      />
      <input
        ref={folderRef}
        type="file"
        className="hidden"
        {...({ webkitdirectory: "true", directory: "true" } as any)}
        onChange={(e) => e.target.files && onUpload(e.target.files)}
      />
    </div>
  );
};

export default UploadStep;
