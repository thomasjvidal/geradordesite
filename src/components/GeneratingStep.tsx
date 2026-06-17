import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GeneratingStepProps {
  logs: string[];
  onBack: () => void;
}

const GeneratingStep = ({ logs, onBack }: GeneratingStepProps) => {
  return (
    <div className="max-w-md mx-auto text-center">
      <div className="gradient-primary w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
        <Loader2 className="w-8 h-8 text-primary-foreground animate-spin" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">Gerando seu site...</h3>
      <p className="text-sm text-muted-foreground mb-6">Aguarde enquanto processamos os arquivos</p>

      <div className="bg-card rounded-lg border p-4 text-left max-h-48 overflow-y-auto mb-6">
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground font-mono py-0.5 animate-pulse">→ Iniciando...</p>
        ) : (
          logs.map((log, i) => (
            <p
              key={i}
              className={`text-xs font-mono py-0.5 ${
                log.startsWith("⚠️") || log.startsWith("❌")
                  ? "text-yellow-600 dark:text-yellow-400"
                  : log.startsWith("✅") || log.includes("reescreveu")
                  ? "text-green-600 dark:text-green-400"
                  : "text-muted-foreground"
              }`}
            >
              → {log}
            </p>
          ))
        )}
      </div>

      <Button variant="ghost" size="sm" onClick={onBack}>
        ← Voltar para Dados
      </Button>
    </div>
  );
};

export default GeneratingStep;
