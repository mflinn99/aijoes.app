import { useEffect } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

type DemoModalProps = {
  onClose: () => void;
};

const DEMO_VIDEO_URL = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&rel=0&modestbranding=1";

export function DemoModal({ onClose }: DemoModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-testid="demo-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ background: "rgba(3,5,10,0.92)", backdropFilter: "blur(12px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="relative w-full mx-4"
        data-testid="demo-modal"
        style={{
          maxWidth: 760,
          background: "rgba(6,9,16,0.98)",
          border: "1px solid rgba(77,163,255,0.12)",
          borderRadius: "6px",
          overflow: "hidden",
          boxShadow: "0 0 120px rgba(77,163,255,0.06), 0 40px 80px rgba(0,0,0,0.9)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div>
            <p className="text-xs tracking-widest uppercase" style={{ color: "#4da3ff", letterSpacing: "0.15em", fontSize: "10px" }}>
              BOARDROOM INTELLIGENCE
            </p>
            <p className="text-sm font-light mt-0.5" style={{ color: "#8a96a8", letterSpacing: "0.04em" }}>
              A live boardroom where six intelligences think in parallel.
            </p>
          </div>
          <button
            onClick={onClose}
            data-testid="demo-modal-close"
            className="text-gray-500 hover:text-gray-300 transition-colors ml-4"
          >
            <X size={16} />
          </button>
        </div>

        {/* Video */}
        <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
          <iframe
            src={DEMO_VIDEO_URL}
            title="SIXONIC Demo"
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              border: "none",
            }}
            data-testid="demo-video"
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
