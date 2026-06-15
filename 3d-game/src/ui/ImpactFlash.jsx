import { motion, AnimatePresence } from "framer-motion";

export default function ImpactFlash({ color = "#ff3344" }) {
  const isCrit = color === "#ffd700";

  return (
    <AnimatePresence>
      <motion.div
        key={color}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        className="pointer-events-none absolute inset-0 z-[25]"
      >
        {isCrit && (
          <div
            className="absolute inset-0 crit-flash-base"
            style={{
              background: "#ffffff",
              mixBlendMode: "screen",
            }}
          />
        )}

        <div
          className="absolute inset-0 crit-flash-radial"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${color} 0%, rgba(0,0,0,0) 55%)`,
            mixBlendMode: "screen",
            transformOrigin: "50% 50%",
          }}
        />

        {isCrit && <div className="absolute inset-0 crit-flash-vignette" />}

        {isCrit && (
          <div
            className="absolute inset-0 crit-ember-burst"
            style={{
              background:
                "conic-gradient(from 0deg at 50% 50%, rgba(255,215,0,0) 0deg, rgba(255,215,0,0.35) 20deg, rgba(255,215,0,0) 40deg, rgba(255,215,0,0.35) 80deg, rgba(255,215,0,0) 120deg, rgba(255,215,0,0.35) 160deg, rgba(255,215,0,0) 200deg, rgba(255,215,0,0.35) 240deg, rgba(255,215,0,0) 280deg, rgba(255,215,0,0.35) 320deg, rgba(255,215,0,0) 360deg)",
              mixBlendMode: "screen",
              transformOrigin: "50% 50%",
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
