import { useState, useCallback, useRef, useEffect, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { AnimatePresence } from 'framer-motion';
import Game from './Game';
import StartScreen from './ui/StartScreen';
import CharacterSelectScreen from './ui/CharacterSelectScreen';
import ArenaSelectScreen from './ui/ArenaSelectScreen';
import HUD from './ui/HUD';
import DamageNumbers from './ui/DamageNumbers';
import RoundOverlay from './ui/RoundOverlay';
import GameOverScreen from './ui/GameOverScreen';
import PauseMenu from './ui/PauseMenu';
import ImpactFlash from './ui/ImpactFlash';
import { CodexOverlay, ForgeOverlay, SettingsOverlay } from './ui/StartScreenOverlays';
import { VfxProvider } from './vfx/VfxManager.jsx';
import { CHARACTER_LIST, DEFAULT_CHARACTER } from './data/characterData.js';
import { ARENA_LIST, DEFAULT_ARENA } from './data/arenaData.js';
import './App.css';

function App() {
  const [gamePhase, setGamePhase] = useState('start');
  const [paused, setPaused] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState(DEFAULT_CHARACTER.id);
  const [selectedArenaId, setSelectedArenaId] = useState(DEFAULT_ARENA.id);
  const [gameKey, setGameKey] = useState(0);
  const [placeholderScreen, setPlaceholderScreen] = useState(null);

  const [audioSettings, setAudioSettings] = useState({
    master: 80,
    sfx: 100,
    music: 60,
    muted: false,
  });
  const [videoSettings, setVideoSettings] = useState({
    quality: 'medium',
    hitSparks: true,
    damageNumbers: true,
    screenShake: 50,
  });
  const [gameplaySettings, setGameplaySettings] = useState({
    difficulty: 'champion',
    matchFormat: 'bestOf3',
    showControlHints: true,
    autoPauseOnBlur: true,
  });

  const [playerHP, setPlayerHP] = useState(100);
  const [npcHP, setNpcHP] = useState(100);
  const [playerStamina, setPlayerStamina] = useState(100);
  const [npcStamina, setNpcStamina] = useState(100);
  const [round, setRound] = useState(1);
  const [playerScore, setPlayerScore] = useState(0);
  const [npcScore, setNpcScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [roundText, setRoundText] = useState(null);
  const [gameOverResult, setGameOverResult] = useState(null);
  const [hitText, setHitText] = useState(null);

  const [damageNumbers, setDamageNumbers] = useState([]);
  const [impactFlash, setImpactFlash] = useState(null);
  const [screenShakeClass, setScreenShakeClass] = useState('');

  const gameComponentRef = useRef(null);
  const prevPlayerHPRef = useRef(100);
  const prevNpcHPRef = useRef(100);
  const damageIdRef = useRef(0);
  const modelReadyRef = useRef(false);

  const npcCharacter = useMemo(() => CHARACTER_LIST[3], []);

  const selectedCharacter = useMemo(
    () => CHARACTER_LIST.find((c) => c.id === selectedCharacterId) || DEFAULT_CHARACTER,
    [selectedCharacterId]
  );
  const selectedArena = useMemo(
    () => ARENA_LIST.find((a) => a.id === selectedArenaId) || DEFAULT_ARENA,
    [selectedArenaId]
  );

  const addDamageNumber = useCallback((text, color, isPlayerSide, isCrit) => {
    const id = damageIdRef.current++;
    const side = isPlayerSide ? -1 : 1;
    const x = 50 + side * (15 + Math.random() * 12);
    const y = 35 + Math.random() * 25;
    setDamageNumbers((prev) => [...prev, { id, text, color, x, y, crit: isCrit }]);
    setTimeout(() => {
      setDamageNumbers((prev) => prev.filter((d) => d.id !== id));
    }, 760);
  }, []);

  const triggerImpactFlash = useCallback((color) => {
    setImpactFlash({ color, key: Date.now() });
    setTimeout(() => setImpactFlash(null), 180);
  }, []);

  const triggerScreenShake = useCallback((isHeavy) => {
    setScreenShakeClass(isHeavy ? 'shake-heavy' : 'shake-light');
    setTimeout(() => setScreenShakeClass(''), 400);
  }, []);

  // Poll the Game refs for HUD state and detect hits from HP changes.
  useEffect(() => {
    if (gamePhase !== 'playing' && gamePhase !== 'roundEnd') return;

    const interval = setInterval(() => {
      const g = gameComponentRef.current;
      if (!g) return;
      const player = g.playerRef.current;
      const npc = g.npcRef.current;
      const game = g.gameRef.current;
      if (!player || !npc || !game) return;

      setPlayerHP(player.hp);
      setNpcHP(npc.hp);
      setPlayerStamina(player.stamina);
      setNpcStamina(npc.stamina);
      setRound(game.round);
      setPlayerScore(game.playerScore);
      setNpcScore(game.npcScore);
      setCombo(Math.max(player.comboCount, npc.comboCount));

      // Push the current quality preset and a normalised player HP onto
      // the shared gameRef so ArenaPostFx can read them inside useFrame
      // without an extra prop / context bridge through the Canvas.
      game.qualityPreset = videoSettings.quality;
      const hpRatio = Math.max(0, Math.min(1, player.hp / 100));
      game.playerHpRatio = hpRatio;
      // lowHpFactor ramps from 0 at HP 30 to 1 at HP 0. ArenaPostFx lerps
      // toward this target so the colour grade fades in / out gracefully.
      game.lowHpFactor = Math.max(0, Math.min(1, (30 - player.hp) / 30));

      // Detect HP drops to show damage numbers / flashes.
      const playerDelta = prevPlayerHPRef.current - player.hp;
      const npcDelta = prevNpcHPRef.current - npc.hp;

      if (playerDelta > 0) {
        const isCrit = playerDelta >= 12 || game.screenShake > 0.35;
        const color = isCrit ? '#ffd700' : '#ff3344';
        addDamageNumber(`-${Math.round(playerDelta)}`, color, true, isCrit);
        triggerImpactFlash(color);
        triggerScreenShake(isCrit || playerDelta >= 10);
        setHitText({ text: npc.anim.toUpperCase(), color, key: Date.now(), crit: isCrit });
        setTimeout(() => setHitText(null), 500);
        // Hit pulses for the post-fx layer.
        game.vignettePulse = Math.max(game.vignettePulse || 0, isCrit ? 0.42 : 0.3);
        game.critPulse = Math.max(game.critPulse || 0, isCrit ? 0.7 : 0.25);
      }
      if (npcDelta > 0) {
        const isCrit = npcDelta >= 12 || game.screenShake > 0.35;
        const color = isCrit ? '#ffd700' : '#00d4ff';
        addDamageNumber(`-${Math.round(npcDelta)}`, color, false, isCrit);
        triggerImpactFlash(color);
        triggerScreenShake(isCrit || npcDelta >= 10);
        setHitText({ text: player.anim.toUpperCase(), color, key: Date.now(), crit: isCrit });
        setTimeout(() => setHitText(null), 500);
        game.vignettePulse = Math.max(game.vignettePulse || 0, isCrit ? 0.42 : 0.3);
        game.critPulse = Math.max(game.critPulse || 0, isCrit ? 0.7 : 0.25);
      }

      prevPlayerHPRef.current = player.hp;
      prevNpcHPRef.current = npc.hp;
    }, 80);

    return () => clearInterval(interval);
  }, [gamePhase, addDamageNumber, triggerImpactFlash, triggerScreenShake, videoSettings.quality]);

  // Expose Gradio AI request helper. In local dev (Vite serves the React app
  // directly with no Gradio backend), we never make network calls so the HF
  // Space's A10G is never woken. The client-side mock AI is used instead.
  const isLocalDev = import.meta.env.DEV === true;

  useEffect(() => {
    if (isLocalDev) {
      // Local dev: stub sendAIRequest to a no-op. Game.jsx's
      // canCallModel check is false because modelReadyRef stays false.
      window.sendAIRequest = async () => {};
      return () => {
        window.sendAIRequest = undefined;
      };
    }
    window.sendAIRequest = async (sequence) => {
      try {
        const res = await fetch('/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sequence }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('ai-response', { detail: data }));
      } catch (err) {
        console.error('AI request failed:', err);
        // A failed request implies the model is offline; fall back locally.
        modelReadyRef.current = false;
        window.dispatchEvent(
          new CustomEvent('ai-response', {
            detail: { reasoning: err.message, counterMove: null, sequence },
          })
        );
      }
    };

    return () => {
      window.sendAIRequest = undefined;
    };
  }, [isLocalDev]);

  // Probe the AI backend on mount. Game.jsx reads modelReadyRef to decide
  // whether to call the /predict endpoint or fall back to the client-side
  // mock counter generator. In local dev we skip the probe entirely so no
  // request reaches the Hugging Face Space.
  useEffect(() => {
    if (isLocalDev) {
      modelReadyRef.current = false;
      return;
    }
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch('/health', { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          modelReadyRef.current = Boolean(data && data.ready);
        }
      } catch {
        if (!cancelled) modelReadyRef.current = false;
      }
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, [isLocalDev]);

  // Global pause toggle.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && (gamePhase === 'playing' || gamePhase === 'roundEnd')) {
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gamePhase]);

  const startGame = () => setGamePhase('characterSelect');
  const onCharacterConfirm = () => setGamePhase('arenaSelect');
  const onArenaConfirm = () => setGamePhase('playing');

  const restartGame = () => {
    setGameKey((k) => k + 1);
    setGamePhase('playing');
    setPlayerHP(100);
    setNpcHP(100);
    setPlayerStamina(100);
    setNpcStamina(100);
    setRound(1);
    setPlayerScore(0);
    setNpcScore(0);
    setGameOverResult(null);
    setRoundText(null);
    setCombo(0);
    prevPlayerHPRef.current = 100;
    prevNpcHPRef.current = 100;
  };

  const handleRoundEnd = useCallback(
    (gameState) => {
      const playerWon = gameState.winner === 'player';
      setRoundText(playerWon ? 'ROUND WON' : 'ROUND LOST');
      setTimeout(() => {
        setRoundText(null);
      }, 2800);
    },
    []
  );

  const handleGameOver = useCallback(
    (winner) => {
      const playerWon = winner === 'player';
      setGameOverResult(playerWon);
      setGamePhase('gameOver');
    },
    []
  );

  // GPU-pause: only mount the heavy 3D scene (and run useFrame) while a match
  // is actively being played. Select screens, pause, and game-over are pure DOM
  // overlays with no canvas, so the browser does zero GPU work between matches.
  const isMatchActive =
    (gamePhase === 'playing' || gamePhase === 'roundEnd') && !paused;
  const isMatchPaused =
    (gamePhase === 'playing' || gamePhase === 'roundEnd') && paused;

  // When the GPU isn't driving a 3D scene, add .gpu-idle to the root so CSS
  // animations and decorative particles freeze and the page is fully static.
  const rootClass = `game-container ${screenShakeClass} ${isMatchActive ? '' : 'gpu-idle'}`;
  const gpuLabel = isMatchActive ? 'GPU ACTIVE' : 'GPU IDLE';
  // Short build hash so the user can confirm they're on the latest build.
  // Reads __BUILD_VERSION__ injected by vite.config.js.
  const buildVersion = (typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : '').slice(-6);

  return (
    <VfxProvider>
      <div className={rootClass} data-gpu={isMatchActive ? 'active' : 'idle'}>
        <div
          className={`gpu-status ${isMatchActive ? 'is-active' : 'is-idle'}`}
          aria-hidden="true"
        >
          <span className="dot" />
          <span>{gpuLabel}</span>
          {buildVersion && <span style={{ opacity: 0.55, marginLeft: 6 }}>v{buildVersion}</span>}
        </div>
        {isMatchActive && (
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80 text-amber-200 font-cinzel text-sm tracking-widest">
                Loading fighters...
              </div>
            }
          >
            <Canvas
              key={gameKey}
              shadows
              camera={{ position: [0, 4, 12], fov: 50 }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
              dpr={[1, 2]}
              frameloop="always"
            >
              <Game
                ref={gameComponentRef}
                arena={selectedArena}
                playerCharacter={selectedCharacter}
                npcCharacter={npcCharacter}
                onGameOver={handleGameOver}
                onRoundEnd={handleRoundEnd}
                onPause={() => setPaused(true)}
                paused={false}
                modelReadyRef={modelReadyRef}
              />
            </Canvas>
          </Suspense>
        )}

        {isMatchPaused && (
          <PausedCanvas key={gameKey} arena={selectedArena} characters={[selectedCharacter, npcCharacter]} />
        )}

        {(gamePhase === 'playing' || gamePhase === 'roundEnd') && !paused && (
          <HUD
            playerHP={playerHP}
            npcHP={npcHP}
            round={round}
            playerScore={playerScore}
            npcScore={npcScore}
            combo={combo}
            energy={playerStamina}
            stamina={playerStamina}
            npcStamina={npcStamina}
          />
        )}

        <DamageNumbers numbers={damageNumbers} />

        {impactFlash && <ImpactFlash color={impactFlash.color} key={impactFlash.key} />}

        {hitText && (
          <div key={hitText.key} className="hit-splash" style={{ color: hitText.color }}>
            {hitText.crit && <span className="crit-star">✦</span>}
            {hitText.text}
          </div>
        )}

        {roundText && <RoundOverlay result={roundText} />}

        {paused && gamePhase !== 'gameOver' && gamePhase !== 'start' && (
          <PauseMenu
            onResume={() => setPaused(false)}
            onRestart={restartGame}
            onQuit={() => {
              setPaused(false);
              setGamePhase('start');
            }}
            audioSettings={audioSettings}
            setAudioSettings={setAudioSettings}
            videoSettings={videoSettings}
            setVideoSettings={setVideoSettings}
            gameplaySettings={gameplaySettings}
            setGameplaySettings={setGameplaySettings}
          />
        )}

        {gamePhase === 'start' && (
          <StartScreen
            onStart={startGame}
            onOpenCodex={() => setPlaceholderScreen('codex')}
            onOpenForge={() => setPlaceholderScreen('forge')}
            onOpenSettings={() => setPlaceholderScreen('settings')}
          />
        )}

        <AnimatePresence>
          {gamePhase === 'start' && placeholderScreen === 'codex' && (
            <CodexOverlay onClose={() => setPlaceholderScreen(null)} />
          )}
          {gamePhase === 'start' && placeholderScreen === 'forge' && (
            <ForgeOverlay onClose={() => setPlaceholderScreen(null)} />
          )}
          {gamePhase === 'start' && placeholderScreen === 'settings' && (
            <SettingsOverlay
              onClose={() => setPlaceholderScreen(null)}
              gpuActive={isMatchActive}
            />
          )}
        </AnimatePresence>

        {gamePhase === 'characterSelect' && (
          <CharacterSelectScreen
            characters={CHARACTER_LIST}
            selectedId={selectedCharacterId}
            onSelect={setSelectedCharacterId}
            onConfirm={onCharacterConfirm}
            onBack={() => setGamePhase('start')}
          />
        )}

        {gamePhase === 'arenaSelect' && (
          <ArenaSelectScreen
            arenas={ARENA_LIST}
            selectedId={selectedArenaId}
            onSelect={setSelectedArenaId}
            onConfirm={onArenaConfirm}
            onBack={() => setGamePhase('characterSelect')}
          />
        )}

        {gamePhase === 'gameOver' && (
          <GameOverScreen
            victory={gameOverResult}
            playerScore={playerScore}
            npcScore={npcScore}
            onRestart={restartGame}
            onMenu={() => setGamePhase('start')}
          />
        )}
      </div>
    </VfxProvider>
  );
}

// Frozen-frame canvas shown while the match is paused. It mounts a Canvas
// with `frameloop="never"` so R3F draws exactly one frame and then idles —
// the WebGL context keeps the last image in its framebuffer and the GPU is
// not asked to render again until the player resumes. The pause menu
// overlay sits above it.
function PausedCanvas({ arena, characters }) {
  return (
    <Suspense
      fallback={
        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/80 text-amber-200 font-cinzel text-sm tracking-widest">
          Loading fighters...
        </div>
      }
    >
      <Canvas
        shadows={false}
        camera={{ position: [0, 4, 12], fov: 50 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true }}
        dpr={1}
        frameloop="never"
      >
        <Game
          arena={arena}
          playerCharacter={characters[0]}
          npcCharacter={characters[1]}
          paused
        />
      </Canvas>
    </Suspense>
  );
}

export default App;
