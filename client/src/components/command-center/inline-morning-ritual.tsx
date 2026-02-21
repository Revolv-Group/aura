import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Dumbbell,
  Pill,
  Droplets,
  Rocket,
  Target,
  Sparkles,
  Sun,
  Save,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Day } from "@shared/schema";

interface Venture {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  status: string;
}

interface InlineMorningRitualProps {
  day: Day | null;
}

// Default habits configuration
const defaultHabits = [
  { key: "pressUps", label: "Press-ups", icon: Dumbbell, hasCount: true, countLabel: "reps", defaultCount: 50 },
  { key: "squats", label: "Squats", icon: Dumbbell, hasCount: true, countLabel: "reps", defaultCount: 50 },
  { key: "supplements", label: "Supplements", icon: Pill, hasCount: false },
  { key: "water", label: "Drink Water", icon: Droplets, hasCount: false },
];

export default function InlineMorningRitual({ day }: InlineMorningRitualProps) {
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");

  const [rituals, setRituals] = useState<Record<string, { done: boolean; count?: number }>>({});
  const [planning, setPlanning] = useState({
    top3Outcomes: "",
    oneThingToShip: "",
    reflectionAm: "",
    primaryVentureFocus: "",
  });

  // Fetch ventures for focus selection
  const { data: ventures = [] } = useQuery<Venture[]>({
    queryKey: ["/api/ventures"],
  });

  const activeVentures = Array.isArray(ventures) ? ventures.filter(v => v.status !== "archived") : [];

  // Initialize rituals from default habits
  useEffect(() => {
    if (Object.keys(rituals).length === 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of defaultHabits) {
        initial[habit.key] = {
          done: false,
          count: habit.hasCount ? habit.defaultCount : undefined,
        };
      }
      setRituals(initial);
    }
  }, []);

  // Load existing data when day data arrives
  useEffect(() => {
    if (day) {
      if (day.morningRituals) {
        const loaded: Record<string, { done: boolean; count?: number }> = {};
        for (const habit of defaultHabits) {
          const saved = (day.morningRituals as Record<string, any>)[habit.key];
          if (saved && typeof saved === "object") {
            loaded[habit.key] = {
              done: saved.done || false,
              count: habit.hasCount
                ? (saved.reps ?? saved.ml ?? saved.count ?? habit.defaultCount)
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

      // Convert top3Outcomes from array format to string for editing
      let top3String = "";
      if (Array.isArray(day.top3Outcomes) && day.top3Outcomes.length > 0) {
        top3String = day.top3Outcomes.map((o, i) => `${i + 1}. ${o.text}`).join("\n");
      }

      setPlanning({
        top3Outcomes: top3String,
        oneThingToShip: day.oneThingToShip || "",
        reflectionAm: day.reflectionAm || "",
        primaryVentureFocus: day.primaryVentureFocus || "",
      });
    }
  }, [day]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const dayId = day?.id || `day_${today}`;

      // Build morningRituals dynamically
      const morningRituals: Record<string, any> = {};
      for (const habit of defaultHabits) {
        const ritual = rituals[habit.key];
        if (ritual) {
          morningRituals[habit.key] = {
            done: ritual.done,
            ...(habit.hasCount && habit.countLabel === "reps" && { reps: ritual.count }),
            ...(habit.hasCount && habit.countLabel === "ml" && { ml: ritual.count }),
          };
        }
      }

      morningRituals.completedAt = isAllRitualsComplete() ? new Date().toISOString() : undefined;

      // Convert top3Outcomes from string to array format
      let top3OutcomesArray = null;
      if (planning.top3Outcomes) {
        const lines = planning.top3Outcomes.split("\n").filter(line => line.trim());
        if (lines.length > 0) {
          top3OutcomesArray = lines.map(line => ({
            text: line.replace(/^\d+\.\s*/, "").trim(),
            completed: false,
          }));
        }
      }

      const payload = {
        id: dayId,
        date: today,
        morningRituals,
        top3Outcomes: top3OutcomesArray,
        oneThingToShip: planning.oneThingToShip || null,
        reflectionAm: planning.reflectionAm || null,
        primaryVentureFocus: planning.primaryVentureFocus || null,
      };

      // Try PATCH first, then POST if day doesn't exist
      try {
        const res = await apiRequest("PATCH", `/api/days/${today}`, payload);
        return await res.json();
      } catch (e) {
        const res = await apiRequest("POST", "/api/days", payload);
        return await res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/days"] });
      queryClient.invalidateQueries({ queryKey: ["/api/days/today"] });
      toast({
        title: "Saved!",
        description: "Your morning ritual has been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save. Please try again.",
        variant: "destructive",
      });
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
    return defaultHabits.every(h => rituals[h.key]?.done);
  };

  const completedCount = defaultHabits.filter(h => rituals[h.key]?.done).length;
  const progressPercent = (completedCount / defaultHabits.length) * 100;

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Morning habits</span>
                <span className="text-sm text-muted-foreground">{completedCount}/{defaultHabits.length} complete</span>
              </div>
              <Progress value={progressPercent} className="h-2 w-48" />
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
          <CardContent className="space-y-3">
            {defaultHabits.map((habit) => {
              const Icon = habit.icon;
              const isComplete = rituals[habit.key]?.done;

              return (
                <div
                  key={habit.key}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
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
                    <Icon className={`h-4 w-4 ${isComplete ? "text-green-600" : "text-muted-foreground"}`} />
                    <Label
                      htmlFor={habit.key}
                      className={`cursor-pointer text-sm ${isComplete ? "line-through text-muted-foreground" : ""}`}
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
                        className="w-16 h-8 text-center text-sm"
                        min={0}
                      />
                      <span className="text-xs text-muted-foreground">{habit.countLabel}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Daily Planning */}
        <div className="space-y-4">
          {/* One Thing to Ship */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="h-4 w-4 text-purple-500" />
                One Thing to Ship Today
              </CardTitle>
              <CardDescription className="text-xs">
                What's the single most important thing you must accomplish?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="e.g., Launch the new feature to production"
                value={planning.oneThingToShip}
                onChange={(e) => setPlanning({ ...planning, oneThingToShip: e.target.value })}
              />
            </CardContent>
          </Card>

          {/* Top 3 Outcomes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-blue-500" />
                Top 3 Outcomes
              </CardTitle>
              <CardDescription className="text-xs">
                What would make today a win?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="1. Complete client proposal&#10;2. Review team PRs&#10;3. Exercise for 30 minutes"
                value={planning.top3Outcomes}
                onChange={(e) => setPlanning({ ...planning, top3Outcomes: e.target.value })}
                rows={3}
              />
            </CardContent>
          </Card>

          {/* Venture Focus */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Primary Venture Focus
              </CardTitle>
              <CardDescription className="text-xs">
                Which venture gets your deep work today?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={planning.primaryVentureFocus}
                onValueChange={(value) => setPlanning({ ...planning, primaryVentureFocus: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a venture..." />
                </SelectTrigger>
                <SelectContent>
                  {activeVentures.map((venture) => (
                    <SelectItem key={venture.id} value={venture.id}>
                      <span className="flex items-center gap-2">
                        {venture.icon && <span>{venture.icon}</span>}
                        {venture.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Morning Intention */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="h-4 w-4 text-amber-500" />
            Morning Intention
          </CardTitle>
          <CardDescription className="text-xs">
            Set your mindset for the day. What energy do you want to bring?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Today I'm grateful for... I'm focused on... I will approach challenges with..."
            value={planning.reflectionAm}
            onChange={(e) => setPlanning({ ...planning, reflectionAm: e.target.value })}
            rows={2}
          />
        </CardContent>
      </Card>
    </div>
  );
}
