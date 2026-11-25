import { useEffect, useRef } from "react";

/**
 * ChatGPT-style edge swipe for the sidebar (owner, 2026-11-25):
 * on a touch screen, dragging right from the left edge opens the
 * drawer, and dragging left while it is open closes it.
 *
 * - Opens only when the touch STARTS within EDGE_PX of the left edge
 *   and moves right, clearly horizontal. The first touchmove is
 *   cancelled (non-passive listener) so Android Chrome's own
 *   edge-swipe-back does not steal the gesture.
 * - Closes on a clear left swipe while open (any start point).
 * - Vertical scrolling is untouched: the gesture only engages when
 *   the movement is clearly horizontal (|dx| > 1.5 * |dy|).
 * - Mouse users are unaffected (touch events only); the hamburger
 *   button still works everywhere.
 */

const EDGE_PX = 32;
const ENGAGE_PX = 24;
const OPEN_PX = 60;
const CLOSE_PX = 60;

export function useEdgeSwipeDrawer(
  isOpen: boolean,
  onOpen: () => void,
  onClose: () => void
) {
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    edge: boolean;
    engaged: boolean;
  } | null>(null);
  const stateRef = useRef({ isOpen, onOpen, onClose });
  stateRef.current = { isOpen, onOpen, onClose };

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        gestureRef.current = null;
        return;
      }
      const t = e.touches[0];
      gestureRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        edge: t.clientX <= EDGE_PX,
        engaged: false,
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      if (Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      const { isOpen } = stateRef.current;
      if (!isOpen && g.edge && dx > ENGAGE_PX) {
        g.engaged = true;
        e.preventDefault();
      } else if (isOpen && dx < -ENGAGE_PX) {
        g.engaged = true;
        e.preventDefault();
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g || !g.engaged) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - g.startX;
      const { isOpen, onOpen, onClose } = stateRef.current;
      if (!isOpen && dx > OPEN_PX) onOpen();
      else if (isOpen && dx < -CLOSE_PX) onClose();
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
}
