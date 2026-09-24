import timezones from '@vvo/tzdb/raw-time-zones.json';

export interface Timezone {
  name: string;
  displayName: string;
  abbr: string;
  offset: number;
  popular?: boolean;
  hasDST?: boolean;
  cities?: string[];
  country?: string;
}

const utcTimezone: Timezone = {
  name: 'UTC',
  displayName: 'Coordinated Universal Time',
  abbr: 'UTC',
  offset: 0,
  hasDST: false,
};

export const getTimeZones = (): Timezone[] => {
  return JSON.parse(
    JSON.stringify(
      [utcTimezone].concat(
        timezones.map((tz) => ({
          name: tz.name,
          displayName: tz.alternativeName,
          abbr: tz.abbreviation,
          offset: tz.rawOffsetInMinutes / 60,
          popular: popularTimezones.includes(tz.name) ? true : undefined,
          hasDST: checkDST(tz.name) ? true : undefined,
          cities: tz.mainCities,
          country: tz.countryName,
        }))
      )
    )
  );
};

function checkDST(timeZone: string): boolean {
  const getOffset = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  };

  const year = new Date().getFullYear();
  const jan = new Date(year, 0, 1);
  const jul = new Date(year, 6, 1);

  return getOffset(jan) !== getOffset(jul);
}

const popularTimezones = [
  'Pacific/Pago_Pago',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Atlantic/South_Georgia',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Athens',
  'Africa/Johannesburg',
  'Europe/Moscow',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
];
