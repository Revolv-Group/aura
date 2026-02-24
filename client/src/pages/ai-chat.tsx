import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Bot,
  Send,
  Trash2,
  User,
  Sparkles,
  Calendar,
  Mail,
  StickyNote,
  Plus,
  MoreVertical,
  Pencil,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, isToday, isYesterday, isThisWeek } from "date-fns";
import { formatDubaiTime } from "@/lib/format-date";
import { useDecisionModal } from "@/lib/decision-modal-store";
import { Lightbulb } from "lucide-react";

interface ChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  userId: string;
  sessionId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: any;
  createdAt: string;
}

// Group sessions by date
function groupSessionsByDate(sessions: ChatSession[]) {
  const groups: { label: string; sessions: ChatSession[] }[] = [];
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const thisWeek: ChatSession[] = [];
  const older: ChatSession[] = [];

  sessions.forEach((session) => {
    const date = new Date(session.updatedAt);
    if (isToday(date)) {
      today.push(session);
    } else if (isYesterday(date)) {
      yesterday.push(session);
    } else if (isThisWeek(date)) {
      thisWeek.push(session);
    } else {
      older.push(session);
    }
  });

  if (today.length) groups.push({ label: "Today", sessions: today });
  if (yesterday.length) groups.push({ label: "Yesterday", sessions: yesterday });
  if (thisWeek.length) groups.push({ label: "This Week", sessions: thisWeek });
  if (older.length) groups.push({ label: "Older", sessions: older });

  return groups;
}

