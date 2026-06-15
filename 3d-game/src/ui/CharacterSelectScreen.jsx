import { useState } from "react";
import { motion } from "framer-motion";
import FighterPreview from "./FighterPreview";
import FantasyButton from "./FantasyButton";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.5, staggerChildren: 0.08 },
  },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
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

const RadarChart = ({ stats, color, size = 160 }) => {
  const labels = ["STR", "SPD", "DEF", "SHD"];
  const values = [
    Math.max(10, Math.min(100, stats?.strength ?? 50)),
    Math.max(10, Math.min(100, stats?.speed ?? 50)),
    Math.max(10, Math.min(100, stats?.defense ?? 50)),
    Math.max(10, Math.min(100, stats?.shadow ?? 50)),
  ];
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 18;
  const rings = [0.25, 0.5, 0.75, 1];

  const pointFor = (i, scale) => {
    const angle = (Math.PI * 2 * i) / 4 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * radius * scale,
      y: cy + Math.sin(angle) * radius * scale,
    };
  };

  const polygonPoints = values
    .map((v, i) => {
      const scale = v / 100;
      const p = pointFor(i, scale);
      return `${p.x},${p.y}`;
    })
    .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="overflow-visible"
    >
      {/* Rings */}
      {rings.map((r, idx) => (
        <polygon
          key={idx}
          points={[0, 1, 2, 3]
            .map((i) => {
              const p = pointFor(i, r);
              return `${p.x},${p.y}`;
            })
            .join(" ")}
          fill="none"
          stroke="rgba(212,175,55,0.25)"
          strokeWidth="0.8"
        />
      ))}
      {/* Axes */}
      {[0, 1, 2, 3].map((i) => {
        const p = pointFor(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="rgba(212,175,55,0.18)"
            strokeWidth="0.6"
          />
        );
      })}
      {/* Stat polygon */}
      <polygon
        points={polygonPoints}
        fill={color}
        fillOpacity="0.18"
        stroke={color}
        strokeWidth="1.5"
        style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
      />
      {/* Vertices */}
      {values.map((v, i) => {
        const p = pointFor(i, v / 100);
        return <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />;
      })}
      {/* Labels */}
      {[0, 1, 2, 3].map((i) => {
        const p = pointFor(i, 1.18);
        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="9"
            fontFamily="var(--font-fantasy)"
            fontWeight="700"
            fill="rgba(240,230,210,0.75)"
            letterSpacing="0.1em"
          >
            {labels[i]}
          </text>
        );
      })}
    </svg>
  );
};

const StatOrnateIcon = ({ kind, color }) => {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (kind) {
    case "strength":
      return (
        <svg {...common}>
          <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
          <path d="M13 19l6-6" />
        </svg>
      );
    case "speed":
      return (
        <svg {...common}>
          <path d="M3 12c5-7 13-7 18 0" />
          <path d="M3 12c5 7 13 7 18 0" />
          <path d="M12 4v16" />
        </svg>
      );
    case "defense":
      return (
        <svg {...common}>
          <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
        </svg>
      );
    case "shadow":
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    default:
      return null;
  }
};

