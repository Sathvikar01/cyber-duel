import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * 2.5D side-view orthographic camera controller.
 *
 * Props:
 *  - playerRef: mutable ref to the player state object (uses .position)
 *  - npcRef:    mutable ref to the NPC state object (uses .position)
 *  - gameRef:   mutable ref to game state (uses .screenShake)
 *
 * The camera stays at a fixed Y/Z, centers on the midpoint between fighters,
 * and zooms in/out dynamically based on how far apart they are. Screen shake
 * is read from gameRef.current.screenShake and decayed here.
 */
export default function FightCamera({ playerRef, npcRef, gameRef }) {
  const camRef = useRef();
  // Damped X (horizontal follow) and Y (vertical drift) state.
  // Initialised lazily on the first frame from current fighter positions.
  const midXRef = useRef(null);
  const yRef = useRef(3.2);

  // Use pixel size so the orthographic frustum can follow the canvas aspect.
  const { width, height } = useThree((state) => state.size);

  // World height we want the orthographic frustum to represent at zoom = 1.
  // Was 6; bumped to 7 so the GLB characters (1.8m tall) have more
  // room to breathe -- they were rendering at only ~21% of the screen
  // height before. With worldHeight=7 and zoom=0.7 the effective
  // visible height is 10 units, giving the fighters a comfortable
  // ~18% of the screen each.
  const worldHeight = 7;
  const cameraArgs = useMemo(() => {
    const aspect = height > 0 ? width / height : 1;
    const worldWidth = worldHeight * aspect;
    return [-worldWidth / 2, worldWidth / 2, worldHeight / 2, -worldHeight / 2, 0.1, 100];
  }, [width, height]);

  useFrame((state) => {
    const cam = camRef.current;
    if (!cam) return;

    const p = playerRef.current.position;
    const n = npcRef.current.position;
    const g = gameRef.current;

    const midX = (p[0] + n[0]) / 2;
    const dist = Math.abs(p[0] - n[0]);

    // --- Damped horizontal follow: the camera glides toward the fighter
    //     midpoint instead of snapping to it every frame. -------------------
    if (midXRef.current === null) midXRef.current = midX;
    midXRef.current += (midX - midXRef.current) * 0.08;
    const camX = midXRef.current;

    // --- Vertical drift driven by pose. Low stances (clinches, getups,
    //     knockdowns) pull the camera down; high hits (uppercuts) push it up;
    //     a knockdown or fall adds an extra drop for impact. ----------------
    const pAnim = playerRef.current.anim;
    const nAnim = npcRef.current.anim;
    const lowPoses = new Set(['clinch', 'getup', 'knockdown']);
    const highPoses = new Set(['uppercut']);
    const dropAnims = new Set(['knockdown', 'fall']);

    let yTarget = 3.2;
    if (lowPoses.has(pAnim) || lowPoses.has(nAnim)) yTarget -= 0.3;
    if (highPoses.has(pAnim) || highPoses.has(nAnim)) yTarget += 0.3;
    if (dropAnims.has(pAnim) || dropAnims.has(nAnim)) yTarget -= 0.5;

    // Subtle idle "breathing" — only contributes when neither fighter is in
    // a heavy reaction, so it never fights with a real camera move.
    const time = state.clock.elapsedTime;
    const inHeavyReaction = (pAnim === 'knockdown' || pAnim === 'fall' ||
                              nAnim === 'knockdown' || nAnim === 'fall');
    if (!inHeavyReaction) {
      yTarget += Math.sin(time * 0.5) * 0.02;
    }

    yRef.current += (yTarget - yRef.current) * 0.06;
    const camY = yRef.current;

    // Corner pressure: zoom in slightly when a fighter is pinned to a wall.
    const arenaHalf = 15;
    const leftCornered = Math.min(p[0], n[0]) <= -arenaHalf + 2.0;
    const rightCornered = Math.max(p[0], n[0]) >= arenaHalf - 2.0;
    const cornered = leftCornered || rightCornered;

    // Orthographic zoom: pull back as fighters separate, push in as they close.
    let targetZoom = THREE.MathUtils.clamp(5 / (dist + 3), 0.35, 1.1);
    if (cornered) targetZoom *= 1.08;
    cam.zoom += (targetZoom - cam.zoom) * 0.05;

    // Crit zoom pulse: brief inward punch that decays back to the base zoom.
    if (g.camZoomPulse) {
      g.camZoomPulse *= 0.88;
      if (g.camZoomPulse < 0.001) g.camZoomPulse = 0;
      cam.zoom *= 1 - g.camZoomPulse;
    }

    // Camera recoil decay.
    if (!g.camRecoil) g.camRecoil = { x: 0, y: 0, intensity: 0 };
    const recoil = g.camRecoil;
    const recoilDecay = 0.12;
    recoil.x += (0 - recoil.x) * recoilDecay;
    recoil.y += (0 - recoil.y) * recoilDecay;
    recoil.intensity += (0 - recoil.intensity) * recoilDecay;

    // Screen shake sampled and decayed (mirrors the old Game.jsx behaviour).
    let shakeX = 0;
    let shakeY = 0;
    let shakeZ = 0;
    if (g.screenShake > 0) {
      const shake = g.screenShake * (1 + Math.random() * 0.5);
      shakeX = (Math.random() - 0.5) * shake;
      shakeY = (Math.random() - 0.5) * shake * 0.5;
      shakeZ = (Math.random() - 0.5) * shake * 0.3;

      g.screenShake *= 0.82;
      if (g.screenShake < 0.02) g.screenShake = 0;
    }

    const recoilX = recoil.x * recoil.intensity;
    const recoilY = recoil.y * recoil.intensity;

    // Cinematic roll: damp the camera's Z rotation toward the target roll,
    // then decay the target. Reaches 0 naturally without abrupt snap.
    if (g.camRoll === undefined) g.camRoll = 0;
    cam.rotation.z += (g.camRoll - cam.rotation.z) * 0.1;
    g.camRoll *= 0.92;
    if (Math.abs(g.camRoll) < 0.001) g.camRoll = 0;

    cam.position.set(camX + shakeX + recoilX, camY + shakeY + recoilY, 12 + shakeZ);
    cam.lookAt(camX, 1.4, 0);
    cam.updateProjectionMatrix();
  });

  return (
    <orthographicCamera
      ref={camRef}
      makeDefault
      position={[0, 3.2, 12]}
      args={cameraArgs}
      zoom={0.7}
    />
  );
}
