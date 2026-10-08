import * as React from "react";

/** Portal-owned integration: shared headers stay independent of Help and its API. */
export const PageHelpContext = React.createContext<{
  trigger: React.ReactNode;
  onContextChange: (context: string | undefined) => void;
} | null>(null);
