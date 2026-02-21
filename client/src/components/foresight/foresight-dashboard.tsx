/**
 * Foresight Dashboard - Overview of strategic foresight data
 * Shows scenario matrix, indicator status, recent signals, and what-if questions
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Target,
  AlertTriangle,
  TrendingUp,
  HelpCircle,
  Plus,
  ChevronRight,
  CircleDot
} from "lucide-react";
import { ScenarioMatrix } from "./scenario-matrix";

interface ForesightDashboardProps {
  ventureId: string;
  onNavigateToScenarios?: () => void;
  onNavigateToIndicators?: () => void;
  onNavigateToSignals?: () => void;
  onNavigateToWhatIfs?: () => void;
}

interface ForesightSummary {
  scenarioCount: number;
  scenariosByQuadrant: Record<string, number>;
  indicatorsByStatus: { green: number; yellow: number; red: number };
  recentSignals: {
    id: string;
    title: string;
    category: string | null;
    signalStrength: string | null;
    createdAt: string;
  }[];
  unexploredQuestions: number;
}

export function ForesightDashboard({
  ventureId,
  onNavigateToScenarios,
  onNavigateToIndicators,
  onNavigateToSignals,
  onNavigateToWhatIfs
}: ForesightDashboardProps) {
  const { data: summary, isLoading } = useQuery<ForesightSummary>({
    queryKey: [`/api/ventures/${ventureId}/foresight/summary`],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/foresight/summary`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch foresight summary");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  const totalIndicators = summary
    ? summary.indicatorsByStatus.green + summary.indicatorsByStatus.yellow + summary.indicatorsByStatus.red
    : 0;

  return (
    <div className="space-y-6">
      {/* Top Row: Scenario Matrix + Indicator Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scenario Matrix */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Scenario Matrix
              </CardTitle>
              <CardDescription>
                {summary?.scenarioCount || 0} scenarios mapped
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onNavigateToScenarios}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <ScenarioMatrix
              scenariosByQuadrant={summary?.scenariosByQuadrant || {}}
              onQuadrantClick={onNavigateToScenarios}
            />
          </CardContent>
        </Card>

        {/* Early Warning Indicators */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Early Warning Status
              </CardTitle>
              <CardDescription>
                {totalIndicators} indicators tracked
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onNavigateToIndicators}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {totalIndicators === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No indicators set up yet</p>
                <Button variant="ghost" size="sm" onClick={onNavigateToIndicators}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add indicators
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Traffic Light Summary */}
                <div className="flex justify-center gap-8 py-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto mb-2">
                      <CircleDot className="h-8 w-8 text-green-600" />
                    </div>
                    <div className="text-2xl font-bold text-green-600">
                      {summary?.indicatorsByStatus.green || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Green</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900/30 mx-auto mb-2">
                      <CircleDot className="h-8 w-8 text-yellow-600" />
                    </div>
                    <div className="text-2xl font-bold text-yellow-600">
                      {summary?.indicatorsByStatus.yellow || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Yellow</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mx-auto mb-2">
                      <CircleDot className="h-8 w-8 text-red-600" />
                    </div>
                    <div className="text-2xl font-bold text-red-600">
                      {summary?.indicatorsByStatus.red || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Red</div>
                  </div>
                </div>

                {/* Alert if any red indicators */}
                {(summary?.indicatorsByStatus.red || 0) > 0 && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-sm font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      {summary?.indicatorsByStatus.red} indicator{summary?.indicatorsByStatus.red !== 1 ? 's' : ''} require attention
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Recent Signals + What-If Questions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Signals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Recent Signals
              </CardTitle>
              <CardDescription>
                Emerging trends and weak signals
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onNavigateToSignals}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {!summary?.recentSignals?.length ? (
              <div className="text-center py-6 text-muted-foreground">
                <TrendingUp className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No signals recorded yet</p>
                <Button variant="ghost" size="sm" onClick={onNavigateToSignals}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add signal
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {summary.recentSignals.slice(0, 4).map((signal) => (
                  <div
                    key={signal.id}
                    className="flex items-start justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                    onClick={onNavigateToSignals}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{signal.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {signal.category && (
                          <Badge variant="outline" className="text-xs">
                            {signal.category}
                          </Badge>
                        )}
                        {signal.signalStrength && (
                          <Badge
                            variant="secondary"
                            className={`text-xs ${
                              signal.signalStrength === 'weak' ? 'bg-gray-100 dark:bg-gray-800' :
                              signal.signalStrength === 'emerging' ? 'bg-blue-100 dark:bg-blue-900/30' :
                              signal.signalStrength === 'strong' ? 'bg-orange-100 dark:bg-orange-900/30' :
                              'bg-purple-100 dark:bg-purple-900/30'
                            }`}
                          >
                            {signal.signalStrength}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground ml-2">
                      {new Date(signal.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* What-If Questions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                What-If Questions
              </CardTitle>
              <CardDescription>
                {summary?.unexploredQuestions || 0} unexplored questions
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onNavigateToWhatIfs}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {(summary?.unexploredQuestions || 0) === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <HelpCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No unexplored questions</p>
                <Button variant="ghost" size="sm" onClick={onNavigateToWhatIfs}>
                  <Plus className="h-3 w-3 mr-1" />
                  Generate questions
                </Button>
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="text-4xl font-bold text-primary mb-2">
                  {summary?.unexploredQuestions}
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  strategic questions to explore
                </p>
                <Button variant="outline" size="sm" onClick={onNavigateToWhatIfs}>
                  View Questions
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
