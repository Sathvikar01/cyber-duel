import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const title = "DUEL OF ALBION";
const subtitle = "A Fable of Blade and Shadow";
const menu = [
  { label: "DUEL", active: true, hint: "Begin a new battle", badge: null, variant: "primary" },
  { label: "FORGE", active: true, hint: "Preview your warrior", badge: "Preview", variant: "muted" },
  { label: "CODEX", active: true, hint: "Bestiary of shadows", badge: "Bestiary", variant: "muted" },
  { label: "SETTINGS", active: true, hint: "Tweak the duel", badge: "Quick", variant: "muted" },
];

const START_EMBERS = Array.from({ length: 38 }).map((_, i) => ({
  id: i,
  left: Math.random() * 100,
  size: 1.2 + Math.random() * 2.4,
  duration: 8 + Math.random() * 9,
  delay: Math.random() * 8,
  drift: -40 + Math.random() * 80,
  opacity: 0.4 + Math.random() * 0.5,
  isAsh: Math.random() > 0.55,
}));

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.3 },
  },
};

const letterVariants = {
  hidden: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
  visible: {
    opacity: 1,
    clipPath: "inset(0 0% 0 0)",
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

const FiligreeCorner = ({ className, style }) => (
  <svg
    className={className}
    width="140"
    height="140"
    viewBox="0 0 140 140"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={style}
  >
    <path
      d="M10 130 C30 90, 10 70, 50 50 C90 30, 110 50, 130 10"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
    <path
      d="M20 130 C35 100, 25 85, 55 70 C80 55, 100 70, 120 35"
      stroke="currentColor"
      strokeWidth="1"
      fill="none"
      opacity="0.6"
    />
    <circle cx="130" cy="10" r="3" fill="currentColor" />
    <circle cx="10" cy="130" r="3" fill="currentColor" />
  </svg>
);

const ParchmentGrain = () => (
  <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.08]">
    <filter id="grain">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.8"
        numOctaves="4"
        stitchTiles="stitch"
      />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter="url(#grain)" />
  </svg>
);

const Embers = () => {
  return (
    <div className="ember-layer">
      {START_EMBERS.map((p) => (
        <span
          key={p.id}
          className={`ember ${p.isAsh ? "ember-ash" : ""}`}
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

const FantasyButton = ({ label, active, onClick, delay, hint, badge, variant = "primary" }) => (
  <motion.button
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    disabled={!active}
    onClick={onClick}
    className={`
      group relative w-80 px-8 py-4 text-center font-title tracking-[0.28em] transition-all duration-300 ease-out
      ${
        active
          ? variant === "primary"
            ? "cursor-pointer text-gold-bright hover:-translate-y-1"
            : "cursor-pointer text-parchment-dim hover:-translate-y-0.5 hover:text-parchment"
          : "cursor-not-allowed text-parchment-dark/35"
      }
    `}
    style={{
      fontSize: active ? "1.4rem" : "0.95rem",
      letterSpacing: active ? "0.32em" : "0.28em",
    }}
  >
    {active ? (
      variant === "primary" ? (
        <span className="absolute inset-0 rounded-sm border border-gold/50 bg-gradient-to-b from-ink-800/70 to-ink-900/80 transition-all duration-300 group-hover:border-gold group-hover:from-ink-700/80 group-hover:to-ink-800/80 group-hover:shadow-[0_0_24px_2px_rgba(212,175,55,0.35)]" />
      ) : (
        <span className="absolute inset-0 rounded-sm border border-parchment-dark/35 bg-gradient-to-b from-ink-800/40 to-ink-900/60 transition-all duration-300 group-hover:border-parchment-dim/70 group-hover:from-ink-700/60 group-hover:to-ink-800/60 group-hover:shadow-[0_0_16px_2px_rgba(184,168,138,0.18)]" />
      )
    ) : (
      <span className="absolute inset-0 rounded-sm border border-gold/10 bg-ink-900/30" />
    )}
    {active && variant === "primary" && (
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-gold/15 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
    )}
    {active && (
      <>
        <span className="absolute inset-x-0 bottom-0 h-[1px] scale-x-0 bg-gradient-to-r from-transparent via-gold to-transparent transition-transform duration-500 group-hover:scale-x-100" />
        <span
          className={`absolute inset-x-0 top-0 h-[1px] scale-x-0 bg-gradient-to-r from-transparent ${
            variant === "primary" ? "via-gold/60" : "via-parchment-dark/50"
          } to-transparent transition-transform duration-700 group-hover:scale-x-100`}
        />
      </>
    )}
    <span
      className={`relative drop-shadow-md transition-all duration-300 ${
        active
          ? variant === "primary"
            ? "group-hover:[text-shadow:0_0_14px_rgba(212,175,55,0.9),0_0_28px_rgba(212,175,55,0.5)]"
            : "group-hover:[text-shadow:0_0_8px_rgba(184,168,138,0.45)]"
          : ""
      }`}
    >
      {label}
    </span>
    {badge && active && (
      <span
        className={`pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-sm border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.3em] shadow-[0_0_8px_rgba(212,175,55,0.25)] ${
          variant === "primary"
            ? "border-gold/45 bg-ink-900/85 text-gold-bright"
            : "border-parchment-dark/40 bg-ink-900/85 text-parchment-dim"
        }`}
        style={{ fontFamily: "var(--font-fantasy)" }}
      >
        {badge}
      </span>
    )}
    {active && variant === "primary" && (
      <span className="pointer-events-none absolute -right-12 top-1/2 -translate-y-1/2 text-xs font-body italic text-gold/60 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        {hint}
      </span>
    )}
    {active && variant === "muted" && (
      <span
        className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-body italic tracking-[0.25em] text-parchment-dark/70"
      >
        {hint}
      </span>
    )}
  </motion.button>
);

export default function StartScreen({ onStart, onOpenForge, onOpenCodex, onOpenSettings }) {
  const containerRef = useRef(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const handlers = {
    DUEL: onStart,
    FORGE: onOpenForge,
    CODEX: onOpenCodex,
    SETTINGS: onOpenSettings,
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      setParallax({ x, y });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-ink-900 font-body"
    >
      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, transparent 0%, rgba(5,4,10,0.4) 50%, rgba(5,4,10,0.92) 100%)",
        }}
      />

      {/* Parchment grain texture */}
      <ParchmentGrain />

      {/* Drifting embers / ash layer */}
      <Embers />

      {/* Corner filigree with parallax */}
      <FiligreeCorner
        className="filigree-corner absolute left-6 top-6 z-[2] text-gold/60"
        style={{
          transform: `translate(${parallax.x * -10}px, ${parallax.y * -10}px)`,
        }}
      />
      <FiligreeCorner
        className="filigree-corner absolute right-6 top-6 z-[2] rotate-90 text-gold/60"
        style={{
          transform: `rotate(90deg) translate(${parallax.x * -10}px, ${parallax.y * -10}px)`,
        }}
      />
      <FiligreeCorner
        className="filigree-corner absolute bottom-6 left-6 z-[2] -rotate-90 text-gold/60"
        style={{
          transform: `rotate(-90deg) translate(${parallax.x * 10}px, ${parallax.y * 10}px)`,
        }}
      />
      <FiligreeCorner
        className="filigree-corner absolute bottom-6 right-6 z-[2] rotate-180 text-gold/60"
        style={{
          transform: `rotate(180deg) translate(${parallax.x * 10}px, ${parallax.y * 10}px)`,
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center">
        {/* Eyebrow */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-3 flex items-center gap-3 font-body text-xs uppercase tracking-[0.5em] text-parchment-dark"
        >
          <span className="h-[1px] w-10 bg-gold/40" />
          Chapter I
          <span className="h-[1px] w-10 bg-gold/40" />
        </motion.div>

        {/* Title with metallic gold sheen */}
        <motion.h1
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="mb-4 flex flex-wrap justify-center font-title text-6xl tracking-[0.12em] sm:text-7xl md:text-8xl"
        >
          {title.split("").map((char, i) => (
            <motion.span
              key={i}
              variants={letterVariants}
              className="text-glow-gold-sheen inline-block"
            >
              {char === " " ? "\u00A0" : char}
            </motion.span>
          ))}
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.8 }}
          className="mb-3 font-body text-xl italic tracking-wide text-parchment-dim sm:text-2xl"
        >
          {subtitle}
        </motion.p>

        {/* Brush flourish under subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="mb-10 font-brush text-2xl text-gold-dim"
          style={{ fontFamily: "var(--font-brush)" }}
        >
          ~ choose thy fate ~
        </motion.p>

        {/* Divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 1.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mb-10 h-[1px] w-72 bg-gradient-to-r from-transparent via-gold/70 to-transparent"
        />

        {/* Menu */}
        <nav className="flex flex-col items-center gap-7">
          {menu.map((item, i) => (
            <FantasyButton
              key={item.label}
              label={item.label}
              active={item.active}
              hint={item.hint}
              badge={item.badge}
              variant={item.variant}
              onClick={item.active ? handlers[item.label] : undefined}
              delay={1.5 + i * 0.1}
            />
          ))}
        </nav>

        {/* CTA hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 1 }}
          className="mt-14"
        >
          <motion.p
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="flex items-center gap-3 font-body text-sm tracking-[0.3em] text-parchment-dark"
          >
            <span className="h-[1px] w-8 bg-gold/40" />
            CLICK TO DUEL
            <span className="h-[1px] w-8 bg-gold/40" />
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
