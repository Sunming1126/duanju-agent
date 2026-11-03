import { Converter } from "opencc-js/cn2t";

// Text conversion is only used for UI and built-in samples, never saved manuscripts.
export const toTraditional = Converter({ from: "cn", to: "tw" });
