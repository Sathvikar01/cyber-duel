import { motion } from "framer-motion";

const FlameIcon = ({ className }) => (
  <svg
    className={className}
    width="28"
    height="36"
    viewBox="0 0 28 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M14 2C14 2 4 12 4 22C4 28 8 34 14 34C20 34 24 28 24 22C24 12 14 2 14 2Z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M14 10C14 10 9 16 9 22C9 26 11 29 14 29C17 29 19 26 19 22C19 16 14 10 14 10Z"
      fill="currentColor"
      fillOpacity="0.55"
    />
  </svg>
);

const LaurelWreath = ({ side }) => (
  <svg
    width="180"
    height="320"
    viewBox="0 0 180 320"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-gold"
    style={{ filter: "drop-shadow(0 0 14px rgba(212,175,55,0.45))" }}
  >
    <g
      transform={side === "left" ? "" : `translate(180,0) scale(-1,1)`}
    >
      <path
        d="M40 300 C20 250, 20 200, 30 150 C40 100, 60 60, 90 30"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      {[...Array(11)].map((_, i) => {
        const t = i / 10;
        const cx = 30 + (90 - 30) * t + Math.sin(t * 3) * 6;
        const cy = 300 - (300 - 30) * t - Math.cos(t * 2) * 4;
        const angle = -25 + t * 60;
        return (
          <g key={i} transform={`translate(${cx}, ${cy}) rotate(${angle})`}>
            <path
              d="M0 0 Q10 -8 20 0 Q10 8 0 0 Z"
              fill="currentColor"
              fillOpacity="0.9"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="M4 -3 Q10 -6 16 -2"
              stroke="currentColor"
              strokeWidth="0.8"
              fill="none"
              opacity="0.7"
            />
          </g>
        );
      })}
    </g>
  </svg>
);

const VICTORY_PARTICLES = Array.from({ length: 60 }).map((_, i) => ({
  id: i,
  left: Math.random() * 100,
  size: 2 + Math.random() * 4,
  duration: 4 + Math.random() * 4,
  delay: Math.random() * 4,
  drift: -60 + Math.random() * 120,
  opacity: 0.6 + Math.random() * 0.4,
}));

const DEFEAT_PARTICLES = Array.from({ length: 30 }).map((_, i) => ({
  id: i,
  left: Math.random() * 100,
  size: 1.5 + Math.random() * 2.5,
  duration: 6 + Math.random() * 6,
  delay: Math.random() * 6,
  drift: -30 + Math.random() * 60,
  opacity: 0.4 + Math.random() * 0.5,
}));

const ParticleShower = () => {
  return (
    <div className="ember-layer">
      {VICTORY_PARTICLES.map((p) => (
        <span
          key={p.id}
          className="ember ember-victory"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            top: 0,
            bottom: "auto",
            animation: `gold-shower ${p.duration}s linear ${p.delay}s infinite`,
            opacity: p.opacity,
            "--drift": `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
};

const FallingEmbers = () => {
  return (
    <div className="ember-layer">
      {DEFEAT_PARTICLES.map((p) => (
        <span
          key={p.id}
          className="ember ember-defeat"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            opacity: p.opacity,
            "--drift": `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
};

const panelVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 40 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
  },
};

const textReveal = {
  hidden: { opacity: 0, y: 30, filter: "blur(12px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 1, ease: [0.22, 1, 0.36, 1] },
  },
};

const scoreItem = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.6 + i * 0.15, duration: 0.6 },
  }),
};

const buttonItem = {
  hidden: { opacity: 0, y: 20 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 1 + i * 0.15, duration: 0.6 },
  }),
};

const DecorativeLine = () => (
  <svg
    className="mx-auto h-6 w-48 text-gold/60"
    viewBox="0 0 200 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M0 12H80" stroke="currentColor" strokeWidth="1" />
    <path d="M120 12H200" stroke="currentColor" strokeWidth="1" />
    <circle cx="100" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
    <path
      d="M100 2C105 8, 105 16, 100 22C95 16, 95 8, 100 2Z"
      stroke="currentColor"
      strokeWidth="1"
      fill="none"
    />
  </svg>
);

const DefectCorona = () => (
  <svg
    className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 text-gold/30"
    viewBox="0 0 200 200"
    fill="none"
    style={{ animation: "spin-slow 60s linear infinite" }}
  >
    <g stroke="currentColor" strokeWidth="0.5" fill="none">
      <circle cx="100" cy="100" r="90" strokeDasharray="2 4" />
      <circle cx="100" cy="100" r="70" strokeDasharray="1 6" />
      <circle cx="100" cy="100" r="50" strokeDasharray="3 3" />
    </g>
    {[...Array(12)].map((_, i) => {
      const a = (i * Math.PI * 2) / 12;
      const x1 = 100 + Math.cos(a) * 60;
      const y1 = 100 + Math.sin(a) * 60;
      const x2 = 100 + Math.cos(a) * 88;
      const y2 = 100 + Math.sin(a) * 88;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
    })}
  </svg>
);

