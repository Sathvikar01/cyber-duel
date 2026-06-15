import { motion } from "framer-motion";

const isWin = (result) => result?.trim().toUpperCase() === "ROUND WON";

const swordVariants = {
  hidden: { opacity: 0, scale: 0.6, rotate: -45 },
  visible: (side) => ({
    opacity: 1,
    scale: 1,
    rotate: side === "left" ? -12 : 12,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 },
  }),
};

const textVariants = {
  hidden: { opacity: 0, scale: 2.5, y: 60 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
      delay: 0.25,
    },
  },
};

const crackVariants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 0.7, ease: "easeOut", delay: 0.35 },
  },
};

export default function RoundOverlay({ result }) {
  const win = isWin(result);
  const heading = win ? "VICTORY" : "DEFEAT";
  const subtitle = win
    ? "The crowd roars thy name..."
    : "The tale continues, bruised but unbroken...";
  const colorClass = win ? "text-[#d4af37]" : "text-[#e71d36]";
  const shadowClass = win ? "drop-shadow-[0_0_18px_rgba(212,175,55,0.7)]" : "drop-shadow-[0_0_18px_rgba(231,29,54,0.7)]";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[90] flex items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at center, rgba(5,4,10,0.2) 0%, rgba(5,4,10,0.75) 60%, rgba(5,4,10,0.95) 100%)",
      }}
    >
      {/* Subtle sword / clash decoration */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="bladeWin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f9d76c" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#8a6e20" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="bladeLoss" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e71d36" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#590d22" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        <motion.g
          custom="left"
          variants={swordVariants}
          initial="hidden"
          animate="visible"
          style={{ originX: 0.5, originY: 0.5 }}
        >
          <path
            d="M 720 540 L 960 540 L 980 535 L 960 540 L 980 545 L 960 540 Z"
            fill={win ? "url(#bladeWin)" : "url(#bladeLoss)"}
            opacity="0.35"
          />
        </motion.g>
        <motion.g
          custom="right"
          variants={swordVariants}
          initial="hidden"
          animate="visible"
          style={{ originX: 0.5, originY: 0.5 }}
        >
          <path
            d="M 1200 540 L 960 540 L 940 535 L 960 540 L 940 545 L 960 540 Z"
            fill={win ? "url(#bladeWin)" : "url(#bladeLoss)"}
            opacity="0.35"
          />
        </motion.g>

        {!win && (
          <motion.path
            d="M 860 420 L 880 470 L 870 520 L 900 580 M 1020 400 L 1000 460 L 1015 510 L 990 570 M 940 620 L 955 670"
            fill="none"
            stroke="#e71d36"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.45"
            variants={crackVariants}
            initial="hidden"
            animate="visible"
          />
        )}
      </svg>

      <div className="relative z-10 text-center">
        <motion.h1
          variants={textVariants}
          initial="hidden"
          animate="visible"
          className={`text-[clamp(3rem,12vw,10rem)] font-bold uppercase leading-none tracking-widest ${colorClass} ${shadowClass}`}
          style={{ fontFamily: "var(--font-title)" }}
        >
          {heading}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.65 }}
          className="mt-4 text-[clamp(1rem,2.5vw,1.5rem)] text-[#b8a88a]"
          style={{ fontFamily: "var(--font-body)", textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}
        >
          {subtitle}
        </motion.p>
      </div>
    </div>
  );
}
