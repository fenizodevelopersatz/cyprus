export type CountryOption = {
  code: string;
  name: string;
  flag: string;
};

const fallbackRegions = [
  "US",
  "GB",
  "CA",
  "AU",
  "NZ",
  "SG",
  "IN",
  "AE",
  "DE",
  "FR",
  "ES",
  "IT",
  "NL",
  "SE",
  "NO",
  "DK",
  "CH",
  "BR",
  "MX",
  "AR",
  "CL",
  "CO",
  "ZA",
  "NG",
  "KE",
  "JP",
  "KR",
  "HK",
  "TW",
];

const fallbackNames: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  NZ: "New Zealand",
  SG: "Singapore",
  IN: "India",
  AE: "United Arab Emirates",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  CH: "Switzerland",
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  ZA: "South Africa",
  NG: "Nigeria",
  KE: "Kenya",
  JP: "Japan",
  KR: "South Korea",
  HK: "Hong Kong SAR",
  TW: "Taiwan",
};

const codeToFlag = (code: string): string => {
  if (!code || code.length !== 2) return "🏳️";
  const base = 0x1f1e6;
  const chars = code.toUpperCase().split("").map((char) => base + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...chars);
};

const buildCountryOptions = (): CountryOption[] => {
  const intlNamespace = Intl as unknown as { supportedValuesOf?: (type: string) => string[] };
  const displayNames =
    typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : undefined;

  let codes: string[] = fallbackRegions;
  if (typeof intlNamespace.supportedValuesOf === "function") {
    try {
      const values = intlNamespace.supportedValuesOf("region");
      if (Array.isArray(values) && values.length) {
        codes = values.filter((code) => /^[A-Z]{2}$/.test(code));
      }
    } catch {
      // fall back to static regions to avoid runtime crashes in older browsers
      codes = fallbackRegions;
    }
  }

  const countries = codes.map((code) => {
    const name =
      displayNames?.of(code) ??
      fallbackNames[code as keyof typeof fallbackNames] ??
      code;
    return {
      code,
      name,
      flag: codeToFlag(code),
    };
  });

  return countries.sort((a, b) => a.name.localeCompare(b.name));
};

export const countryOptions: CountryOption[] = buildCountryOptions();

export const getCountryByCode = (code: string): CountryOption | undefined =>
  countryOptions.find((country) => country.code === code);

export const getCountryByName = (name: string): CountryOption | undefined => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;
  return countryOptions.find((country) => country.name.trim().toLowerCase() === normalized);
};
