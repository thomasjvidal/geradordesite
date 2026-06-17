import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Step {
  label: string;
  icon: React.ReactNode;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

const StepIndicator = ({ steps, currentStep }: StepIndicatorProps) => {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300",
                i < currentStep
                  ? "bg-success text-success-foreground"
                  : i === currentStep
                  ? "gradient-primary text-primary-foreground shadow-elevated"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {i < currentStep ? <Check className="w-5 h-5" /> : step.icon}
            </div>
            <span
              className={cn(
                "text-xs font-medium transition-colors",
                i === currentStep ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "w-12 h-0.5 mx-2 mt-[-18px] transition-colors",
                i < currentStep ? "bg-success" : "bg-muted"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default StepIndicator;
