// A cat that chases the cursor. Based on oneko.js by @adryd325
// (https://github.com/adryd325/oneko.js), MIT.

import { SlickPlugin } from '$slick';
import nekoSprite from './oneko.gif';
import * as meta from './meta.ts';

type SpriteCoordinates = [number, number];

/** Sprite sheet offsets, in 32px cells. Straight from upstream oneko.js. */
const SPRITE_SETS: Record<string, SpriteCoordinates[]> = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  scratchSelf: [
    [-5, 0],
    [-6, 0],
    [-7, 0],
  ],
  scratchWallN: [
    [0, 0],
    [0, -1],
  ],
  scratchWallS: [
    [-7, -1],
    [-6, -2],
  ],
  scratchWallE: [
    [-2, -2],
    [-2, -3],
  ],
  scratchWallW: [
    [-4, 0],
    [-4, -1],
  ],
  tired: [[-3, -2]],
  sleeping: [
    [-2, 0],
    [-2, -1],
  ],
  N: [
    [-1, -2],
    [-1, -3],
  ],
  NE: [
    [0, -2],
    [0, -3],
  ],
  E: [
    [-3, 0],
    [-3, -1],
  ],
  SE: [
    [-5, -1],
    [-5, -2],
  ],
  S: [
    [-6, -3],
    [-7, -2],
  ],
  SW: [
    [-5, -3],
    [-6, -1],
  ],
  W: [
    [-4, -2],
    [-4, -3],
  ],
  NW: [
    [-1, 0],
    [-1, -1],
  ],
};

const STORAGE_KEY = 'oneko';
const FRAME_MS = 100;
/** Beyond this the tab was backgrounded; resync instead of catching up. */
const RESYNC_MS = 500;

type OnekoState = {
  nekoPosX: number;
  nekoPosY: number;
  mousePosX: number;
  mousePosY: number;
  frameCount: number;
  idleTime: number;
  idleAnimation: string | null;
  idleAnimationFrame: number;
  bgPos: string;
};

