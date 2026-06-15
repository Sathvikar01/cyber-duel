import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FantasyButton from "./FantasyButton";

const TABS = [
  { key: "Controls", icon: "sword", badge: "7" },
  { key: "Audio", icon: "lute", badge: "♪" },
  { key: "Video", icon: "eye", badge: "◐" },
  { key: "Gameplay", icon: "scales", badge: "⚖" },
];

const pageVariants = {
  hidden: { opacity: 0, rotateY: -75, scale: 0.92 },
  visible: {
    opacity: 1,
    rotateY: 0,
    scale: 1,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, rotateY: 45, scale: 0.96, transition: { duration: 0.35 } },
};

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35 } },
};

const controls = [
  { keys: "W A S D", action: "Move" },
  { keys: "J", action: "Jab" },
  { keys: "K", action: "Low Kick" },
  { keys: "L", action: "Cross" },
  { keys: "U", action: "Uppercut" },
  { keys: "I", action: "Roundhouse" },
  { keys: "ESC", action: "Pause" },
];

const TabIcon = ({ name, className = "" }) => {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
  };
  switch (name) {
    case "sword":
      return (
        <svg {...common}>
          <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
          <path d="M13 19l6-6" />
          <path d="M16 16l4 4" />
          <path d="M19 21l2-2" />
        </svg>
      );
    case "lute":
      return (
        <svg {...common}>
          <path d="M12 3v6" />
          <path d="M9 6h6" />
          <path d="M8 9c-2 1-3 3-3 5a4 4 0 0 0 8 0c0-2-1-4-3-5" />
          <path d="M5 21l4-4" />
          <path d="M15 21l4-4" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "scales":
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M5 21h14" />
          <path d="M5 7h14" />
          <path d="M5 7l-3 6h6l-3-6z" />
          <path d="M19 7l-3 6h6l-3-6z" />
        </svg>
      );
    default:
      return null;
  }
};

function SectionLabel({ children }) {
  return (
    <h4
      className="mb-2 border-b border-[rgba(138,110,32,0.3)] pb-1 text-xs font-bold uppercase tracking-[0.25em] text-[#8a6e20]"
      style={{ fontFamily: "var(--font-fantasy)" }}
    >
      {children}
    </h4>
  );
}

