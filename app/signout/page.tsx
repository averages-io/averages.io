"use client";

import { useEffect } from "react";
import { signOut } from "../lib/averages";

export default function SignOutPage() {
  useEffect(() => {
    signOut()
      .catch(() => {})
      .finally(() => window.location.replace("/?signedout=1"));
  }, []);
  return null;
}
