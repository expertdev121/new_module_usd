import { toast as sonnerToast } from "sonner";

interface ToastProps {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export const useToast = () => {
  const toast = ({ title, description, variant = "default" }: ToastProps) => {
    const baseStyle = {
      borderRadius: "12px",
      padding: "14px 16px",
      fontSize: "14px",
      boxShadow:
        "0 10px 25px rgba(0,0,0,0.25), 0 4px 10px rgba(0,0,0,0.15)",
    };

    if (variant === "destructive") {
      sonnerToast.error(title, {
        description,
        duration: 4000,
        style: {
          ...baseStyle,
          background: "#1f1f1f",
          color: "#f87171",
          border: "1px solid rgba(248, 113, 113, 0.25)",
          borderLeft: "4px solid #f87171",
        },
      });
    } else {
      sonnerToast.success(title, {
        description,
        duration: 4000,
        style: {
          ...baseStyle,
          background: "#1f1f1f",
          color: "#4ade80",
          border: "1px solid rgba(74, 222, 128, 0.25)",
          borderLeft: "4px solid #4ade80",
        },
      });
    }
  };

  return { toast };
};