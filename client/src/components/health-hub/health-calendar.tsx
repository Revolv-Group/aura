import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay, isToday, startOfWeek, endOfWeek } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface HealthEntry {
  id: string;
  date: string;
  sleepHours: number | null;
  energyLevel: number | null;
  mood: string | null;
  workoutDone: boolean;
  workoutType: string | null;
}

interface HealthCalendarProps {
  healthEntries: HealthEntry[];
  currentMonth: Date;
  onDayClick: (date: string) => void;
}

const getMoodEmoji = (mood: string | null): string => {
  switch (mood) {
    case "low":
      return "😔";
    case "medium":
      return "😐";
    case "high":
      return "😊";
    case "peak":
      return "🤩";
    default:
      return "";
  }
};

const getEnergyColor = (energyLevel: number | null): string => {
  if (!energyLevel) return "bg-muted";
  if (energyLevel <= 2) return "bg-rose-100 hover:bg-rose-200 border-rose-200 dark:bg-rose-900/30 dark:hover:bg-rose-900/40 dark:border-rose-800";
  if (energyLevel === 3) return "bg-amber-100 hover:bg-amber-200 border-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/40 dark:border-amber-800";
  return "bg-emerald-100 hover:bg-emerald-200 border-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/40 dark:border-emerald-800";
};

export default function HealthCalendar({ healthEntries, currentMonth, onDayClick }: HealthCalendarProps) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const getHealthForDay = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return healthEntries.find((entry) => entry.date === dateStr);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{format(currentMonth, "MMMM yyyy")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {/* Week day headers */}
          {weekDays.map((day) => (
            <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {calendarDays.map((day) => {
            const health = getHealthForDay(day);
            const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
            const dateStr = format(day, "yyyy-MM-dd");

            return (
              <button
                key={dateStr}
                onClick={() => onDayClick(dateStr)}
                className={cn(
                  "relative min-h-24 p-2 border rounded-lg text-left transition-colors",
                  isCurrentMonth ? getEnergyColor(health?.energyLevel || null) : "bg-muted/50 text-muted-foreground",
                  isToday(day) && "ring-2 ring-primary",
                  !health && isCurrentMonth && "bg-muted hover:bg-muted/80"
                )}
              >
                <div className="space-y-1">
                  {/* Date number */}
                  <div className={cn(
                    "text-sm font-medium",
                    !isCurrentMonth && "text-muted-foreground/50"
                  )}>
                    {format(day, "d")}
                  </div>

                  {health && (
                    <>
                      {/* Mood emoji */}
                      {health.mood && (
                        <div className="text-lg">{getMoodEmoji(health.mood)}</div>
                      )}

                      {/* Workout indicator */}
                      {health.workoutDone && (
                        <div className="text-xs text-green-700 font-medium">
                          ✓ {health.workoutType && health.workoutType !== "none" ? health.workoutType.slice(0, 3) : ""}
                        </div>
                      )}

                      {/* Sleep hours */}
                      {health.sleepHours && (
                        <div className="text-xs text-muted-foreground">
                          {health.sleepHours}h
                        </div>
                      )}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-rose-100 border border-rose-200 dark:bg-rose-900/30 dark:border-rose-800"></div>
            <span className="text-muted-foreground">Low Energy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-amber-100 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-800"></div>
            <span className="text-muted-foreground">Medium Energy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-emerald-100 border border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800"></div>
            <span className="text-muted-foreground">High Energy</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
