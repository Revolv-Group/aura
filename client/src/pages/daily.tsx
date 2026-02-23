import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays, addDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sun,
  Moon,
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
  Calendar,
  Target,
  Rocket,
  Sparkles,
  Timer,
  Utensils,
  Trophy,
  TrendingUp,
  Heart,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useRoute, useLocation } from "wouter";

// ============================================================================
// TYPES
// ============================================================================

interface Day {
  id: string;
  date: string;
  title: string | null;
  morningRituals: Record<string, { done: boolean; reps?: number; pages?: number; count?: number }> | null;
  top3Outcomes: Top3Outcome[] | string | null;
  oneThingToShip: string | null;
  reflectionAm: string | null;
  reflectionPm: string | null;
  mood: string | null;
  primaryVentureFocus: string | null;
  eveningRituals: {
    reviewCompleted?: boolean;
    journalEntry?: string;
    fastingHours?: number;
    fastingCompleted?: boolean;
    deepWorkHours?: number;
    completedAt?: string;
  } | null;
}

interface Top3Outcome {
  text: string;
  completed: boolean;
}

interface HealthEntry {
  id: number;
  date: string;
  sleepHours: number | null;
  sleepQuality: string | null;
  energyLevel: number | null;
  mood: string | null;
  stressLevel: string | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  steps: number | null;
  workoutDone: boolean;
  workoutType: string | null;
  workoutDurationMin: number | null;
  notes: string | null;
}

interface Venture {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  status: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3" | null;
  dueDate: string | null;
  focusDate: string | null;
  completedAt: string | null;
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

// ============================================================================
// ICON MAP
// ============================================================================

const ICON_MAP: Record<string, LucideIcon> = {
  Dumbbell, Pill, BookOpen, Droplets, Brain, Coffee, Bed, Footprints, Sun,
};

const getIconComponent = (iconName: string): LucideIcon => ICON_MAP[iconName] || Sun;

// ============================================================================
// COMPONENT
// ============================================================================

export default function DailyPage() {
  const { toast } = useToast();
  const [, params] = useRoute("/today/:date");
  const [, setLocation] = useLocation();

  const todayDate = format(new Date(), "yyyy-MM-dd");
  const selectedDate = params?.date || todayDate;
  const isViewingToday = selectedDate === todayDate;
  const currentDate = parseISO(selectedDate);

  // Navigation
  const goToPreviousDay = () => setLocation(`/today/${format(subDays(currentDate, 1), "yyyy-MM-dd")}`);
  const goToNextDay = () => {
    const next = format(addDays(currentDate, 1), "yyyy-MM-dd");
    if (next <= todayDate) setLocation(`/today/${next}`);
  };
  const goToToday = () => setLocation("/today");

  // ---- STATE ----

  // Morning habits
  const [rituals, setRituals] = useState<Record<string, { done: boolean; count?: number }>>({});

  // Plan
  const [top3Outcomes, setTop3Outcomes] = useState<Top3Outcome[]>([
    { text: "", completed: false },
    { text: "", completed: false },
    { text: "", completed: false },
  ]);
  const [planning, setPlanning] = useState({
    oneThingToShip: "",
    reflectionAm: "",
    primaryVentureFocus: "",
  });

  // Health (morning section)
  const [health, setHealth] = useState({
    sleepHours: "" as string | number,
    sleepQuality: "",
    energyLevel: "" as string | number,
    weightKg: "" as string | number,
    bodyFatPercent: "" as string | number,
  });

  // Evening section
  const [evening, setEvening] = useState({
    reflectionPm: "",
    fastingHours: "" as string | number,
    deepWorkHours: "" as string | number,
    stressLevel: "",
    steps: "" as string | number,
    workoutDone: false,
    workoutType: "",
    workoutDurationMin: "" as string | number,
  });

  const [healthEntryId, setHealthEntryId] = useState<number | null>(null);

  // ---- DATA FETCHING ----

  const { data: habitConfig, isLoading: isConfigLoading } = useQuery<MorningRitualConfig>({
    queryKey: ["/api/settings/morning-ritual"],
  });

  const enabledHabits = useMemo(() => {
    return Array.isArray(habitConfig?.habits) ? habitConfig.habits.filter((h) => h.enabled) : [];
  }, [habitConfig?.habits]);

  const { data: dayData, isLoading: isDayLoading } = useQuery<Day>({
    queryKey: ["/api/days", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/days/${selectedDate}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch day");
      return await res.json();
    },
  });

  const { data: ventures = [] } = useQuery<Venture[]>({ queryKey: ["/api/ventures"] });
  const activeVentures = Array.isArray(ventures) ? ventures.filter((v) => v.status !== "archived") : [];

  const { data: healthEntries = [] } = useQuery<HealthEntry[]>({
    queryKey: ["/api/health", { startDate: selectedDate, endDate: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/health?startDate=${selectedDate}&endDate=${selectedDate}`, { credentials: "include" });
      return await res.json();
    },
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks/today", { date: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/today?date=${selectedDate}`, { credentials: "include" });
      return await res.json();
    },
  });

  const { data: dueTasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks", { dueDate: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?due_date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const priorityTasksDueToday = dueTasks.filter(
    (task) => (task.priority === "P0" || task.priority === "P1") && task.status !== "completed" && task.status !== "on_hold"
  );

  // ---- DERIVED VALUES ----

  const completedTasks = Array.isArray(tasks) ? tasks.filter((t) => t.status === "completed").length : 0;
  const totalTasks = Array.isArray(tasks) ? tasks.length : 0;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // ---- EFFECTS: Initialize state from fetched data ----

  // Reset on date change
  useEffect(() => {
    if (enabledHabits.length > 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        initial[habit.key] = { done: false, count: habit.hasCount ? habit.defaultCount : undefined };
      }
      setRituals(initial);
    }
    setTop3Outcomes([
      { text: "", completed: false },
      { text: "", completed: false },
      { text: "", completed: false },
    ]);
    setPlanning({ oneThingToShip: "", reflectionAm: "", primaryVentureFocus: "" });
    setHealth({ sleepHours: "", sleepQuality: "", energyLevel: "", weightKg: "", bodyFatPercent: "" });
    setEvening({ reflectionPm: "", fastingHours: "", deepWorkHours: "", stressLevel: "", steps: "", workoutDone: false, workoutType: "", workoutDurationMin: "" });
    setHealthEntryId(null);
  }, [selectedDate]);

