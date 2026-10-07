import type { Metadata } from "next";

/**
 * Link preview for the school application (2026-10-07): when Martin (or the
 * automatic reply) sends a school's IT team this link, the card says what it
 * is. Next replaces the whole openGraph/twitter object per route, so the
 * shared fields are repeated here.
 */
const TITLE = "Bring Averages.io to your school";
const DESCRIPTION = "For school and district IT teams using Canvas. Tell us about your school and we'll email you when it's approved.";

export const metadata: Metadata = {
  title: "Averages.io School Application",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Averages.io",
    title: TITLE,
    description: DESCRIPTION,
    url: "/schools/apply",
    images: [{ url: "/og-schools.png", width: 1200, height: 630, alt: "Bring it to your school: the Averages.io school application form, for schools and districts using Canvas." }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-schools.png"],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
