import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Joyride,
  EVENTS,
  STATUS,
  Step,
  type Controls,
  type EventData,
  type TooltipRenderProps,
} from "react-joyride";
import { TourTooltip } from "./tour-tooltip";
import { api, type ClientTourStep, type PublicConfig } from "@/lib/api";
import { useCabinetConfig } from "@/contexts/cabinet-config";

interface DashboardTourProps {
  run: boolean;
  onComplete: () => void;
}

interface TourStepWithRoute extends Step {
  route?: string | null;
}

// ── Disabled-tab detection ─────────────────────────────────────────
// Maps data-tour attribute values AND cabinet routes to config checks.
// Returns true when the corresponding tab is DISABLED (hidden from user).

type ConfigCheck = (c: PublicConfig) => boolean;

const DISABLED_BY_TOUR_ATTR: Record<string, ConfigCheck> = {
  "custom-build": (c) => !c.customBuildConfig,
  "extra-options": (c) => !c.sellOptionsEnabled,
  "proxy": (c) => !c.showProxyEnabled,
  "singbox": (c) => !c.showSingboxEnabled,
  "gifts": (c) => !c.giftSubscriptionsEnabled,
};

const DISABLED_BY_ROUTE: Record<string, ConfigCheck> = {
  "/cabinet/custom-build": (c) => !c.customBuildConfig,
  "/cabinet/extra-options": (c) => !c.sellOptionsEnabled,
  "/cabinet/proxy": (c) => !c.showProxyEnabled,
  "/cabinet/singbox": (c) => !c.showSingboxEnabled,
  "/cabinet/gifts": (c) => !c.giftSubscriptionsEnabled,
};

/** Reverse map: route → data-tour attribute for nav buttons */
const ROUTE_TO_NAV_ATTR: Record<string, string> = {
  "/cabinet/dashboard": "dashboard",
  "/cabinet/tariffs": "tariffs",
  "/cabinet/custom-build": "custom-build",
  "/cabinet/extra-options": "extra-options",
  "/cabinet/proxy": "proxy",
  "/cabinet/singbox": "singbox",
  "/cabinet/referral": "referrals",
  "/cabinet/gifts": "gifts",
  "/cabinet/profile": "profile",
};

/** Extract `data-tour` value from selectors like `[data-tour="subscription"]` */
function extractTourAttr(target: string): string | null {
  const m = target.match(/\[data-tour="([^"]+)"\]/);
  return m ? m[1] : null;
}

/** Returns true if the step targets a tab that is currently disabled in config. */
function isStepDisabled(step: TourStepWithRoute, config: PublicConfig): boolean {
  // Check by route
  if (step.route) {
    const routeCheck = DISABLED_BY_ROUTE[step.route];
    if (routeCheck?.(config)) return true;
  }
  // Check by data-tour attribute in the target selector
  const attr = extractTourAttr(step.target as string);
  if (attr) {
    const attrCheck = DISABLED_BY_TOUR_ATTR[attr];
    if (attrCheck?.(config)) return true;
  }
  return false;
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 768;
}

/**
 * Waits for the React route transition to settle before resuming.
 * Uses a longer delay on mobile to let React Router fully mount the new
 * route's component tree — joyride's `targetWaitTimeout` then handles
 * the element.
 */
function waitForRouteSettled(callback: () => void) {
  requestAnimationFrame(() => {
    setTimeout(callback, isMobileViewport() ? 600 : 400);
  });
}

/**
 * If the target step points at [data-tour="floating-chat"],
 * dispatch a custom event so FloatingChat opens itself (desktop only).
 * On mobile, re-target the step to the FAB button instead of the panel.
 * Returns a small delay (ms) the caller should wait before showing the step.
 */
function ensureFloatingChatOpen(step: TourStepWithRoute): number {
  const target = typeof step.target === "string" ? step.target : "";
  if (!target.includes("floating-chat")) return 0;

  if (isMobileViewport()) {
    // On mobile: point at the FAB button, don't open the panel
    step.target = '[data-tour="floating-chat-button"]';
    return 0;
  }
  // Desktop: open the panel, then point at it
  window.dispatchEvent(new CustomEvent("tour:open-chat"));
  return 400;
}

