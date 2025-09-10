import { useState, useEffect } from "react";

type DomainCounts = Record<string, number>;

interface DomainHistogramProps {
  domainCounts: DomainCounts;
}

interface DomainInfo {
  domain: string;
  count: number;
  favicon?: string;
  language?: string;
}

// Country code top-level domains to flag mapping
const COUNTRY_FLAGS: Record<string, string> = {
  // European countries
  de: "🇩🇪", // Germany
  fr: "🇫🇷", // France
  it: "🇮🇹", // Italy
  es: "🇪🇸", // Spain
  pt: "🇵🇹", // Portugal
  nl: "🇳🇱", // Netherlands
  be: "🇧🇪", // Belgium
  ch: "🇨🇭", // Switzerland
  at: "🇦🇹", // Austria
  dk: "🇩🇰", // Denmark
  se: "🇸🇪", // Sweden
  no: "🇳🇴", // Norway
  fi: "🇫🇮", // Finland
  pl: "🇵🇱", // Poland
  cz: "🇨🇿", // Czech Republic
  sk: "🇸🇰", // Slovakia
  hu: "🇭🇺", // Hungary
  ro: "🇷🇴", // Romania
  bg: "🇧🇬", // Bulgaria
  hr: "🇭🇷", // Croatia
  si: "🇸🇮", // Slovenia
  ee: "🇪🇪", // Estonia
  lv: "🇱🇻", // Latvia
  lt: "🇱🇹", // Lithuania
  gr: "🇬🇷", // Greece
  ie: "🇮🇪", // Ireland
  // UK domains
  uk: "🇬🇧", // United Kingdom
  gb: "🇬🇧", // Great Britain
  // North America
  us: "🇺🇸", // United States
  ca: "🇨🇦", // Canada
  mx: "🇲🇽", // Mexico
  // Asia-Pacific
  jp: "🇯🇵", // Japan
  kr: "🇰🇷", // South Korea
  cn: "🇨🇳", // China
  hk: "🇭🇰", // Hong Kong
  tw: "🇹🇼", // Taiwan
  sg: "🇸🇬", // Singapore
  my: "🇲🇾", // Malaysia
  th: "🇹🇭", // Thailand
  ph: "🇵🇭", // Philippines
  id: "🇮🇩", // Indonesia
  vn: "🇻🇳", // Vietnam
  in: "🇮🇳", // India
  au: "🇦🇺", // Australia
  nz: "🇳🇿", // New Zealand
  // Middle East & Africa
  il: "🇮🇱", // Israel
  tr: "🇹🇷", // Turkey
  ae: "🇦🇪", // UAE
  sa: "🇸🇦", // Saudi Arabia
  za: "🇿🇦", // South Africa
  eg: "🇪🇬", // Egypt
  // South America
  br: "🇧🇷", // Brazil
  ar: "🇦🇷", // Argentina
  cl: "🇨🇱", // Chile
  co: "🇨🇴", // Colombia
  pe: "🇵🇪", // Peru
  ve: "🇻🇪", // Venezuela
  // Russia & CIS
  ru: "🇷🇺", // Russia
  ua: "🇺🇦", // Ukraine
  by: "🇧🇾", // Belarus
  kz: "🇰🇿", // Kazakhstan
};

// Additional country-specific second-level domains
const SECOND_LEVEL_DOMAINS: Record<string, string> = {
  // UK domains
  "co.uk": "🇬🇧",
  "ac.uk": "🇬🇧",
  "org.uk": "🇬🇧",
  "gov.uk": "🇬🇧",
  "net.uk": "🇬🇧",
  // Australia domains
  "com.au": "🇦🇺",
  "org.au": "🇦🇺",
  "net.au": "🇦🇺",
  "gov.au": "🇦🇺",
  "edu.au": "🇦🇺",
  // Japan domains
  "co.jp": "🇯🇵",
  "or.jp": "🇯🇵",
  "ne.jp": "🇯🇵",
  "go.jp": "🇯🇵",
  "ac.jp": "🇯🇵",
  // South Korea domains
  "co.kr": "🇰🇷",
  "or.kr": "🇰🇷",
  "ne.kr": "🇰🇷",
  "go.kr": "🇰🇷",
  "ac.kr": "🇰🇷",
  // Brazil domains
  "com.br": "🇧🇷",
  "org.br": "🇧🇷",
  "net.br": "🇧🇷",
  "gov.br": "🇧🇷",
  "edu.br": "🇧🇷",
  // China domains
  "com.cn": "🇨🇳",
  "org.cn": "🇨🇳",
  "net.cn": "🇨🇳",
  "gov.cn": "🇨🇳",
  "edu.cn": "🇨🇳",
  // India domains
  "co.in": "🇮🇳",
  "org.in": "🇮🇳",
  "net.in": "🇮🇳",
  "gov.in": "🇮🇳",
  "edu.in": "🇮🇳",
  // South Africa domains
  "co.za": "🇿🇦",
  "org.za": "🇿🇦",
  "net.za": "🇿🇦",
  "gov.za": "🇿🇦",
  "ac.za": "🇿🇦",
};

