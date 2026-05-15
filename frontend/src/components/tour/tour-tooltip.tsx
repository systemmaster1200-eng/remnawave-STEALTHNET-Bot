import { TooltipRenderProps } from "react-joyride";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import type { ClientTourStep } from "@/lib/api";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Play, X } from "lucide-react";

interface TourTooltipProps extends TooltipRenderProps {
  tourSteps?: ClientTourStep[];
}

export function TourTooltip({
  index,
  step,
  size,
  isLastStep,
  primaryProps,
  backProps,
  skipProps,
  tooltipProps,
  tourSteps,
}: TourTooltipProps) {
  const currentStep = tourSteps?.[index];
  const mascot = currentStep?.mascot ?? null;
  const videoUrl = currentStep?.videoUrl ?? null;
  const isUploadedVideo = videoUrl?.startsWith("/api/uploads/") ?? false;

  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <motion.div
      {...tooltipProps}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="flex flex-col w-[400px] max-w-[90vw] z-[10000] overflow-hidden rounded-3xl border border-white/10 bg-background/80 shadow-2xl backdrop-blur-2xl"
    >
      {/* Top area: content + mascot side by side */}
      <div className="flex">
        {/* Content Side */}
        <div className={`flex-1 p-6 pb-3 ${mascot ? "w-[60%]" : "w-full"}`}>
          <div className="space-y-3">
            {/* Step dots indicator */}
            <div className="flex gap-1.5 mb-2">
              {Array.from({ length: size }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-4 bg-primary" : "w-1.5 bg-primary/20"
                  }`}
                />
              ))}
            </div>

            {step.title && (
              <h3 className="text-lg font-bold leading-tight text-foreground">
                {step.title}
              </h3>
            )}

            <div className="text-sm text-muted-foreground leading-relaxed">
              {step.content}
            </div>

            {/* Video embed if present */}
            {videoUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsVideoOpen(true)}
                className="mt-3 w-fit bg-white/10 hover:bg-white/20 border-white/20 text-foreground backdrop-blur-md rounded-xl"
              >
                <Play className="w-4 h-4 mr-2" />
                Смотреть видео
              </Button>
            )}
          </div>
        </div>

        {/* Mascot Side — PNG image */}
        {mascot && (
          <div className="relative flex w-[40%] shrink-0 items-end justify-center bg-primary/5 pt-4 overflow-hidden border-l border-white/5">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
            <img
              src={mascot.imageUrl}
              alt={mascot.name}
              className="max-w-full object-contain drop-shadow-lg z-10"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}
      </div>

      {/* Buttons — always below content+mascot */}
      <div className="px-6 pb-4 pt-2 flex items-center justify-between gap-3 border-t border-white/5">
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button
              {...backProps}
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground h-9 px-3"
            >
              ← Назад
            </Button>
          )}
          {!isLastStep && (
            <Button
              {...skipProps}
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground h-9 px-3"
            >
              Пропустить
            </Button>
          )}
        </div>
        
        <Button
          {...primaryProps}
          size="sm"
          className={`h-9 px-5 ml-auto font-medium shadow-md hover:scale-105 transition-transform ${isLastStep ? "bg-green-600 hover:bg-green-700 text-white" : "bg-primary text-primary-foreground"}`}
        >
          {isLastStep ? "Завершить" : "Далее →"}
        </Button>
      </div>

      {/* Video Overlay Portal */}
      {mounted && createPortal(
        <AnimatePresence>
          {isVideoOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setIsVideoOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="relative w-[95vw] max-w-[1400px] aspect-video rounded-3xl overflow-hidden border border-white/10 bg-black/50 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setIsVideoOpen(false)}
                  className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
                {isUploadedVideo ? (
                  <video
                    src={videoUrl!}
                    className="w-full h-full object-contain"
                    controls
                    autoPlay
                    onEnded={() => setIsVideoOpen(false)}
                  />
                ) : (
                  <iframe
                    src={videoUrl!}
                    className="w-full h-full"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}
