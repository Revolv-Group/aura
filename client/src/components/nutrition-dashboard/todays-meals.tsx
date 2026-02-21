import { useState } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Apple, Pencil, Eye, Home, Building2, BriefcaseBusiness, Plane } from "lucide-react";
import EditMealModal from "./edit-meal-modal";
import MealDetailModal from "./meal-detail-modal";
import { getStoredGoals } from "./set-goals-modal";

interface NutritionEntry {
  id: string;
  datetime: string;
  mealType: string;
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatsG: number | null;
  context: string | null;
  tags: string[] | null;
  notes: string | null;
  createdAt: string;
}

interface TodaysMealsProps {
  meals: NutritionEntry[];
}

const MEAL_TYPE_COLORS = {
  breakfast: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
  lunch: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700",
  dinner: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700",
  snack: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-700",
};

const CONTEXT_ICONS = {
  home: Home,
  restaurant: Building2,
  office: BriefcaseBusiness,
  travel: Plane,
};

export default function TodaysMeals({ meals }: TodaysMealsProps) {
  const [selectedMealForEdit, setSelectedMealForEdit] = useState<NutritionEntry | null>(null);
  const [selectedMealForView, setSelectedMealForView] = useState<NutritionEntry | null>(null);

  const goals = getStoredGoals();

  const totals = {
    calories: meals.reduce((sum, m) => sum + (m.calories || 0), 0),
    protein: meals.reduce((sum, m) => sum + (m.proteinG || 0), 0),
    carbs: meals.reduce((sum, m) => sum + (m.carbsG || 0), 0),
    fats: meals.reduce((sum, m) => sum + (m.fatsG || 0), 0),
  };

  const getProgressColor = (value: number, goal: number) => {
    const percentage = (value / goal) * 100;
    if (percentage >= 90 && percentage <= 110) return "bg-emerald-500";
    if (percentage >= 80 && percentage <= 120) return "bg-amber-500";
    return "bg-rose-500";
  };

  const handleEditFromDetail = () => {
    setSelectedMealForEdit(selectedMealForView);
    setSelectedMealForView(null);
  };

  if (meals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Today's Meals - {format(new Date(), "MMMM d, yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Apple className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium">No meals logged today</p>
            <p className="text-sm text-muted-foreground mt-1">Start tracking your nutrition by logging your first meal</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Today's Meals - {format(new Date(), "MMMM d, yyyy")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Meals List */}
          <div className="space-y-3">
            {meals.map((meal) => {
              const ContextIcon = meal.context ? CONTEXT_ICONS[meal.context as keyof typeof CONTEXT_ICONS] : null;

              return (
                <div key={meal.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className={`${MEAL_TYPE_COLORS[meal.mealType as keyof typeof MEAL_TYPE_COLORS] || ""} capitalize`}
                        variant="outline"
                      >
                        {meal.mealType}
                      </Badge>
                      {meal.context && ContextIcon && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <ContextIcon className="h-3 w-3" />
                          <span className="capitalize text-xs">{meal.context}</span>
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedMealForView(meal)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedMealForEdit(meal)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <p className="font-medium mb-2">{meal.description}</p>

                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Calories:</span>
                      <p className="font-semibold">{meal.calories || "—"} kcal</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Protein:</span>
                      <p className="font-semibold text-rose-600">{meal.proteinG || "—"} g</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Carbs:</span>
                      <p className="font-semibold text-sky-600">{meal.carbsG || "—"} g</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Fats:</span>
                      <p className="font-semibold text-amber-600">{meal.fatsG || "—"} g</p>
                    </div>
                  </div>

                  {meal.tags && meal.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {meal.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Separator />

          {/* Today's Totals */}
          <div className="space-y-4 pt-2">
            <h3 className="font-semibold text-lg">Today's Totals</h3>

            <div className="space-y-3">
              {/* Calories */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Calories</span>
                  <span className="font-semibold">
                    {totals.calories.toFixed(0)} / {goals.calories} kcal
                  </span>
                </div>
                <Progress
                  value={Math.min((totals.calories / goals.calories) * 100, 100)}
                  className={`h-2 ${getProgressColor(totals.calories, goals.calories)}`}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {((totals.calories / goals.calories) * 100).toFixed(0)}% of goal
                </p>
              </div>

              {/* Protein */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-rose-700">Protein</span>
                  <span className="font-semibold text-rose-700">
                    {totals.protein.toFixed(1)} / {goals.protein} g
                  </span>
                </div>
                <Progress
                  value={Math.min((totals.protein / goals.protein) * 100, 100)}
                  className={`h-2 ${getProgressColor(totals.protein, goals.protein)}`}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {((totals.protein / goals.protein) * 100).toFixed(0)}% of goal
                </p>
              </div>

              {/* Carbs */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-sky-700">Carbs</span>
                  <span className="font-semibold text-sky-700">
                    {totals.carbs.toFixed(1)} / {goals.carbs} g
                  </span>
                </div>
                <Progress
                  value={Math.min((totals.carbs / goals.carbs) * 100, 100)}
                  className={`h-2 ${getProgressColor(totals.carbs, goals.carbs)}`}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {((totals.carbs / goals.carbs) * 100).toFixed(0)}% of goal
                </p>
              </div>

              {/* Fats */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-amber-700">Fats</span>
                  <span className="font-semibold text-amber-700">
                    {totals.fats.toFixed(1)} / {goals.fats} g
                  </span>
                </div>
                <Progress
                  value={Math.min((totals.fats / goals.fats) * 100, 100)}
                  className={`h-2 ${getProgressColor(totals.fats, goals.fats)}`}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {((totals.fats / goals.fats) * 100).toFixed(0)}% of goal
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <EditMealModal
        open={!!selectedMealForEdit}
        onOpenChange={(open) => !open && setSelectedMealForEdit(null)}
        meal={selectedMealForEdit}
      />

      <MealDetailModal
        open={!!selectedMealForView}
        onOpenChange={(open) => !open && setSelectedMealForView(null)}
        meal={selectedMealForView}
        onEdit={handleEditFromDetail}
      />
    </>
  );
}
