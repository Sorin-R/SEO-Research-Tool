const { COUNTRY_CONFIGS, normalizeCountryCode } = require('./searchCountry');

const GOOGLE_ADS_LOCATION_IDS = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  IN: 2356,
  BR: 2076,
  MX: 2484,
  JP: 2392,
};

const GOOGLE_ADS_LANGUAGE_IDS = {
  en: 1000,
  de: 1001,
  fr: 1002,
  es: 1003,
  it: 1004,
  ja: 1005,
  nl: 1010,
  pt: 1014,
};

function getGoogleAdsCountryConfig(countryCode) {
  const normalizedCountry = normalizeCountryCode(countryCode);
  const searchConfig = COUNTRY_CONFIGS[normalizedCountry] || COUNTRY_CONFIGS.US;
  const languageCode = searchConfig.hl || 'en';

  return {
    code: normalizedCountry,
    name: searchConfig.name,
    languageCode,
    languageId: GOOGLE_ADS_LANGUAGE_IDS[languageCode] || 1000,
    locationId: GOOGLE_ADS_LOCATION_IDS[normalizedCountry] || 2840,
  };
}

module.exports = {
  getGoogleAdsCountryConfig,
};
