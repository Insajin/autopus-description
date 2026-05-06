import type { ReactNode } from "react";

export const metadata = {
  title: "SPEC-FIGMA-004 Review Dashboard",
  description: "PM review and write-back dashboard for description manifests.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
