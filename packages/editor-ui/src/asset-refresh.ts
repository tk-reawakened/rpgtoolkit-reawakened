import { createContext } from "preact";

/** Re-read saved linked artwork on activation without replacing the document or its view state. */
export const AssetRefreshContext = createContext(0);
