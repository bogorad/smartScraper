import dns from "dns/promises";
import { isIP } from "net";

interface ResolvedAddress {
  address: string;
  family: number;
}

type LookupAddresses = (
  hostname: string,
) => Promise<ResolvedAddress[]>;

export interface UrlSafetyResult {
  safe: boolean;
  error?: string;
}

export function normalizeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function extractDomain(url: string): string | null {
  const parsed = normalizeUrl(url);
  if (!parsed) return null;
  return parsed.hostname.replace(/^www\./, "");
}

export function isValidUrl(url: string): boolean {
  const parsed = normalizeUrl(url);
  return (
    parsed !== null &&
    (parsed.protocol === "http:" ||
      parsed.protocol === "https:")
  );
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255,
    )
  ) {
    return null;
  }

  return octets;
}

function ipv4FromMappedIpv6(
  address: string,
): string | null {
  const lowerAddress = address.toLowerCase();
  const mappedPrefix = "::ffff:";
  if (!lowerAddress.startsWith(mappedPrefix)) {
    return null;
  }

  const candidate = lowerAddress.slice(mappedPrefix.length);
  return parseIpv4(candidate) ? candidate : null;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(address: string): boolean {
  const lowerAddress = address.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(lowerAddress);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  return (
    lowerAddress === "::1" ||
    lowerAddress.startsWith("fe80:") ||
    lowerAddress.startsWith("fe90:") ||
    lowerAddress.startsWith("fea0:") ||
    lowerAddress.startsWith("feb0:") ||
    lowerAddress.startsWith("fc") ||
    lowerAddress.startsWith("fd")
  );
}

function isPrivateAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return isPrivateIpv4(address);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(address);
  }

  return false;
}

async function lookupAddresses(
  hostname: string,
): Promise<ResolvedAddress[]> {
  return dns.lookup(hostname, {
    all: true,
    verbatim: false,
  });
}

export async function validateScrapeTargetUrl(
  url: string,
  lookup: LookupAddresses = lookupAddresses,
): Promise<UrlSafetyResult> {
  const parsed = normalizeUrl(url);
  if (!parsed || !isValidUrl(url)) {
    return { safe: false, error: "Invalid URL" };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    return { safe: false, error: "Invalid URL" };
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    return {
      safe: false,
      error:
        "Target URL resolves to a private or local network address",
    };
  }

  const ipVersion = isIP(hostname);
  let addresses: ResolvedAddress[];
  try {
    addresses =
      ipVersion === 0
        ? await lookup(hostname)
        : [{ address: hostname, family: ipVersion }];
  } catch {
    return {
      safe: false,
      error: "Target URL could not be resolved",
    };
  }

  if (addresses.length === 0) {
    return {
      safe: false,
      error: "Target URL could not be resolved",
    };
  }

  if (
    addresses.some(({ address }) =>
      isPrivateAddress(normalizeHostname(address)),
    )
  ) {
    return {
      safe: false,
      error:
        "Target URL resolves to a private or local network address",
    };
  }

  return { safe: true };
}
