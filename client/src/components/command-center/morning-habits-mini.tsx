import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Dumbbell, Pill, Droplets, Flame } from "lucide-react";
import { subDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { Day } from "@shared/schema";

interface MorningHabitsMiniProps {
  day: Day | null;
}

const habits = [
  { key: "pressUps", label: "Push-ups", icon: Dumbbell },
  { key: "squats", label: "Squats", icon: Dumbbell },
  { key: "supplements", label: "Supps", icon: Pill },
  { key: "water", label: "Water", icon: Droplets },
] as const;

type HabitKey = (typeof habits)[number]["key"];

interface DayWithRituals {
  date: string;
  morningRituals?: {
    [key: string]: { done?: boolean };
  };
}

// Calculate streak for a specific habit from sorted days (newest first)
function calculateStreak(days: DayWithRituals[], habitKey: string): number {
  let streak = 0;
  const today = format(new Date(), "yyyy-MM-dd");

  // Sort days by date descending (newest first)
  const sortedDays = [...days].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  for (const day of sortedDays) {
    const isDone = day.morningRituals?.[habitKey]?.done;

    // Skip today if not done yet (don't break streak)
    if (day.date === today && !isDone) {
      continue;
    }

    if (isDone) {
      streak++;
    } else {
      break; // Streak broken
    }
  }

  return streak;
}

export default function MorningHabitsMini({ day }: MorningHabitsMiniProps) {
  const queryClient = useQueryClient();
  const rituals = day?.morningRituals || {};

  // Fetch last 30 days for streak calculation
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const { data: recentDays = [] } = useQuery<DayWithRituals[]>({
    queryKey: ["/api/days", { date_gte: thirtyDaysAgo }],
    queryFn: async () => {
      const res = await fetch(`/api/days?date_gte=${thirtyDaysAgo}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updatedRituals: typeof rituals) => {
      if (!day?.date) return;
      const res = await apiRequest("PATCH", `/api/days/${day.date}`, { morningRituals: updatedRituals });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/days"] });
      queryClient.invalidateQueries({ queryKey: ["/api/days/today"] });
    },
  });

  const toggleHabit = (habitKey: HabitKey) => {
    const currentValue = rituals[habitKey]?.done || false;
    const updatedRituals = {
      ...rituals,
      [habitKey]: {
        ...rituals[habitKey],
        done: !currentValue,
      },
    };
    updateMutation.mutate(updatedRituals);
  };

  const completedCount = habits.filter((h) => rituals[h.key]?.done).length;

  // Calculate best current streak across all habits
  const streaks = habits.map(h => calculateStreak(recentDays, h.key));
  const bestStreak = Math.max(...streaks, 0);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground mr-1">Habits</span>
      <div className="flex items-center gap-1">
        {habits.map((habit, idx) => {
          const isDone = rituals[habit.key]?.done || false;
          const habitStreak = streaks[idx];
          const Icon = habit.icon;
          return (
            <button
              key={habit.key}
              onClick={() => toggleHabit(habit.key)}
              className={cn(
                "relative p-2 rounded-lg transition-all",
                isDone
                  ? "bg-green-500/20 text-green-600 dark:text-green-400"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
              title={`${habit.label}${habitStreak > 0 ? ` (${habitStreak} day streak)` : ""}`}
            >
              <Icon className="h-4 w-4" />
              {isDone && (
                <Check className="absolute -top-1 -right-1 h-3 w-3 text-green-500" />
              )}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">
        {completedCount}/{habits.length}
      </span>
      {bestStreak > 0 && (
        <div className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600">
          <Flame className="h-3 w-3" />
          <span className="text-xs font-medium">{bestStreak}</span>
        </div>
      )}
    </div>
  );
}
