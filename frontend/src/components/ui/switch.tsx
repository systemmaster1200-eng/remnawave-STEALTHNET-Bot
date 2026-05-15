import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full outline-none transition-all duration-300 ease-in-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.15),inset_0_1px_2px_rgba(0,0,0,0.1)]",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[22px] w-[22px] rounded-full bg-white ring-0 transition-all duration-300 ease-in-out data-[state=checked]:translate-x-[23px] data-[state=unchecked]:translate-x-[3px] shadow-[0_2px_6px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,1)]"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