// ── OverflowHint component ─────────────────────────────────────────
// Mini-tooltip "Нажми сюда" shown over a nav item inside the overflow menu.

interface OverflowHintProps {
  navAttr: string;
  onNavigated: () => void;
}

function OverflowHint({ navAttr, onNavigated }: OverflowHintProps) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const selector = `[data-tour="${navAttr}"]`;

  // Position the hint over the target element inside the dialog
  useEffect(() => {
    let cancelled = false;
    const tryPosition = () => {
      if (cancelled) return;
      // Find the element inside the dialog (overflow menu)
      const dialog = document.querySelector("[role='dialog']");
      const el = dialog?.querySelector(selector) ?? document.querySelector(selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      setPos({ top: rect.top, left: rect.left + rect.width / 2, width: rect.width });

      // Add highlight class
      el.classList.add("tour-overflow-highlight");
    };

    // Retry: dialog may still be animating open
    const t1 = setTimeout(tryPosition, 100);
    const t2 = setTimeout(tryPosition, 300);
    const t3 = setTimeout(tryPosition, 500);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [selector]);

  // Listen for click on the element → navigation will happen via Link
  useEffect(() => {
    const dialog = document.querySelector("[role='dialog']");
    const el = dialog?.querySelector(selector) ?? document.querySelector(selector);
    if (!el) return;

    const handler = () => {
      el.classList.remove("tour-overflow-highlight");
      // Small delay for route transition to start
      setTimeout(onNavigated, 50);
    };
    el.addEventListener("click", handler, { once: true });
    return () => el.removeEventListener("click", handler);
  }, [selector, onNavigated]);

  // Cleanup highlight on unmount
  useEffect(() => {
    return () => {
      document.querySelector(`.tour-overflow-highlight`)?.classList.remove("tour-overflow-highlight");
    };
  }, []);

  if (!pos) return null;

  return (
    <>
      {/* Tooltip arrow + label — sits above Dialog (z-50) */}
      <div
        className="fixed z-[60] pointer-events-none"
        style={{ top: pos.top - 44, left: pos.left, transform: "translateX(-50%)" }}
      >
        <div className="bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-xl shadow-xl whitespace-nowrap animate-bounce">
          Нажми сюда ☝️
          <div className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-3 h-3 bg-primary rotate-45 rounded-sm" />
        </div>
      </div>
    </>
  );
}

// ── Inject global CSS for overflow highlight ───────────────────────
const OVERFLOW_STYLE_ID = "tour-overflow-highlight-style";
function ensureOverflowStyles() {
  if (document.getElementById(OVERFLOW_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = OVERFLOW_STYLE_ID;
  style.textContent = `
    .tour-overflow-highlight {
      position: relative;
      z-index: 2 !important;
      box-shadow: 0 0 0 3px hsl(var(--primary) / 0.5), 0 0 20px hsl(var(--primary) / 0.2);
      border-radius: 0.75rem;
      animation: tour-overflow-pulse 1.5s ease-in-out infinite;
    }
    @keyframes tour-overflow-pulse {
      0%, 100% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.5), 0 0 20px hsl(var(--primary) / 0.2); }
      50% { box-shadow: 0 0 0 6px hsl(var(--primary) / 0.3), 0 0 30px hsl(var(--primary) / 0.15); }
    }
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════

export function DashboardTour({ run, onComplete }: DashboardTourProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const config = useCabinetConfig();

  const [allSteps, setAllSteps] = useState<TourStepWithRoute[]>([]);
  const [allTourSteps, setAllTourSteps] = useState<ClientTourStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  // Overflow menu hint state
  const [overflowHint, setOverflowHint] = useState<{
    navAttr: string;
    pendingStepIndex: number;
  } | null>(null);

  // Track whether we're mid-navigation so the location effect fires correctly
  const navigatingRef = useRef(false);
  const pendingStepRef = useRef<number | null>(null);
  // Store joyride controls for programmatic navigation after route change
  const controlsRef = useRef<Controls | null>(null);
  // Track last user action to know direction for TARGET_NOT_FOUND skipping
  const lastActionRef = useRef<string>("next");

  // Inject overflow highlight CSS once
  useEffect(() => { ensureOverflowStyles(); }, []);

  // ── Filter out steps targeting disabled tabs ─────────────────────
  const { steps, tourSteps } = useMemo(() => {
    if (!config) return { steps: allSteps, tourSteps: allTourSteps };

    const enabledIndices: number[] = [];
    allSteps.forEach((s, i) => {
      if (!isStepDisabled(s, config)) enabledIndices.push(i);
    });

    return {
      steps: enabledIndices.map((i) => allSteps[i]),
      tourSteps: enabledIndices.map((i) => allTourSteps[i]),
    };
  }, [allSteps, allTourSteps, config]);

  // ── Load steps from API ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    api
      .getClientTourSteps()
      .then((data) => {
        if (cancelled) return;
        setAllTourSteps(data.items);
        setAllSteps(
          data.items.map((s) => ({
            target: s.target,
            placement: s.placement as Step["placement"],
            title: s.title,
            content: s.content,
            skipBeacon: true,
            route: s.route,
          })),
        );
      })
      .catch((err) => {
        console.error("Failed to load tour steps:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Start tour when run=true and steps are loaded ────────────────
  useEffect(() => {
    if (!run || loading || steps.length === 0) return;

    const firstStep = steps[0];
    if (firstStep.route && firstStep.route !== location.pathname) {
      navigatingRef.current = true;
      pendingStepRef.current = 0;
      navigate(firstStep.route);
    } else {
      setStepIndex(0);
      setIsRunning(true);
    }
  }, [run, loading, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── After navigation completes, wait for route to settle then resume ──
  useEffect(() => {
    if (!navigatingRef.current || pendingStepRef.current === null) return;
    navigatingRef.current = false;

    // Clean up overflow hint if it was showing
    setOverflowHint(null);

    const idx = pendingStepRef.current;
    pendingStepRef.current = null;
    if (idx < 0 || idx >= steps.length) return;

    waitForRouteSettled(() => {
      const delay = ensureFloatingChatOpen(steps[idx]);
      if (delay > 0) {
        setTimeout(() => {
          setStepIndex(idx);
          setIsRunning(true);
        }, delay);
      } else {
        setStepIndex(idx);
        setIsRunning(true);
      }
    });
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle overflow hint navigation ──────────────────────────────
  // When user clicks a nav item in overflow menu, the route changes.
  // We detect that here and resume the tour.
  const handleOverflowNavigated = useCallback(() => {
    setOverflowHint(null);
    // navigatingRef + pendingStepRef are already set in tryOverflowNavigation.
    // The location.pathname effect handles resuming the tour.
  }, []);

  /**
   * Try to navigate to a step via the overflow menu.
   * Returns true if overflow navigation was initiated (caller should return early).
   */
  const tryOverflowNavigation = useCallback(
    (nextStep: TourStepWithRoute, nextIndex: number): boolean => {
      // Extract the tour attribute from the step's target selector
      const targetAttr = extractTourAttr(nextStep.target as string);
      if (!targetAttr) return false;

      // Only handle nav buttons (values present in ROUTE_TO_NAV_ATTR)
      const isNavButton = Object.values(ROUTE_TO_NAV_ATTR).includes(targetAttr);
      if (!isNavButton) return false;

      // Check if this nav button is visible in the nav bar or hidden in overflow
      const allEls = document.querySelectorAll(`[data-tour="${targetAttr}"]`);
      let visibleInNav = false;
      for (const el of allEls) {
        if (el.closest("[role='dialog']") || el.closest(".tour-overflow-dropdown"))
          continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visibleInNav = true;
          break;
        }
      }
      if (visibleInNav) return false; // visible in nav bar — Joyride can handle it

      // Nav button is in overflow — open menu and show hint
      setIsRunning(false);
      navigatingRef.current = true;
      pendingStepRef.current = nextIndex;
      window.dispatchEvent(new CustomEvent("tour:open-more-menu"));
      setTimeout(() => {
        setOverflowHint({ navAttr: targetAttr, pendingStepIndex: nextIndex });
      }, 400); // wait for Dialog open animation
      return true;
    },
    [location.pathname],
  );

  // ── Joyride event handler (controlled mode, v3 API) ──────────────
  const handleEvent = useCallback(
    (data: EventData, controls: Controls) => {
      const { action, index, status, type } = data;

      controlsRef.current = controls;

      // Tour finished or skipped — but NOT if we're mid-navigation.
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        if (navigatingRef.current || pendingStepRef.current !== null) return;
        window.dispatchEvent(new Event("tour:hide-gift-mocks"));
        setIsRunning(false);
        onComplete();
        return;
      }

      // Target not found — skip the step.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        const direction = lastActionRef.current === "prev" ? -1 : 1;
        const skipTo = index + direction;
        if (skipTo >= 0 && skipTo < steps.length) {
          setStepIndex(skipTo);
        } else {
          setIsRunning(false);
          onComplete();
        }
        return;
      }

      if (type === EVENTS.STEP_AFTER) {
        const isPrev = action === "prev";
        lastActionRef.current = isPrev ? "prev" : "next";
        const nextIndex = isPrev ? index - 1 : index + 1;

        // Bounds check
        if (nextIndex < 0 || nextIndex >= steps.length) {
          window.dispatchEvent(new Event("tour:hide-gift-mocks"));
          setIsRunning(false);
          onComplete();
          return;
        }

        const nextStep = steps[nextIndex];
        const currentTarget = typeof steps[index]?.target === "string" ? steps[index].target : "";
        const nextTarget = typeof nextStep.target === "string" ? nextStep.target : "";

        // Toggle gift mock subscriptions based on entering/leaving the gifts-subscriptions step
        if (nextTarget.includes('gifts-subscriptions') && !currentTarget.includes('gifts-subscriptions')) {
          window.dispatchEvent(new Event("tour:show-gift-mocks"));
        } else if (currentTarget.includes('gifts-subscriptions') && !nextTarget.includes('gifts-subscriptions')) {
          window.dispatchEvent(new Event("tour:hide-gift-mocks"));
        }

        // Close floating chat when leaving the floating-chat step
        if (currentTarget.includes('floating-chat') && !nextTarget.includes('floating-chat')) {
          window.dispatchEvent(new Event("tour:close-chat"));
        }

        // Check if we need to navigate via overflow menu first
        if (tryOverflowNavigation(nextStep, nextIndex)) {
          return; // Overflow flow takes over
        }

        // Check if we need to navigate to a different route
        if (nextStep.route && nextStep.route !== location.pathname) {
          navigatingRef.current = true;
          pendingStepRef.current = nextIndex;
          setIsRunning(false);
          navigate(nextStep.route);
        } else {
          // Same route — open floating chat if needed, then update stepIndex.
          const delay = ensureFloatingChatOpen(nextStep);
          if (delay > 0) {
            setTimeout(() => setStepIndex(nextIndex), delay);
          } else {
            setStepIndex(nextIndex);
          }
        }
      }
    },
    [steps, location.pathname, navigate, onComplete, tryOverflowNavigation],
  );

  if (loading || steps.length === 0) return null;

  return (
    <>
      {overflowHint && (
        <OverflowHint
          navAttr={overflowHint.navAttr}
          onNavigated={handleOverflowNavigated}
        />
      )}
      <Joyride
        steps={steps}
        run={isRunning}
        stepIndex={stepIndex}
        continuous
        options={{
          overlayClickAction: false,
          blockTargetInteraction: true,
          buttons: ["back", "close", "primary", "skip"],
          targetWaitTimeout: 5000,
          spotlightRadius: 16,
          zIndex: 10000,
          scrollOffset: 80,
        }}
        styles={{
          overlay: {
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
          },
        }}
        onEvent={handleEvent}
        tooltipComponent={(props: TooltipRenderProps) => (
          <TourTooltip {...props} tourSteps={tourSteps} />
        )}
      />
    </>
  );
}
