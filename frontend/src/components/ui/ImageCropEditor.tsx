'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';

type Props = { file: File; aspect?: number; circular?: boolean; onCancel: () => void; onApply: (file: File) => void };
type Point = { x: number; y: number };
type ImageSize = { width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Crop locally before upload. No original image is sent until Apply. */
export default function ImageCropEditor({ file, aspect = 1, circular = false, onCancel, onApply }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const previousDistance = useRef(0);
  const [url, setUrl] = useState('');
  const [natural, setNatural] = useState<ImageSize | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const src = URL.createObjectURL(file);
    setUrl(src);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError('');
    return () => URL.revokeObjectURL(src);
  }, [file]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [url]);
  const height = width / aspect;
  const base = natural && width ? Math.max(width / natural.width, height / natural.height) : 0;
  const bounded = (position: Point, scale: number): Point => {
    if (!natural || !width) return { x: 0, y: 0 };
    const maxX = Math.max(0, (natural.width * base * scale - width) / 2);
    const maxY = Math.max(0, (natural.height * base * scale - height) / 2);
    return { x: clamp(position.x, -maxX, maxX), y: clamp(position.y, -maxY, maxY) };
  };
  const position = bounded(offset, zoom);
  const changeZoom = (next: number) => {
    const value = clamp(next, 1, 4);
    setOffset(current => bounded({ x: current.x * value / zoom, y: current.y * value / zoom }, value));
    setZoom(value);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pair = [...pointers.current.values()];
    if (pair.length === 2) previousDistance.current = distance(pair[0], pair[1]);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const old = pointers.current.get(event.pointerId);
    if (!old) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const pair = [...pointers.current.values()];
    if (pair.length === 2) {
      const nextDistance = distance(pair[0], pair[1]);
      if (previousDistance.current > 0) changeZoom(zoom * nextDistance / previousDistance.current);
      previousDistance.current = nextDistance;
    } else if (pair.length === 1) {
      setOffset(current => bounded({ x: current.x + point.x - old.x, y: current.y + point.y - old.y }, zoom));
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    previousDistance.current = 0;
  };
  const apply = async () => {
    if (!natural || !image.current || !base || busy) return;
    setBusy(true);
    setError('');
    try {
      const scale = base * zoom;
      const sourceWidth = width / scale;
      const sourceHeight = height / scale;
      const sourceX = (natural.width - sourceWidth) / 2 - position.x / scale;
      const sourceY = (natural.height - sourceHeight) / 2 - position.y / scale;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.min(aspect === 1 ? 1024 : 1800, Math.round(sourceWidth)));
      canvas.height = Math.max(1, Math.round(canvas.width / aspect));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable on this device.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.current, Math.max(0, sourceX), Math.max(0, sourceY), sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not crop image.')), 'image/jpeg', 0.92));
      if (mounted.current) onApply(new File([blob], 'cropped-photo.jpg', { type: 'image/jpeg' }));
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not crop image.');
    } finally { if (mounted.current) setBusy(false); }
  };
  if (typeof document === 'undefined') return null;
  return createPortal(<div role="dialog" aria-modal="true" aria-label="Crop photo" className="vanta-photo-crop fixed inset-0 z-[9999] flex h-[100dvh] flex-col bg-[#1F2630] text-white" onKeyDown={event => { if (event.key === 'Escape' && !busy) onCancel(); }}>
    <header className="vanta-community-compact-header flex shrink-0 items-center gap-3 border-b border-white/10 px-4">
      <button type="button" disabled={busy} onClick={onCancel} aria-label="Cancel cropping" className="grid h-11 w-11 place-items-center text-[#f2c75c]"><ArrowLeft size={22}/></button>
      <h2 className="flex-1 text-base font-semibold">Adjust photo</h2>
      <button type="button" disabled={!natural || !width || busy} onClick={() => void apply()} className="flex h-11 items-center gap-2 rounded-xl bg-[#d6a83f] px-4 text-sm font-semibold text-black disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin"/> : <Check size={17}/>}Apply</button>
    </header>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#15191f] p-4">
      <div ref={frame} style={{ aspectRatio: aspect, width: '100%', maxWidth: 'min(600px, 76dvh)' }} className="relative touch-none select-none overflow-hidden border border-white/25 bg-black" tabIndex={0} aria-label="Adjust photo by pinching, dragging, or using arrow and plus or minus keys" onKeyDown={event => { if (event.key === "+" || event.key === "=" || event.key === "-") { event.preventDefault(); changeZoom(zoom + (event.key === "-" ? -0.1 : 0.1)); } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); setOffset(current => bounded({ x: current.x + (event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0), y: current.y + (event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0) }, zoom)); } }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onWheel={event => changeZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1))}>
        {url && <img ref={image} src={url} alt="Photo to crop" draggable={false} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => { setNatural(null); setError('This image format could not be opened. Choose a JPG, PNG or WebP photo.'); }} className="pointer-events-none absolute left-1/2 top-1/2 !max-w-none" style={natural && base ? { width: natural.width * base * zoom, height: natural.height * base * zoom, transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))` } : { opacity: 0 }}/>}
        {circular ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#f2c75c] shadow-[0_0_0_999px_rgba(0,0,0,.62)]"/> : <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 border-2 border-[#f2c75c]">{Array.from({length:9}, (_, index) => <span key={index} className="border border-white/25"/>)}</div>}
      </div>
    </div>
    {error && <p role="alert" className="shrink-0 px-4 py-3 text-center text-xs text-red-300">{error}</p>}
  </div>, document.body);
}
