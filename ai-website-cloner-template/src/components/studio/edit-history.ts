"use client";
import { useState } from "react";
export function useEditHistory<T>() {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  return {
    canUndo: past.length > 0, canRedo: future.length > 0,
    record(value: T) { setPast(items => [...items.slice(-39), value]); setFuture([]); },
    clear() { setPast([]); setFuture([]); },
    undo(current: T, apply: (value: T) => void) { const value = past.at(-1); if (value === undefined) return; setPast(past.slice(0,-1)); setFuture([current,...future]); apply(value); },
    redo(current: T, apply: (value: T) => void) { const value = future[0]; if (value === undefined) return; setPast([...past,current]); setFuture(future.slice(1)); apply(value); },
  };
}
