export const formatTimeOnly = (
  date: Date,
  use24HourTime: boolean,
  locale?: string,
) => {
  return date.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: !use24HourTime,
  });
};

export const formatDateTimeShort = (
  date: Date,
  use24HourTime: boolean,
  locale?: string,
) => {
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: !use24HourTime,
  });
};

export const formatDatePartShort = (date: Date, locale?: string) => {
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

export const formatTimePart = (
  date: Date,
  use24HourTime: boolean,
  locale?: string,
) => {
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !use24HourTime,
  });
};
