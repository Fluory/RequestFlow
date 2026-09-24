"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Navigation link that marks the current section with `aria-current="page"` (styled, and announced). */
export function NavLink({ href, also = [], children }: { href: string; also?: string[]; children: ReactNode }) {
  const pathname = usePathname();
  const current = [href, ...also].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
