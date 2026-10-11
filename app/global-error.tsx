"use client";

import { ErrorReference } from "./error-reference";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body><main>
    <h1>TerraFracta is temporarily unavailable</h1>
    <p>The page could not be loaded. Please try again.</p><ErrorReference />
    <button type="button" onClick={() => retry()}>Try loading again</button>
  </main></body></html>;
}
