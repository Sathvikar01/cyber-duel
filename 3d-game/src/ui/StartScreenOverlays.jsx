import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FighterPreview from "./FighterPreview";
import { CHARACTER_LIST } from "../data/characterData.js";

const controls = [
  { keys: "W A S D", action: "Move" },
  { keys: "J", action: "Jab" },
  { keys: "K", action: "Low Kick" },
  { keys: "L", action: "Cross" },
  { keys: "U", action: "Uppercut" },
  { keys: "I", action: "Roundhouse" },
  { keys: "ESC", action: "Pause" },
];

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

const panelVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.3 } },
};

const CloseIcon = ({ className = "" }) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);

const ParchmentGrain = () => (
  <div className="parchment-grain pointer-events-none" />
);

const FiligreeCorner = ({ className }) => (
  <svg
    className={`pointer-events-none absolute h-16 w-16 text-gold/55 ${className || ""}`}
    viewBox="0 0 140 140"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
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

const OverlayShell = ({ title, subtitle, onClose, children, maxWidth = "1100px" }) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      key="overlay-backdrop"
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      onClick={onClose}
      className="fixed inset-0 z-[150] flex items-center justify-center overflow-y-auto bg-ink-900/85 px-4 py-8 backdrop-blur-md"
    >
      <motion.div
        key="overlay-panel"
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto w-full overflow-hidden rounded-sm border-2 border-gold/45 bg-gradient-to-b from-ink-800/95 to-ink-900/95 shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
        style={{
          maxWidth,
          fontFamily: "var(--font-body)",
          boxShadow:
            "0 24px 80px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(212,175,55,0.18)",
        }}
      >
        <FiligreeCorner className="left-2 top-2" />
        <FiligreeCorner className="right-2 top-2 -scale-x-100" />
        <FiligreeCorner className="bottom-2 left-2 -scale-y-100" />
        <FiligreeCorner className="bottom-2 right-2 -scale-100" />

        <ParchmentGrain />

        <button
          onClick={onClose}
          aria-label="Close overlay"
          className="absolute right-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-sm border border-gold/40 bg-ink-900/70 text-gold-bright transition-all hover:border-gold hover:text-gold-bright hover:shadow-[0_0_12px_rgba(212,175,55,0.45)] active:scale-95"
          style={{ fontFamily: "var(--font-fantasy)" }}
        >
          <CloseIcon />
        </button>

        <div className="relative z-10 px-6 pb-8 pt-10 sm:px-10 sm:pb-10 sm:pt-12">
          {(title || subtitle) && (
            <div className="mb-6 flex flex-col items-center text-center">
              {title && (
                <motion.h2
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.5 }}
                  className="font-title text-3xl tracking-[0.18em] text-gold-bright sm:text-4xl md:text-5xl"
                  style={{
                    fontFamily: "var(--font-title)",
                    textShadow:
                      "0 2px 16px rgba(0,0,0,0.9), 0 0 24px rgba(212,175,55,0.35)",
                  }}
                >
                  {title}
                </motion.h2>
              )}
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.2, duration: 0.7 }}
                className="my-3 h-[1px] w-40 bg-gradient-to-r from-transparent via-gold/70 to-transparent sm:w-56"
              />
              {subtitle && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                  className="font-body text-base italic tracking-wide text-parchment-dim sm:text-lg"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {subtitle}
                </motion.p>
              )}
            </div>
          )}
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
};

