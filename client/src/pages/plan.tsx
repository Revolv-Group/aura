import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays, addDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Target,
  Rocket,
  Sparkles,
  Sun,
  ChevronRight,
  ChevronLeft,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useRoute, useLocation } from "wouter";

interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'completed' | 'on_hold';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | null;
  dueDate: string | null;
  ventureId: string | null;
  projectId: string | null;
}

interface Venture {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  status: string;
}

interface Top3Outcome {
  text: string;
  completed: boolean;
}

interface Day {
  id: string;
  date: string;
  title: string | null;
  top3Outcomes: Top3Outcome[] | string | null;
  oneThingToShip: string | null;
  reflectionAm: string | null;
  mood: string | null;
  primaryVentureFocus: string | null;
  morningRituals: Record<string, any> | null;
}

export default function PlanPage() {
  const { toast } = useToast();
  const [, params] = useRoute("/plan/:date");
  const [, setLocation] = useLocation();

  const todayDate = format(new Date(), "yyyy-MM-dd");
  const selectedDate = params?.date || todayDate;
  const isViewingToday = selectedDate === todayDate;
  const currentDate = parseISO(selectedDate);

  const goToPreviousDay = () => {
    setLocation(`/plan/${format(subDays(currentDate, 1), "yyyy-MM-dd")}`);
  };
  const goToNextDay = () => {
    const nextDate = format(addDays(currentDate, 1), "yyyy-MM-dd");
    if (nextDate <= todayDate) setLocation(`/plan/${nextDate}`);
  };
  const goToToday = () => setLocation("/plan");

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

  // Fetch day data
  const { data: dayData, isLoading: isDayLoading } = useQuery<Day>({
    queryKey: ["/api/days", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/days/${selectedDate}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch day");
      return await res.json();
    },
  });

  // Fetch ventures
  const { data: ventures = [] } = useQuery<Venture[]>({
    queryKey: ["/api/ventures"],
  });
  const activeVentures = Array.isArray(ventures) ? ventures.filter(v => v.status !== "archived") : [];

  // Fetch P0/P1 tasks due on selected date
  const { data: dueTasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks", { dueDate: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?due_date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return await res.json();
    },
  });
  const priorityTasksDueToday = dueTasks.filter(
    (task) =>
      (task.priority === "P0" || task.priority === "P1") &&
      task.status !== "completed" &&
      task.status !== "on_hold"
  );

  // Fetch yesterday for syncing priorities
  const dayBeforeSelected = format(subDays(currentDate, 1), "yyyy-MM-dd");
  const { data: yesterdayData } = useQuery<Day & {
    eveningRituals?: { tomorrowPriorities?: string[] } | null;
  }>({
    queryKey: ["/api/days", dayBeforeSelected],
    queryFn: async () => {
      const res = await fetch(`/api/days/${dayBeforeSelected}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch previous day");
      return await res.json();
    },
  });

  // Reset state on date change
  useEffect(() => {
    setTop3Outcomes([
      { text: "", completed: false },
      { text: "", completed: false },
      { text: "", completed: false },
    ]);
    setPlanning({ oneThingToShip: "", reflectionAm: "", primaryVentureFocus: "" });
  }, [selectedDate]);

  // Load existing data
  useEffect(() => {
    if (dayData) {
      const tomorrowPriorities = yesterdayData?.eveningRituals?.tomorrowPriorities;

      if (Array.isArray(dayData.top3Outcomes)) {
        setTop3Outcomes(dayData.top3Outcomes);
      } else if (typeof dayData.top3Outcomes === "string" && dayData.top3Outcomes) {
        const lines = dayData.top3Outcomes.split("\n").filter(l => l.trim());
        const outcomes = lines.map(line => ({
          text: line.replace(/^\d+\.\s*/, ""),
          completed: false,
        }));
        while (outcomes.length < 3) outcomes.push({ text: "", completed: false });
        setTop3Outcomes(outcomes.slice(0, 3));
      } else if (Array.isArray(tomorrowPriorities)) {
        const outcomes = tomorrowPriorities.map(p => ({ text: p || "", completed: false }));
        while (outcomes.length < 3) outcomes.push({ text: "", completed: false });
        setTop3Outcomes(outcomes.slice(0, 3));
      }

      let oneThingToShip = dayData.oneThingToShip || "";
      if (!oneThingToShip && Array.isArray(tomorrowPriorities) && tomorrowPriorities[0]?.trim()) {
        oneThingToShip = tomorrowPriorities[0];
      }

      setPlanning({
        oneThingToShip,
        reflectionAm: dayData.reflectionAm || "",
        primaryVentureFocus: dayData.primaryVentureFocus || "",
      });
    }
  }, [dayData, yesterdayData]);

  // Sync from yesterday if no day data
  useEffect(() => {
    const tomorrowPriorities = yesterdayData?.eveningRituals?.tomorrowPriorities;
    if (!dayData && Array.isArray(tomorrowPriorities)) {
      const priorities = tomorrowPriorities.filter(p => p.trim());
      if (priorities.length > 0) {
        const hasOutcomes = top3Outcomes.some(o => o.text.trim());
        if (!hasOutcomes) {
          const outcomes = priorities.map(p => ({ text: p, completed: false }));
          while (outcomes.length < 3) outcomes.push({ text: "", completed: false });
          setTop3Outcomes(outcomes.slice(0, 3));
        }
        if (!planning.oneThingToShip && priorities[0]) {
          setPlanning(prev => ({ ...prev, oneThingToShip: priorities[0] }));
        }
      }
    }
  }, [dayData, yesterdayData]);

  // Save mutation — only planning fields
  const saveMutation = useMutation({
    mutationFn: async () => {
      const filteredOutcomes = top3Outcomes.filter(o => o.text.trim());
      const payload = {
        id: `day_${selectedDate}`,
        date: selectedDate,
        top3Outcomes: filteredOutcomes.length > 0 ? top3Outcomes : null,
        oneThingToShip: planning.oneThingToShip || null,
        reflectionAm: planning.reflectionAm || null,
        primaryVentureFocus: planning.primaryVentureFocus || null,
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
      toast({ title: "Saved!", description: "Your daily plan has been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    },
  });

  // Outcome helpers
  const updateOutcomeText = (index: number, text: string) => {
    setTop3Outcomes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text };
      return updated;
    });
  };

  const toggleOutcomeCompleted = (index: number) => {
    setTop3Outcomes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], completed: !updated[index].completed };
      return updated;
    });
  };

  const completedOutcomes = top3Outcomes.filter(o => o.completed && o.text.trim()).length;
  const totalOutcomes = top3Outcomes.filter(o => o.text.trim()).length;
  const outcomeProgressPercent = totalOutcomes > 0 ? (completedOutcomes / totalOutcomes) * 100 : 0;

  if (isDayLoading) {
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
          <div className="p-2 sm:p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full shrink-0">
            <Target className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Daily Plan</h1>
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
        <div className="flex items-center gap-2">
          {!isViewingToday && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              Viewing Past Day
            </Badge>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm">
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* One Thing to Ship */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Rocket className="h-5 w-5 text-purple-500" />
            One Thing to Ship Today
          </CardTitle>
          <CardDescription>
            Select a P0/P1 task due today as your main focus
          </CardDescription>
        </CardHeader>
        <CardContent>
          {priorityTasksDueToday.length > 0 ? (
            <Select
              value={planning.oneThingToShip}
              onValueChange={(value) => setPlanning({ ...planning, oneThingToShip: value })}
            >
              <SelectTrigger className="text-lg">
                <SelectValue placeholder="Select your one thing to ship..." />
              </SelectTrigger>
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
              className="text-lg"
            />
          )}
        </CardContent>
      </Card>

      {/* Top 3 Outcomes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-blue-500" />
            Top 3 Outcomes
            {Array.isArray(yesterdayData?.eveningRituals?.tomorrowPriorities) &&
              yesterdayData.eveningRituals.tomorrowPriorities.filter(p => p.trim()).length > 0 &&
              !dayData?.top3Outcomes && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  Synced from last night
                </Badge>
              )}
          </CardTitle>
          <CardDescription>
            What would make today a win? Check off as you complete them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {top3Outcomes.map((outcome, index) => (
            <div
              key={index}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
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
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                index === 0 ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                index === 1 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
              }`}>
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
          {totalOutcomes > 0 && (
            <div className="pt-2">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{completedOutcomes}/{totalOutcomes} complete</span>
              </div>
              <Progress value={outcomeProgressPercent} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Venture Focus */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Primary Venture Focus
          </CardTitle>
          <CardDescription>
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

      {/* Morning Intention */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500" />
            Morning Intention
          </CardTitle>
          <CardDescription>
            Set your mindset for the day. What energy do you want to bring?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Today I'm grateful for... I'm focused on... I will approach challenges with..."
            value={planning.reflectionAm}
            onChange={(e) => setPlanning({ ...planning, reflectionAm: e.target.value })}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link href="/morning">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Morning Habits
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
