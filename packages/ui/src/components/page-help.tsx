import * as React from "react";

/** Portal-owned integration: shared headers stay independent of Help and its API. */
export const PageHelpContext = React.createContext<{
  trigger: React.ReactNode;
  onContextChange: (context: string | undefined) => void;
  /** Shown under every page header, such as the offline notice (spec 033). */
  notice?: React.ReactNode;
} | null>(null);
