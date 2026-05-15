import * as React from "react";
import { cn } from "@/lib/utils";

const TabsContext = React.createContext<{
  value: string;
  onValueChange: (v: string) => void;
} | null>(null);

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn(className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-xl bg-muted/60 p-1.5 text-muted-foreground gap-0.5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) return null;
  const isActive = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        isActive ? "bg-background text-foreground shadow-md" : "hover:bg-background/60 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(TabsContext);
  if (!ctx || ctx.value !== value) return null;
  return (
    <div className={cn("mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}>
      {children}
    </div>
  );
}