const StatBar = ({ label, value, color }) => {
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-12 text-[10px] font-bold uppercase tracking-[0.25em] text-parchment-dark"
        style={{ fontFamily: "var(--font-fantasy)" }}
      >
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full border border-gold/15 bg-ink-900/80">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full"
          style={{
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}88`,
          }}
        />
      </div>
      <span
        className="w-8 text-right text-xs font-bold text-parchment-dim"
        style={{ fontFamily: "var(--font-fantasy)" }}
      >
        {clamped}
      </span>
    </div>
  );
};

const CodexCard = ({ character, onSelect }) => {
  const color = character.glowColor || "#d4af37";
  return (
    <motion.button
      onClick={() => onSelect(character.id)}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.25 }}
      className="group relative flex h-full flex-col items-stretch overflow-hidden rounded-sm border border-gold/25 bg-ink-900/70 p-3 text-left transition-all hover:border-gold/70 hover:shadow-[0_0_20px_2px_rgba(212,175,55,0.25)]"
    >
      <span className="absolute -left-px -top-px h-4 w-4 border-l-2 border-t-2 border-gold/60 transition-opacity duration-300 group-hover:border-gold group-hover:opacity-100" />
      <span className="absolute -bottom-px -right-px h-4 w-4 border-b-2 border-r-2 border-gold/60 transition-opacity duration-300 group-hover:border-gold group-hover:opacity-100" />

      <div className="mb-3 h-32 overflow-hidden rounded-sm border border-gold/15 bg-ink-900">
        <FighterPreview character={character} />
      </div>

      <h3
        className="font-title text-lg tracking-widest text-gold-bright transition-all group-hover:[text-shadow:0_0_10px_rgba(212,175,55,0.7)]"
        style={{
          fontFamily: "var(--font-title)",
          color: color,
          textShadow: `0 0 10px ${color}55, 0 2px 6px rgba(0,0,0,0.9)`,
        }}
      >
        {character.name}
      </h3>
      <p
        className="mt-0.5 text-xs italic text-parchment-dim"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {character.style}
      </p>
      <p
        className="mt-2 text-xs leading-relaxed text-parchment/80"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {character.description}
      </p>

      <div className="mt-3 space-y-1.5">
        <StatBar label="STR" value={character.stats?.strength} color={color} />
        <StatBar label="SPD" value={character.stats?.speed} color={color} />
        <StatBar label="DEF" value={character.stats?.defense} color={color} />
        <StatBar label="SHD" value={character.stats?.shadow} color={color} />
      </div>

      <span
        className="mt-3 text-[10px] uppercase tracking-[0.3em] text-parchment-dark transition-colors group-hover:text-gold-bright"
        style={{ fontFamily: "var(--font-fantasy)" }}
      >
        ~ read more ~
      </span>
    </motion.button>
  );
};

const CodexDetail = ({ character, onBack }) => {
  const color = character.glowColor || "#d4af37";
  return (
    <motion.div
      key={`detail-${character.id}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6 md:flex-row"
    >
      <div className="md:w-1/2">
        <div className="h-72 overflow-hidden rounded-sm border border-gold/30 bg-ink-900 shadow-[0_0_24px_rgba(0,0,0,0.6)] md:h-[420px]">
          <FighterPreview character={character} />
        </div>
      </div>
      <div className="flex flex-1 flex-col md:w-1/2">
        <button
          onClick={onBack}
          className="mb-3 self-start text-[10px] uppercase tracking-[0.3em] text-parchment-dim transition-colors hover:text-gold-bright"
          style={{ fontFamily: "var(--font-fantasy)" }}
        >
          ← back to the codex
        </button>
        <h3
          className="font-title text-3xl tracking-widest sm:text-4xl"
          style={{
            fontFamily: "var(--font-title)",
            color: color,
            textShadow: `0 0 14px ${color}66, 0 2px 8px rgba(0,0,0,0.9)`,
          }}
        >
          {character.name}
        </h3>
        <p
          className="mt-1 text-sm italic text-parchment-dim sm:text-base"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {character.style}
        </p>
        <div className="my-3 h-[1px] w-full bg-gradient-to-r from-gold/40 via-gold/15 to-transparent" />
        <p
          className="text-sm leading-relaxed text-parchment/90 sm:text-base"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {character.description}
        </p>

        <h4
          className="mt-6 text-[10px] font-bold uppercase tracking-[0.3em] text-gold-dim"
          style={{ fontFamily: "var(--font-fantasy)" }}
        >
          ~ combat ledger ~
        </h4>
        <div className="mt-3 space-y-2.5">
          <StatBar label="STR" value={character.stats?.strength} color={color} />
          <StatBar label="SPD" value={character.stats?.speed} color={color} />
          <StatBar label="DEF" value={character.stats?.defense} color={color} />
          <StatBar label="SHD" value={character.stats?.shadow} color={color} />
        </div>
      </div>
    </motion.div>
  );
};

