export type RGB = { red: number; green: number; blue: number };

export type ColorConversion = { ok: true; value: string; rgb: RGB; hex: string } | { ok: false; error: string };

const NAMED_COLORS: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
  transparent: "000000",
};

export function colorToVec3(input: string): ColorConversion {
  const rgb = parseCssColor(input);
  if (!rgb) return { ok: false, error: "Enter a valid supported CSS color." };

  return { ok: true, value: formatVec3(rgb), rgb, hex: rgbToHex(rgb) };
}

export function parseCssColor(input: string): RGB | null {
  const color = input.trim().toLowerCase();
  if (!color) return null;

  if (NAMED_COLORS[color]) return parseHex(NAMED_COLORS[color]);
  if (color.startsWith("#")) return parseHex(color.slice(1));

  const match = color.match(/^([a-z]+)\((.*)\)$/);
  if (!match) return null;

  const [, name, body] = match;
  if (name === "rgb" || name === "rgba") return parseRgb(body);
  if (name === "hsl" || name === "hsla") return parseHsl(body);
  if (name === "hwb") return parseHwb(body);
  if (name === "oklch") return parseOklch(body);
  return null;
}

export function formatVec3(rgb: RGB): string {
  const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => formatFloat(channel / 255));
  return `vec3(${channels.join(", ")})`;
}

function parseHex(value: string): RGB | null {
  if (!/^(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return null;
  const expanded = value.length <= 4 ? [...value].map((character) => character + character).join("") : value;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function parseRgb(body: string): RGB | null {
  const parts = splitFunctionArguments(body);
  if (!parts || parts.channels.length !== 3 || !isValidAlpha(parts.alpha)) return null;

  const channels = parts.channels.map(parseRgbChannel);
  if (channels.some((channel) => channel === null)) return null;
  return { red: channels[0]!, green: channels[1]!, blue: channels[2]! };
}

function parseHsl(body: string): RGB | null {
  const parts = splitFunctionArguments(body);
  if (!parts || parts.channels.length !== 3 || !isValidAlpha(parts.alpha)) return null;

  const hue = parseHue(parts.channels[0]);
  const saturation = parsePercentage(parts.channels[1]);
  const lightness = parsePercentage(parts.channels[2]);
  if (hue === null || saturation === null || lightness === null) return null;

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] =
    segment < 1
      ? [chroma, secondary, 0]
      : segment < 2
        ? [secondary, chroma, 0]
        : segment < 3
          ? [0, chroma, secondary]
          : segment < 4
            ? [0, secondary, chroma]
            : segment < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  return toRgb(r1 + offset, g1 + offset, b1 + offset);
}

function parseHwb(body: string): RGB | null {
  const parts = splitFunctionArguments(body);
  if (!parts || parts.channels.length !== 3 || !isValidAlpha(parts.alpha)) return null;

  const hue = parseHue(parts.channels[0]);
  const white = parsePercentage(parts.channels[1]);
  const black = parsePercentage(parts.channels[2]);
  if (hue === null || white === null || black === null) return null;
  if (white + black >= 1) {
    const gray = white / (white + black);
    return toRgb(gray, gray, gray);
  }

  const pure = parseHsl(`${hue} 100% 50%`)!;
  const factor = 1 - white - black;
  return toRgb(
    (pure.red / 255) * factor + white,
    (pure.green / 255) * factor + white,
    (pure.blue / 255) * factor + white,
  );
}

function parseOklch(body: string): RGB | null {
  // Unlike the legacy color functions, OKLCH only uses space-separated syntax.
  if (body.includes(",")) return null;
  const parts = splitFunctionArguments(body);
  if (!parts || parts.channels.length !== 3 || !isValidAlpha(parts.alpha)) return null;

  const lightness = parseUnitInterval(parts.channels[0]);
  const chroma = parseOklchChroma(parts.channels[1]);
  const hue = parseHue(parts.channels[2]);
  if (lightness === null || chroma === null || hue === null) return null;

  const angle = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  return oklabToRgb(lightness, a, b);
}

function oklabToRgb(lightness: number, a: number, b: number): RGB {
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);

  const linearRed = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linearGreen = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linearBlue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return toRgb(
    clamp(srgbTransfer(linearRed), 0, 1),
    clamp(srgbTransfer(linearGreen), 0, 1),
    clamp(srgbTransfer(linearBlue), 0, 1),
  );
}

function splitFunctionArguments(body: string): { channels: string[]; alpha?: string } | null {
  const slashParts = body.trim().split(/\s*\/\s*/);
  if (slashParts.length > 2) return null;
  const usesCommas = slashParts[0].includes(",");
  const channels = usesCommas ? slashParts[0].split(/\s*,\s*/) : slashParts[0].trim().split(/\s+/);
  let alpha: string | undefined = slashParts[1];
  if (usesCommas && slashParts.length === 1 && channels.length === 4) alpha = channels.pop();
  if (channels.some((part) => !part) || (alpha !== undefined && !alpha)) return null;
  return { channels, alpha };
}

function parseRgbChannel(value: string): number | null {
  const percentage = value.endsWith("%");
  const number = Number.parseFloat(value);
  if (!isPlainNumber(value, percentage ? "%" : "") || number < 0 || number > (percentage ? 100 : 255)) return null;
  return Math.round(percentage ? (number * 255) / 100 : number);
}

function parsePercentage(value: string): number | null {
  const number = Number.parseFloat(value);
  return isPlainNumber(value, "%") && number >= 0 && number <= 100 ? number / 100 : null;
}

function parseUnitInterval(value: string): number | null {
  if (value.endsWith("%")) return parsePercentage(value);
  const number = Number.parseFloat(value);
  return isPlainNumber(value, "") && number >= 0 && number <= 1 ? number : null;
}

function parseOklchChroma(value: string): number | null {
  const percentage = value.endsWith("%");
  const number = Number.parseFloat(value);
  if (!isPlainNumber(value, percentage ? "%" : "") || number < 0) return null;
  return percentage ? (number * 0.4) / 100 : number;
}

function parseHue(value: string): number | null {
  const match = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(deg|grad|rad|turn)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  const degrees =
    match[2] === "grad"
      ? number * 0.9
      : match[2] === "rad"
        ? number * (180 / Math.PI)
        : match[2] === "turn"
          ? number * 360
          : number;
  return ((degrees % 360) + 360) % 360;
}

function isValidAlpha(value?: string): boolean {
  if (value === undefined) return true;
  const percentage = value.endsWith("%");
  const number = Number.parseFloat(value);
  return isPlainNumber(value, percentage ? "%" : "") && number >= 0 && number <= (percentage ? 100 : 1);
}

function isPlainNumber(value: string, suffix: string): boolean {
  return new RegExp(`^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)${suffix}$`).test(value);
}

function toRgb(red: number, green: number, blue: number): RGB {
  return { red: Math.round(red * 255), green: Math.round(green * 255), blue: Math.round(blue * 255) };
}

function srgbTransfer(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const absolute = Math.abs(channel);
  return absolute > 0.0031308 ? sign * (1.055 * Math.pow(absolute, 1 / 2.4) - 0.055) : 12.92 * channel;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatFloat(value: number): string {
  if (value === 0 || value === 1) return value.toFixed(1);
  return value.toFixed(4).replace(/0+$/, "");
}

function rgbToHex(rgb: RGB): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(rgb.red)}${channel(rgb.green)}${channel(rgb.blue)}`;
}
