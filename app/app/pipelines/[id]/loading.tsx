import { Skeleton } from "@/components/ui/skeleton";

/** O quadro do funil: colunas no lugar enquanto os cards chegam. */
export default function QuadroLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-56" />
      <div className="flex flex-1 gap-4 overflow-x-auto">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="w-72 shrink-0 space-y-3">
            <Skeleton className="h-6 w-32" />
            {Array.from({ length: 3 }).map((_, card) => (
              <Skeleton key={card} className="h-24 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
