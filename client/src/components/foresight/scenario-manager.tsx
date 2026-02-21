/**
 * Scenario Manager - CRUD operations for venture scenarios
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
import { Plus, Edit, Trash2, Target, Clock, TrendingUp, AlertTriangle } from "lucide-react";
import { InteractiveScenarioMatrix } from "./scenario-matrix";

interface Scenario {
  id: string;
  ventureId: string;
  title: string;
  description: string | null;
  timeHorizon: string | null;
  probability: string | null;
  impact: string | null;
  quadrant: string | null;
  uncertaintyAxis1: string | null;
  uncertaintyAxis2: string | null;
  keyAssumptions: string[];
  opportunities: string[];
  threats: string[];
  strategicResponses: { action: string; priority: string; timeline?: string; owner?: string }[];
  status: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ScenarioManagerProps {
  ventureId: string;
}

const TIME_HORIZONS = [
  { value: "1_year", label: "1 Year" },
  { value: "3_year", label: "3 Years" },
  { value: "5_year", label: "5 Years" },
  { value: "10_year", label: "10 Years" },
];

const PROBABILITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const IMPACTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const QUADRANTS = [
  { value: "growth", label: "Growth", description: "High opportunity, favorable conditions" },
  { value: "transformation", label: "Transformation", description: "Change required, favorable conditions" },
  { value: "constraint", label: "Constraint", description: "Limited options, challenging conditions" },
  { value: "collapse", label: "Collapse", description: "Risk scenario, unfavorable conditions" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export function ScenarioManager({ ventureId }: ScenarioManagerProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [viewMode, setViewMode] = useState<"matrix" | "list">("matrix");

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    timeHorizon: "3_year",
    probability: "medium",
    impact: "medium",
    quadrant: "",
    uncertaintyAxis1: "",
    uncertaintyAxis2: "",
    status: "draft",
  });

  const { data: scenarios = [], isLoading } = useQuery<Scenario[]>({
    queryKey: [`/api/ventures/${ventureId}/foresight/scenarios`],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/foresight/scenarios`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch scenarios");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", `/api/ventures/${ventureId}/foresight/scenarios`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/scenarios`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/summary`] });
      toast({ title: "Scenario created successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to create scenario", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/ventures/${ventureId}/foresight/scenarios/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/scenarios`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/summary`] });
      toast({ title: "Scenario updated successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to update scenario", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ventures/${ventureId}/foresight/scenarios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/scenarios`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/foresight/summary`] });
      toast({ title: "Scenario deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete scenario", variant: "destructive" });
    },
  });

  const handleOpenDialog = (scenario?: Scenario) => {
    if (scenario) {
      setEditingScenario(scenario);
      setFormData({
        title: scenario.title,
        description: scenario.description || "",
        timeHorizon: scenario.timeHorizon || "3_year",
        probability: scenario.probability || "medium",
        impact: scenario.impact || "medium",
        quadrant: scenario.quadrant || "",
        uncertaintyAxis1: scenario.uncertaintyAxis1 || "",
        uncertaintyAxis2: scenario.uncertaintyAxis2 || "",
        status: scenario.status || "draft",
      });
    } else {
      setEditingScenario(null);
      setFormData({
        title: "",
        description: "",
        timeHorizon: "3_year",
        probability: "medium",
        impact: "medium",
        quadrant: "",
        uncertaintyAxis1: "",
        uncertaintyAxis2: "",
        status: "draft",
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingScenario(null);
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) {
      toast({ title: "Please enter a scenario title", variant: "destructive" });
      return;
    }

    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const getQuadrantBadgeColor = (quadrant: string | null) => {
    switch (quadrant) {
      case "growth": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "transformation": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "constraint": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "collapse": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Strategic Scenarios</h3>
          <p className="text-sm text-muted-foreground">
            {scenarios.length} scenario{scenarios.length !== 1 ? "s" : ""} defined
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "matrix" | "list")}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="matrix">Matrix View</SelectItem>
              <SelectItem value="list">List View</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Scenario
          </Button>
        </div>
      </div>

      {/* Matrix or List View */}
      {viewMode === "matrix" ? (
        <Card>
          <CardContent className="pt-6">
            <InteractiveScenarioMatrix
              scenarios={scenarios}
              onScenarioClick={(id) => {
                const scenario = scenarios.find((s) => s.id === id);
                if (scenario) handleOpenDialog(scenario);
              }}
              onQuadrantClick={(quadrant) => {
                setFormData((prev) => ({ ...prev, quadrant }));
                handleOpenDialog();
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {scenarios.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">No scenarios created yet</p>
                <Button variant="ghost" onClick={() => handleOpenDialog()}>
                  Create your first scenario
                </Button>
              </CardContent>
            </Card>
          ) : (
            scenarios.map((scenario) => (
              <Card key={scenario.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{scenario.title}</CardTitle>
                      <CardDescription className="mt-1">
                        {scenario.description || "No description"}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(scenario)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this scenario?")) {
                            deleteMutation.mutate(scenario.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {scenario.quadrant && (
                      <Badge className={getQuadrantBadgeColor(scenario.quadrant)}>
                        {QUADRANTS.find((q) => q.value === scenario.quadrant)?.label || scenario.quadrant}
                      </Badge>
                    )}
                    {scenario.timeHorizon && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {TIME_HORIZONS.find((t) => t.value === scenario.timeHorizon)?.label}
                      </Badge>
                    )}
                    {scenario.probability && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        P: {scenario.probability}
                      </Badge>
                    )}
                    {scenario.impact && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        I: {scenario.impact}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingScenario ? "Edit Scenario" : "Create Scenario"}
            </DialogTitle>
            <DialogDescription>
              Define a future scenario for strategic planning
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., AI Disruption Scenario"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Describe this future scenario..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Time Horizon</Label>
                <Select
                  value={formData.timeHorizon}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, timeHorizon: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_HORIZONS.map((h) => (
                      <SelectItem key={h.value} value={h.value}>
                        {h.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Quadrant</Label>
                <Select
                  value={formData.quadrant}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, quadrant: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select quadrant" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUADRANTS.map((q) => (
                      <SelectItem key={q.value} value={q.value}>
                        {q.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Probability</Label>
                <Select
                  value={formData.probability}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, probability: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROBABILITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Impact</Label>
                <Select
                  value={formData.impact}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, impact: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPACTS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="axis1">Uncertainty Dimension 1</Label>
                <Input
                  id="axis1"
                  value={formData.uncertaintyAxis1}
                  onChange={(e) => setFormData((prev) => ({ ...prev, uncertaintyAxis1: e.target.value }))}
                  placeholder="e.g., Technology adoption"
                />
              </div>
              <div>
                <Label htmlFor="axis2">Uncertainty Dimension 2</Label>
                <Input
                  id="axis2"
                  value={formData.uncertaintyAxis2}
                  onChange={(e) => setFormData((prev) => ({ ...prev, uncertaintyAxis2: e.target.value }))}
                  placeholder="e.g., Regulation intensity"
                />
              </div>
            </div>

            <div>
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              {editingScenario ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