export default class Oneko extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['speed'];

  private nekoEl: HTMLDivElement | null = null;
  private animationFrameId: number | null = null;
  private lastFrameTimestamp: number | null = null;

  private nekoPosX = 32;
  private nekoPosY = 32;
  private mousePosX = 0;
  private mousePosY = 0;
  private frameCount = 0;
  private idleTime = 0;
  private idleAnimation: string | null = null;
  private idleAnimationFrame = 0;

  private readonly onMouseMove = (event: MouseEvent) => {
    this.mousePosX = event.clientX;
    this.mousePosY = event.clientY;
  };
  private readonly onBeforeUnload = () => this.saveState();
  private readonly onAnimationFrame = (timestamp: number) => this.tick(timestamp);

  private get speed(): number {
    const value = Number(this.config.speed);
    return Number.isFinite(value) && value > 0 ? value : 10;
  }

  start() {
    this.createElement();
    this.loadState();

    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('beforeunload', this.onBeforeUnload);

    this.animationFrameId = window.requestAnimationFrame(this.onAnimationFrame);
  }

  stop() {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Save before the element goes, so the cat comes back where it was.
    this.saveState();

    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('beforeunload', this.onBeforeUnload);

    this.nekoEl?.remove();
    this.nekoEl = null;
  }

  private createElement() {
    const el = document.createElement('div');
    el.id = 'oneko';
    el.ariaHidden = 'true';
    Object.assign(el.style, {
      width: '32px',
      height: '32px',
      position: 'fixed',
      pointerEvents: 'none',
      imageRendering: 'pixelated',
      zIndex: '2147483647',
      backgroundImage: `url(${nekoSprite})`,
    });
    document.body.appendChild(el);
    this.nekoEl = el;
  }

  private loadState() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const state: OnekoState = JSON.parse(stored);
      this.nekoPosX = state.nekoPosX;
      this.nekoPosY = state.nekoPosY;
      this.mousePosX = state.mousePosX;
      this.mousePosY = state.mousePosY;
      this.frameCount = state.frameCount;
      this.idleTime = state.idleTime;
      this.idleAnimation = state.idleAnimation;
      this.idleAnimationFrame = state.idleAnimationFrame;

      if (this.nekoEl) {
        this.nekoEl.style.backgroundPosition = state.bgPos;
        this.nekoEl.style.left = `${this.nekoPosX - 16}px`;
        this.nekoEl.style.top = `${this.nekoPosY - 16}px`;
      }
    } catch (error) {
      this.log('could not restore position', error);
    }
  }

  private saveState() {
    if (!this.nekoEl) return;
    try {
      const state: OnekoState = {
        nekoPosX: this.nekoPosX,
        nekoPosY: this.nekoPosY,
        mousePosX: this.mousePosX,
        mousePosY: this.mousePosY,
        frameCount: this.frameCount,
        idleTime: this.idleTime,
        idleAnimation: this.idleAnimation,
        idleAnimationFrame: this.idleAnimationFrame,
        bgPos: this.nekoEl.style.backgroundPosition,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      this.log('could not save position', error);
    }
  }

  private tick(timestamp: number) {
    if (!this.nekoEl?.isConnected) return;

    this.lastFrameTimestamp ??= timestamp;
    if (timestamp - this.lastFrameTimestamp > FRAME_MS) {
      // A backgrounded tab would otherwise replay every missed frame at once.
      if (timestamp - this.lastFrameTimestamp > RESYNC_MS) this.lastFrameTimestamp = timestamp;
      else this.lastFrameTimestamp += FRAME_MS;
      this.frame();
    }

    this.animationFrameId = window.requestAnimationFrame(this.onAnimationFrame);
  }

  private setSprite(name: string, frame: number) {
    if (!this.nekoEl) return;
    const spriteSet = SPRITE_SETS[name];
    if (!spriteSet) return;

    const sprite = spriteSet[frame % spriteSet.length];
    this.nekoEl.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
  }

  private resetIdleAnimation() {
    this.idleAnimation = null;
    this.idleAnimationFrame = 0;
  }

  private idle() {
    this.idleTime += 1;

    // Roughly every 20 seconds of sitting still, pick something to do.
    if (this.idleTime > 10 && Math.floor(Math.random() * 200) === 0 && this.idleAnimation === null) {
      const available = ['sleeping', 'scratchSelf'];
      if (this.nekoPosX < 32) available.push('scratchWallW');
      if (this.nekoPosY < 32) available.push('scratchWallN');
      if (this.nekoPosX > window.innerWidth - 32) available.push('scratchWallE');
      if (this.nekoPosY > window.innerHeight - 32) available.push('scratchWallS');
      this.idleAnimation = available[Math.floor(Math.random() * available.length)];
    }

    switch (this.idleAnimation) {
      case 'sleeping':
        if (this.idleAnimationFrame < 8) {
          this.setSprite('tired', 0);
          break;
        }
        this.setSprite('sleeping', Math.floor(this.idleAnimationFrame / 4));
        if (this.idleAnimationFrame > 192) this.resetIdleAnimation();
        break;
      case 'scratchWallN':
      case 'scratchWallS':
      case 'scratchWallE':
      case 'scratchWallW':
      case 'scratchSelf':
        this.setSprite(this.idleAnimation, this.idleAnimationFrame);
        if (this.idleAnimationFrame > 9) this.resetIdleAnimation();
        break;
      default:
        this.setSprite('idle', 0);
        return;
    }
    this.idleAnimationFrame += 1;
  }

  private frame() {
    if (!this.nekoEl) return;

    this.frameCount += 1;
    const diffX = this.nekoPosX - this.mousePosX;
    const diffY = this.nekoPosY - this.mousePosY;
    const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

    if (distance < this.speed || distance < 48) {
      this.idle();
      return;
    }

    this.resetIdleAnimation();

    if (this.idleTime > 1) {
      this.setSprite('alert', 0);
      this.idleTime = Math.min(this.idleTime, 7);
      this.idleTime -= 1;
      return;
    }

    let direction = diffY / distance > 0.5 ? 'N' : '';
    direction += diffY / distance < -0.5 ? 'S' : '';
    direction += diffX / distance > 0.5 ? 'W' : '';
    direction += diffX / distance < -0.5 ? 'E' : '';
    this.setSprite(direction, this.frameCount);

    this.nekoPosX -= (diffX / distance) * this.speed;
    this.nekoPosY -= (diffY / distance) * this.speed;

    this.nekoPosX = Math.min(Math.max(16, this.nekoPosX), window.innerWidth - 16);
    this.nekoPosY = Math.min(Math.max(16, this.nekoPosY), window.innerHeight - 16);

    this.nekoEl.style.left = `${this.nekoPosX - 16}px`;
    this.nekoEl.style.top = `${this.nekoPosY - 16}px`;
  }
}
