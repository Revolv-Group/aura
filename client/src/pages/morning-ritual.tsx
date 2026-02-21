import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays, addDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Sun,
  Dumbbell,
  Pill,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Droplets,
  Brain,
  Coffee,
  Bed,
  Footprints,
  Settings,
  Calendar,
  type LucideIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useRoute, useLocation } from "wouter";

interface Day {
  id: string;
  date: string;
  morningRituals: Record<string, { done: boolean; reps?: number; pages?: number; count?: number }> | null;
}

interface MorningHabitConfig {
  key: string;
  label: string;
  icon: string;
  hasCount: boolean;
  countLabel?: string;
  defaultCount?: number;
  enabled: boolean;
}

interface MorningRitualConfig {
  habits: MorningHabitConfig[];
}

// Map icon names to Lucide components
const ICON_MAP: Record<string, LucideIcon> = {
  Dumbbell,
  Pill,
  BookOpen,
  Droplets,
  Brain,
  Coffee,
  Bed,
  Footprints,
  Sun,
};

const getIconComponent = (iconName: string): LucideIcon => {
  return ICON_MAP[iconName] || Sun;
};

export default function MorningRitual() {
  const { toast } = useToast();
  const [, params] = useRoute("/morning/:date");
  const [, setLocation] = useLocation();

  const todayDate = format(new Date(), "yyyy-MM-dd");
  const selectedDate = params?.date || todayDate;
  const isViewingToday = selectedDate === todayDate;
  const currentDate = parseISO(selectedDate);

  const goToPreviousDay = () => {
    setLocation(`/morning/${format(subDays(currentDate, 1), "yyyy-MM-dd")}`);
  };
  const goToNextDay = () => {
    const nextDate = format(addDays(currentDate, 1), "yyyy-MM-dd");
    if (nextDate <= todayDate) setLocation(`/morning/${nextDate}`);
  };
  const goToToday = () => setLocation("/morning");

  // Fetch habit configuration
  const { data: habitConfig, isLoading: isConfigLoading } = useQuery<MorningRitualConfig>({
    queryKey: ["/api/settings/morning-ritual"],
  });

  const enabledHabits = useMemo(() => {
    return Array.isArray(habitConfig?.habits) ? habitConfig.habits.filter(h => h.enabled) : [];
  }, [habitConfig?.habits]);

  const [rituals, setRituals] = useState<Record<string, { done: boolean; count?: number }>>({});

  // Fetch the selected day's data
  const { data: dayData, isLoading: isDayLoading } = useQuery<Day>({
    queryKey: ["/api/days", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/days/${selectedDate}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch day");
      return await res.json();
    },
  });

  // Reset rituals when navigating to a different date
  useEffect(() => {
    if (enabledHabits.length > 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        initial[habit.key] = {
          done: false,
          count: habit.hasCount ? habit.defaultCount : undefined,
        };
      }
      setRituals(initial);
    }
  }, [selectedDate]);

  // Initialize rituals from habit config
  useEffect(() => {
    if (enabledHabits.length > 0 && Object.keys(rituals).length === 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        initial[habit.key] = {
          done: false,
          count: habit.hasCount ? habit.defaultCount : undefined,
        };
      }
      setRituals(initial);
    }
  }, [enabledHabits]);

  // Load existing ritual data when day data arrives
  useEffect(() => {
    if (dayData && enabledHabits.length > 0 && dayData.morningRituals) {
      const loaded: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        const saved = dayData.morningRituals[habit.key];
        if (saved && typeof saved === "object") {
          loaded[habit.key] = {
            done: saved.done || false,
            count: habit.hasCount
              ? (saved.reps ?? saved.pages ?? saved.count ?? habit.defaultCount)
              : undefined,
          };
        } else {
          loaded[habit.key] = {
            done: false,
            count: habit.hasCount ? habit.defaultCount : undefined,
          };
        }
      }
      setRituals(loaded);
    }
  }, [dayData, enabledHabits]);

  // Save mutation — only habits
  const saveMutation = useMutation({
    mutationFn: async () => {
      const morningRituals: Record<string, any> = {};
      for (const habit of enabledHabits) {
        const ritual = rituals[habit.key];
        if (ritual) {
          morningRituals[habit.key] = {
            done: ritual.done,
            ...(habit.hasCount && habit.countLabel === "reps" && { reps: ritual.count }),
            ...(habit.hasCount && habit.countLabel === "pages" && { pages: ritual.count }),
            ...(habit.hasCount && !["reps", "pages"].includes(habit.countLabel || "") && { count: ritual.count }),
          };
        }
      }
      morningRituals.completedAt = isAllRitualsComplete() ? new Date().toISOString() : undefined;

      const payload = {
        id: `day_${selectedDate}`,
        date: selectedDate,
        morningRituals,
      };

      try {
        const res = await apiRequest("PATCH", `/api/days/${selectedDate}`, payload);
        return await res.json();
      } catch {
        const res = await apiRequest("POST", "/api/days", payload);
        return await res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/days"] });
      toast({ title: "Saved!", description: "Your morning habits have been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    },
  });

  const toggleHabit = (key: string) => {
    setRituals(prev => ({
      ...prev,
      [key]: { ...prev[key], done: !prev[key]?.done },
    }));
  };

  const updateCount = (key: string, count: number) => {
    setRituals(prev => ({
      ...prev,
      [key]: { ...prev[key], count },
    }));
  };

  const isAllRitualsComplete = () => {
    return enabledHabits.every(h => rituals[h.key]?.done);
  };

  const completedCount = enabledHabits.filter(h => rituals[h.key]?.done).length;
  const progressPercent = enabledHabits.length > 0 ? (completedCount / enabledHabits.length) * 100 : 0;

  if (isDayLoading || isConfigLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="space-y-6">
          <div className="h-20 bg-muted animate-pulse rounded" />
          <div className="h-96 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-amber-100 dark:bg-amber-900/30 rounded-full shrink-0">
            <Sun className="h-6 w-6 sm:h-8 sm:w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Morning Ritual</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goToPreviousDay} title="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium">{format(currentDate, "EEEE, MMMM d, yyyy")}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goToNextDay} disabled={isViewingToday} title="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isViewingToday && (
                <Button variant="outline" size="sm" className="h-6 text-xs ml-2" onClick={goToToday}>
                  <Calendar className="h-3 w-3 mr-1" />
                  Today
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isViewingToday && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              Viewing Past Day
            </Badge>
          )}
          {isAllRitualsComplete() && enabledHabits.length > 0 && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          )}
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm">
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      {enabledHabits.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Morning habits</span>
                <span className="font-medium">{completedCount}/{enabledHabits.length} complete</span>
              </div>
              <Progress value={progressPercent} className="h-3" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Morning Habits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-orange-500" />
            Morning Habits
          </CardTitle>
          <CardDescription>
            Start your day with these essential habits
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {enabledHabits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No habits configured.</p>
              <Button variant="ghost" asChild className="mt-2">
                <Link href="/settings">Configure habits in Settings</Link>
              </Button>
            </div>
          ) : (
            enabledHabits.map((habit) => {
              const Icon = getIconComponent(habit.icon);
              const isComplete = rituals[habit.key]?.done;

              return (
                <div
                  key={habit.key}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                    isComplete
                      ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                      : "bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={habit.key}
                      checked={isComplete}
                      onCheckedChange={() => toggleHabit(habit.key)}
                      className="h-5 w-5"
                    />
                    <Icon className={`h-5 w-5 ${isComplete ? "text-green-600" : "text-muted-foreground"}`} />
                    <Label
                      htmlFor={habit.key}
                      className={`cursor-pointer ${isComplete ? "line-through text-muted-foreground" : ""}`}
                    >
                      {habit.label}
                    </Label>
                  </div>

                  {habit.hasCount && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={rituals[habit.key]?.count || ""}
                        onChange={(e) => updateCount(habit.key, parseInt(e.target.value) || 0)}
                        className="w-20 h-8 text-center"
                        min={0}
                      />
                      <span className="text-sm text-muted-foreground">{habit.countLabel}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link href="/plan">
            <ChevronRight className="h-4 w-4 mr-2" />
            Plan Your Day
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            <ChevronRight className="h-4 w-4 mr-2" />
            Go to Command Center
          </Link>
        </Button>
      </div>
    </div>
  );
}
