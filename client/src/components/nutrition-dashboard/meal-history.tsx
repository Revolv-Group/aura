import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Search, Filter, Eye, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import EditMealModal from "./edit-meal-modal";
import MealDetailModal from "./meal-detail-modal";

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

interface MealHistoryProps {
  meals: NutritionEntry[];
}

const ITEMS_PER_PAGE = 20;

const MEAL_TYPE_COLORS = {
  breakfast: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
  lunch: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700",
  dinner: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700",
  snack: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-700",
};

export default function MealHistory({ meals }: MealHistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [mealTypeFilter, setMealTypeFilter] = useState("all");
  const [contextFilter, setContextFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "calories" | "protein">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMealForEdit, setSelectedMealForEdit] = useState<NutritionEntry | null>(null);
  const [selectedMealForView, setSelectedMealForView] = useState<NutritionEntry | null>(null);

  // Get unique tags from all meals
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    meals.forEach((meal) => {
      meal.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [meals]);

  // Filter and sort meals
  const filteredAndSortedMeals = useMemo(() => {
    let filtered = meals;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((meal) => meal.description.toLowerCase().includes(query));
    }

    // Apply meal type filter
    if (mealTypeFilter !== "all") {
      filtered = filtered.filter((meal) => meal.mealType === mealTypeFilter);
    }

    // Apply context filter
    if (contextFilter !== "all") {
      filtered = filtered.filter((meal) => meal.context === contextFilter);
    }

    // Apply tag filter
    if (tagFilter !== "all") {
      filtered = filtered.filter((meal) => meal.tags?.includes(tagFilter));
    }

    // Sort meals
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "date":
          comparison = new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
          break;
        case "calories":
          comparison = (a.calories || 0) - (b.calories || 0);
          break;
        case "protein":
          comparison = (a.proteinG || 0) - (b.proteinG || 0);
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [meals, searchQuery, mealTypeFilter, contextFilter, tagFilter, sortBy, sortOrder]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedMeals.length / ITEMS_PER_PAGE);
  const paginatedMeals = filteredAndSortedMeals.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleEditFromDetail = () => {
    setSelectedMealForEdit(selectedMealForView);
    setSelectedMealForView(null);
  };

  const resetFilters = () => {
    setSearchQuery("");
    setMealTypeFilter("all");
    setContextFilter("all");
    setTagFilter("all");
    setCurrentPage(1);
  };

  if (meals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Meal History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">No meal history yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Meal History
            </CardTitle>
            <Badge variant="secondary">{filteredAndSortedMeals.length} meals</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search meals by description..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="flex-1"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Select
                value={mealTypeFilter}
                onValueChange={(value) => {
                  setMealTypeFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Meal Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="breakfast">Breakfast</SelectItem>
                  <SelectItem value="lunch">Lunch</SelectItem>
                  <SelectItem value="dinner">Dinner</SelectItem>
                  <SelectItem value="snack">Snack</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={contextFilter}
                onValueChange={(value) => {
                  setContextFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Context" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Contexts</SelectItem>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="restaurant">Restaurant</SelectItem>
                  <SelectItem value="office">Office</SelectItem>
                  <SelectItem value="travel">Travel</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={tagFilter}
                onValueChange={(value) => {
                  setTagFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tags</SelectItem>
                  {allTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={`${sortBy}-${sortOrder}`}
                onValueChange={(value) => {
                  const [newSortBy, newSortOrder] = value.split("-") as [typeof sortBy, typeof sortOrder];
                  setSortBy(newSortBy);
                  setSortOrder(newSortOrder);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Newest First</SelectItem>
                  <SelectItem value="date-asc">Oldest First</SelectItem>
                  <SelectItem value="calories-desc">Highest Calories</SelectItem>
                  <SelectItem value="calories-asc">Lowest Calories</SelectItem>
                  <SelectItem value="protein-desc">Highest Protein</SelectItem>
                  <SelectItem value="protein-asc">Lowest Protein</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(searchQuery || mealTypeFilter !== "all" || contextFilter !== "all" || tagFilter !== "all") && (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                <Filter className="h-4 w-4 mr-2" />
                Reset Filters
              </Button>
            )}
          </div>

          {/* Meal Table */}
          {paginatedMeals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No meals found matching your filters</p>
          ) : (
            <>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3 font-medium">Date & Time</th>
                      <th className="text-left p-3 font-medium">Type</th>
                      <th className="text-left p-3 font-medium">Description</th>
                      <th className="text-right p-3 font-medium">Calories</th>
                      <th className="text-right p-3 font-medium hidden md:table-cell">Protein</th>
                      <th className="text-right p-3 font-medium hidden lg:table-cell">Carbs</th>
                      <th className="text-right p-3 font-medium hidden lg:table-cell">Fats</th>
                      <th className="text-center p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMeals.map((meal) => (
                      <tr key={meal.id} className="border-t hover:bg-muted/50">
                        <td className="p-3 whitespace-nowrap">
                          {format(new Date(meal.datetime), "MMM d, h:mm a")}
                        </td>
                        <td className="p-3">
                          <Badge
                            className={`${MEAL_TYPE_COLORS[meal.mealType as keyof typeof MEAL_TYPE_COLORS] || ""} capitalize text-xs`}
                            variant="outline"
                          >
                            {meal.mealType}
                          </Badge>
                        </td>
                        <td className="p-3 max-w-xs truncate">{meal.description}</td>
                        <td className="text-right p-3 font-semibold">{meal.calories || "—"}</td>
                        <td className="text-right p-3 font-semibold text-rose-600 hidden md:table-cell">
                          {meal.proteinG?.toFixed(1) || "—"}g
                        </td>
                        <td className="text-right p-3 font-semibold text-sky-600 hidden lg:table-cell">
                          {meal.carbsG?.toFixed(1) || "—"}g
                        </td>
                        <td className="text-right p-3 font-semibold text-amber-600 hidden lg:table-cell">
                          {meal.fatsG?.toFixed(1) || "—"}g
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
                    {Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSortedMeals.length)} of{" "}
                    {filteredAndSortedMeals.length} meals
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
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
