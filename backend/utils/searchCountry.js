const COUNTRY_CONFIGS = {
  US: {
    code: 'US',
    name: 'United States',
    googleGl: 'us',
    googleCr: 'countryUS',
    googleDomain: 'google.com',
    hl: 'en',
    bingMarket: 'en-US',
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    googleGl: 'uk',
    googleCr: 'countryUK',
    googleDomain: 'google.co.uk',
    hl: 'en',
    bingMarket: 'en-GB',
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    googleGl: 'ca',
    googleCr: 'countryCA',
    googleDomain: 'google.ca',
    hl: 'en',
    bingMarket: 'en-CA',
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    googleGl: 'au',
    googleCr: 'countryAU',
    googleDomain: 'google.com.au',
    hl: 'en',
    bingMarket: 'en-AU',
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    googleGl: 'de',
    googleCr: 'countryDE',
    googleDomain: 'google.de',
    hl: 'de',
    bingMarket: 'de-DE',
  },
  FR: {
    code: 'FR',
    name: 'France',
    googleGl: 'fr',
    googleCr: 'countryFR',
    googleDomain: 'google.fr',
    hl: 'fr',
    bingMarket: 'fr-FR',
  },
  ES: {
    code: 'ES',
    name: 'Spain',
    googleGl: 'es',
    googleCr: 'countryES',
    googleDomain: 'google.es',
    hl: 'es',
    bingMarket: 'es-ES',
  },
  IT: {
    code: 'IT',
    name: 'Italy',
    googleGl: 'it',
    googleCr: 'countryIT',
    googleDomain: 'google.it',
    hl: 'it',
    bingMarket: 'it-IT',
  },
  NL: {
    code: 'NL',
    name: 'Netherlands',
    googleGl: 'nl',
    googleCr: 'countryNL',
    googleDomain: 'google.nl',
    hl: 'nl',
    bingMarket: 'nl-NL',
  },
  IN: {
    code: 'IN',
    name: 'India',
    googleGl: 'in',
    googleCr: 'countryIN',
    googleDomain: 'google.co.in',
    hl: 'en',
    bingMarket: 'en-IN',
  },
  BR: {
    code: 'BR',
    name: 'Brazil',
    googleGl: 'br',
    googleCr: 'countryBR',
    googleDomain: 'google.com.br',
    hl: 'pt',
    bingMarket: 'pt-BR',
  },
  MX: {
    code: 'MX',
    name: 'Mexico',
    googleGl: 'mx',
    googleCr: 'countryMX',
    googleDomain: 'google.com.mx',
    hl: 'es',
    bingMarket: 'es-MX',
  },
  JP: {
    code: 'JP',
    name: 'Japan',
    googleGl: 'jp',
    googleCr: 'countryJP',
    googleDomain: 'google.co.jp',
    hl: 'ja',
    bingMarket: 'ja-JP',
  },
};

function normalizeCountryCode(countryCode) {
  const normalized = String(countryCode || 'US').trim().toUpperCase();
  return COUNTRY_CONFIGS[normalized] ? normalized : 'US';
}

function getCountryConfig(countryCode) {
  return COUNTRY_CONFIGS[normalizeCountryCode(countryCode)];
}

module.exports = {
  COUNTRY_CONFIGS,
  normalizeCountryCode,
  getCountryConfig,
};
