import Image from "next/image";
import { cn } from "@/lib/utils";

/** The app's logo (public/logo.png): the shop front mark, with the outside of the shape transparent. */
export function BrandLogo({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      priority
      unoptimized
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
