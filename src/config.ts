import { config as loadDotenv } from 'dotenv';

loadDotenv();

interface AppConfig {
  googleMapsApiKey: string | undefined;
  smtpProbeFrom: string | undefined;
  smtpProbeHello: string | undefined;
}

export const appConfig: AppConfig = {
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  smtpProbeFrom: process.env.SMTP_PROBE_FROM,
  smtpProbeHello: process.env.SMTP_PROBE_HELLO
};

export function requireConfigValue<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
  const value = appConfig[key];
  if (!value) {
    throw new Error(`Missing required configuration value for ${key}. Check your environment.`);
  }
  return value;
}

