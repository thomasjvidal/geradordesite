import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Step {
  label: string;
  icon: ReactNode;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

const StepIndicator = ({ steps, currentStep }: StepIndicatorProps) => {
  return (
    <div className="flex items-center justify-center mb-8 overflow-x-auto px-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center flex-shrink-0">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold transition-all duration-300",
                i < currentStep
                  ? "bg-success text-success-foreground"
                  : i === currentStep
                  ? "gradient-primary text-primary-foreground shadow-elevated"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {i < currentStep ? <Check className="w-4 h-4" /> : step.icon}
            </div>
            <span
              className={cn(
                "text-[10px] sm:text-xs font-medium transition-colors",
                i === currentStep ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "w-6 sm:w-10 h-0.5 mx-1 sm:mx-2 mt-[-16px] flex-shrink-0 transition-colors",
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
