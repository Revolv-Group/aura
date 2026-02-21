/**
 * Indicator List - Early warning indicators management
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, AlertTriangle, CheckCircle2, AlertCircle, CircleDot } from "lucide-react";

interface Indicator {
  id: string;
  scenarioId: string | null;
  ventureId: string;
  title: string;
  description: string | null;
  category: string | null;
  threshold: string | null;
  currentStatus: string | null;
  lastChecked: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IndicatorListProps {
  ventureId: string;
}

const CATEGORIES = [
  { value: "political", label: "Political" },
  { value: "economic", label: "Economic" },
  { value: "social", label: "Social" },
  { value: "technological", label: "Technological" },
  { value: "legal", label: "Legal" },
  { value: "environmental", label: "Environmental" },
];

const STATUSES = [
  { value: "green", label: "Green", icon: CheckCircle2, color: "text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400" },
  { value: "yellow", label: "Yellow", icon: AlertCircle, color: "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { value: "red", label: "Red", icon: AlertTriangle, color: "text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400" },
];

export function IndicatorList({ ventureId }: IndicatorListProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIndicator, setEditingIndicator] = useState<Indicator | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    threshold: "",
    currentStatus: "green",
    notes: "",
  });

  const { data: indicators = [], isLoading } = useQuery<Indicator[]>({
    queryKey: [`/api/ventures/${ventureId}/foresight/indicators`],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/foresight/indicators`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch indicators");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", `/api/ventures/${ventureId}/foresight/indicators`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/indicators`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/summary`] });
      toast({ title: "Indicator created successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to create indicator", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/ventures/${ventureId}/foresight/indicators/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/indicators`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/summary`] });
      toast({ title: "Indicator updated successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to update indicator", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ventures/${ventureId}/foresight/indicators/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/indicators`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/summary`] });
      toast({ title: "Indicator deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete indicator", variant: "destructive" });
    },
  });

  const handleOpenDialog = (indicator?: Indicator) => {
    if (indicator) {
      setEditingIndicator(indicator);
      setFormData({
        title: indicator.title,
        description: indicator.description || "",
        category: indicator.category || "",
        threshold: indicator.threshold || "",
        currentStatus: indicator.currentStatus || "green",
        notes: indicator.notes || "",
      });
    } else {
      setEditingIndicator(null);
      setFormData({
        title: "",
        description: "",
        category: "",
        threshold: "",
        currentStatus: "green",
        notes: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingIndicator(null);
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) {
      toast({ title: "Please enter an indicator title", variant: "destructive" });
      return;
    }

    if (editingIndicator) {
      updateMutation.mutate({ id: editingIndicator.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const getStatusIcon = (status: string | null) => {
    const statusConfig = STATUSES.find((s) => s.value === status);
    if (!statusConfig) return <CircleDot className="h-4 w-4" />;
    const Icon = statusConfig.icon;
    return <Icon className="h-4 w-4" />;
  };

  const getStatusColor = (status: string | null) => {
    const statusConfig = STATUSES.find((s) => s.value === status);
    return statusConfig?.color || "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400";
  };

  const filteredIndicators = filterStatus === "all"
    ? indicators
    : indicators.filter((i) => i.currentStatus === filterStatus);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Early Warning Indicators</h3>
          <p className="text-sm text-muted-foreground">
            {indicators.length} indicator{indicators.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Indicator
          </Button>
        </div>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-3 gap-4">
        {STATUSES.map((status) => {
          const count = indicators.filter((i) => i.currentStatus === status.value).length;
          const Icon = status.icon;
          return (
            <Card
              key={status.value}
              className={`cursor-pointer transition-all ${filterStatus === status.value ? "ring-2 ring-primary" : ""}`}
              onClick={() => setFilterStatus(filterStatus === status.value ? "all" : status.value)}
            >
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-full ${status.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-sm text-muted-foreground">{status.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Indicators List */}
      <div className="space-y-3">
        {filteredIndicators.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">
                {filterStatus === "all"
                  ? "No indicators created yet"
                  : `No ${filterStatus} indicators`}
              </p>
              {filterStatus === "all" && (
                <Button variant="ghost" onClick={() => handleOpenDialog()}>
                  Create your first indicator
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredIndicators.map((indicator) => (
            <Card key={indicator.id}>
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-full ${getStatusColor(indicator.currentStatus)}`}>
                    {getStatusIcon(indicator.currentStatus)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{indicator.title}</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {indicator.description || "No description"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(indicator)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Delete this indicator?")) {
                              deleteMutation.mutate(indicator.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {indicator.category && (
                        <Badge variant="outline">
                          {CATEGORIES.find((c) => c.value === indicator.category)?.label || indicator.category}
                        </Badge>
                      )}
                      {indicator.threshold && (
                        <Badge variant="secondary" className="text-xs">
                          Threshold: {indicator.threshold}
                        </Badge>
                      )}
                      {indicator.lastChecked && (
                        <span className="text-xs text-muted-foreground">
                          Last checked: {new Date(indicator.lastChecked).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {indicator.notes && (
                      <p className="text-xs text-muted-foreground mt-2 italic">
                        {indicator.notes}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingIndicator ? "Edit Indicator" : "Add Indicator"}
            </DialogTitle>
            <DialogDescription>
              Define an early warning signal to monitor
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., Competitor market share growth"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="What to watch for..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, category: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Current Status</Label>
                <Select
                  value={formData.currentStatus}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, currentStatus: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="threshold">Trigger Threshold</Label>
              <Input
                id="threshold"
                value={formData.threshold}
                onChange={(e) => setFormData((prev) => ({ ...prev, threshold: e.target.value }))}
                placeholder="e.g., When market share exceeds 30%"
              />
            </div>

            <div>
              <Label htmlFor="notes">Current Observations</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Notes on current status..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingIndicator ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
