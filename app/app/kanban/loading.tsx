import { Skeleton } from "@/components/ui/skeleton";

/** A lista de funis, não o quadro — o quadro tem o esqueleto em pipelines/[id]. */
export default function FunisLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-32" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