  // Initialize rituals from config
  useEffect(() => {
    if (enabledHabits.length > 0 && Object.keys(rituals).length === 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        initial[habit.key] = { done: false, count: habit.hasCount ? habit.defaultCount : undefined };
      }
      setRituals(initial);
    }
  }, [enabledHabits]);

  // Load morning rituals + plan from day data
  useEffect(() => {
    if (dayData && enabledHabits.length > 0 && dayData.morningRituals) {
      const loaded: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        const saved = dayData.morningRituals[habit.key];
        if (saved && typeof saved === "object") {
          loaded[habit.key] = {
            done: saved.done || false,
            count: habit.hasCount ? (saved.reps ?? saved.pages ?? saved.count ?? habit.defaultCount) : undefined,
          };
        } else {
          loaded[habit.key] = { done: false, count: habit.hasCount ? habit.defaultCount : undefined };
        }
      }
      setRituals(loaded);
    }
  }, [dayData, enabledHabits]);

  // Load plan data
  useEffect(() => {
    if (dayData) {
      if (Array.isArray(dayData.top3Outcomes)) {
        setTop3Outcomes(dayData.top3Outcomes as Top3Outcome[]);
      } else if (typeof dayData.top3Outcomes === "string" && dayData.top3Outcomes) {
        const lines = dayData.top3Outcomes.split("\n").filter((l) => l.trim());
        const outcomes = lines.map((line) => ({ text: line.replace(/^\d+\.\s*/, ""), completed: false }));
        while (outcomes.length < 3) outcomes.push({ text: "", completed: false });
        setTop3Outcomes(outcomes.slice(0, 3));
      }

      setPlanning({
        oneThingToShip: dayData.oneThingToShip || "",
        reflectionAm: dayData.reflectionAm || "",
        primaryVentureFocus: dayData.primaryVentureFocus || "",
      });

      // Evening data
      setEvening((prev) => ({
        ...prev,
        reflectionPm: dayData.reflectionPm || "",
        fastingHours: dayData.eveningRituals?.fastingHours || "",
        deepWorkHours: dayData.eveningRituals?.deepWorkHours || "",
      }));
    }
  }, [dayData]);

  // Load health entry
  useEffect(() => {
    const entry = Array.isArray(healthEntries) ? healthEntries[0] : null;
    if (entry) {
      setHealthEntryId(entry.id);
      setHealth({
        sleepHours: entry.sleepHours ?? "",
        sleepQuality: entry.sleepQuality ?? "",
        energyLevel: entry.energyLevel ?? "",
        weightKg: entry.weightKg ?? "",
        bodyFatPercent: entry.bodyFatPercent ?? "",
      });
      setEvening((prev) => ({
        ...prev,
        stressLevel: entry.stressLevel ?? "",
        steps: entry.steps ?? "",
        workoutDone: entry.workoutDone || false,
        workoutType: entry.workoutType ?? "",
        workoutDurationMin: entry.workoutDurationMin ?? "",
      }));
    }
  }, [healthEntries]);

  // ---- HANDLERS ----

  const toggleHabit = (key: string) => {
    setRituals((prev) => ({ ...prev, [key]: { ...prev[key], done: !prev[key]?.done } }));
  };

  const updateCount = (key: string, count: number) => {
    setRituals((prev) => ({ ...prev, [key]: { ...prev[key], count } }));
  };

  const isAllRitualsComplete = () => enabledHabits.every((h) => rituals[h.key]?.done);

  const updateOutcomeText = (index: number, text: string) => {
    setTop3Outcomes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text };
      return updated;
    });
  };

  const toggleOutcomeCompleted = (index: number) => {
    setTop3Outcomes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], completed: !updated[index].completed };
      return updated;
    });
  };

  // ---- SAVE ----

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build morning rituals payload
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

      // Build evening rituals payload
      const fastingH = typeof evening.fastingHours === "string" ? parseFloat(evening.fastingHours) || 0 : evening.fastingHours;
      const deepWorkH = typeof evening.deepWorkHours === "string" ? parseFloat(evening.deepWorkHours) || 0 : evening.deepWorkHours;
      const eveningRituals = {
        reviewCompleted: !!evening.reflectionPm || fastingH > 0 || deepWorkH > 0,
        journalEntry: evening.reflectionPm || undefined,
        fastingHours: fastingH || undefined,
        fastingCompleted: fastingH >= 16,
        deepWorkHours: deepWorkH || undefined,
        completedAt: new Date().toISOString(),
      };

      const filteredOutcomes = top3Outcomes.filter((o) => o.text.trim());

      const dayPayload = {
        id: `day_${selectedDate}`,
        date: selectedDate,
        morningRituals,
        top3Outcomes: filteredOutcomes.length > 0 ? top3Outcomes : null,
        oneThingToShip: planning.oneThingToShip || null,
        reflectionAm: planning.reflectionAm || null,
        reflectionPm: evening.reflectionPm || null,
        primaryVentureFocus: planning.primaryVentureFocus || null,
        eveningRituals,
      };

      // Save day data
      try {
        await apiRequest("PATCH", `/api/days/${selectedDate}`, dayPayload);
      } catch {
        await apiRequest("POST", "/api/days", dayPayload);
      }

      // Save health data
      const healthPayload: Record<string, any> = {
        date: selectedDate,
      };
      const sleepH = typeof health.sleepHours === "string" ? parseFloat(health.sleepHours) : health.sleepHours;
      const energyL = typeof health.energyLevel === "string" ? parseInt(String(health.energyLevel)) : health.energyLevel;
      const weightK = typeof health.weightKg === "string" ? parseFloat(health.weightKg) : health.weightKg;
      const bodyFatP = typeof health.bodyFatPercent === "string" ? parseFloat(health.bodyFatPercent) : health.bodyFatPercent;
      const stepsN = typeof evening.steps === "string" ? parseInt(String(evening.steps)) : evening.steps;
      const workoutDurN = typeof evening.workoutDurationMin === "string" ? parseInt(String(evening.workoutDurationMin)) : evening.workoutDurationMin;

      if (sleepH) healthPayload.sleepHours = sleepH;
      if (health.sleepQuality) healthPayload.sleepQuality = health.sleepQuality;
      if (energyL) healthPayload.energyLevel = energyL;
      if (weightK) healthPayload.weightKg = weightK;
      if (bodyFatP) healthPayload.bodyFatPercent = bodyFatP;
      if (evening.stressLevel) healthPayload.stressLevel = evening.stressLevel;
      if (stepsN) healthPayload.steps = stepsN;
      healthPayload.workoutDone = evening.workoutDone;
      if (evening.workoutType) healthPayload.workoutType = evening.workoutType;
      if (workoutDurN) healthPayload.workoutDurationMin = workoutDurN;

      // Only save health if there's something to save
      const hasHealthData = sleepH || health.sleepQuality || energyL || weightK || bodyFatP || evening.stressLevel || stepsN || evening.workoutDone;

      if (hasHealthData) {
        if (healthEntryId) {
          await apiRequest("PATCH", `/api/health/${healthEntryId}`, healthPayload);
        } else {
          await apiRequest("POST", "/api/health", healthPayload);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/days"] });
      queryClient.invalidateQueries({ queryKey: ["/api/health"] });
      toast({ title: "Saved!", description: "Your daily log has been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    },
  });

  // ---- COMPUTED ----

  const completedCount = enabledHabits.filter((h) => rituals[h.key]?.done).length;
  const progressPercent = enabledHabits.length > 0 ? (completedCount / enabledHabits.length) * 100 : 0;
  const completedOutcomes = top3Outcomes.filter((o) => o.completed && o.text.trim()).length;
  const totalOutcomes = top3Outcomes.filter((o) => o.text.trim()).length;

  const fastingH = typeof evening.fastingHours === "string" ? parseFloat(evening.fastingHours) || 0 : evening.fastingHours;
  const deepWorkH = typeof evening.deepWorkHours === "string" ? parseFloat(evening.deepWorkHours) || 0 : evening.deepWorkHours;

  // ---- LOADING ----

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

  // ---- RENDER ----

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-amber-100 dark:bg-amber-900/30 rounded-full shrink-0">
            <Sun className="h-6 w-6 sm:h-8 sm:w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Today</h1>
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
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm">
            {saveMutation.isPending ? "Saving..." : "Save All"}
          </Button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* MORNING SECTION */}
      {/* ================================================================ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Morning</h2>
          {isAllRitualsComplete() && enabledHabits.length > 0 && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Habits Complete
            </Badge>
          )}
        </div>

        {/* Health Metrics Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Heart className="h-4 w-4 text-rose-500" />
              Health Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* Sleep Hours */}
              <div className="space-y-1.5">
                <Label htmlFor="sleep-hours" className="text-xs text-muted-foreground">Sleep (hours)</Label>
                <Input
                  id="sleep-hours"
                  type="number"
                  min={0}
                  max={16}
                  step={0.5}
                  placeholder="7.5"
                  value={health.sleepHours}
                  onChange={(e) => setHealth({ ...health, sleepHours: e.target.value })}
                  className="h-9"
                />
              </div>

              {/* Sleep Quality */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Sleep Quality</Label>
                <Select value={health.sleepQuality} onValueChange={(v) => setHealth({ ...health, sleepQuality: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="poor">Poor</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="excellent">Excellent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Energy Level */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Energy (1-5)</Label>
                <Select
                  value={String(health.energyLevel || "")}
                  onValueChange={(v) => setHealth({ ...health, energyLevel: v })}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Weight */}
              <div className="space-y-1.5">
                <Label htmlFor="weight" className="text-xs text-muted-foreground">Weight (kg)</Label>
                <Input
                  id="weight"
                  type="number"
                  min={0}
                  step={0.1}
                  placeholder="82"
                  value={health.weightKg}
                  onChange={(e) => setHealth({ ...health, weightKg: e.target.value })}
                  className="h-9"
                />
              </div>

              {/* Body Fat */}
              <div className="space-y-1.5">
                <Label htmlFor="body-fat" className="text-xs text-muted-foreground">Body Fat %</Label>
                <Input
                  id="body-fat"
                  type="number"
                  min={0}
                  max={60}
                  step={0.1}
                  placeholder="15"
                  value={health.bodyFatPercent}
                  onChange={(e) => setHealth({ ...health, bodyFatPercent: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Morning Habits Card */}
        {enabledHabits.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Dumbbell className="h-4 w-4 text-orange-500" />
                Morning Habits
              </CardTitle>
              <div className="flex justify-between text-sm pt-1">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{completedCount}/{enabledHabits.length}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </CardHeader>
            <CardContent className="space-y-3">
              {enabledHabits.map((habit) => {
                const Icon = getIconComponent(habit.icon);
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
                          className="w-20 h-8 text-center"
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
        )}

        {/* Plan Your Day Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-blue-500" />
              Plan Your Day
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* One Thing to Ship */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Rocket className="h-3.5 w-3.5 text-purple-500" />
                <Label className="text-sm font-medium">One Thing to Ship</Label>
              </div>
              {priorityTasksDueToday.length > 0 ? (
                <Select
                  value={planning.oneThingToShip}
                  onValueChange={(value) => setPlanning({ ...planning, oneThingToShip: value })}
                >
                  <SelectTrigger><SelectValue placeholder="Select your one thing to ship..." /></SelectTrigger>
                  <SelectContent>
                    {priorityTasksDueToday.map((task) => (
                      <SelectItem key={task.id} value={task.title}>
                        <span className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              task.priority === "P0"
                                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-300"
                                : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-300"
                            }
                          >
                            {task.priority}
                          </Badge>
                          {task.title}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="What's the one thing you must ship today?"
                  value={planning.oneThingToShip}
                  onChange={(e) => setPlanning({ ...planning, oneThingToShip: e.target.value })}
                />
              )}
            </div>

            {/* Top 3 Outcomes */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Target className="h-3.5 w-3.5 text-blue-500" />
                <Label className="text-sm font-medium">Top 3 Outcomes</Label>
              </div>
              {top3Outcomes.map((outcome, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    outcome.completed && outcome.text.trim()
                      ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                      : "bg-muted/30"
                  }`}
                >
                  <Checkbox
                    id={`outcome-${index}`}
                    checked={outcome.completed}
                    onCheckedChange={() => toggleOutcomeCompleted(index)}
                    disabled={!outcome.text.trim()}
                    className="h-5 w-5"
                  />
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      index === 0
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                        : index === 1
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <Input
                    placeholder={index === 0 ? "Most important outcome..." : `Outcome ${index + 1}...`}
                    value={outcome.text}
                    onChange={(e) => updateOutcomeText(index, e.target.value)}
                    className={`flex-1 ${outcome.completed ? "line-through text-muted-foreground" : ""}`}
                  />
                </div>
              ))}
            </div>

            {/* Primary Venture Focus */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <Label className="text-sm font-medium">Primary Venture Focus</Label>
              </div>
              <Select
                value={planning.primaryVentureFocus}
                onValueChange={(value) => setPlanning({ ...planning, primaryVentureFocus: value })}
              >
                <SelectTrigger><SelectValue placeholder="Select a venture..." /></SelectTrigger>
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
            </div>

            {/* Morning Intention */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Sun className="h-3.5 w-3.5 text-amber-500" />
                <Label className="text-sm font-medium">Morning Intention</Label>
              </div>
              <Textarea
                placeholder="Today I'm grateful for... I'm focused on..."
                value={planning.reflectionAm}
                onChange={(e) => setPlanning({ ...planning, reflectionAm: e.target.value })}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================ */}
      {/* DIVIDER */}
      {/* ================================================================ */}
      <Separator className="my-2" />

      {/* ================================================================ */}
      {/* EVENING SECTION */}
      {/* ================================================================ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Moon className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold">Evening</h2>
        </div>

        {/* Evening Metrics Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-indigo-500" />
              Evening Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Workout Row */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <Dumbbell className={`h-4 w-4 ${evening.workoutDone ? "text-green-600" : "text-muted-foreground"}`} />
                <Label className="text-sm font-medium">Workout</Label>
              </div>
              <Switch checked={evening.workoutDone} onCheckedChange={(v) => setEvening({ ...evening, workoutDone: v })} />
            </div>

            {evening.workoutDone && (
              <div className="grid grid-cols-2 gap-4 pl-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Select value={evening.workoutType} onValueChange={(v) => setEvening({ ...evening, workoutType: v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Type..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strength">Strength</SelectItem>
                      <SelectItem value="cardio">Cardio</SelectItem>
                      <SelectItem value="yoga">Yoga</SelectItem>
                      <SelectItem value="sports">Sports</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Duration (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="45"
                    value={evening.workoutDurationMin}
                    onChange={(e) => setEvening({ ...evening, workoutDurationMin: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* Steps */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Steps</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="8000"
                  value={evening.steps}
                  onChange={(e) => setEvening({ ...evening, steps: e.target.value })}
                  className="h-9"
                />
              </div>

              {/* Stress Level */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Stress Level</Label>
                <Select value={evening.stressLevel} onValueChange={(v) => setEvening({ ...evening, stressLevel: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Fasting + Deep Work */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Fasting Hours */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Utensils className="h-3.5 w-3.5 text-orange-500" />
                    <Label className="text-sm font-medium">Fasting</Label>
                  </div>
                  <span className="text-xs text-muted-foreground">Target: 16h</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    placeholder="0"
                    value={evening.fastingHours}
                    onChange={(e) => setEvening({ ...evening, fastingHours: e.target.value })}
                    className="w-20 h-9"
                  />
                  <span className="text-xs text-muted-foreground">hours</span>
                  {fastingH >= 16 && (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Met
                    </Badge>
                  )}
                </div>
                <Progress
                  value={Math.min((fastingH / 16) * 100, 100)}
                  className={`h-1.5 ${fastingH >= 16 ? "[&>div]:bg-green-500" : "[&>div]:bg-orange-500"}`}
                />
              </div>

              {/* Deep Work Hours */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Timer className="h-3.5 w-3.5 text-purple-500" />
                    <Label className="text-sm font-medium">Deep Work</Label>
                  </div>
                  <span className="text-xs text-muted-foreground">Target: 5h</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    placeholder="0"
                    value={evening.deepWorkHours}
                    onChange={(e) => setEvening({ ...evening, deepWorkHours: e.target.value })}
                    className="w-20 h-9"
                  />
                  <span className="text-xs text-muted-foreground">hours</span>
                  {deepWorkH >= 5 && (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Met
                    </Badge>
                  )}
                </div>
                <Progress
                  value={Math.min((deepWorkH / 5) * 100, 100)}
                  className={`h-1.5 ${deepWorkH >= 5 ? "[&>div]:bg-green-500" : "[&>div]:bg-purple-500"}`}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Outcome Review Card */}
        {totalTasks > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4 text-amber-500" />
                Day Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{completedTasks}/{totalTasks}</div>
                  <div className="text-xs text-muted-foreground">Tasks Done</div>
                  <Progress value={taskCompletionRate} className="h-1.5 mt-2" />
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{completedOutcomes}/{totalOutcomes || 3}</div>
                  <div className="text-xs text-muted-foreground">Outcomes Hit</div>
                  <Progress value={totalOutcomes > 0 ? (completedOutcomes / totalOutcomes) * 100 : 0} className="h-1.5 mt-2" />
                </div>
              </div>

              {/* One Thing to Ship status */}
              {dayData?.oneThingToShip && (
                <div className="p-3 border rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Rocket className="h-3.5 w-3.5 text-purple-500" />
                    <span className="font-medium text-xs">One Thing to Ship</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{dayData.oneThingToShip}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Evening Reflection Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-indigo-500" />
              Evening Reflection
            </CardTitle>
            <CardDescription className="text-xs">
              What went well? What could improve? What are you grateful for?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Today I accomplished... I learned... I'm grateful for... Tomorrow I will..."
              value={evening.reflectionPm}
              onChange={(e) => setEvening({ ...evening, reflectionPm: e.target.value })}
              rows={4}
            />
          </CardContent>
        </Card>
      </div>

      {/* Bottom Save Button (mobile convenience) */}
      <div className="flex justify-center pb-4">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full sm:w-auto">
          {saveMutation.isPending ? "Saving..." : "Save All"}
        </Button>
      </div>
    </div>
  );
}