function FantasySlider({ label, value, onChange, onReset, hint, disabled = false }) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef(null);

  const updateFromX = useCallback(
    (clientX) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      onChange(Math.round((x / rect.width) * 100));
    },
    [onChange]
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => updateFromX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, updateFromX]);

  return (
    <div className={disabled ? "pointer-events-none opacity-50" : ""}>
      <div className="mb-1 flex items-center justify-between">
        <span
          className="text-sm font-bold text-[#05040a]"
          style={{ fontFamily: "var(--font-fantasy)" }}
        >
          {label}
        </span>
        <div className="flex items-center gap-3">
          <span
            className="min-w-[2ch] text-right text-sm font-bold tabular-nums text-[#8a6e20]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {value}
          </span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-[10px] uppercase tracking-widest text-[#8a7b63] transition-colors hover:text-[#590d22]"
              style={{ fontFamily: "var(--font-fantasy)" }}
            >
              reset
            </button>
          )}
        </div>
      </div>
      <div
        ref={trackRef}
        onMouseDown={(e) => {
          if (disabled) return;
          setDragging(true);
          updateFromX(e.clientX);
        }}
        className="relative h-3 cursor-pointer select-none rounded-sm border border-[rgba(138,110,32,0.6)] bg-[rgba(240,230,210,0.65)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
      >
        <div
          className="h-full rounded-l-sm bg-[linear-gradient(90deg,#8a6e20,#d4af37,#f1c232)] shadow-[0_0_8px_rgba(212,175,55,0.55)]"
          style={{ width: `${value}%` }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#8a6e20] bg-[linear-gradient(135deg,#fff8e1,#d4af37)] shadow-[0_0_6px_rgba(0,0,0,0.45)] transition-[left] duration-75"
          style={{ left: `${value}%` }}
        />
      </div>
      {hint && (
        <p
          className="mt-1 text-[11px] italic text-[#8a7b63]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

function RadioCardGroup({ options, value, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={isActive}
            className={`flex flex-col items-center gap-1 rounded-sm border-2 px-3 py-3 text-center transition-all active:scale-[0.97] ${
              isActive
                ? "border-[#d4af37] bg-[rgba(240,230,210,0.95)] shadow-[0_0_12px_rgba(212,175,55,0.55)]"
                : "border-[rgba(138,110,32,0.45)] bg-[rgba(240,230,210,0.55)] hover:border-[rgba(138,110,32,0.75)] hover:bg-[rgba(240,230,210,0.8)]"
            }`}
          >
            {opt.glyph && (
              <span
                className={`text-lg leading-none ${isActive ? "text-[#8a6e20]" : "text-[#a89878]"}`}
                style={{ fontFamily: "var(--font-title)" }}
              >
                {opt.glyph}
              </span>
            )}
            <span
              className={`text-[12px] font-bold uppercase tracking-wider ${
                isActive ? "text-[#05040a]" : "text-[#5c4d3c]"
              }`}
              style={{ fontFamily: "var(--font-fantasy)" }}
            >
              {opt.label}
            </span>
            {opt.hint && (
              <span
                className="text-[10px] leading-tight text-[#8a7b63]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {opt.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FantasyToggle({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div
          className="text-sm font-bold text-[#05040a]"
          style={{ fontFamily: "var(--font-fantasy)" }}
        >
          {label}
        </div>
        {hint && (
          <div
            className="mt-0.5 text-[11px] italic text-[#8a7b63]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {hint}
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-12 shrink-0 rounded-full border-2 transition-all ${
          value
            ? "border-[#d4af37] bg-[linear-gradient(90deg,#b8860b,#d4af37)] shadow-[0_0_8px_rgba(212,175,55,0.5)]"
            : "border-[rgba(138,110,32,0.55)] bg-[rgba(209,191,160,0.6)]"
        }`}
      >
        <span
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-[#8a6e20] bg-[linear-gradient(135deg,#fff8e1,#f1c232)] shadow transition-all ${
            value ? "left-[1.35rem]" : "left-[2px]"
          }`}
        />
      </button>
    </div>
  );
}

export default function PauseMenu({
  onResume,
  onRestart,
  onQuit,
  audioSettings,
  setAudioSettings,
  videoSettings,
  setVideoSettings,
  gameplaySettings,
  setGameplaySettings,
}) {
  const [activeTab, setActiveTab] = useState("Controls");

  return (
    <motion.div
      className="absolute inset-0 z-[110] flex items-center justify-center"
      style={{ perspective: "1200px" }}
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
    >
      {/* Backdrop blur over the game */}
      <div
        className="absolute inset-0 bg-[rgba(5,4,10,0.55)] backdrop-blur-md"
        onClick={onResume}
      />

      <AnimatePresence>
        <motion.div
          key="pause-panel"
          variants={pageVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative z-10 flex h-[min(85vh,720px)] w-[min(92vw,1100px)] overflow-hidden rounded-sm border-2 border-[rgba(138,110,32,0.45)] bg-[linear-gradient(135deg,rgba(240,230,210,0.97),rgba(209,191,160,0.94))] text-[#05040a] shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.25)]"
          style={{
            fontFamily: "var(--font-body)",
            boxShadow:
              "0 24px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 2px rgba(212,175,55,0.25)",
          }}
        >
          {/* Faint ink stains on parchment */}
          <span
            className="ink-stain"
            style={{ top: "12%", left: "8%", width: 90, height: 70 }}
          />
          <span
            className="ink-stain"
            style={{ top: "60%", left: "30%", width: 60, height: 50, opacity: 0.5 }}
          />
          <span
            className="ink-stain"
            style={{ top: "20%", right: "6%", width: 110, height: 80 }}
          />
          <span
            className="ink-stain"
            style={{ bottom: "10%", right: "12%", width: 70, height: 60, opacity: 0.5 }}
          />

          {/* Torn parchment edges */}
          <div className="torn-edge-top" />
          <div className="torn-edge-bottom" />

          {/* Decorative torn-edge SVGs to deepen the effect */}
          <svg
            className="pointer-events-none absolute top-0 left-0 z-[1] w-full"
            viewBox="0 0 1200 24"
            preserveAspectRatio="none"
            height="24"
          >
            <path
              d="M0,0 L0,12 Q30,20 60,10 T120,14 T180,6 T240,16 T300,8 T360,18 T420,10 T480,14 T540,6 T600,16 T660,8 T720,18 T780,10 T840,14 T900,6 T960,16 T1020,8 T1080,18 T1140,10 T1200,14 L1200,0 Z"
              fill="rgba(209,191,160,0.94)"
            />
          </svg>
          <svg
            className="pointer-events-none absolute bottom-0 left-0 z-[1] w-full"
            viewBox="0 0 1200 24"
            preserveAspectRatio="none"
            height="24"
          >
            <path
              d="M0,24 L0,12 Q30,4 60,14 T120,10 T180,18 T240,8 T300,16 T360,6 T420,14 T480,10 T540,18 T600,8 T660,16 T720,6 T780,14 T840,10 T900,18 T960,8 T1020,16 T1080,6 T1140,14 T1200,10 L1200,24 Z"
              fill="rgba(209,191,160,0.94)"
            />
          </svg>

          {/* Gold corners */}
          <div className="pointer-events-none absolute top-3 left-3 z-[2] h-10 w-10 border-t-2 border-l-2 border-[rgba(212,175,55,0.75)]" />
          <div className="pointer-events-none absolute top-3 right-3 z-[2] h-10 w-10 border-t-2 border-r-2 border-[rgba(212,175,55,0.75)]" />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[2] h-10 w-10 border-b-2 border-l-2 border-[rgba(212,175,55,0.75)]" />
          <div className="pointer-events-none absolute bottom-3 right-3 z-[2] h-10 w-10 border-b-2 border-r-2 border-[rgba(212,175,55,0.75)]" />

          {/* Tab column */}
          <aside className="relative z-[3] flex w-56 flex-col border-r border-[rgba(138,110,32,0.35)] bg-[rgba(209,191,160,0.5)] py-8 pr-0">
            <h2
              className="px-5 text-xl font-bold tracking-wide text-[#8a6e20]"
              style={{ fontFamily: "var(--font-title)" }}
            >
              Tome of Options
            </h2>
            <div className="mt-2 px-5 text-[10px] uppercase tracking-[0.3em] text-[#8a7b63]">
              ~ Select a scroll ~
            </div>
            <nav className="mt-6 flex flex-col gap-1">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`group relative flex items-center gap-3 px-5 py-3 text-left text-sm font-semibold uppercase tracking-wider transition-colors ${
                      isActive
                        ? "text-[#05040a]"
                        : "text-[#8a7b63] hover:text-[#05040a]"
                    }`}
                    style={{ fontFamily: "var(--font-fantasy)" }}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="pause-tab"
                        className="absolute inset-0 bg-[rgba(240,230,210,0.85)]"
                        style={{ borderLeft: "3px solid #d4af37" }}
                        transition={{ duration: 0.25 }}
                      />
                    )}
                    <span
                      className={`relative z-10 transition-colors ${
                        isActive ? "text-[#8a6e20]" : "text-[#8a7b63]"
                      }`}
                    >
                      <TabIcon name={tab.icon} />
                    </span>
                    <span className="relative z-10 flex-1">{tab.key}</span>
                    <span
                      className={`relative z-10 inline-flex h-5 min-w-[1.4rem] items-center justify-center rounded-full border px-1.5 text-[10px] font-bold tracking-normal transition-colors ${
                        isActive
                          ? "border-[#8a6e20]/60 bg-[rgba(212,175,55,0.18)] text-[#8a6e20]"
                          : "border-[#8a7b63]/40 bg-[rgba(138,110,32,0.1)] text-[#8a7b63] group-hover:border-[#8a7b63]/70 group-hover:text-[#5c4d3c]"
                      }`}
                    >
                      {tab.badge}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Main content */}
          <main className="relative z-[3] flex flex-1 flex-col p-8">
            <div className="flex-1 overflow-y-auto">
              {activeTab === "Controls" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3
                    className="mb-2 flex items-center gap-3 text-2xl font-bold text-[#05040a]"
                    style={{ fontFamily: "var(--font-title)" }}
                  >
                    <TabIcon name="sword" className="text-[#8a6e20]" />
                    Blade &amp; Boot Bindings
                  </h3>
                  <p
                    className="mb-6 text-sm italic text-[#8a7b63]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    "Strike true, parry true, live to duel again."
                  </p>
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {controls.map((c) => (
                      <li
                        key={c.action}
                        className="flex items-center justify-between rounded border border-[rgba(138,110,32,0.25)] bg-[rgba(240,230,210,0.6)] px-4 py-3"
                      >
                        <span
                          className="text-[#5c4d3c]"
                          style={{ fontFamily: "var(--font-body)" }}
                        >
                          {c.action}
                        </span>
                        <span
                          className="rounded border border-[rgba(138,110,32,0.45)] bg-[rgba(209,191,160,0.8)] px-2 py-1 text-xs font-bold tracking-widest text-[#05040a] shadow-sm"
                          style={{ fontFamily: "var(--font-fantasy)" }}
                        >
                          {c.keys}
                        </span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {activeTab === "Audio" && (
                <motion.div
                  key="audio"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3
                    className="mb-2 flex items-center gap-3 text-2xl font-bold text-[#05040a]"
                    style={{ fontFamily: "var(--font-title)" }}
                  >
                    <TabIcon name="lute" className="text-[#8a6e20]" />
                    Sounds of the Realm
                  </h3>
                  <p
                    className="mb-5 text-sm italic text-[#8a7b63]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    "Tune the wind and the clash of steel to your liking."
                  </p>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr,1fr]">
                    <div className="flex flex-col gap-4">
                      <SectionLabel>Mixer</SectionLabel>
                      <FantasySlider
                        label="Master Volume"
                        value={audioSettings.muted ? 0 : audioSettings.master}
                        onChange={(v) =>
                          setAudioSettings((s) => ({ ...s, master: v, muted: false }))
                        }
                        onReset={() =>
                          setAudioSettings((s) => ({ ...s, master: 80, muted: false }))
                        }
                        hint="All sound, in one dial."
                        disabled={audioSettings.muted}
                      />
                      <FantasySlider
                        label="SFX Volume"
                        value={audioSettings.muted ? 0 : audioSettings.sfx}
                        onChange={(v) => setAudioSettings((s) => ({ ...s, sfx: v }))}
                        onReset={() => setAudioSettings((s) => ({ ...s, sfx: 100 }))}
                        hint="Hits, blocks, footsteps."
                        disabled={audioSettings.muted}
                      />
                      <FantasySlider
                        label="Music Volume"
                        value={audioSettings.muted ? 0 : audioSettings.music}
                        onChange={(v) => setAudioSettings((s) => ({ ...s, music: v }))}
                        onReset={() => setAudioSettings((s) => ({ ...s, music: 60 }))}
                        hint="Ambient lute and drum."
                        disabled={audioSettings.muted}
                      />
                    </div>

                    <div className="flex flex-col gap-4 sm:items-end">
                      <SectionLabel>Quick</SectionLabel>
                      <button
                        type="button"
                        onClick={() =>
                          setAudioSettings((s) => ({ ...s, muted: !s.muted }))
                        }
                        aria-pressed={audioSettings.muted}
                        className={`flex w-full items-center justify-center gap-2 rounded-sm border-2 px-5 py-3 text-sm font-bold uppercase tracking-widest transition-all active:scale-95 ${
                          audioSettings.muted
                            ? "border-[#d4af37] bg-[linear-gradient(135deg,#fff8e1,#d4af37)] text-[#05040a] shadow-[0_0_14px_rgba(212,175,55,0.6)]"
                            : "border-[rgba(138,110,32,0.55)] bg-[rgba(209,191,160,0.7)] text-[#5c4d3c] hover:border-[rgba(138,110,32,0.85)] hover:bg-[rgba(240,230,210,0.9)]"
                        }`}
                        style={{ fontFamily: "var(--font-fantasy)" }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          {audioSettings.muted ? (
                            <>
                              <line x1="23" y1="9" x2="17" y2="15" />
                              <line x1="17" y1="9" x2="23" y2="15" />
                            </>
                          ) : (
                            <>
                              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </>
                          )}
                        </svg>
                        {audioSettings.muted ? "Unmute All" : "Mute All"}
                      </button>
                      <p
                        className="w-full text-[11px] italic text-[#8a7b63]"
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        The bards shall heed your command.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "Video" && (
                <motion.div
                  key="video"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3
                    className="mb-2 flex items-center gap-3 text-2xl font-bold text-[#05040a]"
                    style={{ fontFamily: "var(--font-title)" }}
                  >
                    <TabIcon name="eye" className="text-[#8a6e20]" />
                    View of the Arena
                  </h3>
                  <p
                    className="mb-5 text-sm italic text-[#8a7b63]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    "The world can be painted in broad strokes or fine detail."
                  </p>

                  <SectionLabel>Quality</SectionLabel>
                  <RadioCardGroup
                    value={videoSettings.quality}
                    onChange={(v) => setVideoSettings((s) => ({ ...s, quality: v }))}
                    options={[
                      { value: "low", label: "Low", glyph: "I", hint: "No bloom · dpr 1" },
                      { value: "medium", label: "Medium", glyph: "II", hint: "Bloom · dpr 1.5" },
                      { value: "high", label: "High", glyph: "III", hint: "Full effects · dpr 2" },
                    ]}
                  />

                  <SectionLabel>Effects</SectionLabel>
                  <div className="flex flex-col gap-1">
                    <FantasyToggle
                      label="Hit Spark Particles"
                      hint="Bursts of light on every landed blow."
                      value={videoSettings.hitSparks}
                      onChange={(v) =>
                        setVideoSettings((s) => ({ ...s, hitSparks: v }))
                      }
                    />
                    <FantasyToggle
                      label="Damage Numbers"
                      hint="Floating numerals on each hit."
                      value={videoSettings.damageNumbers}
                      onChange={(v) =>
                        setVideoSettings((s) => ({ ...s, damageNumbers: v }))
                      }
                    />
                  </div>

                  <div className="mt-4">
                    <FantasySlider
                      label="Screen Shake Intensity"
                      value={videoSettings.screenShake}
                      onChange={(v) =>
                        setVideoSettings((s) => ({ ...s, screenShake: v }))
                      }
                      onReset={() =>
                        setVideoSettings((s) => ({ ...s, screenShake: 50 }))
                      }
                      hint="How hard the world trembles on a heavy hit."
                    />
                  </div>
                </motion.div>
              )}

              {activeTab === "Gameplay" && (
                <motion.div
                  key="gameplay"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3
                    className="mb-2 flex items-center gap-3 text-2xl font-bold text-[#05040a]"
                    style={{ fontFamily: "var(--font-title)" }}
                  >
                    <TabIcon name="scales" className="text-[#8a6e20]" />
                    Rules of Engagement
                  </h3>
                  <p
                    className="mb-5 text-sm italic text-[#8a7b63]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    "Set the terms of your duel."
                  </p>

                  <SectionLabel>Difficulty</SectionLabel>
                  <RadioCardGroup
                    value={gameplaySettings.difficulty}
                    onChange={(v) =>
                      setGameplaySettings((s) => ({ ...s, difficulty: v }))
                    }
                    options={[
                      { value: "apprentice", label: "Apprentice", glyph: "I", hint: "Rounds 1–2" },
                      { value: "champion", label: "Champion", glyph: "II", hint: "Rounds 1–3" },
                      { value: "legend", label: "Legend", glyph: "III", hint: "Rounds 1–5" },
                    ]}
                  />

                  <SectionLabel>Match Format</SectionLabel>
                  <RadioCardGroup
                    value={gameplaySettings.matchFormat}
                    onChange={(v) =>
                      setGameplaySettings((s) => ({ ...s, matchFormat: v }))
                    }
                    options={[
                      { value: "single", label: "Single Bout", glyph: "I", hint: "1 round" },
                      { value: "bestOf3", label: "Best of Three", glyph: "III", hint: "First to 2" },
                      { value: "bestOf5", label: "Best of Five", glyph: "V", hint: "First to 3" },
                    ]}
                  />

                  <SectionLabel>HUD &amp; Focus</SectionLabel>
                  <div className="flex flex-col gap-1">
                    <FantasyToggle
                      label="Show Control Hints in HUD"
                      hint="Small key reminders on the action bar."
                      value={gameplaySettings.showControlHints}
                      onChange={(v) =>
                        setGameplaySettings((s) => ({ ...s, showControlHints: v }))
                      }
                    />
                    <FantasyToggle
                      label="Auto-Pause When Tab Loses Focus"
                      hint="Freezes the duel if you look away."
                      value={gameplaySettings.autoPauseOnBlur}
                      onChange={(v) =>
                        setGameplaySettings((s) => ({ ...s, autoPauseOnBlur: v }))
                      }
                    />
                  </div>
                </motion.div>
              )}
            </div>

            {/* Bottom buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(138,110,32,0.3)] pt-5">
              <span
                className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-[#8a7b63]"
                style={{ fontFamily: "var(--font-fantasy)" }}
              >
                <kbd
                  className="rounded border border-[rgba(138,110,32,0.45)] bg-[rgba(240,230,210,0.7)] px-1.5 py-0.5 text-[10px] font-bold text-[#05040a]"
                  style={{ fontFamily: "var(--font-fantasy)" }}
                >
                  ESC
                </kbd>
                Press ESC to resume
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <FantasyButton
                  variant="secondary"
                  size="sm"
                  onClick={onResume}
                >
                  Resume
                </FantasyButton>
                <FantasyButton
                  variant="secondary"
                  size="sm"
                  onClick={onRestart}
                >
                  Restart Duel
                </FantasyButton>
                <FantasyButton
                  variant="danger"
                  size="sm"
                  onClick={onQuit}
                >
                  Flee to Tavern
                </FantasyButton>
              </div>
            </div>
          </main>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
