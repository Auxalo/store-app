import { Suspense } from "react";
import { PartyDetailScreen } from "@/components/parties/party-detail-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PartyDetailScreen kind="supplier" />
    </Suspense>
  );
}
