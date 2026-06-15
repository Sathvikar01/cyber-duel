import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const ROMAN = ["I", "II", "III"];
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾ".split("");

function clamp(n, min = 0, max = 100) {
  return Math.min(max, Math.max(min, n));
}

/* ------------------------------------------------------------------
   Lantern Shield — tapered health bar with in-bar numerals
   ------------------------------------------------------------------ */
function LanternShield({ value, colorVar, deepColorVar, side }) {
  const hp = clamp(value);
  const isRight = side === "right";
  const low = hp < 25;
  const cracked = hp < 15;

  const W = 240;
  const H = 60;
  const framePath =
    "M 18 8 L 222 8 L 210 30 L 130 56 L 110 56 L 30 30 Z";
  const clipPath =
    "M 22 11 L 218 11 L 207 30 L 129 52 L 111 52 L 33 30 Z";
  const fillGradId = `lfill-${side}`;
  const frameGradId = `lframe-${side}`;
  const tickGradId = `ltick-${side}`;

  const fillHeight = (hp / 100) * 48;
  const fillY = 52 - fillHeight;

  return (
    <div
      className="relative flex items-center"
      style={{
        width: W,
        height: H,
        transform: isRight ? "scaleX(-1)" : "none",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`absolute inset-0 ${low ? "lantern-pulse" : ""}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id={frameGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f9d76c" />
            <stop offset="50%" stopColor="#8a6e20" />
            <stop offset="100%" stopColor="#d4af37" />
          </linearGradient>
          <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorVar} stopOpacity="0.95" />
            <stop offset="100%" stopColor={deepColorVar} stopOpacity="1" />
          </linearGradient>
          <linearGradient id={tickGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(212,175,55,0.0)" />
            <stop offset="50%" stopColor="rgba(212,175,55,0.85)" />
            <stop offset="100%" stopColor="rgba(212,175,55,0.0)" />
          </linearGradient>
          <clipPath id={`lclip-${side}`}>
            <path d={clipPath} />
          </clipPath>
        </defs>

        <path
          d={framePath}
          fill="rgba(10,8,6,0.62)"
          stroke={`url(#${frameGradId})`}
          strokeWidth="3.2"
          className="lantern-frame"
          strokeLinejoin="round"
        />

        <g clipPath={`url(#lclip-${side})`}>
          <motion.rect
            x="0"
            width={W}
            height={fillHeight}
            fill={`url(#${fillGradId})`}
            initial={false}
            animate={{ y: fillY, height: fillHeight }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />
          <motion.path
            d={`M 30 11 L 210 11 L 198 16 L 42 16 Z`}
            fill="rgba(255,255,255,0.18)"
            initial={false}
            animate={{ y: fillY - 2 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />
        </g>

        {[25, 50, 75].map((p) => {
          const cx = 22 + (p / 100) * 196;
          return (
            <g key={p}>
              <line
                x1={cx}
                y1={12}
                x2={cx}
                y2={50}
                stroke={`url(#${tickGradId})`}
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
              <line
                x1={cx - 3}
                y1={30}
                x2={cx + 3}
                y2={30}
                stroke="rgba(212,175,55,0.65)"
                strokeWidth="1.2"
              />
            </g>
          );
        })}

        <path
          d={framePath}
          fill="none"
          stroke={`url(#${frameGradId})`}
          strokeWidth="3.2"
          className="lantern-frame"
          strokeLinejoin="round"
        />

        <circle
          cx="14"
          cy="30"
          r="9"
          fill="rgba(10,8,6,0.7)"
          stroke="#d4af37"
          strokeWidth="2"
        />
        <circle cx="14" cy="30" r="3" fill="#d4af37" />
        <circle
          cx="226"
          cy="30"
          r="7"
          fill="rgba(10,8,6,0.7)"
          stroke="#d4af37"
          strokeWidth="2"
        />
        <circle cx="226" cy="30" r="2.4" fill="#d4af37" />

        <path
          d="M 120 56 L 116 60 L 124 60 Z"
          fill="#d4af37"
          stroke="#8a6e20"
          strokeWidth="1"
        />
      </svg>

      <AnimatePresence>
        {cracked && (
          <motion.svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <path
              d="M 60 14 L 72 26 L 66 40 M 120 12 L 114 24 L 128 32 L 122 44 M 90 14 L 96 26 L 88 36 M 150 16 L 158 26 L 152 36"
              stroke="rgba(255,255,255,0.7)"
              strokeWidth="1.6"
              fill="none"
            />
            <path
              d="M 60 14 L 72 26 L 66 40 M 120 12 L 114 24 L 128 32 L 122 44 M 90 14 L 96 26 L 88 36"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="0.8"
              fill="none"
            />
            {[0, 0.25, 0.5, 0.75, 1].map((d, i) => (
              <motion.circle
                key={i}
                cx={W * 0.5 + (i - 2) * 18}
                cy={H * 0.5}
                r="1.8"
                fill="#ffd700"
                initial={{ opacity: 1, x: 0, y: 0 }}
                animate={{
                  opacity: 0,
                  x: (i - 2) * 14,
                  y: -20 - i * 6,
                }}
                transition={{ duration: 0.7, repeat: Infinity, delay: d * 0.4 }}
              />
            ))}
          </motion.svg>
        )}
      </AnimatePresence>

      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ transform: isRight ? "scaleX(-1)" : "none" }}
      >
        <span
          className="text-[2.1rem] font-black leading-none"
          style={{
            fontFamily: "var(--font-title)",
            color: hp < 30 ? "var(--color-crit)" : "var(--color-parchment)",
            textShadow:
              "0 2px 4px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.85), 0 0 2px rgba(255,255,255,0.4)",
            letterSpacing: "0.05em",
          }}
        >
          {Math.round(hp)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Crossed Swords — score indicator with rune lights per round won
   ------------------------------------------------------------------ */
function CrossedSwords({ score, side = "left" }) {
  return (
    <div className="relative flex items-center" style={{ width: 84, height: 38 }}>
      <svg viewBox="0 0 84 38" className="absolute inset-0 overflow-visible">
        <defs>
          <linearGradient id={`blade-${side}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0f0f0" />
            <stop offset="50%" stopColor="#b0b0b0" />
            <stop offset="100%" stopColor="#5a5a5a" />
          </linearGradient>
          <linearGradient id={`hilt-${side}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#6a4a18" />
          </linearGradient>
        </defs>

        <g
          transform={`translate(${side === "left" ? 22 : 62} 4) rotate(${side === "left" ? 32 : -32})`}
        >
          <rect x="-1.6" y="0" width="3.2" height="24" fill={`url(#blade-${side})`} />
          <polygon points="0,0 -1.6,3 1.6,3" fill="#d0d0d0" />
          <rect x="-6" y="22" width="12" height="2" fill={`url(#hilt-${side})`} />
          <rect x="-2.5" y="24" width="5" height="5" fill="#5c3a1a" />
          <circle cx="0" cy="26.5" r="1.6" fill="#d4af37" />
        </g>

        {Array.from({ length: 3 }).map((_, i) => {
          const lit = i < score;
          return (
            <motion.circle
              key={i}
              cx={14 + i * 28}
              cy={32}
              r={lit ? 2.8 : 1.4}
              fill={lit ? "#ffd700" : "rgba(60,50,40,0.7)"}
              stroke={lit ? "#fff8c8" : "rgba(120,100,70,0.4)"}
              strokeWidth="0.5"
              animate={lit ? { opacity: [0.7, 1, 0.7] } : { opacity: 0.5 }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }}
              style={{
                filter: lit ? "drop-shadow(0 0 4px #ffd700)" : "none",
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------
   Round Banner — tattered heraldic drape with Roman numeral
   ------------------------------------------------------------------ */
function RoundBanner({ round, playerScore, npcScore }) {
  const r = clamp(round, 1, 3);

  return (
    <div className="relative flex flex-col items-center" style={{ width: 360 }}>
      <svg
        viewBox="0 0 360 110"
        className="absolute -top-3 left-1/2 -translate-x-1/2"
        style={{ width: 360, height: 110, overflow: "visible", filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.6))" }}
      >
        <defs>
          <linearGradient id="bannerFabric" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a1d1d" />
            <stop offset="45%" stopColor="#7a2222" />
            <stop offset="100%" stopColor="#3a0f0f" />
          </linearGradient>
          <pattern id="bannerWeave" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="rgba(0,0,0,0)" />
            <line x1="0" y1="0" x2="4" y2="4" stroke="rgba(0,0,0,0.16)" strokeWidth="0.6" />
          </pattern>
        </defs>

        <line x1="60" y1="0" x2="60" y2="14" stroke="#d4af37" strokeWidth="2" />
        <line x1="300" y1="0" x2="300" y2="14" stroke="#d4af37" strokeWidth="2" />
        <circle cx="60" cy="2" r="3" fill="#d4af37" />
        <circle cx="300" cy="2" r="3" fill="#d4af37" />

        <path
          d="M 60 14
             L 300 14
             L 304 22
             L 296 36
             L 308 50
             L 290 60
             L 304 72
             L 282 78
             L 296 88
             L 268 92
             L 280 102
             L 240 98
             L 230 108
             L 210 96
             L 195 106
             L 180 94
             L 165 106
             L 150 96
             L 130 108
             L 120 98
             L 80 102
             L 92 88
             L 64 92
             L 80 78
             L 56 72
             L 70 60
             L 52 50
             L 64 36
             L 56 22 Z"
          fill="url(#bannerFabric)"
          stroke="#d4af37"
          strokeWidth="2.2"
        />
        <path
          d="M 60 14
             L 300 14
             L 304 22
             L 296 36
             L 308 50
             L 290 60
             L 304 72
             L 282 78
             L 296 88
             L 268 92
             L 280 102
             L 240 98
             L 230 108
             L 210 96
             L 195 106
             L 180 94
             L 165 106
             L 150 96
             L 130 108
             L 120 98
             L 80 102
             L 92 88
             L 64 92
             L 80 78
             L 56 72
             L 70 60
             L 52 50
             L 64 36
             L 56 22 Z"
          fill="url(#bannerWeave)"
          opacity="0.6"
        />

        <path
          d="M 60 14 L 75 22 L 90 14 L 105 22 L 120 14 L 135 22 L 150 14 L 165 22 L 180 14 L 195 22 L 210 14 L 225 22 L 240 14 L 255 22 L 270 14 L 285 22 L 300 14"
          fill="none"
          stroke="#d4af37"
          strokeWidth="1.4"
          opacity="0.85"
        />

        <circle cx="60" cy="14" r="5" fill="none" stroke="#d4af37" strokeWidth="1.8" />
        <circle cx="300" cy="14" r="5" fill="none" stroke="#d4af37" strokeWidth="1.8" />
        <circle cx="60" cy="14" r="2" fill="#d4af37" />
        <circle cx="300" cy="14" r="2" fill="#d4af37" />
      </svg>

      <div
        className="relative z-10 mt-1 flex flex-col items-center"
        style={{ paddingTop: 22 }}
      >
        <div
          style={{
            fontFamily: "var(--font-title)",
            fontSize: "2.6rem",
            fontWeight: 900,
            color: "var(--color-parchment)",
            textShadow:
              "0 0 14px rgba(255,215,0,0.85), 0 0 28px rgba(212,175,55,0.45), 0 3px 8px rgba(0,0,0,0.95)",
            letterSpacing: "0.12em",
            lineHeight: 1,
          }}
        >
          {ROMAN[r - 1]}
        </div>
        <div
          className="text-[0.62rem] tracking-[0.45em] uppercase"
          style={{
            fontFamily: "var(--font-body)",
            color: "var(--color-parchment-dim)",
            marginTop: 2,
            textShadow: "0 1px 2px rgba(0,0,0,0.9)",
          }}
        >
          Round
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-center gap-4 mt-1">
        <CrossedSwords side="left" score={playerScore} />
        <span
          className="text-[0.7rem] tracking-[0.3em] uppercase"
          style={{
            fontFamily: "var(--font-title)",
            color: "var(--color-parchment-dim)",
            textShadow: "0 1px 2px rgba(0,0,0,0.9)",
          }}
        >
          vs
        </span>
        <CrossedSwords side="right" score={npcScore} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Stamina Gauge — wide segmented gauge under the round banner
   ------------------------------------------------------------------ */
function StaminaGauge({ value }) {
  const stamina = clamp(value);
  const exhausted = stamina < 20;
  const pips = 5;
  const filledPips = Math.max(0, Math.ceil((stamina / 100) * pips));
  const label = exhausted ? "EXHAUSTED" : "STAMINA";

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <span
        className={`text-[0.62rem] font-bold tracking-[0.4em] uppercase ${
          exhausted ? "text-glow-exhausted" : "text-glow-stamina"
        }`}
        style={{
          fontFamily: "var(--font-title)",
          color: exhausted
            ? "var(--color-stamina-exhausted)"
            : "var(--color-stamina)",
        }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: pips }).map((_, i) => {
          const filled = i < filledPips;
          return (
            <motion.div
              key={i}
              initial={false}
              animate={{
                scale: filled ? 1 : 0.86,
                opacity: filled ? 1 : 0.45,
              }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative"
              style={{ width: 44, height: 18 }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: filled
                    ? exhausted
                      ? "linear-gradient(180deg, #e74c3c 0%, #8a1c1c 100%)"
                      : "linear-gradient(180deg, #f9d76c 0%, #c47020 60%, #8c4b1f 100%)"
                    : "linear-gradient(180deg, rgba(40,30,20,0.85), rgba(20,15,10,0.95))",
                  border: "1.5px solid rgba(212,175,55,0.55)",
                  clipPath:
                    "polygon(8% 0, 92% 0, 100% 50%, 92% 100%, 8% 100%, 0 50%)",
                  boxShadow: filled
                    ? `inset 0 1px 0 rgba(255,255,255,0.35), 0 0 8px ${
                        exhausted ? "rgba(231,76,60,0.7)" : "rgba(244,162,97,0.65)"
                      }`
                    : "inset 0 0 6px rgba(0,0,0,0.7)",
                }}
              />
              {filled && (
                <div
                  className="absolute top-1 left-2 right-2 h-[2px]"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)",
                    clipPath: "polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)",
                  }}
                />
              )}
            </motion.div>
          );
        })}
        <span
          className={`ml-2 text-[0.95rem] font-black ${
            exhausted ? "stamina-exhausted-flicker" : ""
          }`}
          style={{
            fontFamily: "var(--font-title)",
            color: exhausted
              ? "var(--color-stamina-exhausted)"
              : "var(--color-stamina)",
            textShadow: exhausted
              ? "0 0 10px rgba(197,48,48,0.85), 0 2px 4px rgba(0,0,0,0.9)"
              : "0 0 8px rgba(244,162,97,0.7), 0 2px 4px rgba(0,0,0,0.9)",
            minWidth: 34,
            textAlign: "right",
          }}
        >
          {Math.round(stamina)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Combo Meter — rune chain with SHADOW RAGE and gold-ember burst
   ------------------------------------------------------------------ */
function ComboMeter({ combo }) {
  if (combo <= 0) return null;
  const chainLength = Math.min(combo, 12);
  const shadowRage = combo >= 5;
  const goldBurst = combo >= 8;

  return (
    <div className="flex flex-col items-center">
      <AnimatePresence>
        {shadowRage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.6, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.1, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mb-2 px-5 py-1 text-lg font-bold tracking-[0.25em] text-glow-gold"
            style={{
              fontFamily: "var(--font-title)",
              color: "var(--color-crit)",
              borderTop: "2px solid rgba(212,175,55,0.7)",
              borderBottom: "2px solid rgba(212,175,55,0.7)",
              background: "rgba(20,10,0,0.4)",
              position: "relative",
            }}
          >
            {goldBurst && (
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: [0, 0.9, 0], scale: [0.5, 1.4, 1.8] }}
                transition={{ duration: 0.7, repeat: Infinity, ease: "easeOut" }}
              >
                <span
                  style={{
                    width: 220,
                    height: 60,
                    background:
                      "radial-gradient(ellipse at 50% 50%, rgba(255,215,0,0.55) 0%, transparent 70%)",
                    filter: "blur(4px)",
                  }}
                />
              </motion.span>
            )}
            SHADOW RAGE
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2 relative">
        {goldBurst && (
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 0.85, 0], scale: [0.4, 1.25, 1.6] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeOut" }}
          >
            <span
              style={{
                width: 280,
                height: 80,
                background:
                  "radial-gradient(ellipse at 50% 50%, rgba(255,215,0,0.65) 0%, rgba(212,175,55,0.25) 35%, transparent 70%)",
                filter: "blur(6px)",
              }}
            />
          </motion.div>
        )}

        <span
          className="text-[2.5rem] font-black leading-none text-glow-gold relative"
          style={{
            fontFamily: "var(--font-title)",
            color: "var(--color-crit)",
          }}
        >
          x{combo}
        </span>

        <div className="flex items-center relative">
          {Array.from({ length: chainLength }).map((_, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, scale: 0, rotate: -90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="text-[1.5rem]"
              style={{
                fontFamily: "var(--font-fantasy)",
                color: shadowRage ? "var(--color-crit)" : "var(--color-mana)",
                textShadow: shadowRage
                  ? "0 0 12px rgba(255,215,0,0.95), 0 0 24px rgba(255,200,50,0.6)"
                  : "0 0 10px rgba(123,104,238,0.85)",
                marginLeft: i > 0 ? -6 : 0,
              }}
            >
              {RUNES[i % RUNES.length]}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Control Hints — runic stone tiles
   ------------------------------------------------------------------ */
function ControlHints() {
  const hints = [
    { keys: ["W", "A", "S", "D"], label: "Move" },
    { keys: ["J"], label: "Jab" },
    { keys: ["K"], label: "Low Kick" },
    { keys: ["L"], label: "Cross" },
    { keys: ["U"], label: "Uppercut" },
    { keys: ["I"], label: "Roundhouse" },
  ];

  return (
    <div
      className="flex items-center gap-3 px-5 py-2 rounded-full pointer-events-auto"
      style={{
        background: "rgba(10,8,6,0.65)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(212,175,55,0.25)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {hints.map(({ keys, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <div className="flex gap-0.5">
            {keys.map((k) => (
              <kbd
                key={k}
                className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1 text-xs font-bold rounded text-[var(--color-parchment)] select-none"
                style={{
                  fontFamily: "var(--font-fantasy)",
                  background:
                    "linear-gradient(180deg, #5c5040 0%, #3a3126 100%)",
                  border: "1px solid #8a7b63",
                  borderBottomWidth: "3px",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.12), 0 2px 4px rgba(0,0,0,0.5)",
                  textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                }}
              >
                {k}
              </kbd>
            ))}
          </div>
          <span
            className="text-[0.7rem] text-[var(--color-parchment-dim)] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------
   Hit Splash — ink-splatter overlay with brush font + gold burst
   ------------------------------------------------------------------ */
function HitSplash({ text, color, crit = false, heavy = false }) {
  void heavy;
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          key={text}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.05 }}
        >
          <div
            className="hit-splash-ink"
            style={{
              width: crit ? 420 : 320,
              height: crit ? 200 : 140,
            }}
          >
            <svg
              viewBox="0 0 400 180"
              preserveAspectRatio="none"
              style={{ width: "100%", height: "100%" }}
            >
              <defs>
                <radialGradient id="splashInkGrad">
                  <stop offset="0%" stopColor={crit ? "#ffd700" : color} stopOpacity="0.55" />
                  <stop offset="60%" stopColor={crit ? "#ffd700" : color} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={crit ? "#ffd700" : color} stopOpacity="0" />
                </radialGradient>
              </defs>
              <ellipse
                cx="200"
                cy="90"
                rx={crit ? 180 : 140}
                ry={crit ? 70 : 50}
                fill="url(#splashInkGrad)"
              />
              <path
                d="M 80 60 C 110 50 160 55 200 70 C 240 55 290 50 320 65 C 340 80 320 100 290 110 C 240 130 200 120 160 130 C 120 140 80 120 70 100 C 60 80 60 70 80 60 Z"
                fill={crit ? "#1a0d00" : color}
                opacity="0.55"
              />
              <path
                d="M 90 70 C 130 60 180 65 200 80 M 220 75 C 260 65 300 70 320 85 M 110 110 C 150 100 200 105 250 110 M 140 130 C 180 122 220 125 260 130"
                stroke={crit ? "#ffd700" : color}
                strokeWidth="2"
                fill="none"
                opacity="0.6"
              />
              {crit && Array.from({ length: 12 }).map((_, i) => {
                const a = (i / 12) * Math.PI * 2;
                const r1 = 60 + (i % 3) * 22;
                const r2 = 90 + (i % 3) * 18;
                return (
                  <line
                    key={i}
                    x1={200 + Math.cos(a) * r1}
                    y1={90 + Math.sin(a) * r1}
                    x2={200 + Math.cos(a) * r2}
                    y2={90 + Math.sin(a) * r2}
                    stroke="#ffd700"
                    strokeWidth="1.4"
                    opacity="0.55"
                  />
                );
              })}
            </svg>
          </div>

          <div
            className="hit-splash"
            style={{ color: crit ? "var(--color-crit)" : color }}
          >
            {crit && <span className="crit-star">✦</span>}
            {crit && <span className="crit-star">✦</span>}
            {text}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------
   Crit Flash Overlay — layered base + radial + vignette, HUD-driven
   ------------------------------------------------------------------ */
function CritFlashOverlay({ flash }) {
  if (!flash) return null;
  const isCrit = flash.crit;
  return (
    <div
      key={flash.key}
      className="pointer-events-none absolute inset-0 z-[24]"
      aria-hidden="true"
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
          background: `radial-gradient(circle at 50% 50%, ${flash.color} 0%, transparent 60%)`,
          mixBlendMode: "screen",
          transformOrigin: "50% 50%",
        }}
      />
      {isCrit && <div className="absolute inset-0 crit-flash-vignette" />}
    </div>
  );
}

/* ------------------------------------------------------------------
   HUD
   ------------------------------------------------------------------ */
export default function HUD({
  playerHP,
  npcHP,
  round,
  playerScore,
  npcScore,
  combo,
  stamina,
}) {
  const [vfxFlash, setVfxFlash] = useState(null);
  const [hitSplash, setHitSplash] = useState(null);

  useEffect(() => {
    const onVfx = (e) => {
      const detail = e.detail || {};
      if (detail.type !== "screenFlash") return;
      const key = Date.now() + Math.random();
      setVfxFlash({ color: detail.color, crit: !!detail.crit, heavy: !!detail.heavy, key });
      setTimeout(() => {
        setVfxFlash((cur) => (cur && cur.key === key ? null : cur));
      }, 520);

      window.dispatchEvent(
        new CustomEvent("hud-vfx-flash", {
          detail: { color: detail.color, crit: !!detail.crit, key },
        })
      );

      const cls = detail.crit
        ? "shake-crit"
        : detail.heavy
        ? "shake-heavy"
        : "shake-light";
      document.body.classList.add(cls);
      setTimeout(() => document.body.classList.remove(cls), detail.crit ? 600 : detail.heavy ? 550 : 400);

      const splashText = detail.crit
        ? "CRITICAL"
        : detail.heavy
        ? "HEAVY"
        : "HIT";
      const splashColor = detail.crit
        ? "#ffd700"
        : detail.color || "#ff3344";
      const splashKey = Date.now() + Math.random();
      setHitSplash({
        text: splashText,
        color: splashColor,
        crit: !!detail.crit,
        heavy: !!detail.heavy,
        key: splashKey,
      });
      setTimeout(() => {
        setHitSplash((cur) => (cur && cur.key === splashKey ? null : cur));
      }, 560);
    };
    window.addEventListener("game-vfx", onVfx);
    return () => window.removeEventListener("game-vfx", onVfx);
  }, []);

  const playerLow = playerHP < 25;

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      <CritFlashOverlay flash={vfxFlash} />

      {playerLow && <div className="player-low-hp-vignette vignette-pulse" />}

      <HitSplash
        text={hitSplash?.text}
        color={hitSplash?.color}
        crit={hitSplash?.crit}
        heavy={hitSplash?.heavy}
      />

      <div className="absolute top-5 left-5 flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h2
            className="text-2xl font-black tracking-widest text-glow-player"
            style={{
              fontFamily: "var(--font-title)",
              color: "var(--color-player)",
            }}
          >
            HERO
          </h2>
          {playerLow && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 0.6, repeat: Infinity }}
              className="text-[0.65rem] tracking-[0.35em] uppercase"
              style={{
                fontFamily: "var(--font-title)",
                color: "var(--color-crit)",
                textShadow: "0 0 8px rgba(255,215,0,0.85)",
              }}
            >
              DANGER
            </motion.span>
          )}
        </div>
        <LanternShield
          value={playerHP}
          colorVar="var(--color-player)"
          deepColorVar="var(--color-player-deep)"
          side="left"
        />
      </div>

      <div className="absolute top-5 right-5 flex flex-col items-end gap-1">
        <div className="flex items-baseline gap-3">
          <h2
            className="text-2xl font-black tracking-widest text-glow-enemy"
            style={{
              fontFamily: "var(--font-title)",
              color: "var(--color-enemy)",
            }}
          >
            BALVERINE
          </h2>
        </div>
        <LanternShield
          value={npcHP}
          colorVar="var(--color-enemy)"
          deepColorVar="var(--color-enemy-deep)"
          side="right"
        />
      </div>

      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
        style={{ marginTop: -8 }}
      >
        <RoundBanner
          round={round}
          playerScore={playerScore}
          npcScore={npcScore}
        />
        <div style={{ marginTop: 112 }}>
          <StaminaGauge value={stamina} />
        </div>
      </div>

      <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
        <ComboMeter combo={combo} />
      </div>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
        <ControlHints />
      </div>
    </div>
  );
}