export default function CharacterSelectScreen({
  characters = [],
  selectedId,
  onSelect,
  onConfirm,
  onBack,
}) {
  const selected = characters.find((c) => c.id === selectedId) || characters[0];
  const [hoveredId, setHoveredId] = useState(null);

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

      {/* Decorative top line */}
      <div className="pointer-events-none absolute top-0 left-0 z-[2] h-1 w-full bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

      <div className="relative z-10 flex h-full w-full max-w-7xl flex-col px-6 py-6 md:px-10">
        {/* Header */}
        <div className="mb-4 flex flex-col items-center text-center">
          <motion.h1
            variants={titleVariants}
            className="font-title text-4xl tracking-[0.18em] text-gold sm:text-5xl md:text-6xl"
            style={{
              textShadow:
                "0 2px 24px rgba(0,0,0,0.9), 0 0 30px rgba(212,175,55,0.35)",
              fontFamily: "var(--font-title)",
            }}
          >
            Choose Your Shadow
          </motion.h1>
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="mt-3 h-[1px] w-56 bg-gradient-to-r from-transparent via-gold/70 to-transparent"
          />
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-2 text-xs uppercase tracking-[0.4em] text-parchment-dark"
            style={{ fontFamily: "var(--font-fantasy)" }}
          >
            four souls · one blade
          </motion.p>
        </div>

        {/* Main grid */}
        <div className="flex flex-1 flex-col gap-5 overflow-hidden md:flex-row">
          {/* Character cards */}
          <motion.div
            variants={containerVariants}
            className="flex flex-1 flex-wrap content-start gap-3 overflow-y-auto pr-1 md:grid md:grid-cols-2"
          >
            {characters.map((char) => {
              const isSelected = char.id === selectedId;
              const isHovered = char.id === hoveredId;
              return (
                <motion.button
                  key={char.id}
                  variants={cardVariants}
                  onClick={() => onSelect(char.id)}
                  onMouseEnter={() => setHoveredId(char.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`
                    group relative flex flex-col items-start gap-2 rounded-sm border p-3 text-left transition-all duration-300
                    ${
                      isSelected
                        ? "border-gold/80 bg-gradient-to-br from-ink-700/95 to-ink-800/95"
                        : "border-gold/20 bg-ink-800/60 hover:border-gold/50 hover:bg-ink-700/70"
                    }
                    ${isSelected ? "float-up -translate-y-1" : ""}
                  `}
                  style={{
                    minWidth: 200,
                    boxShadow: isSelected
                      ? `0 0 24px 2px ${char.glowColor}55, 0 0 32px rgba(212,175,55,0.25), inset 0 0 0 1px rgba(212,175,55,0.4)`
                      : isHovered
                      ? `0 0 14px 1px ${char.glowColor}33`
                      : undefined,
                    transform: isHovered && !isSelected
                      ? "scale(1.02)"
                      : isSelected
                      ? "translateY(-4px) scale(1.02)"
                      : undefined,
                    transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  {/* Gold filigree border corners */}
                  <span
                    className="absolute -left-px -top-px h-5 w-5 border-l-2 border-t-2 border-gold transition-opacity duration-300"
                    style={{ opacity: isSelected || isHovered ? 1 : 0.4 }}
                  />
                  <span
                    className="absolute -bottom-px -right-px h-5 w-5 border-b-2 border-r-2 border-gold transition-opacity duration-300"
                    style={{ opacity: isSelected || isHovered ? 1 : 0.4 }}
                  />
                  <span
                    className="absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-gold/60 transition-opacity duration-300"
                    style={{ opacity: isSelected ? 1 : 0 }}
                  />
                  <span
                    className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-gold/60 transition-opacity duration-300"
                    style={{ opacity: isSelected ? 1 : 0 }}
                  />

                  <div className="flex w-full items-center justify-between">
                    <h3
                      className="font-title text-lg tracking-widest transition-all duration-300"
                      style={{
                        fontFamily: "var(--font-title)",
                        color: isSelected
                          ? "#f9d76c"
                          : isHovered
                          ? "#f9d76c"
                          : "var(--color-parchment)",
                        textShadow: isHovered || isSelected
                          ? `0 0 12px ${char.glowColor}, 0 0 20px rgba(212,175,55,0.4), 0 2px 8px rgba(0,0,0,0.8)`
                          : "0 2px 8px rgba(0,0,0,0.8)",
                      }}
                    >
                      {char.name}
                    </h3>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: char.glowColor,
                        boxShadow: isSelected
                          ? `0 0 12px ${char.glowColor}, 0 0 24px ${char.glowColor}`
                          : `0 0 8px ${char.glowColor}`,
                      }}
                    />
                  </div>

                  <p
                    className="text-xs italic text-parchment-dim"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {char.style}
                  </p>

                  {/* Radar chart */}
                  <div className="mt-1 flex w-full items-center justify-center">
                    <RadarChart
                      stats={char.stats}
                      color={char.glowColor}
                      size={120}
                    />
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          {/* Preview area */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.7 }}
            className="flex h-[460px] w-full flex-col gap-4 md:h-auto md:w-[460px] lg:w-[500px]"
          >
            {/* 3D Fighter Preview (larger) */}
            <div
              className="relative flex-[1.6] overflow-hidden rounded-sm border bg-ink-800/40 p-1 shadow-[0_12px_50px_rgba(0,0,0,0.55)]"
              style={{
                borderColor: selected?.glowColor
                  ? `${selected.glowColor}80`
                  : "rgba(212,175,55,0.4)",
                boxShadow: `0 12px 50px rgba(0,0,0,0.55), 0 0 30px ${
                  selected?.glowColor || "#d4af37"
                }33`,
                minHeight: 340,
              }}
            >
              {/* Inner gold filigree corners */}
              <span className="pointer-events-none absolute left-1 top-1 z-[2] h-4 w-4 border-l-2 border-t-2 border-gold/70" />
              <span className="pointer-events-none absolute right-1 top-1 z-[2] h-4 w-4 border-r-2 border-t-2 border-gold/70" />
              <span className="pointer-events-none absolute bottom-1 left-1 z-[2] h-4 w-4 border-b-2 border-l-2 border-gold/70" />
              <span className="pointer-events-none absolute bottom-1 right-1 z-[2] h-4 w-4 border-b-2 border-r-2 border-gold/70" />
              <FighterPreview character={selected} />
            </div>

            {/* Parchment title + description panel */}
            <div
              className="relative flex-shrink-0 rounded-sm border border-[rgba(138,110,32,0.4)] p-4"
              style={{
                background:
                  "linear-gradient(135deg, rgba(240,230,210,0.95), rgba(209,191,160,0.92))",
                boxShadow:
                  "0 8px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.25)",
                color: "#05040a",
              }}
            >
              <span className="pointer-events-none absolute left-1 top-1 h-3 w-3 border-l-2 border-t-2 border-[#8a6e20]" />
              <span className="pointer-events-none absolute right-1 top-1 h-3 w-3 border-r-2 border-t-2 border-[#8a6e20]" />
              <span className="pointer-events-none absolute bottom-1 left-1 h-3 w-3 border-b-2 border-l-2 border-[#8a6e20]" />
              <span className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2 border-[#8a6e20]" />

              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: selected?.glowColor,
                    boxShadow: `0 0 8px ${selected?.glowColor}`,
                  }}
                />
                <h4
                  className="font-title text-base tracking-[0.18em] text-[#05040a]"
                  style={{ fontFamily: "var(--font-title)" }}
                >
                  {selected?.name}
                </h4>
              </div>
              <p
                className="mt-1 text-[11px] uppercase tracking-[0.3em] text-[#8a6e20]"
                style={{ fontFamily: "var(--font-fantasy)" }}
              >
                {selected?.style}
              </p>
              <p
                className="mt-2 line-clamp-2 text-sm italic leading-snug text-[#3a2e1a]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {selected?.description || "A shadow waiting to be shaped by your will."}
              </p>

              {/* Mini stat line */}
              <div className="mt-3 flex items-center justify-between border-t border-[rgba(138,110,32,0.3)] pt-2">
                {[
                  { key: "strength", label: "STR" },
                  { key: "speed", label: "SPD" },
                  { key: "defense", label: "DEF" },
                  { key: "shadow", label: "SHD" },
                ].map((s, idx, arr) => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <StatOrnateIcon
                      kind={s.key}
                      color={selected?.glowColor || "#d4af37"}
                    />
                    <span
                      className="text-[10px] font-bold tracking-widest text-[#05040a]"
                      style={{ fontFamily: "var(--font-fantasy)" }}
                    >
                      {s.label}
                    </span>
                    <span
                      className="text-[10px] font-bold text-[#8a6e20]"
                      style={{ fontFamily: "var(--font-fantasy)" }}
                    >
                      {selected?.stats?.[s.key] ?? 50}
                    </span>
                    {idx < arr.length - 1 && (
                      <span className="ml-1.5 h-3 w-[1px] bg-[rgba(138,110,32,0.3)]" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Footer controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="mt-4 flex items-center justify-center gap-4"
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
            onClick={onConfirm}
          >
            Confirm Shadow
          </FantasyButton>
        </motion.div>
      </div>
    </motion.div>
  );
}
