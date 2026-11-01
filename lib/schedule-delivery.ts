export type ScheduleDayOption = {
  key: string;
  isoDate: string;
  weekday: string;
  dayNumber: string;
  label: string;
  isToday: boolean;
};

export type ScheduleTimeOption = {
  value: string;
  label: string;
  disabled: boolean;
  period: 'morning' | 'afternoon' | 'evening';
};

export type ScheduleTimePeriod = {
  key: 'morning' | 'afternoon' | 'evening';
  title: string;
  slots: ScheduleTimeOption[];
};

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatClockLabel(hour: number, minute: number, language: 'sw' | 'en') {
  if (language === 'sw') {
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${pad2(minute)} ${suffix}`;
}

function getPeriod(hour: number): ScheduleTimeOption['period'] {
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

export function buildScheduleDays(language: 'sw' | 'en', count = 7): ScheduleDayOption[] {
  const weekdaySw = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
  const weekdayEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdayShortSw = ['Jp', 'Jt', 'Jn', 'Jtn', 'Al', 'Ij', 'Jm'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const isToday = index === 0;
    const isTomorrow = index === 1;
    const weekday = language === 'sw' ? weekdayShortSw[date.getDay()] : weekdayEn[date.getDay()];
    const fullWeekday = language === 'sw' ? weekdaySw[date.getDay()] : weekdayEn[date.getDay()];
    const dayNumber = String(date.getDate());
    const label = isToday
      ? language === 'sw'
        ? 'Leo'
        : 'Today'
      : isTomorrow
        ? language === 'sw'
          ? 'Kesho'
          : 'Tomorrow'
        : fullWeekday;

    return {
      key: toIsoDate(date),
      isoDate: toIsoDate(date),
      weekday,
      dayNumber,
      label,
      isToday,
    };
  });
}

export function parseScheduleTime(value: string): { hour24: number; minute: number } {
  const raw = String(value || '').trim();
  if (!raw) {
    return { hour24: 8, minute: 0 };
  }
  const [hourText = '', minuteText = ''] = raw.split(':');
  const hour24 = Number(hourText);
  const minute = Number(minuteText);
  return {
    hour24: Number.isFinite(hour24) ? hour24 : 8,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

export function formatScheduleTimeValue(hour24: number, minute: number): string {
  const hour = Number.isFinite(hour24) ? Math.max(0, Math.min(23, Math.round(hour24))) : 8;
  const nextMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.round(minute))) : 0;
  return `${pad2(hour)}:${pad2(nextMinute)}`;
}

export function firstAvailableScheduleDate(language: 'sw' | 'en'): string {
  const days = buildScheduleDays(language);
  for (const day of days) {
    if (buildScheduleTimeSlots(day.isoDate, language).some((slot) => !slot.disabled)) {
      return day.isoDate;
    }
  }
  return days[1]?.isoDate || days[0]?.isoDate || toIsoDate(new Date());
}

export function firstAvailableScheduleTime(isoDate: string, language: 'sw' | 'en'): string {
  return snapScheduleTime(isoDate, '', language);
}

export function snapScheduleTime(isoDate: string, time: string, language: 'sw' | 'en'): string {
  const slots = buildScheduleTimeSlots(isoDate, language);
  const enabled = slots.filter((slot) => !slot.disabled);
  if (enabled.length === 0) {
    return '';
  }
  if (!time) {
    return enabled[0].value;
  }
  const exact = enabled.find((slot) => slot.value === time);
  if (exact) {
    return exact.value;
  }

  const parsed = parseScheduleTime(time);
  const target = parsed.hour24 * 60 + parsed.minute;
  let best = enabled[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const slot of enabled) {
    const slotParts = parseScheduleTime(slot.value);
    const dist = Math.abs(slotParts.hour24 * 60 + slotParts.minute - target);
    if (dist < bestDist) {
      best = slot;
      bestDist = dist;
    }
  }
  return best.value;
}

export function buildScheduleTimeSlots(isoDate: string, language: 'sw' | 'en'): ScheduleTimeOption[] {
  const slots: ScheduleTimeOption[] = [];
  const now = new Date();
  const selected = new Date(`${isoDate}T00:00:00`);
  const isToday = toIsoDate(now) === isoDate;

  for (let hour = 8; hour <= 20; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === 20 && minute > 0) {
        continue;
      }
      const value = `${pad2(hour)}:${pad2(minute)}`;
      const slotDate = new Date(selected);
      slotDate.setHours(hour, minute, 0, 0);
      const disabled = isToday && slotDate.getTime() <= now.getTime() + 20 * 60 * 1000;
      slots.push({
        value,
        label: formatClockLabel(hour, minute, language),
        disabled,
        period: getPeriod(hour),
      });
    }
  }

  return slots;
}

export function groupScheduleTimeSlots(
  slots: ScheduleTimeOption[],
  language: 'sw' | 'en'
): ScheduleTimePeriod[] {
  const titles = {
    morning: language === 'sw' ? 'Asubuhi' : 'Morning',
    afternoon: language === 'sw' ? 'Mchana' : 'Afternoon',
    evening: language === 'sw' ? 'Jioni' : 'Evening',
  } as const;

  return (['morning', 'afternoon', 'evening'] as const)
    .map((key) => ({
      key,
      title: titles[key],
      slots: slots.filter((slot) => slot.period === key),
    }))
    .filter((group) => group.slots.length > 0);
}

const weekdayFullSw = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
const weekdayFullEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthFullSw = [
  'Januari',
  'Februari',
  'Machi',
  'Aprili',
  'Mei',
  'Juni',
  'Julai',
  'Agosti',
  'Septemba',
  'Oktoba',
  'Novemba',
  'Desemba',
];

export function formatScheduleDateHeading(isoDate: string, language: 'sw' | 'en') {
  if (!isoDate) {
    return '';
  }

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  if (language === 'sw') {
    return `${weekdayFullSw[date.getDay()]}, ${date.getDate()}`;
  }

  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  return `${weekdayFullEn[date.getDay()]}, ${month} ${date.getDate()}`;
}

export function formatScheduleDateField(isoDate: string, language: 'sw' | 'en') {
  if (!isoDate) {
    return '';
  }

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  if (language === 'sw') {
    return `${weekdayFullSw[date.getDay()]}, ${date.getDate()} ${monthFullSw[date.getMonth()]} ${date.getFullYear()}`;
  }

  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatScheduleMonthLabel(isoDate: string, language: 'sw' | 'en') {
  if (!isoDate) {
    return '';
  }

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  if (language === 'sw') {
    return `${monthFullSw[date.getMonth()]} ${date.getFullYear()}`;
  }

  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function formatScheduleSummary(isoDate: string, time: string, language: 'sw' | 'en') {
  if (!isoDate || !time) {
    return language === 'sw' ? 'Chagua siku na saa' : 'Pick a date and time';
  }

  const [hourText, minuteText = '00'] = time.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const clock = Number.isFinite(hour) ? formatClockLabel(hour, Number.isFinite(minute) ? minute : 0, language) : time;

  const date = new Date(`${isoDate}T00:00:00`);
  const today = toIsoDate(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = toIsoDate(tomorrowDate);

  let dayLabel = date.toLocaleDateString(language === 'sw' ? 'sw-TZ' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  if (isoDate === today) {
    dayLabel = language === 'sw' ? 'Leo' : 'Today';
  } else if (isoDate === tomorrow) {
    dayLabel = language === 'sw' ? 'Kesho' : 'Tomorrow';
  }

  return `${dayLabel} • ${clock}`;
}
