import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, Trash2, Home, Building2, BriefcaseBusiness, Plane } from "lucide-react";
import { useState } from "react";

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

interface MealDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meal: NutritionEntry | null;
  onEdit: () => void;
}

const CONTEXT_ICONS = {
  home: Home,
  restaurant: Building2,
  office: BriefcaseBusiness,
  travel: Plane,
};

const MEAL_TYPE_COLORS = {
  breakfast: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
  lunch: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700",
  dinner: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700",
  snack: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-700",
};

export default function MealDetailModal({ open, onOpenChange, meal, onEdit }: MealDetailModalProps) {
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteMealMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/nutrition/${meal?.id}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nutrition"] });
      setShowDeleteDialog(false);
      onOpenChange(false);
      toast({
        title: "Success",
        description: "Meal deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete meal",
        variant: "destructive",
      });
    },
  });

  if (!meal) return null;

  const mealDate = new Date(meal.datetime);
  const ContextIcon = meal.context ? CONTEXT_ICONS[meal.context as keyof typeof CONTEXT_ICONS] : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Meal Details</DialogTitle>
            <DialogDescription className="sr-only">View meal information and nutrition data</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Meal Type Badge */}
            <div className="flex items-center gap-2">
              <Badge
                className={`${MEAL_TYPE_COLORS[meal.mealType as keyof typeof MEAL_TYPE_COLORS] || ""} capitalize`}
                variant="outline"
              >
                {meal.mealType}
              </Badge>
              {meal.context && ContextIcon && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <ContextIcon className="h-3 w-3" />
                  <span className="capitalize">{meal.context}</span>
                </Badge>
              )}
            </div>

            {/* Date & Time */}
            <div>
              <p className="text-sm font-medium text-muted-foreground">Date & Time</p>
              <p className="text-lg font-semibold">{format(mealDate, "MMMM d, yyyy 'at' h:mm a")}</p>
            </div>

            <Separator />

            {/* Description */}
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-base">{meal.description}</p>
            </div>

            <Separator />

            {/* Macros */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-3">Nutrition Information</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Calories</p>
                  <p className="text-xl font-bold">{meal.calories ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">kcal</p>
                </div>
                <div className="bg-rose-50 dark:bg-rose-950/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Protein</p>
                  <p className="text-xl font-bold text-rose-700 dark:text-rose-400">{meal.proteinG ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">grams</p>
                </div>
                <div className="bg-sky-50 dark:bg-sky-950/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Carbs</p>
                  <p className="text-xl font-bold text-sky-700 dark:text-sky-400">{meal.carbsG ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">grams</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">Fats</p>
                  <p className="text-xl font-bold text-amber-700 dark:text-amber-400">{meal.fatsG ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">grams</p>
                </div>
              </div>
            </div>

            {/* Tags */}
            {meal.tags && meal.tags.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {meal.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Notes */}
            {meal.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Notes</p>
                  <p className="text-sm">{meal.notes}</p>
                </div>
              </>
            )}

            <Separator />

            {/* Logged At */}
            <div>
              <p className="text-xs text-muted-foreground">
                Logged on {format(new Date(meal.createdAt), "MMMM d, yyyy 'at' h:mm a")}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button onClick={onEdit} variant="default" className="flex-1">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button onClick={() => setShowDeleteDialog(true)} variant="destructive" className="flex-1">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Meal?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this meal entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMealMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMealMutation.mutate()}
              disabled={deleteMealMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMealMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
