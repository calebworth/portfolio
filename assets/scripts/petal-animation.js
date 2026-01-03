(() => {
  /**
   * Inspired by a "sakura petals" look:
   * - soft pink fills
   * - slight blur and translucency
   * - slow drift / sway / rotation
   */

  const canvas = document.getElementById("petals-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  /** @type {{ enabled: boolean; reducedMotion: boolean; visibilityBoost: number }} */
  const state = {
    enabled: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    visibilityBoost: 0,
  };

  const mm = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (mm && typeof mm.addEventListener === "function") {
    mm.addEventListener("change", (e) => {
      state.reducedMotion = !!e.matches;
    });
  }

  // Config tuned to match the subtle reference look.
  const config = {
    baseCount: 42,
    maxCount: 90,
    minSize: 8,
    maxSize: 28,
    // Gentle wind that changes over time (biased right to drift top-left -> bottom-right).
    windStrength: 0.12,
    windBias: 0.62,
    windGustiness: 0.18,
    windScale: 0.11,
    // Overall motion multiplier (lower = slower / less distracting).
    motion: 0.4,
    // Global fall speed multiplier.
    fallSpeed: 1.0,
    // Slight blur for softness.
    blurPx: 0.7,
  };

  // Adaptive quality to keep animation smooth on weaker CPUs.
  const quality = {
    level: 0,
    levels: [
      { dprMax: 2, countScale: 1, blurPx: config.blurPx },
      { dprMax: 1.5, countScale: 0.82, blurPx: Math.max(0.4, config.blurPx * 0.8) },
      { dprMax: 1.25, countScale: 0.62, blurPx: Math.max(0.2, config.blurPx * 0.6) },
    ],
    lastAdjust: 0,
  };

  const perf = {
    avgMs: 16.7,
  };

  const palette = {
    fillA: [
      [255, 230, 240],
      [255, 220, 235],
      [255, 205, 225],
    ],
    fillB: [
      [255, 255, 255],
      [255, 245, 250],
    ],
    target: {
      fillA: [245, 165, 195],
      fillB: [255, 225, 238],
      outline: [230, 105, 145],
      vein: [220, 90, 135],
      microVein: [235, 125, 160],
    },
    outlineBase: [255, 185, 208],
    veinBase: [255, 175, 200],
    microVeinBase: [255, 195, 214],
  };

  /**
   * @typedef {{
   *  wScale: number; hScale: number;
   *  asym: number; notch: number; tip: number; lobe: number; curl: number;
   *  vein: number;
   *  gradX: number; gradY: number;
   *  edge: number; detail: number;
   *  veinCount: number;
   * }} PetalShape
   */

  /**
   * @typedef {{
   *  x: number; y: number;
   *  vx: number; vy: number;
   *  size: number;
   *  rot: number; rotSpeed: number;
   *  swayPhase: number; swayAmp: number; swaySpeed: number;
   *  flutterPhase: number; flutterSpeed: number; flutterAmp: number;
   *  baseA: number[]; baseB: number[];
   *  colorA: string; colorB: string;
   *  alphaSeed: number; alpha: number;
   *  shape: PetalShape;
   *  sprite: HTMLCanvasElement | OffscreenCanvas | null;
   *  spriteSize: number;
   * }} Petal
   */

  /** @type {Petal[]} */
  let petals = [];

  let rafId = 0;
  let lastT = performance.now();
  let dpr = 1;
  let w = 0;
  let h = 0;

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixRgb = (a, b, t) => [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
  const rgba = (rgb, alpha) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

  const supportsOffscreen = typeof OffscreenCanvas !== "undefined";

  function getQualitySettings() {
    return quality.levels[quality.level];
  }

  function getBlurPx() {
    return getQualitySettings().blurPx;
  }

  function createSpriteCanvas(size) {
    if (supportsOffscreen) return new OffscreenCanvas(size, size);
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    return sprite;
  }

  function getSpriteDim(p, blurPx) {
    return Math.max(24, Math.ceil(p.size * 3.2 + blurPx * 4));
  }

  const contrastQueries = {
    more: window.matchMedia?.("(prefers-contrast: more)"),
    less: window.matchMedia?.("(prefers-contrast: less)"),
    reduceTransparency: window.matchMedia?.("(prefers-reduced-transparency: reduce)"),
    forcedColors: window.matchMedia?.("(forced-colors: active)"),
    gamutP3: window.matchMedia?.("(color-gamut: p3)"),
  };

  function getPetalAlpha(seed) {
    const boost = clamp(state.visibilityBoost, 0, 1);
    const min = lerp(0.48, 0.62, boost);
    const max = lerp(0.78, 0.92, boost);
    return clamp(lerp(min, max, seed), 0.42, 0.95);
  }

  function getPetalColors(baseA, baseB) {
    const boost = clamp(state.visibilityBoost, 0, 1);
    const a = mixRgb(baseA, palette.target.fillA, boost);
    const b = mixRgb(baseB, palette.target.fillB, boost);
    return { colorA: rgba(a, 1), colorB: rgba(b, 1) };
  }

  function refreshPetalVisuals() {
    for (const p of petals) {
      const colors = getPetalColors(p.baseA, p.baseB);
      p.colorA = colors.colorA;
      p.colorB = colors.colorB;
      p.alpha = getPetalAlpha(p.alphaSeed);
      renderPetalSprite(p);
    }
  }

  function applyQualityLevel(nextLevel) {
    const clamped = clamp(nextLevel, 0, quality.levels.length - 1);
    if (clamped === quality.level) return;
    const prevBlurPx = getBlurPx();
    quality.level = clamped;
    resize({ preservePetals: true, prevBlurPx });
  }

  function maybeAdjustQuality(nowMs) {
    if (nowMs - quality.lastAdjust < 1200) return;
    quality.lastAdjust = nowMs;
    if (perf.avgMs > 30 && quality.level < quality.levels.length - 1) {
      applyQualityLevel(quality.level + 1);
    } else if (perf.avgMs < 18 && quality.level > 0) {
      applyQualityLevel(quality.level - 1);
    }
  }

  function listenMedia(mql, handler) {
    if (!mql) return;
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
    } else if (typeof mql.addListener === "function") {
      mql.addListener(handler);
    }
  }

  function updateVisibilityBoost() {
    const lowGamut = contrastQueries.gamutP3 ? !contrastQueries.gamutP3.matches : false;
    const boost = clamp(
      (contrastQueries.more?.matches ? 0.45 : 0) +
        (contrastQueries.forcedColors?.matches ? 0.5 : 0) +
        (contrastQueries.reduceTransparency?.matches ? 0.25 : 0) +
        (lowGamut ? 0.2 : 0) -
        (contrastQueries.less?.matches ? 0.2 : 0),
      0,
      1
    );
    if (boost === state.visibilityBoost) return;
    state.visibilityBoost = boost;
    refreshPetalVisuals();
  }

  listenMedia(contrastQueries.more, updateVisibilityBoost);
  listenMedia(contrastQueries.less, updateVisibilityBoost);
  listenMedia(contrastQueries.reduceTransparency, updateVisibilityBoost);
  listenMedia(contrastQueries.forcedColors, updateVisibilityBoost);
  listenMedia(contrastQueries.gamutP3, updateVisibilityBoost);

  function resize(options = {}) {
    const { preservePetals = false, prevBlurPx = null } = options;
    const prevW = w;

    const qualitySettings = getQualitySettings();
    dpr = clamp(window.devicePixelRatio || 1, 1, qualitySettings.dprMax);
    w = Math.max(1, Math.floor(window.innerWidth));
    h = Math.max(1, Math.floor(window.innerHeight));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Density scales with area, but stays in a reasonable range.
    const area = w * h;
    const minCount = 12;
    const maxCount = Math.max(minCount, Math.round(config.maxCount * qualitySettings.countScale));
    const target = clamp(
      Math.round(config.baseCount * (area / (1100 * 700)) * qualitySettings.countScale),
      minCount,
      maxCount
    );

    const shouldPreserve = preservePetals && petals.length > 0 && prevW > 0;
    if (!shouldPreserve) {
      petals = makePetals(target, true);
      return;
    }

    // Preserve existing petals; only add/remove to match the new target count.
    // (This avoids the occasional "everything reset" feeling on resize/quality changes.)
    if (petals.length < target) {
      petals.push(...makePetals(target - petals.length, false));
    } else if (petals.length > target) {
      petals.length = target;
    }

    // If the viewport width changed, keep petals roughly in the same relative X position.
    // Avoid scaling Y (mobile address bar resize) to prevent visible vertical jumps.
    if (prevW > 0 && w !== prevW) {
      const sx = w / prevW;
      for (const p of petals) p.x *= sx;
    }

    // Pull any far-off petals back into a reasonable horizontal range.
    for (const p of petals) {
      if (p.x < -w * 0.5 || p.x > w * 1.5) {
        p.x = rand(-w * 0.25, w * 0.35);
      }
    }

    // Sprite dims depend on blur; if quality changed blur, re-render sprites.
    const nextBlurPx = getBlurPx();
    if (typeof prevBlurPx === "number" && nextBlurPx !== prevBlurPx) {
      for (const p of petals) renderPetalSprite(p);
    }
  }

  function makePetals(count, scatterEverywhere = false) {
    /** @type {Petal[]} */
    const arr = [];
    for (let i = 0; i < count; i++) {
      const size = rand(config.minSize, config.maxSize) * rand(0.78, 1.15);
      const x = scatterEverywhere ? rand(-w * 0.05, w * 1.05) : rand(-w * 0.25, w * 0.35);
      const y = scatterEverywhere ? rand(-h * 0.2, h * 1.1) : rand(-h, -size);
      const vy = rand(18, 52) * (size / 24) * config.fallSpeed;
      const vx = rand(3, 11) * 0.08 * (size / 24);
      const rot = rand(0, Math.PI * 2);
      const rotSpeed = rand(-0.7, 0.7) * (size / 24);
      const swayAmp = rand(10, 60) * (size / 24);
      const swaySpeed = rand(0.5, 1.2);
      const swayPhase = rand(0, Math.PI * 2);
      const flutterPhase = rand(0, Math.PI * 2);
      const flutterSpeed = rand(1.2, 2.6);
      const flutterAmp = rand(0.06, 0.18) * (size / 24);

      /** @type {PetalShape} */
      const shape = {
        wScale: rand(0.82, 1.18),
        hScale: rand(0.9, 1.22),
        asym: rand(-0.14, 0.14),
        notch: rand(-0.02, 0.025),
        tip: rand(-0.03, 0.05),
        lobe: rand(-0.02, 0.035),
        curl: rand(-0.06, 0.06),
        vein: rand(-0.22, 0.22),
        gradX: rand(-0.06, 0.06),
        gradY: rand(-0.06, 0.06),
        edge: rand(0.35, 1),
        detail: rand(0.45, 1),
        veinCount: Math.random() < 0.45 ? 3 : Math.random() < 0.7 ? 2 : 1,
      };

      // Mostly-white palette with a subtle pink blush (less distracting).
      // Using two tones for a gentle gradient: white highlight + whisper-blush edges.
      const tint = rand(0, 1);
      const alphaSeed = rand(0, 1);
      const baseA = tint < 0.55 ? palette.fillA[0] : tint < 0.9 ? palette.fillA[1] : palette.fillA[2];
      const baseB = tint < 0.75 ? palette.fillB[0] : palette.fillB[1];
      const { colorA, colorB } = getPetalColors(baseA, baseB);
      const alpha = getPetalAlpha(alphaSeed);

      const petal = {
        x,
        y,
        vx,
        vy,
        size,
        rot,
        rotSpeed,
        swayPhase,
        swayAmp,
        swaySpeed,
        flutterPhase,
        flutterSpeed,
        flutterAmp,
        baseA,
        baseB,
        colorA,
        colorB,
        alphaSeed,
        alpha,
        shape,
        sprite: null,
        spriteSize: 0,
      };

      renderPetalSprite(petal);
      arr.push(petal);
    }
    return arr;
  }

  /**
   * Draw a stylized sakura petal in local coordinates centered near (0,0).
   * The silhouette is a rounded teardrop petal with a shallow notch.
   */
  function drawPetalShape(ctx, size, fillA, fillB, shape, visibilityBoost) {
    const s = size;
    // Slightly wider/rounder proportions read closer to real petals.
    const w = s * 0.94 * shape.wScale;
    const h = s * 1.02 * shape.hScale;
    const boost = clamp(visibilityBoost, 0, 1);
    const leftMul = 1 + shape.asym;
    const rightMul = 1 - shape.asym;

    const lx = (v) => -w * v * leftMul;
    const rx = (v) => w * v * rightMul;

    // Two small tips with a shallow central notch (more like the reference photo).
    const notchY = -h * clamp(0.6 + shape.notch, 0.55, 0.72);
    const tipY = -h * clamp(0.72 + shape.tip * 0.12, 0.64, 0.82);
    const tipHalfX = w * clamp(0.16 + shape.edge * 0.08, 0.1, 0.26);
    const lobeY = -h * clamp(0.62 + shape.lobe, 0.54, 0.72);
    const waistY = -h * clamp(0.02 + shape.curl * 0.07, -0.07, 0.07);
    // Rounded bottom cap to avoid a teardrop point.
    const bottomX = w * clamp(0.08 + shape.curl * 0.05, 0.05, 0.15);
    const bottomY = h * clamp(0.44 + shape.tip * 0.2, 0.38, 0.54);
    const capDepth = h * clamp(0.05 + shape.tip * 0.06, 0.02, 0.08);

    const lobeC1x = clamp(0.38 + shape.curl * 0.06, 0.3, 0.46);
    const lobeC2x = clamp(0.6 + shape.curl * 0.05, 0.48, 0.7);
    const waistX = clamp(0.42 + shape.curl * 0.04, 0.32, 0.52);
    const sideC1x = clamp(0.18 + shape.curl * 0.07, 0.1, 0.28);
    const sideC2x = clamp(0.1 + shape.curl * 0.05, 0.06, 0.2);

    ctx.beginPath();
    // Start at left top tip (two-tip silhouette)
    const tipT = clamp(tipHalfX / w, 0.08, 0.35);
    ctx.moveTo(lx(tipT), tipY);
    // Left lobe
    ctx.bezierCurveTo(lx(lobeC1x), lobeY, lx(lobeC2x), -h * 0.16, lx(waistX), waistY);
    // Left side down to rounded bottom
    ctx.bezierCurveTo(lx(sideC1x), h * 0.22, lx(sideC2x), h * 0.38, -bottomX, bottomY);
    ctx.quadraticCurveTo(0, bottomY + capDepth, bottomX, bottomY);
    // Right side up
    ctx.bezierCurveTo(rx(sideC2x), h * 0.38, rx(sideC1x), h * 0.22, rx(waistX), waistY);
    // Right lobe back to notch
    ctx.bezierCurveTo(rx(lobeC2x), -h * 0.16, rx(lobeC1x), lobeY, rx(tipT), tipY);
    // Close the top with a shallow notch
    const notchCurve = h * clamp(0.04 + shape.edge * 0.05, 0.02, 0.09);
    ctx.bezierCurveTo(rx(tipT * 0.65), tipY + notchCurve, rx(tipT * 0.32), notchY + notchCurve * 0.6, 0, notchY);
    ctx.bezierCurveTo(lx(tipT * 0.32), notchY + notchCurve * 0.6, lx(tipT * 0.65), tipY + notchCurve, lx(tipT), tipY);
    ctx.closePath();

    // Gradient: white center + pink edges, with a gentle blush near the tip.
    const gx = w * (shape.gradX * 0.12);
    const gy = h * (0.18 + shape.gradY * 0.12);
    const g = ctx.createRadialGradient(gx, gy, s * 0.05, 0, 0, s * 1.05);
    g.addColorStop(0, fillB);
    g.addColorStop(0.62, fillB);
    g.addColorStop(1, fillA);
    ctx.fillStyle = g;

    // Very subtle shadow gives the "real petal on white" separation.
    ctx.save();
    ctx.shadowColor = `rgba(20, 20, 20, ${clamp(0.045 + boost * 0.045, 0.04, 0.12)})`;
    ctx.shadowBlur = s * clamp(0.18 + boost * 0.12, 0.16, 0.34);
    ctx.shadowOffsetX = s * 0.02;
    ctx.shadowOffsetY = s * 0.06;
    ctx.fill();
    ctx.restore();

    // Tip blush overlay (kept subtle so it doesn't look "outlined").
    ctx.save();
    const blushRgb = mixRgb(palette.outlineBase, palette.target.outline, boost);
    ctx.globalAlpha *= 0.12 + shape.detail * 0.14;
    const tg = ctx.createRadialGradient(0, tipY + h * 0.02, s * 0.04, 0, tipY + h * 0.08, s * 0.86);
    tg.addColorStop(0, rgba(blushRgb, 0.75));
    tg.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.restore();

    // Details (outline + veins). Draw without blur so it reads a bit sharper.
    ctx.save();
    ctx.filter = "none";

    const detail = shape.detail;

    // Soft outline to add definition.
    const outlineAlpha = clamp(0.02 + detail * 0.05 + boost * 0.14, 0.02, 0.22);
    const outlineRgb = mixRgb(palette.outlineBase, palette.target.outline, boost);
    ctx.strokeStyle = rgba(outlineRgb, outlineAlpha);
    ctx.lineWidth = Math.max(0.45, s * (0.02 + boost * 0.008));
    ctx.stroke();

    // Subtle highlight wash near the top-left for depth (kept very light).
    if (detail > 0.55) {
      ctx.save();
      ctx.globalAlpha *= 0.22 + detail * 0.12;
      const hg = ctx.createRadialGradient(gx - w * 0.06, gy - h * 0.08, s * 0.04, 0, 0, s * 0.7);
      hg.addColorStop(0, "rgba(255, 255, 255, 1)");
      hg.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.restore();
    }

    // Veins: center vein + optional side veins for variation.
    const veinAlpha = clamp(0.04 + detail * 0.08 + boost * 0.14, 0.04, 0.25);
    const veinRgb = mixRgb(palette.veinBase, palette.target.vein, boost);
    ctx.strokeStyle = rgba(veinRgb, veinAlpha);
    ctx.lineWidth = Math.max(0.35, s * (0.014 + boost * 0.006));
    ctx.beginPath();
    // Veins originate near the base and fan toward the notch (closer to real petals).
    ctx.moveTo(0, h * 0.34);
    ctx.quadraticCurveTo(w * shape.vein, h * 0.04, 0, -h * 0.36);
    ctx.stroke();

    if (shape.veinCount >= 2) {
      const sideVeinRgb = mixRgb(palette.outlineBase, palette.target.outline, boost);
      ctx.strokeStyle = rgba(sideVeinRgb, veinAlpha * 0.7);
      ctx.lineWidth = Math.max(0.3, s * (0.012 + boost * 0.005));
      const startY = h * 0.16;
      const midY = -h * 0.02;
      const endY = -h * 0.22;
      const spread = clamp(0.3 + shape.curl * 0.08, 0.22, 0.38);
      const endX = clamp(0.18 + shape.curl * 0.04, 0.12, 0.24);

      ctx.beginPath();
      ctx.moveTo(lx(0.1), startY);
      ctx.quadraticCurveTo(lx(spread), midY, lx(endX), endY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rx(0.1), startY);
      ctx.quadraticCurveTo(rx(spread), midY, rx(endX), endY);
      ctx.stroke();
    }

    if (shape.veinCount >= 3) {
      // A couple short "micro veins" near the top for extra variation.
      const microVeinRgb = mixRgb(palette.microVeinBase, palette.target.microVein, boost);
      ctx.strokeStyle = rgba(microVeinRgb, veinAlpha * 0.55);
      ctx.lineWidth = Math.max(0.28, s * (0.01 + boost * 0.004));
      ctx.beginPath();
      ctx.moveTo(lx(0.06), -h * 0.3);
      ctx.quadraticCurveTo(lx(0.16), -h * 0.21, lx(0.08), -h * 0.08);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rx(0.06), -h * 0.3);
      ctx.quadraticCurveTo(rx(0.16), -h * 0.21, rx(0.08), -h * 0.08);
      ctx.stroke();
    }

    ctx.restore();
  }

  function renderPetalSprite(p) {
    const blurPx = getBlurPx();
    const dim = getSpriteDim(p, blurPx);
    let sprite = p.sprite;
    if (!sprite || sprite.width !== dim || sprite.height !== dim) {
      sprite = createSpriteCanvas(dim);
    }
    const sctx = sprite.getContext("2d");
    if (!sctx) {
      p.sprite = null;
      p.spriteSize = 0;
      return;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, dim, dim);
    sctx.translate(dim / 2, dim / 2);
    sctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
    drawPetalShape(sctx, p.size, p.colorA, p.colorB, p.shape, state.visibilityBoost);
    sctx.filter = "none";
    p.sprite = sprite;
    p.spriteSize = dim;
  }

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    const frameMs = t - lastT;
    const dt = Math.min(0.04, frameMs / 1000);
    lastT = t;

    perf.avgMs = perf.avgMs * 0.9 + frameMs * 0.1;
    maybeAdjustQuality(t);

    ctx.clearRect(0, 0, w, h);

    if (!state.enabled) return;

    // In reduced motion, we keep movement extremely subtle.
    const motionScale = (state.reducedMotion ? 0.08 : 1) * config.motion;
    const visibilityBoost = clamp(state.visibilityBoost, 0, 1);

    // A gentle wind that changes slowly over time.
    const wind = (config.windBias + Math.sin(t * 0.00018) * config.windGustiness) * 20 * config.windStrength;

    for (const p of petals) {
      // Update physics
      p.y += p.vy * dt * motionScale;
      p.rot += p.rotSpeed * dt * motionScale;
      p.swayPhase += p.swaySpeed * dt * motionScale;
      p.flutterPhase += p.flutterSpeed * dt * motionScale;
      const sway = Math.sin(p.swayPhase) * p.swayAmp;
      p.x += (p.vx + wind * config.windScale) * dt * 60 * motionScale;

      // Respawn when off-screen
      if (p.y > h + p.size * 2 || p.x > w + p.size * 4) {
        p.y = rand(-h * 0.25, -p.size * 1.5);
        p.x = rand(-w * 0.25, w * 0.35);
      }

      // Draw
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x + sway, p.y);
      ctx.rotate(p.rot);
      const flutter = 1 + Math.sin(p.flutterPhase) * p.flutterAmp * motionScale;
      ctx.scale(flutter, 1);
      if (p.sprite && p.spriteSize) {
        const dim = p.spriteSize;
        ctx.drawImage(p.sprite, -dim / 2, -dim / 2, dim, dim);
      } else {
        drawPetalShape(ctx, p.size, p.colorA, p.colorB, p.shape, visibilityBoost);
      }
      ctx.restore();
    }

    ctx.filter = "none";
  }

  function start() {
    cancelAnimationFrame(rafId);
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", () => {
    resize({ preservePetals: true });
  });

  updateVisibilityBoost();
  resize();
  start();
})();
