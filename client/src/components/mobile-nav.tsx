import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, LayoutDashboard, Briefcase, Heart, BookOpen, Focus, Settings, Sun, Moon, ShoppingCart, Library } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/morning", label: "Morning Ritual", icon: Sun },
  { href: "/evening", label: "Evening Review", icon: Moon },
  { href: "/ventures", label: "Ventures", icon: Briefcase },
  { href: "/deep-work", label: "Deep Work", icon: Focus },
  { href: "/health-hub", label: "Health", icon: Heart },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/books", label: "Books", icon: Library },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] sm:w-[400px]">
        <nav className="flex flex-col gap-4 mt-8">
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-2">Navigation</h2>
          </div>
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location === link.href;

            return (
              <Link key={link.href} href={link.href}>
                <a
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {link.label}
                </a>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