// Helper function to get language flag from domain based on TLD
function getLanguageFlag(domain: string): string | undefined {
  const parts = domain.split(".");

  // Check for second-level domains first (like co.uk, com.au)
  if (parts.length >= 2) {
    const secondLevel = parts[parts.length - 2].toLowerCase();
    const tld = parts[parts.length - 1].toLowerCase();
    const combinedTld = `${secondLevel}.${tld}`;

    if (SECOND_LEVEL_DOMAINS[combinedTld]) {
      return SECOND_LEVEL_DOMAINS[combinedTld];
    }
  }

  // Extract TLD (top-level domain) and check if it's a country code
  const tld = parts[parts.length - 1].toLowerCase();
  if (COUNTRY_FLAGS[tld]) {
    return COUNTRY_FLAGS[tld];
  }

  return undefined;
}

export function DomainHistogram({ domainCounts }: DomainHistogramProps) {
  const [domainInfos, setDomainInfos] = useState<DomainInfo[]>([]);

  useEffect(() => {
    // Convert domain counts to array and fetch additional info
    const domains = Object.entries(domainCounts)
      .sort(([, a], [, b]) => b - a) // Sort by count descending
      .map(([domain, count]) => ({
        domain,
        count,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`,
        language: getLanguageFlag(domain),
      }));

    setDomainInfos(domains);
  }, [domainCounts]);

  return (
    <div
      style={{
        width: "280px",
        padding: "1em",
        borderLeft: "1px solid #ccc",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px 0 0 8px",
        maxHeight: "100vh",
        overflowY: "auto",
      }}
    >
      <h3
        style={{ margin: "0 0 1em 0", color: "#333", fontFamily: "monospace" }}
      >
        STATS
      </h3>
      <div style={{ overflowY: "auto" }}>
        {domainInfos.map(({ domain, count, favicon, language }) => (
          <div
            key={domain}
            style={{
              marginBottom: "1em",
              padding: "0.75em",
              backgroundColor: "white",
              borderRadius: "6px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5em",
                marginBottom: "0.5em",
              }}
            >
              <img
                src={favicon}
                alt={`${domain} favicon`}
                style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "2px",
                }}
                onError={(e) => {
                  // Fallback to a default icon if favicon fails to load
                  (e.target as HTMLImageElement).src =
                    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjNjY2NjY2Ii8+CjxwYXRoIGQ9Ik04IDRMMTIgOEw4IDEyTDQgOEw4IDRaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K";
                }}
              />
              {language && (
                <span
                  style={{
                    fontSize: "14px",
                    marginLeft: "4px",
                  }}
                  title={`Country/Language: ${language}`}
                >
                  {language}
                </span>
              )}
              <span
                style={{
                  fontWeight: "500",
                  fontSize: "0.9em",
                  color: "#333",
                  flex: 1,
                }}
              >
                {domain}
              </span>
              <span
                style={{
                  fontWeight: "bold",
                  color: "#0066cc",
                  fontSize: "0.9em",
                }}
              >
                {count}
              </span>
            </div>
            <div
              style={{
                width: "100%",
                height: "6px",
                backgroundColor: "#e9ecef",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${
                    (count / Math.max(...Object.values(domainCounts))) * 100
                  }%`,
                  height: "100%",
                  backgroundColor: "#0066cc",
                  borderRadius: "3px",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
