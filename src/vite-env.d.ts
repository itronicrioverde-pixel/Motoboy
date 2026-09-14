/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave da Google Routes API (opcional; sem ela, cai no OSRM/linha reta). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Chave da GraphHopper API (opcional; sem ela, cai no OSRM/linha reta). */
  readonly VITE_GRAPHHOPPER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
