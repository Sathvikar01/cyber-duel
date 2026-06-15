import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FantasyButton from "./FantasyButton";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.5, staggerChildren: 0.1 },
  },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

const titleVariants = {
  hidden: { opacity: 0, y: -20, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
  },
};

const ARENA_SWATCHES = {
  temple: {
    from: "#2a2010",
    to: "#d4af37",
    accent: "#e71d36",
    atmos: "molten",
    cardClass: "atmos-card-temple",
    pattern: "embers",
  },
  bamboo: {
    from: "#0d1f17",
    to: "#3a5f40",
    accent: "#adff2f",
    atmos: "hushed",
    cardClass: "atmos-card-bamboo",
    pattern: "stalks",
  },
  coliseum: {
    from: "#2a1c4a",
    to: "#b45a2b",
    accent: "#ff9d3e",
    atmos: "ruined",
    cardClass: "atmos-card-coliseum",
    pattern: "stone",
  },
  shrine: {
    from: "#0a1424",
    to: "#3a6b8c",
    accent: "#6ecfff",
    atmos: "frozen",
    cardClass: "atmos-card-shrine",
    pattern: "lanterns",
  },
};

const ArenaPattern = ({ kind }) => {
  if (kind === "embers") {
    return (
      <>
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 80%, rgba(231,29,54,0.6) 0px, transparent 2px), radial-gradient(circle at 70% 30%, rgba(249,215,108,0.6) 0px, transparent 1.5px)",
            backgroundSize: "60px 60px, 80px 80px",
          }}
        />
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "linear-gradient(115deg, transparent 0%, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%, transparent 100%)",
          }}
        />
      </>
    );
  }
  if (kind === "stalks") {
    return (
      <>
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute bottom-0 w-[3px] bg-gradient-to-t from-transparent via-[rgba(173,255,47,0.35)] to-transparent"
            style={{
              left: `${(i + 0.5) * 12}%`,
              height: `${60 + (i % 3) * 15}%`,
            }}
          />
        ))}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 0%, rgba(173,255,47,0.4) 0%, transparent 50%)",
          }}
        />
      </>
    );
  }
  if (kind === "stone") {
    return (
      <>
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent 0px, transparent 18px, rgba(255,255,255,0.06) 18px, rgba(255,255,255,0.06) 20px)",
            backgroundPositionY: "top",
          }}
        />
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0px, transparent 22px, rgba(180,90,43,0.18) 22px, rgba(180,90,43,0.18) 24px)",
          }}
        />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 100%, rgba(255,157,62,0.35) 0%, transparent 55%)",
          }}
        />
      </>
    );
  }
  if (kind === "lanterns") {
    return (
      <>
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute h-2 w-2 rounded-full"
            style={{
              left: `${10 + i * 15}%`,
              top: `${20 + (i % 2) * 30}%`,
              background: "radial-gradient(circle, #f9d76c 0%, #6ecfff 50%, transparent 80%)",
              boxShadow: "0 0 12px #f9d76c, 0 0 24px #6ecfff",
            }}
          />
        ))}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(7,13,22,0.0) 0%, rgba(7,13,22,0.7) 100%)",
          }}
        />
      </>
    );
  }
  return null;
};

