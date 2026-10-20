/** Company signs drawn on a 2D canvas and used as textures, so no fonts or files are fetched. */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';

export interface SignStyle {
  /** Canvas size in px; the aspect should match the mesh it goes on. */
  w: number;
  h: number;
  bg: string | null;
  fg: string;
  weight?: number;
  /** Optional thin line along the bottom edge. */
  stripe?: string;
}

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function useImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImg(null);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setImg(null);
    i.src = src;
  }, [src]);
  return img;
}

function draw(ctx: CanvasRenderingContext2D, text: string, logo: HTMLImageElement | null, s: SignStyle) {
  const { w, h } = s;
  ctx.clearRect(0, 0, w, h);
  if (s.bg) {
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (s.stripe) {
    ctx.fillStyle = s.stripe;
    ctx.fillRect(0, h - h * 0.07, w, h * 0.07);
  }
  const pad = h * 0.22;
  let logoW = 0;
  if (logo && logo.naturalWidth > 0) {
    const lh = h - pad * 2;
    logoW = Math.min((logo.naturalWidth / logo.naturalHeight) * lh, w * 0.4);
  }
  const gap = logoW ? pad : 0;
  const maxText = w - pad * 2 - logoW - gap;
  let size = h * 0.5;
  ctx.font = `${s.weight ?? 800} ${size}px ${FONT}`;
  while (size > 8 && ctx.measureText(text).width > maxText) {
    size -= 2;
    ctx.font = `${s.weight ?? 800} ${size}px ${FONT}`;
  }
  const textW = text ? ctx.measureText(text).width : 0;
  let x = (w - (logoW + gap + textW)) / 2;
  if (logoW && logo) {
    const lh = logoW * (logo.naturalHeight / logo.naturalWidth);
    ctx.drawImage(logo, x, (h - lh) / 2, logoW, lh);
    x += logoW + gap;
  }
  ctx.fillStyle = s.fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, h / 2 + size * 0.04);
}

/** Some browsers taint a canvas for SVG images, which WebGL then refuses; test on a scratch canvas. */
function canvasSafe(img: HTMLImageElement): boolean {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d')!;
  try {
    ctx.drawImage(img, 0, 0, 4, 4);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

/** A texture with the company name (and logo) that redraws when the inputs change. */
export function useSignTexture(text: string, logoSrc: string | null, style: SignStyle): THREE.CanvasTexture {
  const logo = useImage(logoSrc);
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = style.w;
    c.height = style.h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [style.w, style.h]);
  useEffect(() => {
    draw((tex.image as HTMLCanvasElement).getContext('2d')!, text, logo && canvasSafe(logo) ? logo : null, style);
    tex.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex, text, logo, style.bg, style.fg, style.stripe, style.weight]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}