export default function GameOverScreen({
  victory,
  playerScore,
  npcScore,
  onRestart,
  onMenu,
}) {
  const outcomeText = victory ? "VICTORY" : "DEFEAT";
  const outcomeColor = victory
    ? "text-glow-gold-sheen"
    : "text-parchment-dark";

  return (
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-ink-900/95 font-body backdrop-blur-sm ${
        victory ? "" : "palette-desaturate"
      }`}
    >
      {/* Atmospheric vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background: victory
            ? "radial-gradient(circle at 50% 35%, rgba(212,175,55,0.18) 0%, transparent 55%, rgba(5,4,10,0.9) 100%)"
            : "radial-gradient(circle at 50% 35%, rgba(80,75,70,0.15) 0%, transparent 55%, rgba(5,4,10,0.95) 100%)",
        }}
      />

      {/* Outcome-specific particle layer */}
      {victory ? <ParticleShower /> : <FallingEmbers />}

      {/* Defect corona behind title on victory */}
      {victory && <DefectCorona />}

      {/* Parchment panel */}
      <motion.div
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        className={`relative z-10 w-full max-w-2xl rounded-sm border-2 p-10 text-center shadow-2xl shadow-black/70 ${
          victory
            ? "border-gold/40 bg-gradient-to-b from-aged-paper/95 to-parchment/90 parchment-cracked"
            : "border-gold/20 bg-gradient-to-b from-aged-paper/90 to-parchment-dark/30 parchment-cracked"
        }`}
      >
        {/* Corner brackets */}
        <span className="absolute -left-[2px] -top-[2px] z-[2] h-8 w-8 border-l-2 border-t-2 border-gold/70" />
        <span className="absolute -right-[2px] -top-[2px] z-[2] h-8 w-8 border-r-2 border-t-2 border-gold/70" />
        <span className="absolute -bottom-[2px] -left-[2px] z-[2] h-8 w-8 border-b-2 border-l-2 border-gold/70" />
        <span className="absolute -bottom-[2px] -right-[2px] z-[2] h-8 w-8 border-b-2 border-r-2 border-gold/70" />

        {/* Laurel wreath (victory only) */}
        {victory && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 opacity-70"
            style={{ animation: "rise-laurel 1.6s ease-out forwards" }}
          >
            <div
              className="flex"
              style={{ width: 460, height: 320, position: "relative" }}
            >
              <LaurelWreath side="left" />
              <LaurelWreath side="right" />
            </div>
          </div>
        )}

        <div className="relative z-[2]">
          <DecorativeLine />

          {/* Outcome title */}
          <motion.h1
            variants={textReveal}
            initial="hidden"
            animate="visible"
            className={`my-6 font-title text-7xl tracking-[0.15em] sm:text-8xl ${outcomeColor}`}
            style={
              victory
                ? undefined
                : {
                    textShadow:
                      "0 0 10px rgba(80,75,70,0.8), 0 4px 24px rgba(0,0,0,0.9)",
                  }
            }
          >
            {outcomeText}
          </motion.h1>

          {/* Flavour line */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.8 }}
            className="mb-8 font-body text-lg italic text-ink-700"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {victory
              ? "The realm shall sing of your blade this night."
              : "Your shadow fades into the mists of Albion."}
          </motion.p>

          {/* Scoreboard */}
          <motion.div
            initial="hidden"
            animate="visible"
            className="mb-10 flex items-center justify-center gap-8 sm:gap-14"
          >
            <motion.div
              custom={0}
              variants={scoreItem}
              className="flex flex-col items-center"
            >
              <span
                className="mb-2 font-title text-sm tracking-widest text-ink-700"
                style={{ fontFamily: "var(--font-title)" }}
              >
                PLAYER
              </span>
              <div className="flex items-center gap-2">
                <FlameIcon className="text-gold animate-flame" />
                <span
                  className="font-title text-5xl text-ink-900"
                  style={{ fontFamily: "var(--font-title)" }}
                >
                  {playerScore}
                </span>
              </div>
            </motion.div>

            <div className="h-16 w-[1px] bg-ink-600/40" />

            <motion.div
              custom={1}
              variants={scoreItem}
              className="flex flex-col items-center"
            >
              <span
                className="mb-2 font-title text-sm tracking-widest text-ink-700"
                style={{ fontFamily: "var(--font-title)" }}
              >
                FOE
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="font-title text-5xl text-ink-900"
                  style={{ fontFamily: "var(--font-title)" }}
                >
                  {npcScore}
                </span>
                <FlameIcon className="text-enemy animate-flame" />
              </div>
            </motion.div>
          </motion.div>

          <DecorativeLine />

          {/* Action buttons */}
          <div className="mt-10 flex flex-col items-center justify-center gap-5 sm:flex-row">
            <motion.button
              custom={0}
              variants={buttonItem}
              initial="hidden"
              animate="visible"
              onClick={onRestart}
              className="btn-base btn-primary btn-size-lg glow-border-gold"
            >
              <span aria-hidden="true" className="btn-sheen bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
              <span className="relative">Rise Again</span>
            </motion.button>

            <motion.button
              custom={1}
              variants={buttonItem}
              initial="hidden"
              animate="visible"
              onClick={onMenu}
              className="btn-base btn-danger btn-size-lg"
            >
              <span aria-hidden="true" className="btn-sheen bg-gradient-to-r from-transparent via-[rgba(231,29,54,0.18)] to-transparent" />
              <span className="relative">Flee to Tavern</span>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