export function CodexOverlay({ onClose }) {
  const [expandedId, setExpandedId] = useState(null);
  const expanded =
    expandedId != null ? CHARACTER_LIST.find((c) => c.id === expandedId) : null;

  return (
    <OverlayShell
      title="The Codex of Albion"
      subtitle="A record of every shadow that has walked these lands"
      onClose={onClose}
      maxWidth="1200px"
    >
      <AnimatePresence mode="wait">
        {expanded ? (
          <CodexDetail
            key="detail"
            character={expanded}
            onBack={() => setExpandedId(null)}
          />
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {CHARACTER_LIST.map((char) => (
              <CodexCard
                key={char.id}
                character={char}
                onSelect={setExpandedId}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </OverlayShell>
  );
}

const FORGE_SLOTS = [
  { id: "head", label: "Head", hint: "Hoods, helms, circlets" },
  { id: "body", label: "Body", hint: "Armor, sashes, scarves" },
  { id: "legs", label: "Legs", hint: "Boots, greaves, wraps" },
];

const LockedSlot = ({ label, hint }) => (
  <div className="relative flex h-44 flex-col items-center justify-center overflow-hidden rounded-sm border-2 border-dashed border-gold/40 bg-ink-900/70 sm:h-52">
    <span className="pointer-events-none absolute inset-1 rounded-sm border border-gold/15" />
    <span
      className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-gold-dim"
      style={{ fontFamily: "var(--font-fantasy)" }}
    >
      {label}
    </span>
    <span
      className="text-xs italic text-parchment-dark"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {hint}
    </span>
    <motion.div
      initial={{ rotate: -8, scale: 0.9, opacity: 0 }}
      animate={{ rotate: -8, scale: 1, opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="pointer-events-none absolute right-2 top-2 rounded-sm border-2 border-[#8c1a1a] bg-[#3a0a0a]/70 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#d9a3a3] shadow-[0_0_10px_rgba(140,26,26,0.6)]"
      style={{ fontFamily: "var(--font-fantasy)" }}
    >
      Locked
    </motion.div>
    <svg
      className="pointer-events-none absolute bottom-2 right-2 h-5 w-5 text-gold/35"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  </div>
);

export function ForgeOverlay({ onClose }) {
  return (
    <OverlayShell
      title="The Forge"
      subtitle="Where warriors are made"
      onClose={onClose}
      maxWidth="1200px"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {CHARACTER_LIST.map((char, i) => (
          <motion.div
            key={char.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.45 }}
            className="flex flex-col items-stretch"
          >
            <div className="mb-2 h-44 overflow-hidden rounded-sm border border-gold/25 bg-ink-900 sm:h-56">
              <FighterPreview character={char} />
            </div>
            <h4
              className="text-center font-title text-sm tracking-widest"
              style={{
                fontFamily: "var(--font-title)",
                color: char.glowColor || "#d4af37",
                textShadow: `0 0 8px ${char.glowColor || "#d4af37"}55, 0 1px 4px rgba(0,0,0,0.9)`,
              }}
            >
              {char.name}
            </h4>
          </motion.div>
        ))}
      </div>

      <div className="mt-8">
        <h3
          className="mb-4 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-gold-dim"
          style={{ fontFamily: "var(--font-fantasy)" }}
        >
          ~ customization slots ~
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FORGE_SLOTS.map((slot) => (
            <LockedSlot key={slot.id} label={slot.label} hint={slot.hint} />
          ))}
        </div>
      </div>

      <p
        className="mt-8 text-center text-xs italic text-parchment-dim sm:text-sm"
        style={{ fontFamily: "var(--font-body)" }}
      >
        The smiths are still tempering these blades. Return soon.
      </p>
    </OverlayShell>
  );
}

const Toggle = ({ on, onToggle, label }) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={onToggle}
    className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-all ${
      on
        ? "border-gold/70 bg-gold/30"
        : "border-gold/25 bg-ink-900/70"
    }`}
    style={{ fontFamily: "var(--font-fantasy)" }}
  >
    <motion.span
      layout
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`block h-4 w-4 rounded-full ${
        on ? "ml-6 bg-gold-bright" : "ml-1 bg-parchment-dim/70"
      }`}
      style={{
        boxShadow: on
          ? "0 0 8px rgba(212,175,55,0.7)"
          : "0 0 4px rgba(0,0,0,0.4)",
      }}
    />
  </button>
);

export function SettingsOverlay({ onClose, gpuActive = false }) {
  const [showControls, setShowControls] = useState(true);
  const [showFullHint, setShowFullHint] = useState(false);

  return (
    <OverlayShell
      title="Quick Settings"
      subtitle="Tweak thy duel before the bell rings"
      onClose={onClose}
      maxWidth="780px"
    >
      <div className="space-y-6">
        <section>
          <h3
            className="mb-3 flex items-center gap-2 border-b border-gold/20 pb-2 text-xs font-bold uppercase tracking-[0.3em] text-gold-dim"
            style={{ fontFamily: "var(--font-fantasy)" }}
          >
            <span className="h-[1px] w-5 bg-gold/40" />
            Blade &amp; Boot Bindings
            <span className="h-[1px] flex-1 bg-gold/20" />
          </h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {controls.map((c) => (
              <li
                key={c.action}
                className="flex items-center justify-between rounded-sm border border-gold/20 bg-ink-900/60 px-3 py-2"
              >
                <span
                  className="text-sm text-parchment/90"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {c.action}
                </span>
                <span
                  className="rounded-sm border border-gold/45 bg-ink-800/80 px-2 py-0.5 text-[11px] font-bold tracking-widest text-gold-bright shadow-sm"
                  style={{ fontFamily: "var(--font-fantasy)" }}
                >
                  {c.keys}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3
            className="mb-3 flex items-center gap-2 border-b border-gold/20 pb-2 text-xs font-bold uppercase tracking-[0.3em] text-gold-dim"
            style={{ fontFamily: "var(--font-fantasy)" }}
          >
            <span className="h-[1px] w-5 bg-gold/40" />
            Display
            <span className="h-[1px] flex-1 bg-gold/20" />
          </h3>
          <div className="space-y-3 rounded-sm border border-gold/20 bg-ink-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p
                  className="text-sm font-bold text-parchment"
                  style={{ fontFamily: "var(--font-fantasy)" }}
                >
                  Show on-screen controls
                </p>
                <p
                  className="text-xs italic text-parchment-dark"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  Overlay touch buttons on mobile
                </p>
              </div>
              <Toggle
                on={showControls}
                onToggle={() => setShowControls((v) => !v)}
                label="Show on-screen controls"
              />
            </div>
            <div className="flex items-center justify-between border-t border-gold/10 pt-3">
              <p
                className="text-sm font-bold text-parchment"
                style={{ fontFamily: "var(--font-fantasy)" }}
              >
                GPU Status
              </p>
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] ${
                  gpuActive
                    ? "border-crit/60 bg-crit/10 text-crit"
                    : "border-[#6c8e6a]/60 bg-[#6c8e6a]/10 text-[#6c8e6a]"
                }`}
                style={{ fontFamily: "var(--font-fantasy)" }}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    gpuActive
                      ? "bg-crit animate-pulse-glow"
                      : "bg-[#6c8e6a]"
                  }`}
                />
                {gpuActive ? "Active" : "Idle"}
              </span>
            </div>
          </div>
        </section>

        <section className="pt-2">
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setShowFullHint(true)}
              className="min-w-[260px] rounded-sm border border-gold/55 bg-gradient-to-b from-gold/20 to-gold/5 px-8 py-3 font-title text-sm tracking-[0.2em] text-parchment transition-all hover:-translate-y-0.5 hover:border-gold hover:text-gold-bright hover:shadow-[0_0_20px_2px_rgba(212,175,55,0.35)] active:scale-95"
              style={{ fontFamily: "var(--font-title)" }}
            >
              Open Full Settings
            </button>
            <AnimatePresence>
              {showFullHint && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-center text-xs italic text-parchment-dim"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  Full settings (audio, video, gameplay) are available in-game —
                  press <span className="font-bold text-gold-bright">ESC</span>{" "}
                  during a duel.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </OverlayShell>
  );
}
