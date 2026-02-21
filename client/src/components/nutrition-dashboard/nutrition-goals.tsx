import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Target, Settings, TrendingUp } from "lucide-react";
import SetGoalsModal from "./set-goals-modal";
import { getStoredGoals } from "./set-goals-modal";

interface NutritionGoalsProps {
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
  };
  onGoalsUpdated: () => void;
}

export default function NutritionGoals({ totals, onGoalsUpdated }: NutritionGoalsProps) {
  const [showSetGoals, setShowSetGoals] = useState(false);
  const goals = getStoredGoals();

  const getProgressColor = (value: number, goal: number) => {
    const percentage = (value / goal) * 100;
    if (percentage >= 90 && percentage <= 110) return "bg-emerald-500";
    if (percentage >= 80 && percentage <= 120) return "bg-amber-500";
    return "bg-rose-500";
  };

  const getProgressStatus = (value: number, goal: number) => {
    const percentage = (value / goal) * 100;
    if (percentage >= 90 && percentage <= 110) return { text: "On track", color: "text-emerald-600" };
    if (percentage >= 80 && percentage <= 120) return { text: "Close", color: "text-amber-600" };
    if (percentage < 80) return { text: "Under", color: "text-rose-600" };
    return { text: "Over", color: "text-rose-600" };
  };

  const nutritionItems = [
    {
      name: "Calories",
      current: totals.calories,
      goal: goals.calories,
      unit: "kcal",
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      name: "Protein",
      current: totals.protein,
      goal: goals.protein,
      unit: "g",
      color: "text-rose-600 dark:text-rose-400",
      bgColor: "bg-rose-50 dark:bg-rose-950/30",
    },
    {
      name: "Carbs",
      current: totals.carbs,
      goal: goals.carbs,
      unit: "g",
      color: "text-sky-600 dark:text-sky-400",
      bgColor: "bg-sky-50 dark:bg-sky-950/30",
    },
    {
      name: "Fats",
      current: totals.fats,
      goal: goals.fats,
      unit: "g",
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Daily Goals
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowSetGoals(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {nutritionItems.map((item) => {
            const percentage = (item.current / item.goal) * 100;
            const status = getProgressStatus(item.current, item.goal);

            return (
              <div key={item.name} className={`rounded-lg p-4 ${item.bgColor}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${item.color}`}>{item.name}</span>
                  <span className={`text-xs font-medium ${status.color}`}>{status.text}</span>
                </div>

                <div className="flex items-baseline gap-1 mb-2">
                  <span className={`text-2xl font-bold ${item.color}`}>{item.current.toFixed(item.name === "Calories" ? 0 : 1)}</span>
                  <span className="text-sm text-muted-foreground">/ {item.goal}</span>
                  <span className="text-sm text-muted-foreground">{item.unit}</span>
                </div>

                <Progress
                  value={Math.min(percentage, 100)}
                  className={`h-2 ${getProgressColor(item.current, item.goal)}`}
                />

                <p className="text-xs text-muted-foreground mt-1">
                  {percentage.toFixed(0)}% of daily goal
                </p>
              </div>
            );
          })}

          <div className="pt-2 space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowSetGoals(true)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Edit Goals
            </Button>
          </div>
        </CardContent>
      </Card>

      <SetGoalsModal
        open={showSetGoals}
        onOpenChange={setShowSetGoals}
        onGoalsUpdated={() => {
          onGoalsUpdated();
          setShowSetGoals(false);
        }}
      />
    </>
  );
}
