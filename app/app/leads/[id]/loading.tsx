import { Skeleton } from "@/components/ui/skeleton";

/**
 * O endereço do lead redireciona para o quadro. O esqueleto segura o lugar
 * nesse intervalo, em vez de uma tela branca.
 */
export default function LeadLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full max-w-xl" />
    </div>
  );
}