export default function ArenaSelectScreen({
  arenas = [],
  selectedId,
  onSelect,
  onConfirm,
  onBack,
}) {
  const selected = arenas.find((a) => a.id === selectedId) || arenas[0];
  const [hoveredId, setHoveredId] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = () => {
    if (!selected) return;
    setConfirming(true);
    setTimeout(() => onConfirm?.(), 800);
  };

  useEffect(() => {
    if (confirming) {
      const timer = setTimeout(() => setConfirming(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [confirming]);

  const accent = selected?.id
    ? ARENA_SWATCHES[selected.id]?.accent || "#d4af37"
    : "#d4af37";

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-ink-900/95 font-body backdrop-blur-sm"
    >
      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, transparent 0%, rgba(5,4,10,0.4) 50%, rgba(5,4,10,0.92) 100%)",
        }}
      />

      {/* Ambient color wash from selected arena, with breathing opacity */}
      <div
        className="pointer-events-none absolute inset-0 z-[2] transition-[background] duration-700"
        style={{
          animation: "ambient-breath 6s ease-in-out infinite",
          background: selected?.id
            ? `radial-gradient(circle at 50% 60%, ${accent}55 0%, transparent 65%)`
            : "none",
        }}
      />

      {/* Confirm-to-arena fade overlay */}
      <AnimatePresence>
        {confirming && (
          <div
            key="confirm-fade"
            className="arena-confirm-overlay"
            style={{ "--arena-accent": accent }}
          />
        )}
      </AnimatePresence>

      <div className="relative z-10 flex w-full max-w-6xl flex-col items-center px-6 py-6">
        {/* Header */}
        <div className="mb-6 text-center">
          <motion.h1
            variants={titleVariants}
            className="font-title text-4xl tracking-[0.18em] text-gold sm:text-5xl md:text-6xl"
            style={{
              textShadow:
                "0 2px 24px rgba(0,0,0,0.9), 0 0 30px rgba(212,175,55,0.35)",
              fontFamily: "var(--font-title)",
            }}
          >
            Choose the Battleground
          </motion.h1>
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="mx-auto mt-3 h-[1px] w-56 bg-gradient-to-r from-transparent via-gold/70 to-transparent"
          />
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-2 text-xs uppercase tracking-[0.4em] text-parchment-dark"
            style={{ fontFamily: "var(--font-fantasy)" }}
          >
            four grounds · one fate
          </motion.p>
        </div>

        {/* Arena cards grid */}
        <motion.div
          variants={containerVariants}
          className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {arenas.map((arena) => {
            const isSelected = arena.id === selectedId;
            const isHovered = arena.id === hoveredId;
            const swatch = ARENA_SWATCHES[arena.id] || ARENA_SWATCHES.temple;

            return (
              <motion.button
                key={arena.id}
                variants={cardVariants}
                onClick={() => onSelect(arena.id)}
                onMouseEnter={() => setHoveredId(arena.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`
                  group card-tilt relative flex flex-col overflow-hidden rounded-sm border text-left
                  ${
                    isSelected
                      ? "border-gold/80"
                      : "border-gold/20 hover:border-gold/50"
                  }
                `}
                style={{
                  background:
                    "linear-gradient(180deg, rgba(20,16,28,0.6) 0%, rgba(8,6,14,0.92) 100%)",
                  minHeight: 360,
                  boxShadow: isSelected
                    ? `0 0 30px 2px ${swatch.accent}55, 0 12px 32px rgba(0,0,0,0.6)`
                    : isHovered
                    ? `0 0 18px 1px ${swatch.accent}33`
                    : undefined,
                }}
              >
                {/* Full-card atmospheric image */}
                <div className={`relative h-44 w-full ${swatch.cardClass}`}>
                  <ArenaPattern kind={swatch.pattern} />
                  {/* Brighten on hover */}
                  <div
                    className="absolute inset-0 transition-all duration-500"
                    style={{
                      background: isHovered
                        ? "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 40%)"
                        : "linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.35) 100%)",
                      mixBlendMode: isHovered ? "screen" : "normal",
                    }}
                  />
                  {/* Atmosphere tag (1-word) */}
                  <span
                    className={`
                      absolute right-3 top-3 rounded-sm border border-gold/40 bg-ink-900/70 px-2 py-0.5
                      font-title text-[10px] uppercase tracking-[0.25em] text-parchment
                      transition-all duration-300
                      ${
                        isHovered
                          ? "opacity-100 translate-y-0"
                          : "translate-y-1 opacity-60"
                      }
                    `}
                    style={{
                      fontFamily: "var(--font-fantasy)",
                      color: swatch.accent,
                      textShadow: `0 0 8px ${swatch.accent}88`,
                    }}
                  >
                    {swatch.atmos}
                  </span>
                </div>

                {/* Content */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3
                      className="font-title text-lg tracking-widest transition-all duration-300"
                      style={{
                        fontFamily: "var(--font-title)",
                        color:
                          isSelected || isHovered
                            ? "#f9d76c"
                            : "var(--color-parchment)",
                        textShadow:
                          isHovered || isSelected
                            ? `0 0 12px ${swatch.accent}, 0 2px 8px rgba(0,0,0,0.8)`
                            : "0 2px 8px rgba(0,0,0,0.8)",
                      }}
                    >
                      {arena.name}
                    </h3>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: swatch.accent,
                        boxShadow: isSelected
                          ? `0 0 14px ${swatch.accent}, 0 0 24px ${swatch.accent}`
                          : `0 0 10px ${swatch.accent}`,
                      }}
                    />
                  </div>

                  <p
                    className="flex-1 text-sm leading-relaxed text-parchment-dim"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {arena.description}
                  </p>

                  {/* Selection indicator */}
                  <div className="mt-3 flex items-center justify-between border-t border-gold/15 pt-3">
                    <span
                      className={`
                        text-xs uppercase tracking-[0.2em] transition-colors
                        ${isSelected ? "text-gold" : "text-parchment-dark"}
                      `}
                      style={{
                        fontFamily: "var(--font-fantasy)",
                        textShadow: isSelected
                          ? "0 0 8px rgba(212,175,55,0.6)"
                          : undefined,
                      }}
                    >
                      {isSelected ? "✦ Selected" : "Select"}
                    </span>
                    {isSelected && (
                      <motion.span
                        layoutId="arena-selected"
                        className="text-gold"
                        style={{
                          textShadow: "0 0 10px rgba(212,175,55,0.8)",
                          fontFamily: "var(--font-title)",
                        }}
                      >
                        ⚔
                      </motion.span>
                    )}
                  </div>
                </div>

                {/* Corner brackets */}
                <span
                  className={`
                    absolute left-2 top-2 z-[2] h-6 w-6 border-l-2 border-t-2 border-gold transition-opacity duration-300
                    ${isSelected || isHovered ? "opacity-100" : "opacity-30"}
                  `}
                />
                <span
                  className={`
                    absolute bottom-2 right-2 z-[2] h-6 w-6 border-b-2 border-r-2 border-gold transition-opacity duration-300
                    ${isSelected || isHovered ? "opacity-100" : "opacity-30"}
                  `}
                />
                {/* Atmospheric top corner brackets too */}
                <span
                  className={`
                    absolute right-2 top-2 z-[3] h-4 w-4 border-r-2 border-t-2 border-gold/60 transition-opacity duration-300
                    ${isSelected ? "opacity-100" : "opacity-30"}
                  `}
                />
                <span
                  className={`
                    absolute bottom-2 left-2 z-[3] h-4 w-4 border-b-2 border-l-2 border-gold/60 transition-opacity duration-300
                    ${isSelected ? "opacity-100" : "opacity-30"}
                  `}
                />
              </motion.button>
            );
          })}
        </motion.div>

        {/* Selected arena name */}
        <motion.div
          key={selected?.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mt-6 text-center"
        >
          <p
            className="text-sm uppercase tracking-[0.3em] text-parchment-dark"
            style={{ fontFamily: "var(--font-fantasy)" }}
          >
            The duel shall take place in
          </p>
          <p
            className="mt-1 text-2xl text-gold"
            style={{
              fontFamily: "var(--font-title)",
              textShadow:
                "0 2px 12px rgba(0,0,0,0.8), 0 0 16px rgba(212,175,55,0.35)",
            }}
          >
            {selected?.name}
          </p>
        </motion.div>

        {/* Footer controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="mt-6 flex items-center justify-center gap-4"
        >
          <FantasyButton
            variant="secondary"
            size="md"
            onClick={onBack}
          >
            Back
          </FantasyButton>
          <FantasyButton
            variant="primary"
            size="lg"
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "Entering..." : "Enter Arena"}
          </FantasyButton>
        </motion.div>
      </div>
    </motion.div>
  );
}
