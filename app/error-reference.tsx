"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "../src/client-error-diagnostics";

export function ErrorReference() {
  const [reference, setReference] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => mounted ? reportClientError("page_render") : null)
      .then(value => { if (mounted) setReference(value); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  return reference ? <p className="small-note">Error reference: <code>{reference}</code>. This reference was saved in the private diagnostic log.</p> : null;
}
