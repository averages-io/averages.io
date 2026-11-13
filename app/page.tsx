"use client";
// "/" is the sign-in page (fs-src/signin.html): worker/index.js serves it there, so on the real site this page is
// never shown. It's only here so "/" still leads somewhere without the worker (next dev, a plain static server).
import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    window.location.replace("/IS/signin" + window.location.search + window.location.hash);
  }, []);
  return null;
}
