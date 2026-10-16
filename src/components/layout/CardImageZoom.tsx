"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import { HologramArtwork, hologramUrl, useHologramIndex } from "@/components/duel/MonsterHolograms";
import styles from "./CardImageZoom.module.css";

interface CardImage {
  src: string;
  alt: string;
  hologram?: { code: number; attribute?: string };
}

/** A mesma ampliação nos painéis do construtor, dos lobbies e da mesa. */
export function CardImageZoom({ src, alt, hologram, className }: CardImage & { className?: string }) {
  const [zoom, setZoom] = useState<CardImage | null>(null);
  const close = useCallback(() => setZoom(null), []);

  return (
    <>
      <button
        type="button"
        data-card-image-zoom
        data-table-control
        aria-label={`Ampliar imagem de ${alt}`}
        aria-haspopup="dialog"
        onClick={() => setZoom({ src, alt, hologram })}
        className={`${styles.trigger} ${className ?? ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} draggable={false} />
      </button>
      {zoom && <CardImageDialog image={zoom} onClose={close} />}
    </>
  );
}

function CardImageDialog({ image, onClose }: { image: CardImage; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const index = useHologramIndex(Boolean(image.hologram));
  const available = image.hologram && index?.kinds.has(image.hologram.code);
  const url = available && index ? hologramUrl(index, image.hologram!.code) : null;
  const [hologramReady, setHologramReady] = useState(false);
  const [hologramOn, setHologramOn] = useState(false);
  const [projectionSide, setProjectionSide] = useState(480);

  useEffect(() => {
    if (!url) return;
    let active = true;
    const sprite = new Image();
    sprite.onload = () => { if (active) setHologramReady(true); };
    sprite.src = url;
    return () => { active = false; };
  }, [url]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const observer = new ResizeObserver(([entry]) => setProjectionSide(entry.contentRect.width * 1.05));
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
    sceneRef.current?.style.setProperty("--card-rotate-x", `${-y * 6}deg`);
    sceneRef.current?.style.setProperty("--card-rotate-y", `${x * 6}deg`);
  }

  function resetTilt() {
    sceneRef.current?.style.setProperty("--card-rotate-x", "0deg");
    sceneRef.current?.style.setProperty("--card-rotate-y", "0deg");
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      data-card-image-dialog
      aria-label={`Imagem ampliada de ${image.alt}`}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className={styles.header}>
        <p>{image.alt}</p>
        <div className={styles.controls}>
          {hologramReady && (
            <button
              type="button"
              role="switch"
              aria-checked={hologramOn}
              aria-label="Mostrar holograma"
              data-hologram-toggle
              data-table-control
              className={styles.toggle}
              onClick={() => setHologramOn((on) => !on)}
            >
              <span aria-hidden className={styles.switchTrack}><span /></span>
              Holograma
            </button>
          )}
          <button type="button" data-table-control onClick={onClose} aria-label="Fechar imagem ampliada" className={styles.close}>
            Fechar <span aria-hidden>✕</span>
          </button>
        </div>
      </header>
      <div
        className={styles.stage}
        onPointerMove={tilt}
        onPointerLeave={resetTilt}
        onPointerCancel={resetTilt}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div ref={sceneRef} className={styles.scene} data-card-image-scene data-hologram={hologramOn}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} draggable={false} className={styles.full} />
          {hologramReady && index && url && (
            <div
              aria-hidden
              data-card-image-hologram
              data-holo-kind={index.kinds.get(image.hologram!.code)}
              className={`${styles.projection} md-holo md-holo-${image.hologram?.attribute?.toLowerCase() || "neutral"} ${hologramOn ? "md-holo-on" : ""}`}
            >
              <HologramArtwork side={projectionSide} layers={index.layers} url={url} />
            </div>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