export default function AiChat() {
  const { toast } = useToast();
  const { openDecisionModal } = useDecisionModal();
  const [message, setMessage] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToEdit, setSessionToEdit] = useState<ChatSession | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track dismissed "Save as Decision" prompts for this session
  const [decisionDismissCount, setDecisionDismissCount] = useState(0);
  const showDecisionPrompt = decisionDismissCount < 3;

  // Fetch chat sessions
  const { data: sessions = [], isLoading: isLoadingSessions } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat/sessions"],
    queryFn: async () => {
      const res = await fetch("/api/chat/sessions", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch chat sessions");
      return await res.json();
    },
  });

  // Fetch chat history for active session
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/history", activeSessionId],
    queryFn: async () => {
      const url = activeSessionId
        ? `/api/chat/history?sessionId=${activeSessionId}`
        : "/api/chat/history";
      const res = await fetch(url, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch chat history");
      return await res.json();
    },
    enabled: activeSessionId !== null || sessions.length === 0,
  });

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: async (title?: string): Promise<ChatSession> => {
      const res = await apiRequest("POST", "/api/chat/sessions", {
        title: title || "New Chat",
      });
      return await res.json();
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/sessions"],
      });
      setActiveSessionId(session.id);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create new chat",
        variant: "destructive",
      });
    },
  });

  // Rename session mutation
  const renameSessionMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await apiRequest("PATCH", `/api/chat/sessions/${id}`, {
        title,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/sessions"],
      });
      setRenameDialogOpen(false);
      setSessionToEdit(null);
      toast({
        title: "Success",
        description: "Chat renamed",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to rename chat",
        variant: "destructive",
      });
    },
  });

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/chat/sessions/${id}`, {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/chat/sessions"],
      });
      if (sessionToEdit?.id === activeSessionId) {
        setActiveSessionId(null);
      }
      setDeleteDialogOpen(false);
      setSessionToEdit(null);
      toast({
        title: "Success",
        description: "Chat deleted",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete chat",
        variant: "destructive",
      });
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/chat", {
        message,
        sessionId: activeSessionId,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/history", activeSessionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/sessions"] });
      setMessage("");
      // Scroll to bottom after message is sent
      setTimeout(() => {
        if (scrollAreaRef.current) {
          const scrollContainer = scrollAreaRef.current.querySelector(
            "[data-radix-scroll-area-viewport]"
          );
          if (scrollContainer) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        }
      }, 100);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    },
  });

  // Clear chat mutation
  const clearChatMutation = useMutation({
    mutationFn: async () => {
      const url = activeSessionId
        ? `/api/chat/history?sessionId=${activeSessionId}`
        : "/api/chat/history";
      const res = await apiRequest("DELETE", url, {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/history", activeSessionId] });
      toast({
        title: "Success",
        description: "Chat history cleared",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to clear chat history",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || sendMessageMutation.isPending) return;

    // If no active session, create one first
    if (!activeSessionId && sessions.length === 0) {
      createSessionMutation.mutate("New Chat");
    }

    sendMessageMutation.mutate(message.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleNewChat = () => {
    createSessionMutation.mutate();
  };

  const handleRenameSession = (session: ChatSession) => {
    setSessionToEdit(session);
    setNewTitle(session.title);
    setRenameDialogOpen(true);
  };

  const handleDeleteSession = (session: ChatSession) => {
    setSessionToEdit(session);
    setDeleteDialogOpen(true);
  };

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollAreaRef.current && messages.length > 0) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Select first session if none selected
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const sessionGroups = groupSessionsByDate(sessions);

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <div
        className={`border-r bg-muted/30 flex flex-col transition-all duration-200 ${
          sidebarCollapsed ? "w-12" : "w-64"
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-3 border-b flex items-center justify-between">
          {!sidebarCollapsed && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 mr-2"
              onClick={handleNewChat}
              disabled={createSessionMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Chat
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Session List */}
        {!sidebarCollapsed && (
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-4">
              {isLoadingSessions ? (
                <div className="text-center text-muted-foreground text-sm p-4">
                  Loading...
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm p-4">
                  No conversations yet
                </div>
              ) : (
                sessionGroups.map((group) => (
                  <div key={group.label}>
                    <div className="text-xs text-muted-foreground font-medium px-2 mb-1">
                      {group.label}
                    </div>
                    <div className="space-y-1">
                      {group.sessions.map((session) => (
                        <div
                          key={session.id}
                          className={`group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer overflow-hidden ${
                            activeSessionId === session.id
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          }`}
                          onClick={() => setActiveSessionId(session.id)}
                        >
                          <MessageSquare className="h-4 w-4 shrink-0" />
                          <span className="flex-1 min-w-0 text-sm truncate">{session.title}</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-50 hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRenameSession(session);
                                }}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSession(session);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b bg-card">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <Bot className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">AI COO</h1>
                  <p className="text-sm text-muted-foreground">
                    Your strategic operating partner
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearChatMutation.mutate()}
                disabled={clearChatMutation.isPending || messages.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Chat
              </Button>
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 px-6 py-6 flex flex-col gap-4 overflow-hidden">
          {/* Messages */}
          <Card className="flex-1 overflow-hidden">
            <ScrollArea ref={scrollAreaRef} className="h-full p-6">
              {isLoadingMessages ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-muted-foreground">
                    <Bot className="h-12 w-12 mx-auto mb-2 animate-pulse" />
                    <p>Loading chat history...</p>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-6">
                  <div className="p-4 bg-purple-100 dark:bg-purple-900/30 rounded-full">
                    <Sparkles className="h-12 w-12 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="max-w-md">
                    <h3 className="text-xl font-semibold mb-2">Welcome to Your AI COO</h3>
                    <p className="text-muted-foreground mb-6">
                      I'm your strategic operating partner with full access to your ventures,
                      projects, tasks, health data, and trading journal.
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2 text-left">
                        <Calendar className="h-4 w-4 text-blue-500" />
                        <span>Manage daily operations</span>
                      </div>
                      <div className="flex items-center gap-2 text-left">
                        <Mail className="h-4 w-4 text-green-500" />
                        <span>Track all ventures</span>
                      </div>
                      <div className="flex items-center gap-2 text-left">
                        <StickyNote className="h-4 w-4 text-amber-500" />
                        <span>Create tasks & captures</span>
                      </div>
                      <div className="flex items-center gap-2 text-left">
                        <Sparkles className="h-4 w-4 text-purple-500" />
                        <span>Strategic insights</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                          <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                        </div>
                      )}
                      <div
                        className={`max-w-[70%] rounded-lg px-4 py-3 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                        <div
                          className={`text-xs mt-2 flex items-center gap-2 ${
                            msg.role === "user"
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatDubaiTime(msg.createdAt)}
                          {/* Save as Decision affordance for assistant messages */}
                          {msg.role === "assistant" && showDecisionPrompt && (
                            <>
                              <span className="opacity-30">|</span>
                              <button
                                onClick={() => {
                                  // Find the user message that preceded this one
                                  const msgIndex = messages.findIndex((m) => m.id === msg.id);
                                  const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
                                  openDecisionModal({
                                    source: 'ai_chat',
                                    context: userMsg?.role === 'user' ? userMsg.content : '',
                                    decision: '',
                                    reasoning: '',
                                  });
                                }}
                                className="flex items-center gap-1 text-primary/70 hover:text-primary transition-colors"
                              >
                                <Lightbulb className="h-3 w-3" />
                                Save as Decision
                              </button>
                              <button
                                onClick={() => setDecisionDismissCount((c) => c + 1)}
                                className="text-muted-foreground/50 hover:text-muted-foreground text-xs"
                                title="Dismiss"
                              >
                                ×
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {msg.role === "user" && (
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                      )}
                    </div>
                  ))}
                  {sendMessageMutation.isPending && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400 animate-pulse" />
                      </div>
                      <div className="max-w-[70%] rounded-lg px-4 py-3 bg-muted">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div
                              className="h-2 w-2 bg-purple-600 dark:bg-purple-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0ms" }}
                            ></div>
                            <div
                              className="h-2 w-2 bg-purple-600 dark:bg-purple-400 rounded-full animate-bounce"
                              style={{ animationDelay: "150ms" }}
                            ></div>
                            <div
                              className="h-2 w-2 bg-purple-600 dark:bg-purple-400 rounded-full animate-bounce"
                              style={{ animationDelay: "300ms" }}
                            ></div>
                          </div>
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </Card>

          {/* Input Area */}
          <Card className="p-4">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <Textarea
                ref={textareaRef}
                placeholder="Ask about your ventures, tasks, health, trading, or anything else..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                className="min-h-[60px] max-h-[200px] resize-none"
                disabled={sendMessageMutation.isPending}
              />
              <Button
                type="submit"
                size="icon"
                className="h-[60px] w-[60px] flex-shrink-0"
                disabled={!message.trim() || sendMessageMutation.isPending}
              >
                <Send className="h-5 w-5" />
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-2">
              Press <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border">Enter</kbd> to
              send,{" "}
              <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border">Shift+Enter</kbd> for
              new line
            </p>
          </Card>
        </div>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>Enter a new name for this conversation.</DialogDescription>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Chat name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (sessionToEdit && newTitle.trim()) {
                  renameSessionMutation.mutate({ id: sessionToEdit.id, title: newTitle.trim() });
                }
              }}
              disabled={!newTitle.trim() || renameSessionMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the chat "{sessionToEdit?.title}" and all its messages.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (sessionToEdit) {
                  deleteSessionMutation.mutate(sessionToEdit.id);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
