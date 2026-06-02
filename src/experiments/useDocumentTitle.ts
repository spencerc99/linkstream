// ABOUTME: Sets document.title for the current experiment and restores the
// ABOUTME: base title on unmount, since this SPA shares one index.html.

import { useEffect } from "react";

const BASE_TITLE = "HAH — social media art experiments";

// Pass an experiment name to show "HAH — {name}", or nothing for the base title.
export function useDocumentTitle(name?: string): void {
  useEffect(() => {
    document.title = name ? `HAH — ${name}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [name]);
}
