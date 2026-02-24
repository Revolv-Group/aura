import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TIMEZONE = "Asia/Dubai";

export function formatDubaiTime(date: string | Date, fmt = "h:mm a"): string {
  return format(toZonedTime(new Date(date), TIMEZONE), fmt);
}

export function formatDubaiDateTime(date: string | Date, fmt = "MMM d, h:mm a"): string {
  return format(toZonedTime(new Date(date), TIMEZONE), fmt);
}

export function formatDubaiDate(date: string | Date, fmt = "MMM d, yyyy"): string {
  return format(toZonedTime(new Date(date), TIMEZONE), fmt);
}
