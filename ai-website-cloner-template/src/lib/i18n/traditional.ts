import { Converter } from "opencc-js/cn2t";
import { Converter as SimplifiedConverter } from "opencc-js/t2cn";

// Text conversion is only used for UI and built-in samples, never saved manuscripts.
export const toTraditional = Converter({ from: "cn", to: "tw" });
export const toSimplified = SimplifiedConverter({ from: "tw", to: "cn" });
