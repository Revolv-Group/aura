import { format, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, TrendingUp } from "lucide-react";

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
}

interface WeeklySummaryProps {
  meals: NutritionEntry[];
}

export default function WeeklySummary({ meals }: WeeklySummaryProps) {
  // Group meals by date
  const groupedByDate = meals.reduce((acc, meal) => {
    const date = format(new Date(meal.datetime), "yyyy-MM-dd");
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(meal);
    return acc;
  }, {} as Record<string, NutritionEntry[]>);

  // Calculate daily totals for each day
  const dailyData = Object.entries(groupedByDate).map(([date, dayMeals]) => {
    const calories = dayMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
    const protein = dayMeals.reduce((sum, m) => sum + (m.proteinG || 0), 0);
    const carbs = dayMeals.reduce((sum, m) => sum + (m.carbsG || 0), 0);
    const fats = dayMeals.reduce((sum, m) => sum + (m.fatsG || 0), 0);

    // Count tags
    const allTags = dayMeals.flatMap((m) => m.tags || []);
    const tagCounts = allTags.reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Most common context
    const contexts = dayMeals.map((m) => m.context).filter(Boolean);
    const contextCounts = contexts.reduce((acc, ctx) => {
      if (ctx) acc[ctx] = (acc[ctx] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostCommonContext = Object.entries(contextCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      date,
      calories,
      protein,
      carbs,
      fats,
      mealCount: dayMeals.length,
      avgCaloriesPerMeal: dayMeals.length > 0 ? calories / dayMeals.length : 0,
      tagCounts,
      mostCommonContext,
    };
  }).sort((a, b) => b.date.localeCompare(a.date)); // Sort by date descending

  // Calculate overall averages
  const avgCalories = dailyData.length > 0 ? dailyData.reduce((sum, d) => sum + d.calories, 0) / dailyData.length : 0;
  const avgProtein = dailyData.length > 0 ? dailyData.reduce((sum, d) => sum + d.protein, 0) / dailyData.length : 0;
  const avgCarbs = dailyData.length > 0 ? dailyData.reduce((sum, d) => sum + d.carbs, 0) / dailyData.length : 0;
  const avgFats = dailyData.length > 0 ? dailyData.reduce((sum, d) => sum + d.fats, 0) / dailyData.length : 0;

  // Most common tags across all meals
  const allTags = meals.flatMap((m) => m.tags || []);
  const overallTagCounts = allTags.reduce((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topTags = Object.entries(overallTagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Most common context
  const allContexts = meals.map((m) => m.context).filter(Boolean);
  const overallContextCounts = allContexts.reduce((acc, ctx) => {
    if (ctx) acc[ctx] = (acc[ctx] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const mostCommonContext = Object.entries(overallContextCounts).sort((a, b) => b[1] - a[1])[0];

  if (meals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Weekly Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">No nutrition data for this period</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Weekly Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Avg Calories</p>
            <p className="text-2xl font-bold">{avgCalories.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">kcal/day</p>
          </div>
          <div className="bg-rose-50 dark:bg-rose-950/30 rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Avg Protein</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{avgProtein.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">g/day</p>
          </div>
          <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Avg Carbs</p>
            <p className="text-2xl font-bold text-sky-600 dark:text-sky-400">{avgCarbs.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">g/day</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-1">Avg Fats</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{avgFats.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">g/day</p>
          </div>
        </div>

        {/* Insights */}
        <div className="space-y-3">
          <h3 className="font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Insights
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            {mostCommonContext && (
              <div className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Most Common Context</p>
                <p className="font-semibold capitalize">
                  {mostCommonContext[0]} ({mostCommonContext[1]} meals)
                </p>
              </div>
            )}
            {topTags.length > 0 && (
              <div className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Top Tags</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {topTags.map(([tag, count]) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag.replace(/_/g, " ")} ({count})
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Daily Breakdown Table */}
        <div className="space-y-2">
          <h3 className="font-semibold">Daily Breakdown</h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2 font-medium">Date</th>
                  <th className="text-right p-2 font-medium">Meals</th>
                  <th className="text-right p-2 font-medium">Calories</th>
                  <th className="text-right p-2 font-medium">Protein</th>
                  <th className="text-right p-2 font-medium hidden md:table-cell">Carbs</th>
                  <th className="text-right p-2 font-medium hidden md:table-cell">Fats</th>
                </tr>
              </thead>
              <tbody>
                {dailyData.map((day) => (
                  <tr key={day.date} className="border-t hover:bg-muted/50">
                    <td className="p-2 font-medium">{format(new Date(day.date), "MMM d, yyyy")}</td>
                    <td className="text-right p-2">{day.mealCount}</td>
                    <td className="text-right p-2 font-semibold">{day.calories.toFixed(0)}</td>
                    <td className="text-right p-2 font-semibold text-rose-600">{day.protein.toFixed(1)}g</td>
                    <td className="text-right p-2 font-semibold text-sky-600 hidden md:table-cell">{day.carbs.toFixed(1)}g</td>
                    <td className="text-right p-2 font-semibold text-amber-600 hidden md:table-cell">{day.fats.toFixed(1)}g</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
