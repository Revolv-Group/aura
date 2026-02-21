import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  Plus,
  Users,
  Edit,
  Trash2,
  Phone,
  Mail,
  Building2,
  Calendar,
  Clock,
  AlertCircle,
  RefreshCw,
  UserPlus,
  Search,
  Filter,
  Star,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

interface Person {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  birthday: string | null;
  location: string | null;
  photoUrl: string | null;
  linkedIn: string | null;
  notes: string | null;
  relationship: string | null;
  importance: "inner_circle" | "key" | "standard";
  ventureId: string | null;
  howWeMet: string | null;
  introducedBy: string | null;
  lastContactDate: string | null;
  nextFollowUp: string | null;
  contactFrequency: string | null;
  googleContactId: string | null;
  needsEnrichment: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface GoogleContactsStatus {
  configured: boolean;
  connected: boolean;
  syncLabelName?: string;
  syncLabelFound?: boolean;
  syncLabelMemberCount?: number;
  error?: string;
}

interface ContactsApiStatus {
  configured: boolean;
  connected: boolean;
  contactCount?: number;
  error?: string;
}

const relationshipConfig: Record<string, { label: string; color: string }> = {
  family: { label: "Family", color: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200" },
  friend: { label: "Friend", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  mentor: { label: "Mentor", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  mentee: { label: "Mentee", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
  investor: { label: "Investor", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  client: { label: "Client", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
  partner: { label: "Partner", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200" },
  colleague: { label: "Colleague", color: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200" },
  acquaintance: { label: "Acquaintance", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" },
  service_provider: { label: "Service Provider", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
};

const importanceConfig: Record<string, { label: string; color: string; icon: typeof Star }> = {
  inner_circle: { label: "Inner Circle", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: Star },
  key: { label: "Key", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: Star },
  standard: { label: "Standard", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200", icon: Star },
};

const frequencyConfig: Record<string, { label: string; days: number }> = {
  weekly: { label: "Weekly", days: 7 },
  biweekly: { label: "Bi-weekly", days: 14 },
  monthly: { label: "Monthly", days: 30 },
  quarterly: { label: "Quarterly", days: 90 },
  yearly: { label: "Yearly", days: 365 },
  as_needed: { label: "As Needed", days: 0 },
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function PeoplePage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [relationshipFilter, setRelationshipFilter] = useState<string>("all");
  const [importanceFilter, setImportanceFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  const [isSyncingApi, setIsSyncingApi] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    jobTitle: "",
    relationship: "" as string,
    importance: "standard" as "inner_circle" | "key" | "standard",
    howWeMet: "",
    contactFrequency: "as_needed",
    nextFollowUp: "",
    notes: "",
  });

  // Queries
  const { data: people = [], isLoading } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: stalePeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people/stale"],
  });

  const { data: upcomingFollowUps = [] } = useQuery<Person[]>({
    queryKey: ["/api/people/upcoming"],
  });

  const { data: googleStatus } = useQuery<GoogleContactsStatus>({
    queryKey: ["/api/people/google-contacts/status"],
  });

  const { data: contactsApiStatus } = useQuery<ContactsApiStatus>({
    queryKey: ["/api/people/contacts-api/status"],
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/people", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({ title: "Person added", description: "Contact has been added to your CRM." });
      closeModal();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Person> }) => {
      return apiRequest("PATCH", `/api/people/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/stale"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/upcoming"] });
      toast({ title: "Person updated", description: "Contact has been updated." });
      closeModal();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/people/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({ title: "Person deleted", description: "Contact has been removed." });
      setDeleteConfirmId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const logContactMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/people/${id}/contacted`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people/stale"] });
      toast({ title: "Contact logged", description: "Last contact date updated to today." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const syncGoogleContacts = async () => {
    setIsSyncingGoogle(true);
    try {
      const response = await apiRequest("POST", "/api/people/google-contacts/sync", {});
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Google sync complete",
        description: `Synced ${result.synced} new, updated ${result.updated}, skipped ${result.skipped}`,
      });
    } catch (error: any) {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSyncingGoogle(false);
    }
  };

  const syncContactsApi = async () => {
    setIsSyncingApi(true);
    try {
      const response = await apiRequest("POST", "/api/people/contacts-api/sync", {});
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Contacts sync complete",
        description: `Synced ${result.synced} new, updated ${result.updated}, skipped ${result.skipped}`,
      });
    } catch (error: any) {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSyncingApi(false);
    }
  };

  // Filter logic
  const peopleArray = Array.isArray(people) ? people : [];
  const filteredPeople = peopleArray.filter((person) => {
    // Tab filter
    if (activeTab === "needs_enrichment" && !person.needsEnrichment) return false;
    if (activeTab === "stale" && !stalePeople.some((s) => s.id === person.id)) return false;
    if (activeTab === "upcoming" && !upcomingFollowUps.some((u) => u.id === person.id)) return false;

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matches =
        person.name.toLowerCase().includes(query) ||
        person.email?.toLowerCase().includes(query) ||
        person.company?.toLowerCase().includes(query);
      if (!matches) return false;
    }

    // Relationship filter
    if (relationshipFilter !== "all" && person.relationship !== relationshipFilter) return false;

    // Importance filter
    if (importanceFilter !== "all" && person.importance !== importanceFilter) return false;

    return true;
  });

  // Sort: inner_circle first, then key, then by name
  const sortedPeople = [...filteredPeople].sort((a, b) => {
    const importanceOrder = { inner_circle: 0, key: 1, standard: 2 };
    const aOrder = importanceOrder[a.importance] ?? 2;
    const bOrder = importanceOrder[b.importance] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });

  const openModal = (person?: Person) => {
    if (person) {
      setEditingPerson(person);
      setFormData({
        name: person.name,
        email: person.email || "",
        phone: person.phone || "",
        company: person.company || "",
        jobTitle: person.jobTitle || "",
        relationship: person.relationship || "",
        importance: person.importance || "standard",
        howWeMet: person.howWeMet || "",
        contactFrequency: person.contactFrequency || "as_needed",
        nextFollowUp: person.nextFollowUp || "",
        notes: person.notes || "",
      });
    } else {
      setEditingPerson(null);
      setFormData({
        name: "",
        email: "",
        phone: "",
        company: "",
        jobTitle: "",
        relationship: "",
        importance: "standard",
        howWeMet: "",
        contactFrequency: "as_needed",
        nextFollowUp: "",
        notes: "",
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPerson(null);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }

    const submitData = {
      ...formData,
      email: formData.email || null,
      phone: formData.phone || null,
      company: formData.company || null,
      jobTitle: formData.jobTitle || null,
      relationship: formData.relationship || null,
      howWeMet: formData.howWeMet || null,
      nextFollowUp: formData.nextFollowUp || null,
      notes: formData.notes || null,
      needsEnrichment: false,
    };

    if (editingPerson) {
      updateMutation.mutate({ id: editingPerson.id, data: submitData });
    } else {
      createMutation.mutate(submitData as any);
    }
  };

  const needsEnrichmentCount = peopleArray.filter((p) => p.needsEnrichment).length;

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            People
          </h1>
          <p className="text-muted-foreground mt-1">
            {peopleArray.length} contacts
            {stalePeople.length > 0 && (
              <span className="text-orange-600 ml-2">
                ({stalePeople.length} need attention)
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {contactsApiStatus?.configured && (
            <Button
              variant="outline"
              onClick={syncContactsApi}
              disabled={isSyncingApi}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncingApi ? "animate-spin" : ""}`} />
              Sync Contacts
            </Button>
          )}
          {googleStatus?.configured && (
            <Button
              variant="outline"
              onClick={syncGoogleContacts}
              disabled={isSyncingGoogle}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncingGoogle ? "animate-spin" : ""}`} />
              Sync Google
            </Button>
          )}
          <Button onClick={() => openModal()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Person
          </Button>
        </div>
      </div>

      {/* Google Contacts Status Banner */}
      {googleStatus && !googleStatus.configured && (
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800 dark:text-yellow-200">
                  Google Contacts not configured
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  Add Google OAuth credentials to sync contacts from your "SB-OS" label.
                  Go to Settings → Integrations to configure.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="needs_enrichment" className="relative">
            Inbox
            {needsEnrichmentCount > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 min-w-[20px] px-1">
                {needsEnrichmentCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="stale" className="relative">
            Stale
            {stalePeople.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] px-1 bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                {stalePeople.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="upcoming">
            Follow-ups
            {upcomingFollowUps.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 min-w-[20px] px-1">
                {upcomingFollowUps.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Search and Filters */}
        <div className="flex flex-wrap gap-4 mt-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={relationshipFilter} onValueChange={setRelationshipFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Relationship" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(relationshipConfig).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={importanceFilter} onValueChange={setImportanceFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Importance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="inner_circle">Inner Circle</SelectItem>
              <SelectItem value="key">Key</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          {sortedPeople.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <UserPlus className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {activeTab === "needs_enrichment"
                    ? "No contacts to enrich"
                    : activeTab === "stale"
                    ? "No stale relationships"
                    : activeTab === "upcoming"
                    ? "No upcoming follow-ups"
                    : "No contacts found"}
                </h3>
                <p className="text-muted-foreground mb-4 text-center max-w-md">
                  {activeTab === "needs_enrichment"
                    ? "Sync from Google Contacts or add people manually."
                    : activeTab === "stale"
                    ? "All your relationships are up to date!"
                    : activeTab === "upcoming"
                    ? "Set follow-up dates to see them here."
                    : "Add your first contact to get started."}
                </p>
                <Button onClick={() => openModal()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Person
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sortedPeople.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  stalePeople={stalePeople}
                  onEdit={() => openModal(person)}
                  onDelete={() => setDeleteConfirmId(person.id)}
                  onLogContact={() => logContactMutation.mutate(person.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPerson ? "Edit Contact" : "Add Contact"}
            </DialogTitle>
            <DialogDescription>
              {editingPerson
                ? "Update contact details and relationship info."
                : "Add a new contact to your personal CRM."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+1 555 123 4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job Title</Label>
                <Input
                  id="jobTitle"
                  value={formData.jobTitle}
                  onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                  placeholder="CEO"
                />
              </div>
            </div>

            {/* Relationship */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="relationship">Relationship</Label>
                <Select
                  value={formData.relationship}
                  onValueChange={(v) => setFormData({ ...formData, relationship: v })}
                >
                  <SelectTrigger id="relationship">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(relationshipConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="importance">Importance</Label>
                <Select
                  value={formData.importance}
                  onValueChange={(v) =>
                    setFormData({ ...formData, importance: v as typeof formData.importance })
                  }
                >
                  <SelectTrigger id="importance">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inner_circle">Inner Circle (Top 10)</SelectItem>
                    <SelectItem value="key">Key Relationship</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Context */}
            <div className="space-y-2">
              <Label htmlFor="howWeMet">How We Met</Label>
              <Input
                id="howWeMet"
                value={formData.howWeMet}
                onChange={(e) => setFormData({ ...formData, howWeMet: e.target.value })}
                placeholder="YC Demo Day 2024, introduced by..."
              />
            </div>

            {/* Engagement */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contactFrequency">Contact Frequency</Label>
                <Select
                  value={formData.contactFrequency}
                  onValueChange={(v) => setFormData({ ...formData, contactFrequency: v })}
                >
                  <SelectTrigger id="contactFrequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(frequencyConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nextFollowUp">Next Follow-up</Label>
                <Input
                  id="nextFollowUp"
                  type="date"
                  value={formData.nextFollowUp}
                  onChange={(e) => setFormData({ ...formData, nextFollowUp: e.target.value })}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Kids names, interests, what they're working on..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingPerson ? "Save Changes" : "Add Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this person from your CRM. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Person Card Component
function PersonCard({
  person,
  stalePeople,
  onEdit,
  onDelete,
  onLogContact,
}: {
  person: Person;
  stalePeople: Person[];
  onEdit: () => void;
  onDelete: () => void;
  onLogContact: () => void;
}) {
  const isStale = stalePeople.some((s) => s.id === person.id);

  return (
    <Card className={`relative ${person.needsEnrichment ? "border-yellow-400 border-2" : ""} ${isStale ? "border-orange-400" : ""}`}>
      {person.needsEnrichment && (
        <Badge className="absolute -top-2 -right-2 bg-yellow-500">
          New
        </Badge>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={person.photoUrl || undefined} alt={person.name} />
            <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2">
              {person.name}
              {person.importance === "inner_circle" && (
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              )}
              {person.importance === "key" && (
                <Star className="h-4 w-4 text-blue-500" />
              )}
            </CardTitle>
            {(person.jobTitle || person.company) && (
              <CardDescription className="truncate">
                {person.jobTitle}
                {person.jobTitle && person.company && " at "}
                {person.company}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Contact Info */}
        <div className="space-y-1 text-sm">
          {person.email && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              <span className="truncate">{person.email}</span>
            </div>
          )}
          {person.phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              <span>{person.phone}</span>
            </div>
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1">
          {person.relationship && relationshipConfig[person.relationship] && (
            <Badge variant="outline" className={relationshipConfig[person.relationship].color}>
              {relationshipConfig[person.relationship].label}
            </Badge>
          )}
        </div>

        {/* Last Contact */}
        {person.lastContactDate && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last contact: {formatDistanceToNow(new Date(person.lastContactDate), { addSuffix: true })}
          </div>
        )}

        {/* Stale Warning */}
        {isStale && (
          <div className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
            <AlertCircle className="h-3 w-3" />
            Overdue for contact
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-1 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogContact}
            title="Log contact"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
