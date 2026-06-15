import { motion, AnimatePresence } from "framer-motion";

const INK_SPLATS = [
  "M 60 10 C 75 5 95 8 105 22 C 115 38 100 55 82 56 C 65 58 52 48 48 36 C 44 22 50 14 60 10 Z M 30 60 C 38 55 50 60 52 70 C 54 80 44 86 36 82 C 28 78 24 66 30 60 Z M 100 70 C 112 68 120 76 118 86 C 116 96 104 100 96 92 C 88 84 90 72 100 70 Z",
  "M 50 5 C 70 0 95 10 100 30 C 105 50 88 60 70 58 C 52 56 40 45 42 30 C 44 15 42 8 50 5 Z M 20 50 C 30 45 40 55 38 68 C 36 78 22 80 16 70 C 12 60 14 54 20 50 Z M 90 80 C 100 78 110 88 105 100 C 100 110 84 110 80 98 C 76 90 80 82 90 80 Z",
  "M 55 8 C 80 4 100 16 102 38 C 104 56 86 64 68 60 C 50 56 44 42 46 28 C 48 18 50 12 55 8 Z M 22 55 C 32 52 42 62 40 72 C 38 82 24 86 18 78 C 12 70 14 60 22 55 Z",
];

export default function DamageNumbers({ numbers = [] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[35] overflow-hidden">
      <AnimatePresence>
        {numbers.map(({ id, text, color, x, y, crit = false, heavy = false, side = 1 }) => {
          const isPlayerSide = side === -1;
          const pushX = isPlayerSide ? -1 : 1;
          const splat = INK_SPLATS[id % INK_SPLATS.length];
          const baseSize = crit ? 5 : 3.4;
          const finalSize = crit ? 4.2 : 2.9;

          return (
            <motion.div
              key={id}
              initial={{
                opacity: 0,
                scale: crit ? 0.3 : 0.5,
                x: 0,
                y: crit ? 0 : 8,
              }}
              animate={{
                opacity: [0, 1, 1, 0],
                scale: crit
                  ? [0.3, baseSize * 0.32, baseSize * 0.28, baseSize * 0.22]
                  : [0.5, 1.15, 1, 0.85],
                x: [0, pushX * (crit ? 24 : 12), pushX * (crit ? 42 : 22)],
                y: crit ? [-20, -90, -140] : [8, -40, -80],
                rotate: crit ? [-8, 4, 0] : [-4, 3, 0],
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: crit ? 1.1 : 0.85,
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                left: `${x}%`,
                top: `${y}%`,
                fontFamily: "var(--font-brush)",
                color: crit ? "#000" : color,
                textShadow: crit
                  ? `0 0 8px #ffd700, 0 0 18px #ffd700, 0 0 32px #ffd700, 0 4px 12px rgba(0,0,0,0.9)`
                  : `0 0 6px ${color}, 0 0 18px ${color}, 0 3px 10px rgba(0,0,0,0.9)`,
                WebkitTextStroke: crit ? "2px #ffd700" : "0.5px rgba(0,0,0,0.5)",
                fontSize: crit ? `${finalSize}rem` : `${finalSize}rem`,
                fontWeight: 900,
                lineHeight: 1,
                whiteSpace: "nowrap",
                zIndex: 35,
                transform: "translate(-50%, -50%)",
              }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{
                  filter: `drop-shadow(0 0 12px ${crit ? "rgba(255,215,0,0.9)" : color})`,
                  transform: "translate(-50%, -50%)",
                  left: "50%",
                  top: "50%",
                }}
              >
                <svg
                  width={crit ? 220 : 170}
                  height={crit ? 220 : 170}
                  viewBox="0 0 120 120"
                  className="absolute"
                  style={{
                    transform: "translate(-50%, -50%)",
                    left: "50%",
                    top: "50%",
                  }}
                >
                  <path
                    d={splat}
                    fill={crit ? "#1a0d00" : color}
                    opacity={crit ? 0.85 : 0.75}
                  />
                  {crit && (
                    <path
                      d={splat}
                      fill="none"
                      stroke="#ffd700"
                      strokeWidth="2"
                      opacity="0.7"
                    />
                  )}
                </svg>
              </span>

              {crit && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center"
                >
                  <svg
                    width="140"
                    height="140"
                    viewBox="0 0 120 120"
                    className="absolute"
                    style={{
                      filter: "drop-shadow(0 0 10px rgba(255, 215, 0, 0.95))",
                      transform: "translate(-50%, -50%)",
                      left: "50%",
                      top: "50%",
                    }}
                  >
                    <polygon
                      points="60,0 70,45 120,40 78,65 100,110 60,80 20,110 42,65 0,40 50,45"
                      fill="#ffd700"
                      opacity="0.95"
                    />
                  </svg>
                  <svg
                    width="180"
                    height="180"
                    viewBox="0 0 160 160"
                    className="absolute"
                    style={{
                      filter: "drop-shadow(0 0 6px rgba(0, 0, 0, 0.9))",
                      transform: "translate(-50%, -50%) rotate(18deg)",
                      left: "50%",
                      top: "50%",
                    }}
                  >
                    <polygon
                      points="80,10 92,58 150,52 102,80 130,140 80,105 30,140 58,80 10,52 68,58"
                      fill="none"
                      stroke="#000"
                      strokeWidth="3"
                      opacity="0.95"
                    />
                  </svg>
                </span>
              )}

              {heavy && !crit && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center"
                >
                  <svg
                    width="160"
                    height="160"
                    viewBox="0 0 160 160"
                    className="absolute"
                    style={{
                      filter: "drop-shadow(0 0 14px " + color + ")",
                      transform: "translate(-50%, -50%)",
                      left: "50%",
                      top: "50%",
                    }}
                  >
                    <path
                      d="M 80 5 L 95 60 L 155 55 L 105 88 L 130 150 L 80 110 L 30 150 L 55 88 L 5 55 L 65 60 Z"
                      fill="none"
                      stroke={color}
                      strokeWidth="3.5"
                      opacity="0.85"
                    />
                  </svg>
                </span>
              )}

              <span style={{ position: "relative", zIndex: 2 }}>{text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
