'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';

type Detector = { detect(source: HTMLVideoElement | ImageBitmap): Promise<{rawValue:string}[]> };
type DetectorCtor = new (options:{formats:string[]}) => Detector;
function getDetector(): DetectorCtor | undefined {
  return (window as unknown as {BarcodeDetector?:DetectorCtor}).BarcodeDetector;
}
export default function ReceivingScanner({onScan, onCancel}: {onScan:(value:string)=>void;onCancel:()=>void}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onScan);
  const [error,setError] = useState('');
  const [camera,setCamera] = useState(false);
  const [supported,setSupported] = useState(false);
  useEffect(()=>{callback.current=onScan;},[onScan]);
  useEffect(()=>{setSupported(Boolean(getDetector()));},[]);
  useEffect(()=>{
    if (!camera) return;
    let live=true, stream:MediaStream|undefined, timer:number|undefined;
    const stop=()=>{live=false;window.clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());if(video.current)video.current.srcObject=null;};
    async function start(){
      try{
        const Ctor=getDetector();
        if(!Ctor || !navigator.mediaDevices?.getUserMedia)throw new Error('Scanner unavailable');
        const detector=new Ctor({formats:['qr_code']});
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        if(!live){stream.getTracks().forEach(t=>t.stop());return;}
        const element=video.current;
        if(!element){stop();return;}
        element.srcObject=stream;
        await element.play();
        const tick=async()=>{
          if(!live)return;
          try{
            const codes=await detector.detect(element);
            if(!live)return;
            if(codes.length===1){stop();setCamera(false);callback.current(codes[0].rawValue);return;}
            if(codes.length>1)setError('Point the camera at just one QR code.');
          }catch{if(live){stop();setCamera(false);setError('Could not scan. Try a QR image or paste the link.');}return;}
          if(live)timer=window.setTimeout(tick,250);
        };
        void tick();
      }catch{if(live){stop();setCamera(false);setError('Camera unavailable or permission denied. Paste the receiving link instead.');}}
    }
    void start();
    return stop;
  },[camera]);
  async function scanImage(file:File){
    setError('');
    if(!file.type.startsWith('image/')||file.size>10*1024*1024){setError('Choose an image under 10 MB.');return;}
    let bitmap:ImageBitmap|undefined;
    try{
      const Ctor=getDetector();
      if(!Ctor)throw new Error('Unavailable');
      bitmap=await createImageBitmap(file);
      const codes=await new Ctor({formats:['qr_code']}).detect(bitmap);
      if(codes.length!==1){setError('Choose an image containing exactly one QR code.');return;}
      callback.current(codes[0].rawValue);
    }catch{setError('Could not read the QR image. Paste the receiving link instead.');}
    finally{bitmap?.close();}
  }
  return <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="flex items-center justify-between"><p className="font-semibold text-sm">Scan receiving QR</p><button type="button" onClick={onCancel} className="min-h-11 text-xs text-[var(--vanta-gold-bright)]">Close scanner</button></div>
    {!supported?<p className="text-xs text-[var(--text-secondary)]">QR scanning is not supported by this browser. Use your phone camera or paste the receiving link.</p>:<>
      {camera?<><video ref={video} muted playsInline className="aspect-video w-full rounded-lg bg-black object-contain"/><button type="button" onClick={()=>setCamera(false)} className="min-h-11 text-sm">Stop camera</button></>:<div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>{setError('');setCamera(true);}} className="min-h-11 rounded-lg bg-[var(--surface-secondary)] text-sm"><Camera size={16} className="inline mr-1"/>Camera</button><label className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg bg-[var(--surface-secondary)] text-sm"><ImagePlus size={16}/>QR image<input type="file" accept="image/*" className="sr-only" onChange={e=>{const f=e.target.files?.[0];if(f)void scanImage(f);e.target.value='';}}/></label></div>}
    </>}
    {error&&<p role="alert" className="text-xs text-red-300">{error}</p>}
    <p className="text-xs text-[var(--text-secondary)]">Scanning is local to your device. A QR never authorizes payment.</p>
  </div>;
}
