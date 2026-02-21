import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Briefcase, Heart, BookOpen, Focus, Settings, Sun, Moon, ShoppingCart, Library } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/morning", label: "Morning", icon: Sun },
  { href: "/evening", label: "Evening", icon: Moon },
  { href: "/ventures", label: "Ventures", icon: Briefcase },
  { href: "/deep-work", label: "Deep Work", icon: Focus },
  { href: "/health-hub", label: "Health", icon: Heart },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/books", label: "Books", icon: Library },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function NavLinks() {
  const [location] = useLocation();

  return (
    <div className="hidden md:flex gap-1">
      {links.map((link) => {
        const Icon = link.icon;
        const isActive = location === link.href;

        return (
          <Link key={link.href} href={link.href}>
            <a
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </a>
          </Link>
        );
      })}
    </div>
  );
}
