"use client";

import { useEffect } from "react";
import { scanImage } from "../lib/nsfw";

export default function ScanPage() {
  useEffect(() => {
    const here = window.location.origin;
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== here || !e.source) return;
      const d = e.data as { type?: string; id?: string; blob?: Blob; name?: string } | null;
      if (!d || d.type !== "averages-scan" || typeof d.id !== "string" || !(d.blob instanceof Blob)) return;
      let verdict: { allowed: boolean; reason?: string };
      try {
        const v = await scanImage(new File([d.blob], String(d.name || "picture").slice(0, 200), { type: d.blob.type }));
        verdict = { allowed: !!v.allowed, reason: v.reason };
      } catch {
        verdict = { allowed: false, reason: "We couldn't check that image. Please try a different one." };
      }
      (e.source as Window).postMessage({ type: "averages-scan-result", id: d.id, ...verdict }, here);
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: "averages-scan-ready" }, here);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return null;
}
